import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// 新しいワークフローや設定ファイルを足したのに README に書き忘れる、を防ぐ。
const readme = fs.readFileSync("README.md", "utf8");

test("every workflow is described in the README", () => {
  const names = fs
    .readdirSync(".github/workflows")
    .filter((f) => (f.endsWith(".yml") && !f.endsWith(".lock.yml")) || f.endsWith(".md"))
    .map((f) => f.replace(/\.(yml|md)$/, ""));
  const missing = names.filter((name) => !readme.includes(name));
  assert.deepEqual(missing, [], `README must mention: ${missing.join(", ")}`);
});

test("every file in config/ is described in the README", () => {
  const missing = fs.readdirSync("config").filter((f) => !readme.includes(f));
  assert.deepEqual(missing, [], `README must mention: ${missing.join(", ")}`);
});