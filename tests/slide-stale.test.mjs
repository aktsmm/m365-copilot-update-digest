import assert from "node:assert/strict";
import test from "node:test";
import { staleReasons, staleSlideIds } from "../scripts/lib/slide-stale.mjs";

const slide = { kind: "in-development", title: { en: "Feature  X" } };

test("a slide is stale when the stage moved on or the source title changed", () => {
  assert.deepEqual(staleReasons(slide, { releaseStage: "In development", titleEn: "Feature X" }), []);
  assert.equal(staleReasons(slide, { releaseStage: "Rolling out", titleEn: "Feature X" }).length, 1);
  assert.equal(staleReasons(slide, { releaseStage: "In development", titleEn: "Feature X (renamed)" }).length, 1);
  assert.equal(staleReasons(slide, { releaseStage: "Launched", titleEn: "Other" }).length, 2);
});

test("only updates that have a slide and changed are listed", () => {
  const events = [
    { id: "a", releaseStage: "Rolling out", titleEn: "Feature X" },
    { id: "b", releaseStage: "In development", titleEn: "Feature X" },
    { id: "c", releaseStage: "Launched", titleEn: "No slide yet" },
  ];
  assert.deepEqual(staleSlideIds(events, new Map([["a", slide], ["b", slide]])), ["a"]);
});
