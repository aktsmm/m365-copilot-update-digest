import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

// gh-aw のロックファイルは、元の .md を編集したあと必ず `gh aw compile` し直す。ずれたままの commit を CI で止める。
// あわせて、どのワークフローも permissions を宣言し、write-all と pull_request_target を使わないことを確認する。
const dir = ".github/workflows";
const names = fs.readdirSync(dir);
const read = (file) => fs.readFileSync(`${dir}/${file}`, "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");

for (const file of names.filter((name) => name.endsWith(".md"))) {
  test(`${file} matches its compiled lock file`, () => {
    const lock = file.replace(/\.md$/, ".lock.yml");
    assert.ok(names.includes(lock), `${file} has no compiled ${lock}; run \`gh aw compile\``);
    const meta = JSON.parse(read(lock).match(/gh-aw-metadata: (\{.*\})/)?.[1] ?? "null");
    assert.ok(meta?.body_hash, `${lock} has no gh-aw metadata`);
    const source = read(file).replace(/\r\n/g, "\n");
    const body = source.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)?.[1] ?? "";
    assert.equal(sha(body.trim()), meta.body_hash, `${file} was edited after ${lock} was compiled; run \`gh aw compile\` and commit the lock file`);
  });
}

for (const file of names.filter((name) => name.endsWith(".yml") && !name.endsWith(".lock.yml"))) {
  test(`${file} declares permissions and avoids risky triggers`, () => {
    const text = read(file);
    assert.match(text, /^permissions:/m, `${file} must declare its permissions`);
    assert.doesNotMatch(text, /write-all/, `${file} must not use write-all`);
    if (/^\s*pull_request_target:/m.test(text) && /actions\/checkout/.test(text)) {
      assert.match(text, /head\.repo\.full_name == github\.repository/, `${file} uses pull_request_target with a checkout; it must be limited to same-repository PRs`);
    }
  });
}
