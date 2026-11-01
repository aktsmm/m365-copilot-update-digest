import fs from "node:fs";
import path from "node:path";

// qa（想定問答）がまだないスライドの key を新しい順に 1 行ずつ出す。
// config/qa-skip.json に載せた ID は、根拠が足りず Q&A を作れなかったもの。同じ失敗を毎回繰り返さないよう対象から外す。
let skip = new Set();
try {
  skip = new Set(JSON.parse(fs.readFileSync("config/qa-skip.json", "utf8")).skip ?? []);
} catch {}
const dir = "data/slides";
const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 100;
const rows = [];
for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const deck = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  const slide = deck.slides?.[0];
  if (!slide || (slide.qa ?? []).length > 0) continue;
  if (skip.has(slide.key ?? name.replace(/\.json$/, ""))) continue;
  rows.push({ key: slide.key ?? name.replace(/\.json$/, ""), published: slide.meta?.publishedJst ?? "" });
}
rows.sort((a, b) => b.published.localeCompare(a.published) || a.key.localeCompare(b.key));
for (const row of rows.slice(0, limit)) console.log(row.key);
