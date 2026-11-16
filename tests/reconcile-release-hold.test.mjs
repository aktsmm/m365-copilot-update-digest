import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// 自動マージが「出所マーカー欠落」で付けた needs-human-review は、マーカーが戻ったら外す（PR #1457）。
// 他の理由・人が付けたラベルは外さない。ワークフロー内のロジックなので、判定条件を静的に守る。
const text = fs.readFileSync(".github/workflows/reconcile-generated-prs.yml", "utf8");
const start = text.indexOf("- name: Release transient human-review holds");
const end = text.indexOf("- name: Close stale no-op generated PRs");
const step = text.slice(start, end);

test("the reconciler has a step that releases the transient hold, after the metadata is normalized", () => {
  assert.ok(start > 0 && end > start, "the release step must exist before the stale no-op step");
  assert.ok(start > text.indexOf("- name: Normalize generated PR metadata"), "it must run after normalization restores the marker");
});

test("the hold is only released when the only stop reason is the missing marker and the bot applied the label", () => {
  assert.match(step, /missing the source marker/);
  assert.match(step, /reasons\.every\(\(comment\) => missingMarker\.test/);
  assert.match(step, /labeledBy\.every\(\(event\) => event\.actor\?\.login === 'github-actions\[bot\]'\)/);
  assert.match(step, /if \(!bodyPattern\.test\(pr\.body \|\| ''\)\) continue;/);
});

test("the stop message produced by auto-merge is the one the reconciler looks for", () => {
  const autoMerge = fs.readFileSync(".github/workflows/auto-merge-generated-pr.yml", "utf8");
  assert.match(autoMerge, /Auto-merge stopped: \$\{reason\}/);
  assert.match(autoMerge, /body is missing the source marker\./);
  assert.match(step, /Auto-merge stopped: PR #\\d\+ body is missing the source marker\\\./);
});
