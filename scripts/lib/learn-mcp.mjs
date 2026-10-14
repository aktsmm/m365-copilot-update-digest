import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  documentFingerprint,
  documentUrl,
  enrichDocumentCache,
  isSupplementaryDocument,
  matchingRecord,
  normalizeDocuments,
  pendingDocumentEvents,
  urlKey,
} from "./related-documents.mjs";

const COMMON_WORDS = new Set([
  "microsoft", "copilot", "teams", "windows", "from", "with", "that",
  "this", "their", "users", "user", "console", "update", "directly",
]);

export function featureTerms(event) {
  const feature = (event.titleEn || event.title).split(":").slice(-1)[0]
    .replace(/\[[^\]]*\]/g, "");
  const words = [...new Set(feature.toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])]
    .filter((word) => !COMMON_WORDS.has(word))
    .map((word) => word.length >= 7 ? word.replace(/(?:ing|ed|s)$/, "") : word.replace(/s$/, ""));
  return [...new Set(words)];
}

export function matchesProduct(event, document) {
  const product = event.productArea || "";
  const path = new URL(document.url).pathname.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "");
  const allowed = /purview/i.test(product) ? /^\/purview\//
    : /copilot studio/i.test(product) ? /^\/microsoft-copilot-studio\//
    : /microsoft 365 copilot/i.test(product) ? /^\/(?:microsoft-365|microsoftsearch)\//
    : /microsoft teams/i.test(product) ? /^\/microsoftteams\//
    : null;
  if (allowed && !allowed.test(path)) return false;
  const title = event.titleEn || event.title;
  if (/teams rooms/i.test(title) && !/teams rooms/i.test(document.title || "")) return false;
  if (/connectors/i.test(title) && /\/connectors\/[^/]+-deployment/i.test(path)) return false;
  return true;
}

export function matchesFeature(terms, text) {
  const normalized = text.toLowerCase();
  return terms.length >= 2 &&
    terms.filter((term) => normalized.includes(term)).length >= Math.max(2, Math.ceil(terms.length * 0.7)) &&
    !/(?:isn't|is not|not currently) supported|cannot edit|can't edit/i.test(normalized);
}

function resultText(result) {
  if (result.isError) {
    throw new Error(`Learn MCP tool failed: ${JSON.stringify(result.content)}`);
  }
  const text = (result.content || []).filter((block) => block.type === "text")
    .map((block) => block.text).join("\n");
  if (!text.trim()) {
    throw new Error("Learn MCP returned no text content");
  }
  return text;
}

export async function createLearnLookup() {
  const client = new Client({ name: "m365-copilot-update-digest", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL("https://learn.microsoft.com/api/mcp"), {
    fetch: (url, init = {}) => fetch(url, {
      ...init,
      signal: AbortSignal.any([AbortSignal.timeout(20_000), ...(init.signal ? [init.signal] : [])]),
    }),
  });
  try {
    await client.connect(transport);
    const catalog = await client.listTools();
    for (const name of ["microsoft_docs_search", "microsoft_docs_fetch"]) {
      if (!catalog.tools.some((tool) => tool.name === name)) {
        throw new Error(`Learn MCP does not advertise ${name}`);
      }
    }
    return {
      async findDocuments(event) {
        const terms = featureTerms(event);
        const search = await client.callTool({
          name: "microsoft_docs_search",
          arguments: { query: `${event.productArea || ""} ${event.titleEn || event.title}` },
        });
        const payload = JSON.parse(resultText(search));
        if (!Array.isArray(payload.results)) {
          throw new Error("Learn MCP search response has no results array");
        }
        const candidates = [];
        const seen = new Set([urlKey(event.url)]);
        for (const result of payload.results) {
          const url = documentUrl(result.contentUrl);
          if (!url || new URL(url).hostname !== "learn.microsoft.com" ||
            seen.has(urlKey(url)) || !matchesProduct(event, { ...result, url }) ||
            !matchesFeature(terms, result.content || "")) {
            continue;
          }
          seen.add(urlKey(url));
          candidates.push({ ...result, url });
          if (candidates.length === 3) {
            break;
          }
        }
        const documents = [];
        for (const candidate of candidates) {
          const body = resultText(await client.callTool({
            name: "microsoft_docs_fetch", arguments: { url: candidate.url },
          }));
          if (matchesFeature(terms, body)) {
            documents.push({
              title: candidate.title,
              url: candidate.url,
              provenance: "mcp",
              evidenceUrl: event.url,
              evidence: `Microsoft Learn MCP の検索・本文取得で更新の機能語を照合: ${terms.join(", ")}`,
            });
          }
        }
        return documents;
      },
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}

export async function enrichLearnDocuments(events, cache, {
  limit = 6,
  now = new Date().toISOString(),
  findDocuments,
  fetchPage,
  onWarning = (message) => console.warn(message),
} = {}) {
  const candidates = pendingDocumentEvents(events, cache, limit, now);
  if (!candidates.length) {
    return { processed: 0, verified: 0, errors: 0 };
  }
  let lookup;
  let connectionError;
  if (!findDocuments) {
    try {
      lookup = await createLearnLookup();
      findDocuments = lookup.findDocuments;
    } catch (error) {
      connectionError = error;
    }
  }
  const outcome = { processed: 0, verified: 0, errors: 0 };
  try {
    for (const candidate of candidates) {
      const event = events.find((entry) => entry.id === candidate.id);
      const previous = matchingRecord(event, cache);
      outcome.processed += 1;
      try {
        if (connectionError) {
          throw connectionError;
        }
        const found = normalizeDocuments(await findDocuments(event), event.url);
        const verified = {};
        if (found.length) {
          await enrichDocumentCache([event], verified, {
            candidates: new Map([[event.id, found]]), limit: 1,
            now, fetchPage, onWarning,
          });
        }
        const documents = normalizeDocuments([
          ...(verified[event.id]?.documents || []), ...(previous?.documents || []),
        ], event.url);
        const primary = documents.some((document) =>
          document.provenance === "mcp" && !isSupplementaryDocument(document));
        const error = verified[event.id]?.error;
        cache[event.id] = {
          inputFingerprint: documentFingerprint(event),
          status: documents.length ? "verified" : error ? "error" : "not-found",
          checkedAt: now,
          localePreference: "ja-jp",
          documents,
          mcpStatus: primary ? "verified" : error ? "error" : "not-found",
          ...(!primary ? {
            mcpRetryAfter: new Date(Date.parse(now) + (error ? 1 : 7) * 86_400_000).toISOString(),
          } : {}),
          ...(error ? { error } : {}),
        };
        if (primary) outcome.verified += 1;
        if (error) outcome.errors += 1;
      } catch (error) {
        const documents = normalizeDocuments(previous?.documents || [], event.url);
        cache[event.id] = {
          inputFingerprint: documentFingerprint(event),
          status: documents.length ? "verified" : "error",
          checkedAt: now, documents, mcpStatus: "error",
          mcpRetryAfter: new Date(Date.parse(now) + 86_400_000).toISOString(),
          error: `Learn MCP: ${error.message}`,
        };
        onWarning(`Related documents for ${event.id}: ${cache[event.id].error}`);
        outcome.errors += 1;
      }
    }
  } finally {
    await lookup?.close();
  }
  return outcome;
}
