import fs from "node:fs/promises";
import path from "node:path";
import { enrichLearnDocuments } from "./lib/learn-mcp.mjs";
import { enrichDocumentCache, validateDocumentCache, withPublicationSource } from "./lib/related-documents.mjs";
import { incompleteCandidates, parseRequestedCandidates } from "./lib/requested-candidates.mjs";

// node scripts/resolve-requested-candidates.mjs <issue-body-file> [--write]
// 自動化 Issue が調査を依頼した更新のうち、キャッシュ上でまだ調査済みでないものを調べ、--write なら Learn MCP で調べて保存する。
// エージェントの PR が依頼と別の候補を調べていても、依頼された更新が必ず調査済みになる（PR の検証から呼ぶ）。
// 終了コード: 0 = 依頼された更新がすべて調査済み / 1 = 未調査・Learn MCP のエラー・イベントデータに無い更新が残っている（検証を通さない）。
const [bodyFile, ...flags] = process.argv.slice(2);
if (!bodyFile) {
  console.error("usage: node scripts/resolve-requested-candidates.mjs <issue-body-file> [--write]");
  process.exit(2);
}
const write = flags.includes("--write");
const root = process.cwd();
const requested = parseRequestedCandidates(await fs.readFile(bodyFile, "utf8"));
if (!requested.length) {
  console.log(JSON.stringify({ requested: 0, unresolved: [], note: "no candidate list in the issue" }));
  process.exit(0);
}

const sources = JSON.parse(await fs.readFile(path.join(root, "config", "sources.json"), "utf8"));
const cachePath = path.join(root, "config", "related-documents.json");
const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
validateDocumentCache(cache);
const events = [];
for (const file of (await fs.readdir(path.join(root, "data", "events"))).filter((name) => name.endsWith(".json")).sort()) {
  const log = JSON.parse(await fs.readFile(path.join(root, "data", "events", file), "utf8"));
  events.push(...(log.events || []).map((event) => withPublicationSource(event, sources)));
}

const before = incompleteCandidates(requested, events, cache);
const result = { requested: requested.length, ...before };
if (write && before.unresolved.length) {
  const selected = events.filter((event) => before.unresolved.includes(event.id));
  const base = await enrichDocumentCache(selected, cache, { limit: selected.length });
  const mcp = await enrichLearnDocuments(selected, cache, { limit: Math.min(selected.length, 6) });
  validateDocumentCache(cache);
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  result.resolved = { ...base, mcp };
}
// 調べたあとの状態で、完了したかを判定する（調べたのに MCP のエラーで終わった更新も「未完了」）
const after = incompleteCandidates(requested, events, cache);
result.incomplete = after;
console.log(JSON.stringify(result, null, 2));
const remaining = [...after.unresolved, ...after.errored, ...after.missing];
if (remaining.length) {
  console.error(`Requested candidates are not fully researched: unresolved=${after.unresolved.length}, errored=${after.errored.length}, missing=${after.missing.length}`);
  process.exitCode = 1;
}
