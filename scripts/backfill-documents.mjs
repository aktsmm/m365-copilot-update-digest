import fs from "node:fs/promises";
import path from "node:path";
import { parseSource } from "./collect.mjs";
import { backfillDocumentation, coverageSummary, missingFeatureGroups } from "./lib/documentation-backfill.mjs";
import { createLearnLookup } from "./lib/learn-mcp.mjs";
import { fetchOfficialPage, validateDocumentCache, withPublicationSource } from "./lib/related-documents.mjs";

const args = process.argv.slice(2);
const write = args.includes("--write");
const maxIndex = args.indexOf("--max-groups");
const maxGroups = maxIndex === -1 ? Number.MAX_SAFE_INTEGER : Number(args[maxIndex + 1]);
if (!Number.isSafeInteger(maxGroups) || maxGroups < 1) throw new Error("--max-groups must be a positive integer");
const root = process.cwd();
const sources = JSON.parse(await fs.readFile(path.join(root, "config", "sources.json"), "utf8"));
const cachePath = path.join(root, "config", "related-documents.json");
const reportPath = path.join(root, "data", "documentation-coverage.json");
const cache = JSON.parse(await fs.readFile(cachePath, "utf8"));
validateDocumentCache(cache);
if (args.includes("--recheck-unfound")) {
  for (const [id, record] of Object.entries(cache)) {
    if (record.mcpStatus === "not-found" && !record.documents.length) delete cache[id];
  }
}
const files = (await fs.readdir(path.join(root, "data", "events"))).filter((file) => file.endsWith(".json")).sort();
const events = [];
for (const file of files) {
  events.push(...JSON.parse(await fs.readFile(path.join(root, "data", "events", file), "utf8")).events
    .map((event) => withPublicationSource(event, sources)));
}
const groups = missingFeatureGroups(events, cache);
if (!write) {
  console.log(JSON.stringify({
    mode: "preview", coverage: coverageSummary(events, cache),
    missingFeatureGroups: groups.length, maxGroups: Math.min(maxGroups, groups.length),
    eventFilesModified: false, fieldsModified: ["config/related-documents.json", "data/documentation-coverage.json"],
  }, null, 2));
} else {
  const pages = new Map();
  const fetchPage = async (url) => {
    const key = url.split("#")[0];
    if (!pages.has(key)) {
      pages.set(key, fetchOfficialPage(key));
      if (pages.size > 100) pages.delete(pages.keys().next().value);
    }
    return pages.get(key);
  };
  const candidates = new Map();
  for (const source of sources.filter((entry) => ["m365_release_notes", "copilot_studio_whats_new"].includes(entry.kind))) {
    try {
      const page = await fetchPage(source.url);
      const parsed = parseSource(source, page.html, new Date().toISOString());
      for (const event of parsed) {
        if (event.documentCandidates?.length) candidates.set(event.id, event.documentCandidates);
      }
      console.log(JSON.stringify({ source: source.id, parsedItems: parsed.length, candidateGroups: candidates.size }));
    } catch (error) {
      console.warn(`Source link recovery failed for ${source.id}: ${error.message}`);
    }
  }
  let lookup;
  try {
    const report = await backfillDocumentation(events, cache, {
      maxGroups, candidates, fetchPage,
      findDocuments: async (event) => {
        lookup ||= await createLearnLookup();
        return lookup.findDocuments(event);
      },
      checkpoint: async (state) => {
        validateDocumentCache(cache);
        const snapshot = {
          ...state, generatedAt: new Date().toISOString(),
          checkedEvents: state.coverage.total - state.coverage.pending,
        };
        for (const [file, value] of [[cachePath, cache], [reportPath, snapshot]]) {
          const temporary = `${file}.tmp`;
          await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
          await fs.rename(temporary, file);
        }
      },
      onProgress: (report, event) => {
        if (report.processedGroups % 10 === 0 || report.stoppedReason) {
          console.log(JSON.stringify({ ...report, lastEvent: event.id }));
        }
      },
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.stoppedReason) process.exitCode = 2;
  } catch (error) {
    const durableCache = JSON.parse(await fs.readFile(cachePath, "utf8"));
    const previousReport = JSON.parse(await fs.readFile(reportPath, "utf8").catch((readError) => {
      if (readError.code === "ENOENT") return "{}";
      throw readError;
    }));
    await fs.writeFile(reportPath, `${JSON.stringify({
      ...previousReport, state: "paused", stoppedReason: error.message,
      coverage: coverageSummary(events, durableCache),
    }, null, 2)}\n`, "utf8");
    throw error;
  } finally {
    await lookup?.close();
  }
}
