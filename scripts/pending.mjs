import fs from "node:fs/promises";
import path from "node:path";
import { loadCategoryConfig, annotateEvent } from "./lib/classify.mjs";
import { loadAgentSummaries, pendingItems, sourceFingerprint } from "./lib/agent-summaries.mjs";
import { jstDate } from "./lib/slides.mjs";

// gh-aw の要約エージェントに渡す入力 .work/pending.json を作る（エージェントは MRC や data/events へ接続しない）。
const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : 30;
const root = process.cwd();
const config = loadCategoryConfig();
const events = [];
for (const name of await fs.readdir(path.join(root, "data", "events"))) {
  const log = JSON.parse(await fs.readFile(path.join(root, "data", "events", name), "utf8"));
  events.push(...(log.events || []).map((event) => annotateEvent(event, config)));
}

const items = pendingItems(events, loadAgentSummaries(root), { limit });
await fs.mkdir(path.join(root, ".work"), { recursive: true });
await fs.writeFile(
  path.join(root, ".work", "pending.json"),
  `${JSON.stringify(
    {
      count: items.length,
      items: items.map((event) => ({
        key: event.id,
        sourceFingerprint: sourceFingerprint(event),
        title: event.titleEn || event.title,
        description: event.summaryEn || event.summary,
        stage: event.releaseStage,
        productArea: event.productArea,
        tags: event.tags || [],
        publishedJst: jstDate(event.publishedAt),
        importance: event.importanceLevel,
        currentTitleJa: event.titleJa,
      })),
    },
    null,
    2,
  )}\n`,
);
console.log(`pending summaries: ${items.length}`);
