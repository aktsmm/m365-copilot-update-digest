import assert from "node:assert/strict";
import test from "node:test";
import { buildApi } from "../scripts/lib/api.mjs";
import { loadCategoryConfig, annotateEvent } from "../scripts/lib/classify.mjs";
import { coverageStatusKey, summarizeCoverage } from "../scripts/lib/coverage.mjs";
import { createGate, decryptBuffer, deriveKey, encryptBuffer } from "../scripts/lib/pdf-crypto.mjs";
import fs from "node:fs";
import { loadSlides, retentionStart, selectSlideEvents, slideKind, validateDeck } from "../scripts/lib/slides.mjs";

const config = loadCategoryConfig();

function event(overrides = {}) {
  return annotateEvent(
    {
      id: "e-1",
      sourceId: "s",
      sourceName: "Source",
      sourceFamily: "Roadmap",
      productArea: "Microsoft 365 Copilot",
      title: "Agent Builder GA",
      titleJa: "Agent Builder が GA",
      summaryJa: "要約です。",
      url: "https://example.com/a",
      publishedAt: "2026-10-10T12:00:00Z",
      releaseStage: "GA",
      importanceScore: 140,
      importanceReason: "理由",
      tags: [],
      relatedDocuments: [{ title: "Doc", url: "https://learn.microsoft.com/x" }],
      ...overrides,
    },
    config,
  );
}

test("sample slides satisfy the schema and semantic rules", () => {
  const deck = JSON.parse(fs.readFileSync(new URL("../examples/slide.sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateDeck(deck), []);
  assert.equal(deck.slides.length, 2);
});

test("validation rejects forbidden wording, bad hosts and unverified evidence", () => {
  const deck = JSON.parse(fs.readFileSync(new URL("../examples/slide.sample.json", import.meta.url), "utf8"));
  const bad = structuredClone(deck);
  bad.slides[0].title.ja = "要確認の更新";
  assert.ok(validateDeck(bad).some((p) => p.message.includes("forbidden phrase")));
  const host = structuredClone(deck);
  host.slides[0].references.announcement = "https://example.com/x";
  assert.ok(validateDeck(host).some((p) => p.message.includes("host not allowed")));
  const noEvidence = structuredClone(deck);
  delete noEvidence.slides[0].action.summary.evidence;
  assert.ok(validateDeck(noEvidence).length > 0);
});

test("published slide files are valid and named after their key", () => {
  for (const entry of loadSlides(process.cwd())) assert.deepEqual(entry.problems, [], entry.key);
});
test("stage maps to kind and unknown stages fall back to update", () => {
  assert.equal(slideKind({ releaseStage: "Preview" }), "preview");
  assert.equal(slideKind({ releaseStage: "Update" }), "update");
});

test("selection keeps recent notable+ updates, newest first", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  assert.equal(retentionStart(now, 3), "2026-08-01");
  const selected = selectSlideEvents(
    [
      event({ id: "old", publishedAt: "2026-05-01T00:00:00Z" }),
      event({ id: "low", importanceScore: 70 }),
      event({ id: "ga" }),
      event({ id: "pre", releaseStage: "Preview" }),
    ],
    { now },
  );
  assert.deepEqual(selected.map((item) => item.id), ["ga", "pre"]);
});

test("pdf encryption round-trips and rejects a wrong key", () => {
  const { key, gate } = createGate("secret", Buffer.alloc(16, 1));
  const blob = encryptBuffer(key, Buffer.from("%PDF-test"));
  assert.equal(decryptBuffer(key, blob).toString(), "%PDF-test");
  assert.throws(() => decryptBuffer(deriveKey("wrong", Buffer.alloc(16, 1)), blob));
  assert.equal(decryptBuffer(key, Buffer.from(gate.verifier, "base64")).toString(), "m365-copilot-update-digest");
});

test("coverage is partial unless every source is complete", () => {
  assert.equal(summarizeCoverage([{ sourceId: "a", status: "complete", parsedCount: 1 }]).status, "complete");
  assert.equal(
    summarizeCoverage([
      { sourceId: "a", status: "complete", parsedCount: 1 },
      { sourceId: "b", status: "empty", parsedCount: 0 },
    ]).status,
    "complete",
  );
  const partial = summarizeCoverage([
    { sourceId: "b", status: "failed", parsedCount: 0 },
    { sourceId: "a", status: "complete", parsedCount: 3 },
  ]);
  assert.equal(partial.status, "partial");
  assert.equal(coverageStatusKey(partial), coverageStatusKey({ ...partial, sources: partial.sources.map((s) => ({ ...s, parsedCount: 99 })) }));
});

test("api output is deterministic and links slides", () => {
  const events = [event(), event({ id: "e-2", publishedAt: "2026-09-02T00:00:00Z" })];
  const options = { snapshotAt: "2026-10-14T00:00:00Z", categoryConfig: config, slideKeys: new Set(["e-1"]) };
  const files = buildApi(events, options);
  assert.deepEqual(files, buildApi(events, options));
  const paths = files.map((file) => file.path);
  for (const expected of ["api/v1/index.json", "api/v1/latest.json", "api/v1/months/2026-10.json", "api/v1/updates/e-1.json", "api/v1/categories/agents.json"]) {
    assert.ok(paths.includes(expected), expected);
  }
  assert.equal(files.find((file) => file.path === "api/v1/updates/e-1.json").body.item.urls.slide, "slides/e-1.json");
  assert.equal(files.find((file) => file.path === "api/v1/latest.json").body.count, 1);
});
