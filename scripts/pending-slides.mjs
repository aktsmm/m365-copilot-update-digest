import fs from "node:fs/promises";
import path from "node:path";
import { annotateEvent, loadCategoryConfig } from "./lib/classify.mjs";
import { escalatedIds, loadRetry } from "./lib/slide-retry.mjs";
import { SLIDES_DIR, jstDate, selectSlideEvents, stableStringify } from "./lib/slides.mjs";

// スライドがまだない更新の ID（直近 N か月・重要/注目・新しい順）を列挙する。標準出力に 1 行 1 ID。
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const limit = Number(flag("limit", "30"));
const months = Number(flag("months", "3"));
const out = flag("out", ".work/slide-pending.json");
const root = process.cwd();
const config = loadCategoryConfig();

const events = [];
for (const name of await fs.readdir(path.join(root, "data", "events"))) {
  const log = JSON.parse(await fs.readFile(path.join(root, "data", "events", name), "utf8"));
  events.push(...(log.events || []).map((event) => annotateEvent(event, config)));
}
const existing = new Set(
  (await fs.readdir(path.join(root, SLIDES_DIR)).catch(() => [])).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)),
);
// 3 回続けて失敗した更新は保留にする（毎回先頭で再試行して枠を使い続けないため）。保守エージェントが直したら記録を消す。
const held = new Set(escalatedIds(loadRetry(root)));
const todo = selectSlideEvents(events, { months })
  .filter((event) => !existing.has(event.id) && !held.has(event.id))
  .slice(0, limit)
  .map((event) => ({ id: event.id, publishedJst: jstDate(event.publishedAt), title: event.titleEn || event.title }));

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, stableStringify({ count: todo.length, items: todo }), "utf8");
for (const item of todo) console.log(item.id);
console.error(`slides pending: ${todo.length} (limit ${limit}, last ${months} months, ${held.size} held after repeated failures)`);
