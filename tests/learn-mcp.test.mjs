import assert from "node:assert/strict";
import test from "node:test";
import { documentationProduct, enrichLearnDocuments, featureTerms, matchesFeature, matchesProduct } from "../scripts/lib/learn-mcp.mjs";
import { documentFingerprint, pendingDocumentEvents, validateDocumentCache } from "../scripts/lib/related-documents.mjs";

const event = {
  id: "room-update", title: "Microsoft Teams: Ad-hoc room reservation from Teams Rooms on Windows console",
  productArea: "Microsoft Teams", url: "https://www.microsoft.com/microsoft-365/roadmap?id=548648",
  summary: "Reserve rooms", publishedAt: "2026-10-06",
};
const now = "2026-10-14T06:00:00.000Z";
const document = {
  title: "Teams Rooms reservation",
  url: "https://learn.microsoft.com/en-us/microsoftteams/rooms/mtr-home-refresh",
  provenance: "mcp", evidenceUrl: event.url, evidence: "MCP full body confirms ad-hoc room reservation.",
};

test("feature matching requires multiple specific terms, deduplicates stems and rejects unsupported statements", () => {
  const terms = featureTerms(event);
  assert.equal(new Set(terms).size, terms.length);
  assert.ok(matchesFeature(terms, "Teams Rooms allow ad-hoc room reservation."));
  assert.equal(matchesFeature(terms, "Room plans"), false);
  assert.equal(matchesFeature(terms, "Ad-hoc room reservation is not currently supported."), false);
  assert.ok(featureTerms({ title: "Edit query string settings" }).includes("string"));
});

test("lookup cannot substitute Teams panels, a different product, or vendor-specific deployment instructions", () => {
  assert.ok(matchesProduct(event, document));
  assert.equal(matchesProduct(event, {
    title: "Teams panels", url: "https://learn.microsoft.com/microsoftteams/devices/use-teams-panels",
  }), false);
  assert.equal(matchesProduct(event, {
    title: "Teams Rooms", url: "https://learn.microsoft.com/azure/rooms",
  }), false);
  assert.equal(matchesProduct({
    title: "Edit query string and user identity mapping rules for Copilot connectors",
    productArea: "Microsoft 365 Copilot",
  }, {
    title: "Deploy Veeva", url: "https://learn.microsoft.com/microsoft-365/copilot/connectors/veeva-deployment",
  }), false);
});

test("source product names override coarse feed labels and component names remain scoped", () => {
  const retention = {
    title: "Microsoft Purview compliance portal: Data Lifecycle Management - Retention based on Last Accessed",
    productArea: "Microsoft 365 Copilot",
  };
  assert.match(documentationProduct(retention), /Purview/);
  assert.equal(matchesProduct(retention, {
    title: "Copilot retention", url: "https://learn.microsoft.com/microsoft-365/loop/retention",
  }), false);
  const connector = {
    title: "Microsoft Purview: Rights Management connector - Certificate-based authentication",
    productArea: "Microsoft Purview",
  };
  assert.equal(matchesProduct(connector, {
    title: "Configure the Information Protection scanner",
    content: "Certificate-based authentication for the Rights Management service.",
    url: "https://learn.microsoft.com/purview/deploy-scanner",
  }), false);
  assert.ok(matchesProduct(connector, {
    title: "RMS connector requirements", url: "https://learn.microsoft.com/purview/deploy-rms-connector",
  }));
  assert.equal(documentationProduct({
    title: "Microsoft Copilot (Microsoft 365): New feature",
  }), "Microsoft 365 Copilot");
  assert.ok(featureTerms({ title: "Work IQ: Retrieve" }).includes("work iq"));
});

test("a source without explicit links gets a verified Japanese MCP document and subsequent runs reuse it", async () => {
  const cache = {};
  const options = {
    now, findDocuments: async () => [document],
    fetchPage: async (url) => ({ url, html: "<main><h1>Teams Rooms の予約</h1><p>会議室を予約する手順です。</p></main>" }),
  };
  assert.deepEqual(await enrichLearnDocuments([event], cache, options), { processed: 1, verified: 1, errors: 0 });
  assert.equal(cache[event.id].mcpStatus, "verified");
  assert.match(cache[event.id].documents[0].url, /\/ja-jp\//);
  validateDocumentCache(cache);
  assert.deepEqual(await enrichLearnDocuments([event], cache, options), { processed: 0, verified: 0, errors: 0 });
});

test("missing results retry after seven days; failures are explicit and retry after one day", async () => {
  const cache = {};
  await enrichLearnDocuments([event], cache, { now, findDocuments: async () => [] });
  assert.equal(cache[event.id].mcpStatus, "not-found");
  assert.equal(pendingDocumentEvents([event], cache, 6, now).length, 0);
  assert.equal(pendingDocumentEvents([event], cache, 6, "2026-10-21T06:00:00Z").length, 1);
  const errors = {};
  await enrichLearnDocuments([event], errors, {
    now, findDocuments: async () => { throw new Error("HTTP 429"); }, onWarning() {},
  });
  assert.equal(errors[event.id].mcpStatus, "error");
  assert.match(errors[event.id].error, /429/);
  assert.equal(pendingDocumentEvents([event], errors, 6, "2026-10-15T06:00:00Z").length, 1);
  validateDocumentCache(errors);
});

test("lookup failure preserves an already confirmed supplemental document", async () => {
  const supplemental = {
    ...document, title: "GitHub integration",
    url: "https://docs.github.com/ja/copilot/how-tos/example",
  };
  const cache = { [event.id]: {
    inputFingerprint: documentFingerprint(event), status: "verified",
    checkedAt: now, documents: [supplemental],
  } };
  await enrichLearnDocuments([event], cache, {
    now, findDocuments: async () => { throw new Error("Unavailable"); }, onWarning() {},
  });
  assert.equal(cache[event.id].documents[0].url, supplemental.url);
  assert.equal(cache[event.id].status, "verified");
  assert.equal(cache[event.id].mcpStatus, "error");
  validateDocumentCache(cache);
});
