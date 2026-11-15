import fs from "node:fs/promises";
import path from "node:path";
import { enrichLearnDocuments } from "./lib/learn-mcp.mjs";
import { enrichDocumentCache, validateDocumentCache, withPublicationSource } from "./lib/related-documents.mjs";
import { parseRequestedCandidates, unresolvedCandidates } from "./lib/requested-candidates.mjs";

// node scripts/resolve-requested-candidates.mjs <issue-body-file> [--write]
// 自動化 Issue が調査を依頼した更新のうち、キャッシュ上でまだ調査済みでないものを調べ、--write なら Learn MCP で調べて保存する。
// エージェントの PR が依頼と別の候補を調べていても、依頼された更新が必ず調査済みになる（PR の検証から呼ぶ）。
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

const unresolved = unresolvedCandidates(requested, events, cache);
const known = new Set(events.map((event) => event.id));
const missing = requested.filter((item) => !known.has(item.id)).map((item) => item.id);
const result = { requested: requested.length, unresolved, missingFromEvents: missing };
if (write && unresolved.length) {
  const selected = events.filter((event) => unresolved.includes(event.id));
  const base = await enrichDocumentCache(selected, cache, { limit: selected.length });
  const mcp = await enrichLearnDocuments(selected, cache, { limit: Math.min(selected.length, 6) });
  validateDocumentCache(cache);
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  result.resolved = { ...base, mcp };
}
console.log(JSON.stringify(result, null, 2));
