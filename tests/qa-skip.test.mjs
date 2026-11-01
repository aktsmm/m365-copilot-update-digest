import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

test("pending-qa leaves out the ids listed in config/qa-skip.json", () => {
  const skip = JSON.parse(fs.readFileSync("config/qa-skip.json", "utf8")).skip;
  assert.ok(Array.isArray(skip));
  const out = execFileSync("node", ["scripts/pending-qa.mjs", "--limit", "1000"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  for (const id of skip) assert.ok(!out.includes(id), `${id} should be skipped`);
});