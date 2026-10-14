import assert from "node:assert/strict";
import test from "node:test";
import { backfillDocumentation, coverageSummary, missingFeatureGroups } from "../scripts/lib/documentation-backfill.mjs";
import { documentFingerprint, documentUrl, japaneseDocumentUrl, normalizeDocuments, validateDocumentCache, withPublicationSource } from "../scripts/lib/related-documents.mjs";

const now = () => "2026-10-14T07:00:00.000Z";
const event = (id, feature = id) => ({
  id, title: `Feature ${feature}`, productArea: "Microsoft 365 Copilot",
  summary: `Details for ${feature}`, url: `https://www.microsoft.com/microsoft-365/roadmap?id=${feature}`,
  publishedAt: "2026-10-14",
});
const reference = (entry) => ({
  title: "Feature reference", url: "https://learn.microsoft.com/en-us/copilot/feature",
  provenance: "mcp", evidenceUrl: entry.url, evidence: "Feature correspondence verified by MCP.",
});
const fetchPage = async (url) => ({
  url, html: "<main><h1>機能の説明</h1><p>この機能を構成する手順です。</p></main>",
});

test("identical feature versions share one lookup but keep distinct fingerprints", async () => {
  const events = [event("a", "1"), event("b", "1")];
  const cache = {};
  let calls = 0;
  const report = await backfillDocumentation(events, cache, {
    now, fetchPage,
    findDocuments: async (entry) => { calls += 1; return [reference(entry)]; },
  });
  assert.equal(calls, 1);
  assert.equal(report.coverage.withDocuments, 2);
  assert.equal(report.reusedEvents, 1);
  assert.equal(cache.b.inputFingerprint, documentFingerprint(events[1]));
  assert.notEqual(cache.a.inputFingerprint, cache.b.inputFingerprint);
  validateDocumentCache(cache);
});

test("bounded runs resume beyond already checked not-found features", async () => {
  const events = [event("a"), event("b"), event("c")];
  const cache = {};
  const calls = [];
  const options = {
    now, fetchPage, maxGroups: 1,
    findDocuments: async (entry) => { calls.push(entry.id); return []; },
  };
  await backfillDocumentation(events, cache, options);
  await backfillDocumentation(events, cache, options);
  const report = await backfillDocumentation(events, cache, options);
  assert.deepEqual(calls, ["a", "b", "c"]);
  assert.equal(report.state, "completed");
  assert.deepEqual(coverageSummary(events, cache), {
    total: 3, withDocuments: 0, notFound: 3, errors: 0, pending: 0,
  });
});

test("rate limits stop the batch and checkpoint partial status without calling later items", async () => {
  const cache = {};
  let calls = 0;
  let saved;
  const report = await backfillDocumentation([event("a"), event("b")], cache, {
    now, fetchPage, onWarning() {},
    findDocuments: async () => { calls += 1; throw new Error("HTTP 429 Too Many Requests"); },
    checkpoint: async (value) => { saved = structuredClone(value); },
  });
  assert.equal(calls, 1);
  assert.equal(report.state, "paused");
  assert.equal(saved.coverage.errors, 1);
  assert.equal(saved.coverage.pending, 1);
  validateDocumentCache(cache);
});

test("existing confirmed references are not replaced or needlessly researched", async () => {
  const entry = event("a");
  const cache = { a: {
    inputFingerprint: documentFingerprint(entry), checkedAt: now(),
    status: "verified", documents: [reference(entry)], mcpStatus: "verified",
  } };
  assert.equal(missingFeatureGroups([entry], cache).length, 0);
  const original = JSON.stringify(cache);
  await backfillDocumentation([entry], cache, {
    now, fetchPage, findDocuments: async () => assert.fail("Must not look up a confirmed reference"),
  });
  assert.equal(JSON.stringify(cache), original);
});

test("Microsoft Support is accepted and translated slugs do not duplicate the original article", () => {
  const id = "069c91f0-9e42-4c9a-bbce-fddf5d581541";
  const original = `https://support.microsoft.com/office/draft-with-copilot-${id}`;
  assert.ok(documentUrl(original));
  assert.equal(japaneseDocumentUrl(original), `https://support.microsoft.com/ja-jp/office/draft-with-copilot-${id}`);
  assert.equal(normalizeDocuments([{
    title: "Japanese article", url: `https://support.microsoft.com/ja-jp/office/translated-title-${id}`,
  }], original).length, 0);
  assert.equal(documentUrl("https://support.microsoft.com.evil.test/office/article"), null);
  assert.equal(documentUrl("https://support.microsoft.com/office/word-help"), null);
});

test("release-note publication remains official even if its original target is external or empty", () => {
  const sources = [{
    id: "notes", sourceFamily: "Microsoft Learn",
    url: "https://learn.microsoft.com/en-us/microsoft-365/copilot/release-notes",
  }];
  for (const url of ["https://external.example/blog", ""]) {
    const entry = { ...event("a"), sourceId: "notes", url };
    const result = withPublicationSource(entry, sources);
    assert.equal(result.url, url);
    assert.equal(result.publicationUrl, sources[0].url);
    assert.equal(documentFingerprint(result), documentFingerprint(entry));
  }
});
