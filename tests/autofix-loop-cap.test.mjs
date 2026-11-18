import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 2026-11-18: 翻訳の揺れで再生成が収束せず、1 つの PR で 300 回以上コミット・検証失敗 200 件に達した。
// 自動修正の手順（validate-generated-pr.yml）を実際に Git で動かし、収束しなければ上限で止まることを確かめる。
const text = fs.readFileSync(".github/workflows/validate-generated-pr.yml", "utf8").replace(/\r\n/g, "\n");
const start = text.indexOf("- name: Auto-fix canonical generated outputs");
const runStart = text.indexOf("run: |\n", start) + "run: |\n".length;
const runEnd = text.indexOf("\n      - name:", runStart);
const script = text.slice(runStart, runEnd).split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n") + "\n";

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" });
const haveBash = spawnSync("bash", ["-c", "true"]).status === 0;

function simulate(driftFor) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "autofix-"));
  try {
    const repo = path.join(root, "repo");
    const remote = path.join(root, "remote.git");
    fs.mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    for (const [k, v] of [["user.name", "t"], ["user.email", "t@t"], ["core.autocrlf", "false"]]) git(repo, "config", k, v);
    for (const dir of ["data", "config", "summaries", "drafts"]) fs.mkdirSync(path.join(repo, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, "data/x.json"), '{"a":1}\n');
    fs.writeFileSync(path.join(repo, "summaries/.keep"), "x\n");
    fs.writeFileSync(path.join(repo, "drafts/.keep"), "x\n");
    fs.writeFileSync(path.join(repo, "config/summary-ja-cache.json"), "{}\n");
    fs.writeFileSync(path.join(repo, "config/related-documents.json"), "{}\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");
    const base = git(repo, "rev-parse", "HEAD").stdout.trim();
    git(root, "init", "-q", "--bare", remote);
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-q", "origin", "main");
    git(repo, "checkout", "-q", "-b", "pr");
    fs.writeFileSync(path.join(repo, "data/x.json"), '{"a":2}\n');
    git(repo, "commit", "-q", "-am", "agent change");
    git(repo, "push", "-q", "origin", "pr");
    fs.writeFileSync(path.join(root, "autofix.sh"), script);

    const env = { ...process.env, PR_USER_LOGIN: "copilot-swe-agent", PR_TITLE: "chore: improve digest automation 2026-11-18", PR_BODY: "Generated from data/events/2026-11-18.json", PR_HEAD_REF: "pr", PR_BASE_SHA: base };
    const exits = [];
    for (let i = 1; i <= 8; i += 1) {
      if (i <= driftFor) fs.writeFileSync(path.join(repo, "config/summary-ja-cache.json"), `{"flip":${i}}\n`);
      const result = spawnSync("bash", [path.join(root, "autofix.sh")], { cwd: repo, env, encoding: "utf8" });
      exits.push({ code: result.status, out: `${result.stdout}${result.stderr}` });
      if (result.status === 0) break;
      git(repo, "reset", "-q", "--hard");
      git(repo, "fetch", "-q", "origin", "pr");
      git(repo, "reset", "-q", "--hard", "origin/pr");
    }
    const pushed = git(repo, "log", `${base}..origin/pr`, "--grep=^chore: regenerate canonical digest outputs$", "--format=%h").stdout.split("\n").filter(Boolean).length;
    return { exits, pushed };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a regeneration that never converges is pushed at most 3 times, then fails with an explanation", { skip: !haveBash }, () => {
  const { exits, pushed } = simulate(99);
  assert.equal(pushed, 3, "no more than 3 automatic regenerations may be pushed");
  assert.ok(exits.slice(0, 3).every((item) => item.code === 1));
  const stopped = exits[3];
  assert.equal(stopped.code, 1);
  assert.match(stopped.out, /do not converge/);
  assert.ok(exits.slice(3).every((item) => item.code === 1), "once the cap is hit it must keep failing instead of pushing");
});

test("a regeneration that converges within the cap still passes", { skip: !haveBash }, () => {
  const { exits, pushed } = simulate(2);
  assert.equal(pushed, 2);
  assert.equal(exits.at(-1).code, 0);
});

test("the step receives the PR base SHA to count only this PR's regenerations", () => {
  assert.match(text, /PR_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(text, /max_autofix=3/);
});
