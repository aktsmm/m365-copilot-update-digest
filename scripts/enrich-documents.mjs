import fs from "node:fs/promises";
import path from "node:path";
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
const selected = id ? events.filter((event) => event.id === id) : events;
if (id && selected.length === 0) {
  throw new Error(`Event not found: ${id}`);
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
  validateDocumentCache(cache);
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ mode: "write", ...result }, null, 2));
}
