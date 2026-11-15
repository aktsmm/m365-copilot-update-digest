import assert from "node:assert/strict";
import test from "node:test";
import { documentFingerprint } from "../scripts/lib/related-documents.mjs";
import { linkedIssueNumber, parseRequestedCandidates, unresolvedCandidates } from "../scripts/lib/requested-candidates.mjs";

const body = [
  "## Cloud automation improvement request",
  "```json",
  JSON.stringify([{ id: "a", title: "A" }, { id: "b", title: "B" }]),
  "```",
].join("\n");

test("parseRequestedCandidates reads the json block of the automation issue", () => {
  assert.deepEqual(parseRequestedCandidates(body).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(parseRequestedCandidates("no block here"), []);
  assert.deepEqual(parseRequestedCandidates("```json\nnot json\n```"), []);
  assert.deepEqual(parseRequestedCandidates("```json\n{\"id\":\"a\"}\n```"), []);
});

test("linkedIssueNumber finds Fixes/Closes/Resolves references", () => {
  assert.equal(linkedIssueNumber("text\n\n- Fixes #1446"), 1446);
  assert.equal(linkedIssueNumber("Closes #7 and more"), 7);
  assert.equal(linkedIssueNumber("see #12"), null);
});

const event = (id, publishedAt) => ({ id, title: id, titleEn: id, summary: "s", summaryEn: "s", url: `https://example.com/${id}`, publishedAt, importanceScore: 1 });
const verifiedRecord = (item) => ({ inputFingerprint: documentFingerprint(item), status: "verified", checkedAt: "2026-11-15T00:00:00.000Z", localePreference: "ja-jp", documents: [], mcpStatus: "verified" });

test("a requested update stays unresolved until the cache records it; other candidates do not count", () => {
  const a = event("a", "2026-10-01T00:00:00Z");
  const b = event("b", "2026-10-02T00:00:00Z");
  const other = event("other", "2026-10-03T00:00:00Z");
  const requested = [{ id: "a" }, { id: "b" }];
  const now = "2026-11-15T12:00:00.000Z";

  // The agent researched an unrelated candidate only.
  const wrongCache = { other: verifiedRecord(other) };
  assert.deepEqual(unresolvedCandidates(requested, [a, b, other], wrongCache, now).sort(), ["a", "b"]);

  // Researching the requested ones resolves them, even when the result is "not found" (retry is scheduled later).
  const notFound = (item) => ({ ...verifiedRecord(item), status: "not-found", mcpStatus: "not-found", mcpRetryAfter: "2026-11-22T00:00:00.000Z" });
  const goodCache = { a: verifiedRecord(a), b: notFound(b) };
  assert.deepEqual(unresolvedCandidates(requested, [a, b, other], goodCache, now), []);
});
