import assert from "node:assert/strict";
import test from "node:test";
import { annotateEvent, classifyCategories, importanceLevel, loadCategoryConfig } from "../scripts/lib/classify.mjs";

const config = loadCategoryConfig();

test("classifies by product area, tag, and title; order follows config", () => {
  assert.deepEqual(
    classifyCategories({ productArea: "Microsoft Purview", tags: [], title: "DLP for Copilot" }, config),
    ["security-compliance"],
  );
  assert.deepEqual(
    classifyCategories({ productArea: "Word", tags: ["Copilot Studio"], title: "New thing" }, config),
    ["copilot-studio", "office-apps"],
  );
  assert.deepEqual(
    classifyCategories({ productArea: "Microsoft 365 Copilot", tags: [], title: "Agent Builder GA" }, config),
    ["agents"],
  );
});

test("falls back when nothing matches", () => {
  assert.deepEqual(classifyCategories({ productArea: "Unknown", tags: [], title: "x" }, config), ["other"]);
});

test("importance level uses thresholds", () => {
  assert.equal(importanceLevel(157, config), "high");
  assert.equal(importanceLevel(112, config), "notable");
  assert.equal(importanceLevel(62, config), "normal");
  assert.equal(annotateEvent({ productArea: "Word", tags: [], title: "t", importanceScore: 140 }, config).importanceLevel, "high");
});
