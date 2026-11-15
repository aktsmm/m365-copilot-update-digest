import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// 収集のたびに自動化 Issue の本文（調査候補の一覧）を上書きすると、エージェントが依頼どおりに調べた PR と食い違って見える。
const text = fs.readFileSync(".github/workflows/author-automation-pr.yml", "utf8");

test("the automation issue body is not rewritten while Copilot is assigned", () => {
  const guard = text.indexOf("const copilotWorking");
  const skip = text.indexOf("if (existing && copilotWorking)");
  const update = text.indexOf("github.rest.issues.update");
  assert.ok(guard > 0, "copilotWorking must be computed from the existing issue's assignees");
  assert.ok(skip > guard, "the Copilot-assigned branch must come before the update");
  assert.ok(update > skip, "issues.update must only run in the else branch");
  assert.match(text, /\(existing\.assignees \|\| \[\]\)\.some\(\(assignee\) => copilotLogins\.has\(assignee\.login\)\)/);
});

test("there is exactly one issues.update call, and it is not reached for a Copilot-assigned issue", () => {
  assert.equal((text.match(/github\.rest\.issues\.update\(/g) || []).length, 1);
  assert.match(text, /\} else if \(existing\) \{\s*await github\.rest\.issues\.update\(/);
});
