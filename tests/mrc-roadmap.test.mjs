import assert from "node:assert/strict";
import test from "node:test";
import {
  knownJapaneseRoadmapSummary,
  knownJapaneseRoadmapTitle,
  mrcRoadmapItemsToEvents,
} from "../scripts/collect.mjs";
import { listM365Roadmaps } from "../scripts/lib/mrc.mjs";

const source = { id: "m365-roadmap-rss", name: "Microsoft 365 Roadmap", productArea: "Microsoft 365 Copilot", sourceFamily: "Roadmap" };

function item(id, extra = {}) {
  return {
    id,
    title: `Microsoft Copilot (Microsoft 365): Feature ${id}`,
    description: "Does a thing.",
    products: ["Microsoft Copilot (Microsoft 365)", "Word"],
    status: "Rolling out",
    releaseRings: ["General Availability"],
    platforms: ["Web"],
    cloudInstances: ["Worldwide (Standard Multi-Tenant)"],
    created: "2026-01-02T00:00:00Z",
    modified: "2026-03-04T10:00:00Z",
    moreInfoUrls: [],
    ...extra,
  };
}

function fakeClient(pages) {
  const calls = [];
  return {
    calls,
    async callTool(name, args) {
      calls.push(args.skip);
      return pages.shift();
    },
  };
}

test("Copilot Studio Computer Use localization names Microsoft Copilot Harness", () => {
  const event = {
    titleEn: "Copilot Studio: Computer Use for web browsing on Microsoft Copilot Harness",
    summaryEn: "Enable Microsoft Copilot Studio agents to browse and interact with websites.",
  };
  assert.equal(
    knownJapaneseRoadmapTitle(event),
    "Copilot Studio: Microsoft Copilot Harness による Web ブラウジングでコンピューターを使用",
  );
  assert.equal(
    knownJapaneseRoadmapSummary(event),
    "Microsoft Copilot Studio エージェントは、Microsoft Copilot Harness を利用して Web サイトを閲覧・操作できます。自然言語の指示に従ってページを移動し、情報の抽出やファイルのダウンロードを行えます。",
  );
  assert.doesNotMatch(knownJapaneseRoadmapTitle(event), /GitHub/);
  assert.doesNotMatch(knownJapaneseRoadmapSummary(event), /GitHub/);
});

test("roadmap items map to events and reuse existing ids by roadmap id", () => {
  const existing = [{ id: "m365-roadmap-rss-old", sourceId: source.id, roadmapIds: ["101"], publishedAt: "2026-02-01T12:00:00.000Z" }];
  const events = mrcRoadmapItemsToEvents(source, [item(101), item(102)], existing);
  assert.equal(events[0].id, "m365-roadmap-rss-old");
  assert.notEqual(events[1].id, "m365-roadmap-rss-old");
  assert.equal(events[0].url, "https://www.microsoft.com/microsoft-365/roadmap?id=101");
  assert.equal(events[0].releaseStage, "Rolling out");
  assert.deepEqual(events[0].roadmapIds, ["101"]);
  assert.equal(events[0].publishedAt, "2026-03-04T10:00:00.000Z");
});

test("listing is complete only when unique ids match totalCount", async () => {
  const complete = await listM365Roadmaps(
    fakeClient([
      { items: [item(1), item(2)], totalCount: 3, hasMore: true },
      { items: [item(3)], totalCount: 3, hasMore: false },
    ]),
    "f",
  );
  assert.equal(complete.complete, true);
  assert.equal(complete.items.length, 3);

  const partial = await listM365Roadmaps(
    fakeClient([
      { items: [item(1)], totalCount: 5, hasMore: false },
      { items: [item(1)], totalCount: 5, hasMore: false },
      { items: [item(1)], totalCount: 5, hasMore: false },
    ]),
    "f",
  );
  assert.equal(partial.complete, false);
});

test("a moving totalCount triggers a restart", async () => {
  const client = fakeClient([
    { items: [item(1)], totalCount: 2, hasMore: true },
    { items: [item(2)], totalCount: 3, hasMore: false },
    { items: [item(1), item(2)], totalCount: 2, hasMore: false },
  ]);
  const result = await listM365Roadmaps(client, "f");
  assert.equal(result.complete, true);
  assert.equal(result.totalCount, 2);
});
