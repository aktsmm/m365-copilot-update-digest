import assert from "node:assert/strict";
import test from "node:test";
import { isSameSourceText } from "../scripts/collect.mjs";

test("an excerpt cut or a dropped lead sentence is still the same source text", () => {
  const cached =
    "Add an agent node to your workflow to reason over data, call tools, and return a response, all within a single step. The agent node lets you embed reasoning directly into your workflow. This means fewer manual handoffs...";
  const current =
    "The agent node lets you embed reasoning directly into your workflow. This means fewer manual handoffs";
  assert.equal(isSameSourceText(cached, current), true);
  assert.equal(isSameSourceText(cached, cached.replace("...", "")), true);
});

test("genuinely different or too short text is not treated as the same", () => {
  assert.equal(
    isSameSourceText(
      "Copilot Chat now supports image search across your files and meetings in Teams.",
      "Admins can now manage agent inventory from the Microsoft 365 admin center.",
    ),
    false,
  );
  assert.equal(isSameSourceText("agent node", "The agent node is here"), false);
  assert.equal(isSameSourceText("", "text"), false);
});
