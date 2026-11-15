import assert from "node:assert/strict";
import test from "node:test";
import { findByRoadmapId, listsRoadmapId, roadmapId } from "../scripts/lib/learn-mcp.mjs";

const event = {
  titleEn: "Dynamics 365 Business Central: Development - Diagnose AL MCP server activity with file logging",
  url: "https://www.microsoft.com/microsoft-365/roadmap?id=573349",
  publicationUrl: "https://www.microsoft.com/microsoft-365/roadmap?id=573349",
};
const whatsNew = {
  title: "Update 29.0 for Business Central 2026 release wave 2",
  contentUrl: "https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/whatsnew/whatsnew-update-29-0",
  content: "| Configure AL MCP workspaces dynamically | General availability | [573348](https://www.microsoft.com/en-us/microsoft-365/roadmap?id=573348) |",
};
const row = "| Diagnose AL MCP server activity with file logging | General availability | [573349](https://www.microsoft.com/en-us/microsoft-365/roadmap?id=573349) |";

test("roadmapId reads the id from the roadmap URL and listsRoadmapId matches whole ids only", () => {
  assert.equal(roadmapId(event), "573349");
  assert.equal(roadmapId({ url: "https://example.com/a" }), "");
  assert.ok(listsRoadmapId(row, "573349"));
  assert.ok(!listsRoadmapId("roadmap?id=5733490", "573349"));
  assert.ok(!listsRoadmapId(row, ""));
});

test("a release-notes page that lists the roadmap id is adopted, using the full article when the chunk lacks the row", async () => {
  const fetched = [];
  const documents = await findByRoadmapId(event, {
    search: async (query) => {
      assert.match(query, /^Roadmap ID 573349 what's new release Dynamics 365 Business Central$/);
      return [whatsNew];
    },
    fetchArticle: async (url) => { fetched.push(url); return `# Update 29.0\n${row}`; },
  });
  assert.equal(documents.length, 1);
  assert.equal(documents[0].provenance, "mcp");
  assert.equal(documents[0].url, whatsNew.contentUrl);
  assert.equal(documents[0].evidenceUrl, event.publicationUrl);
  assert.match(documents[0].evidence, /573349/);
  assert.equal(fetched.length, 1);
});

test("a page that lists other roadmap ids, but not this one, is not adopted", async () => {
  const documents = await findByRoadmapId(event, {
    search: async () => [whatsNew],
    fetchArticle: async () => "| Something else | GA | [573348](https://www.microsoft.com/en-us/microsoft-365/roadmap?id=573348) |",
  });
  assert.deepEqual(documents, []);
});

test("non-Learn hosts, the source URL itself and events without a roadmap id are skipped", async () => {
  const other = { ...whatsNew, contentUrl: "https://example.com/x", content: row };
  const self = { ...whatsNew, contentUrl: event.url, content: row };
  assert.deepEqual(await findByRoadmapId(event, { search: async () => [other, self], fetchArticle: async () => row }), []);
  assert.deepEqual(await findByRoadmapId({ titleEn: "X: Y", url: "https://example.com" }, { search: async () => assert.fail("must not search"), fetchArticle: async () => "" }), []);
});

test("fetching is capped so that one event cannot trigger many article downloads", async () => {
  const many = Array.from({ length: 6 }, (_, i) => ({ ...whatsNew, contentUrl: `https://learn.microsoft.com/en-us/dynamics365/business-central/p${i}`, content: "" }));
  let fetches = 0;
  await findByRoadmapId(event, { search: async () => many, fetchArticle: async () => { fetches += 1; return ""; }, maxFetches: 2 });
  assert.equal(fetches, 2);
});

test("featureTitle drops the product prefix and a trailing platform tag", async () => {
  const { featureTitle } = await import("../scripts/lib/learn-mcp.mjs");
  assert.equal(featureTitle({ titleEn: "Microsoft Teams: Use Copilot Chat after a call in Queues app" }), "Use Copilot Chat after a call in Queues app");
  assert.equal(featureTitle({ titleEn: "Microsoft Copilot (M365): Edit a file [Windows, Mac]" }), "Edit a file");
});

test("a Learn page that states the same feature name is adopted by findByExactTitle", async () => {
  const { findByExactTitle } = await import("../scripts/lib/learn-mcp.mjs");
  const queues = { titleEn: "Microsoft Teams: Use Copilot Chat after a call in Queues app", url: "https://www.microsoft.com/microsoft-365/roadmap?id=568933" };
  const releaseNotes = {
    title: "Microsoft 365 Copilot release notes",
    contentUrl: "https://learn.microsoft.com/microsoft-365/copilot/release-notes#october-27,-2026",
    content: "**Use Copilot Chat after a call in Queues app** [Windows, Mac]\nAfter a recorded call is completed...",
  };
  const found = await findByExactTitle(queues, { search: async (query) => { assert.match(query, /^"Use Copilot Chat after a call in Queues app"$/); return [releaseNotes]; } });
  assert.equal(found.length, 1);
  assert.equal(found[0].url, releaseNotes.contentUrl);
  assert.match(found[0].evidence, /Use Copilot Chat after a call in Queues app/);
});

test("findByExactTitle ignores short or generic feature names and pages without the exact name", async () => {
  const { findByExactTitle } = await import("../scripts/lib/learn-mcp.mjs");
  const search = async () => assert.fail("must not search for a short feature name");
  assert.deepEqual(await findByExactTitle({ titleEn: "Microsoft Teams: Improved search", url: "https://x" }, { search }), []);
  const other = { title: "Queues app on Teams phones", contentUrl: "https://learn.microsoft.com/microsoftteams/phones/queues-app", content: "Queues app is a Microsoft Teams native solution" };
  const event = { titleEn: "Microsoft Teams: Use Copilot Chat after a call in Queues app", url: "https://x" };
  assert.deepEqual(await findByExactTitle(event, { search: async () => [other] }), []);
});

test("when the ID-anchored query finds nothing, the feature-name query is tried second", async () => {
  const queries = [];
  const documents = await findByRoadmapId(event, {
    search: async (query) => { queries.push(query); return queries.length === 1 ? [] : [{ ...whatsNew, content: row }]; },
    fetchArticle: async () => assert.fail("the chunk already lists the id"),
  });
  assert.equal(queries.length, 2);
  assert.match(queries[0], /^Roadmap ID 573349/);
  assert.match(queries[1], /Diagnose AL MCP server activity with file logging 573349$/);
  assert.equal(documents.length, 1);
});
