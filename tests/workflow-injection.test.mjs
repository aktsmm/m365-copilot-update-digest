import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// 信頼できない入力（PR のタイトル・本文・ブランチ名など）を run / script に直接埋め込むと、スクリプトインジェクションになる。
// 値は env に渡してから参照する（validate-generated-pr.yml のように）。
const files = fs.readdirSync(".github/workflows").filter((f) => f.endsWith(".yml") && !f.endsWith(".lock.yml"));
const UNTRUSTED = /\$\{\{[^}]*github\.(event\.[a-z_.]*(title|body|ref|label|name|message|login|email)|head_ref)[^}]*\}\}/i;

test("hand-written workflows never interpolate untrusted event fields inside run or script blocks", () => {
  const bad = [];
  for (const file of files) {
    const lines = fs.readFileSync(`.github/workflows/${file}`, "utf8").split(/\r?\n/);
    let inBlock = false;
    let indent = 0;
    lines.forEach((line, i) => {
      const start = line.match(/^(\s*)(?:-\s+)?(run|script):\s*(.*)$/);
      if (start) {
        inBlock = true;
        indent = start[1].length;
        if (UNTRUSTED.test(start[3])) bad.push(`${file}:${i + 1}`);
        return;
      }
      if (inBlock && line.trim() && line.match(/^(\s*)/)[1].length <= indent) {
        inBlock = false;
        return;
      }
      if (inBlock && UNTRUSTED.test(line)) bad.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], `move these into env: ${bad.join(", ")}`);
});

test("hand-written workflows only use first-party actions", () => {
  const external = [];
  for (const file of files) {
    for (const m of fs.readFileSync(`.github/workflows/${file}`, "utf8").matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      if (!/^(actions|github)\//.test(m[1])) external.push(`${file}: ${m[1]}`);
    }
  }
  assert.deepEqual(external, [], "third-party actions need pinning to a commit SHA and a review");
});