import fs from "node:fs/promises";
import path from "node:path";
import { matchingRecord, normalizeDocuments, validateDocumentCache } from "./lib/related-documents.mjs";

const workspaceRoot = process.cwd();
const eventsDir = path.join(workspaceRoot, "data", "events");

function stableArticleKey(event) {
  const sourceId = String(event.sourceId || "")
    .trim()
    .toLowerCase();
  const url = String(event.url || "")
    .trim()
    .toLowerCase();
  if (!sourceId.endsWith("-blog") || !url.includes("/ba-p/")) {
    return null;
  }

  return `${sourceId}\n${url}`;
}

async function main() {
  const { loadAgentSummaries } = await import("./lib/agent-summaries.mjs");
  const invalid = [...loadAgentSummaries(workspaceRoot).values()].filter((entry) => entry.problems.length > 0);
  if (invalid.length > 0) {
    for (const entry of invalid.slice(0, 20)) console.error(`${path.relative(workspaceRoot, entry.file)}: ${entry.problems.join("; ")}`);
    throw new Error(`${invalid.length} invalid agent summary file(s)`);
  }
  const cache = JSON.parse(await fs.readFile(path.join(workspaceRoot, "config", "related-documents.json"), "utf8"));
  validateDocumentCache(cache);
  const entries = await fs.readdir(eventsDir, { withFileTypes: true });
  const occurrences = new Map();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const dateKey = entry.name.replace(/\.json$/i, "");
    const filePath = path.join(eventsDir, entry.name);
    const log = JSON.parse(await fs.readFile(filePath, "utf8"));

    for (const event of log.events || []) {
      const record = matchingRecord(event, cache);
      if (record && normalizeDocuments(record.documents, event.url).length !== record.documents.length) {
        throw new Error(`Related document cache repeats the original URL for ${event.id}`);
      }
      if (event.relatedDocuments !== undefined && (
        !Array.isArray(event.relatedDocuments) ||
        normalizeDocuments(event.relatedDocuments, event.url).length !== event.relatedDocuments.length
      )) {
        throw new Error(`Invalid related documents for ${event.id} in ${entry.name}`);
      }
      const key = stableArticleKey(event);
      if (!key) {
        continue;
      }

      if (!occurrences.has(key)) {
        occurrences.set(key, []);
      }

      occurrences.get(key).push({
        dateKey,
        title: event.titleEn || event.title || "(untitled)",
        url: event.url || "",
      });
    }
  }

  const duplicates = [...occurrences.values()].filter(
    (items) => items.length > 1,
  );
  if (duplicates.length === 0) {
    console.log("Generated data invariants OK");
    return;
  }

  console.error(
    "Duplicate stable article URLs were found across daily event logs:",
  );
  for (const items of duplicates) {
    console.error(`- ${items[0].title}`);
    console.error(`  ${items[0].url}`);
    for (const item of items) {
      console.error(`  - ${item.dateKey}`);
    }
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
