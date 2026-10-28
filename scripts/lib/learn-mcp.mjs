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
  "the", "and", "for", "new", "app", "web", "are", "can", "now", "use", "how",
]);

export function featureTerms(event) {
  const feature = (event.titleEn || event.title).split(":").slice(-1)[0]
    .replace(/\[[^\]]*\]/g, "");
  const words = [...new Set(feature.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [])]
    .filter((word) => !COMMON_WORDS.has(word))
    .map((word) => word.length >= 7 ? word.replace(/(?:ing|ed|s)$/, "") : word.replace(/s$/, ""));
  if (/^work iq\s*:/i.test(event.titleEn || event.title)) words.push("work iq");
  return [...new Set(words)];
}

export function documentationProduct(event) {
  const title = event.titleEn || event.title;
  const prefix = title.includes(":") ? title.slice(0, title.indexOf(":")).trim() : "";
  if (/^Microsoft Copilot \((?:Microsoft )?(?:M365|365)\)$/i.test(prefix)) return "Microsoft 365 Copilot";
  return /^(Microsoft|Dynamics 365|Power Apps|Power Automate|Work IQ|Copilot Studio|Outlook|Word|Excel|PowerPoint|OneNote|SharePoint|Planner|Visio)\b/i.test(prefix)
    ? prefix : event.productArea || "";
}

export function subjectEntities(event) {
  const title = (event.titleEn || event.title).split(":").slice(-1)[0];
  const matches = title.match(/\b(?:[A-Z][A-Za-z0-9-]*\s+){1,4}(?:[Cc]onnector|[Aa]gent|[Dd]ashboard|[Ss]canner|[Ww]eb [Pp]art)\b/g) || [];
  return matches.map((entity) => entity.replace(/^(?:Add|Use|Create|Configure|New|Enable|Manage|Connect|Improve|Integrate)\s+/, ""));
}

export function matchesProduct(event, document) {
  const product = documentationProduct(event);
  const path = new URL(document.url).pathname.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "");
  const allowed = /purview/i.test(product) ? /^\/purview\//
    : /copilot studio/i.test(product) ? /^\/microsoft-copilot-studio\//
    : /microsoft 365 copilot/i.test(product) ? /^\/(?:microsoft-365(?:-[a-z]+)?|microsoftsearch|copilot)\//
    : /microsoft teams/i.test(product) ? /^\/microsoftteams\//
    : /power apps/i.test(product) ? /^\/(?:power-apps|power-platform|microsoft-365(?:-copilot)?|microsoft-copilot-studio)\//
    : /^visio$/i.test(product) ? /^\/(?:office|microsoft-365(?:-apps)?|visio)\//
    : null;
  if (allowed && !allowed.test(path)) return false;
  const title = event.titleEn || event.title;
  if (/teams rooms/i.test(title) && !/teams rooms/i.test(document.title || "")) return false;
  if (/teams rooms.*windows/i.test(title) &&
    /android/i.test(document.title || "") && !/windows/i.test(document.title || "")) return false;
  const context = `${document.title || ""}\n${document.content || ""}`.toLowerCase().replace(/[-\u2010-\u2015]/g, " ");
  if (/^(Word|Excel|PowerPoint|Outlook|OneNote|SharePoint|Planner|Visio)$/i.test(product) &&
    !new RegExp(`\\b${product}\\b`, "i").test(context)) return false;
  if (/\bcopilot chat\b/i.test(title) && !/\bcopilot chat\b/i.test(context)) return false;
  for (const entity of subjectEntities(event)) {
    const phrase = entity.toLowerCase().replace(/[-\u2010-\u2015]/g, " ");
    const pattern = phrase.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+(?:[a-z0-9]+\\s+){0,2}");
    if (!new RegExp(`\\b${pattern}\\b`, "i").test(context) &&
      !(phrase === "rights management connector" && context.includes("rms connector"))) return false;
  }
  const vendor = path.match(/\/connectors\/([^/]+)-deployment/i)?.[1];
  if (/connectors/i.test(title) && vendor) {
    const sourceContext = `${title} ${event.summaryEn || event.summary || ""}`.toLowerCase();
    if (!vendor.split("-").filter((word) => word !== "microsoft")
      .every((word) => sourceContext.includes(word))) return false;
  }
  return true;
}

export function matchesFeature(terms, text, { rejectUnsupported = true } = {}) {
  const normalized = text.toLowerCase();
  return terms.length >= 2 &&
    terms.filter((term) => normalized.includes(term)).length >= Math.max(2, Math.ceil(terms.length * 0.7)) &&
    (!rejectUnsupported || !/(?:isn't|is not|not currently) supported|cannot edit|can't edit/i.test(normalized));
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
    const articles = new Map();
    return {
      async findDocuments(event) {
        const terms = featureTerms(event);
        const search = await client.callTool({
          name: "microsoft_docs_search",
          arguments: { query: `${documentationProduct(event)} ${event.titleEn || event.title}\n${(event.summaryEn || event.summary || "").slice(0, 320)}` },
        });
        const payload = JSON.parse(resultText(search));
        if (!Array.isArray(payload.results)) {
          throw new Error("Learn MCP search response has no results array");
        }
        const candidates = [];
        const seen = new Set([event.url, event.publicationUrl].filter(Boolean).map(urlKey));
        for (const result of payload.results) {
          const url = documentUrl(result.contentUrl);
          if (!url || new URL(url).hostname !== "learn.microsoft.com" ||
            isSupplementaryDocument({ ...result, url }) ||
            seen.has(urlKey(url)) || !matchesProduct(event, { ...result, url }) ||
            !matchesFeature(terms, result.content || "")) {
            continue;
          }
          seen.add(urlKey(url));
          candidates.push({ ...result, url });
        }
        const titleScore = (candidate) => terms.filter((term) =>
          `${candidate.title} ${candidate.url.split("#")[1] || ""}`.toLowerCase().replace(/-/g, " ").includes(term)).length;
        candidates.sort((left, right) => titleScore(right) - titleScore(left));
        const documents = [];
        for (const candidate of candidates.slice(0, 3)) {
          const key = urlKey(candidate.url);
          if (!articles.has(key)) {
            articles.set(key, resultText(await client.callTool({
              name: "microsoft_docs_fetch", arguments: { url: candidate.url },
            })));
            if (articles.size > 100) articles.delete(articles.keys().next().value);
          }
          const body = articles.get(key);
          // Search chunks are feature-scoped; unrelated limitations elsewhere in
          // the complete article must not veto an otherwise relevant reference.
          if (matchesFeature(terms, body, { rejectUnsupported: false })) {
            documents.push({
              title: candidate.title,
              sourceTitle: candidate.title,
              url: candidate.url,
              provenance: "mcp",
              evidenceUrl: event.publicationUrl || event.url,
              evidence: `Microsoft Learn MCP の検索・本文取得で更新の機能語を照合: ${terms.join(", ")}`,
            });
            break;
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
        const error = verified[event.id]?.error || (!documents.length ? previous?.error : undefined);
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
