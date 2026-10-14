import fs from "node:fs/promises";
import path from "node:path";
import { enrichLearnDocuments } from "./lib/learn-mcp.mjs";
import {
  enrichDocumentCache,
  pendingDocumentEvents,
  requiresDocumentEnrichment,
  validateDocumentCache,
} from "./lib/related-documents.mjs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const pending = args.includes("--pending");
const retryErrors = args.includes("--retry-errors");
const dateIndex = args.indexOf("--date");
const date = dateIndex === -1 ? null : args[dateIndex + 1];
if (dateIndex !== -1 && (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") ||
  !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
  throw new Error("--date requires YYYY-MM-DD");
}
const idIndex = args.indexOf("--id");
const id = idIndex === -1 ? null : args[idIndex + 1];
if (idIndex !== -1 && (!id || id.startsWith("--"))) {
  throw new Error("--id requires an event ID");
}
const limitIndex = args.indexOf("--limit");
const limit = limitIndex === -1 ? 12 : Number(args[limitIndex + 1]);
if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
  throw new Error("--limit must be an integer between 1 and 50");
}
const root = process.cwd();
const cachePath = path.join(root, "config", "related-documents.json");
const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
validateDocumentCache(cache);
const entries = await fs.readdir(path.join(root, "data", "events"));
const events = [];
for (const file of entries.filter((entry) => entry.endsWith(".json")).sort()) {
  const log = JSON.parse(await fs.readFile(path.join(root, "data", "events", file), "utf8"));
  events.push(...(log.events || []));
}
const selected = id ? events.filter((event) => event.id === id)
  : date ? events.filter((event) => event.publishedAt.slice(0, 10) === date)
    .sort((a, b) => (b.importanceScore || 0) - (a.importanceScore || 0))
    .slice(0, limit)
  : events;
if (id && selected.length === 0) {
  throw new Error(`Event not found: ${id}`);
}
if (date && selected.length === 0) {
  throw new Error(`No events found for date: ${date}`);
}
if (pending) {
  console.log(JSON.stringify(pendingDocumentEvents(selected, cache, limit), null, 2));
} else if (!write) {
  console.log(JSON.stringify({
    mode: "preview",
    cache: "config/related-documents.json",
    eventFilesModified: false,
    candidates: [...selected]
      .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id))
      .filter((event) => requiresDocumentEnrichment(event, cache, retryErrors))
      .slice(0, limit)
      .map((event) => ({ id: event.id, title: event.titleEn || event.title, url: event.url })),
  }, null, 2));
} else {
  const result = await enrichDocumentCache(selected, cache, { limit, retryErrors });
  const mcp = await enrichLearnDocuments(selected, cache, { limit: Math.min(limit, 6) });
  validateDocumentCache(cache);
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ mode: "write", ...result, mcp }, null, 2));
}
