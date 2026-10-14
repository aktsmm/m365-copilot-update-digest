import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

export const MAX_DOCUMENTS = 3;
export const OFFICIAL_HOSTS = new Set([
  "learn.microsoft.com",
  "techcommunity.microsoft.com",
  "devblogs.microsoft.com",
  "www.microsoft.com",
  "docs.github.com",
]);

export class OfficialPageError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "OfficialPageError";
    this.status = status;
  }
}

export function officialUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !OFFICIAL_HOSTS.has(url.hostname)
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function documentUrl(value, base) {
  const url = officialUrl(value, base);
  if (
    !url ||
    !["learn.microsoft.com", "docs.github.com"].includes(url.hostname) ||
    !/^\/(?:[a-z]{2}-[a-z]{2}\/)?[^/]+\/[^/]+/i.test(url.pathname) ||
    (url.hostname === "docs.github.com" && !/^\/(?:en|ja)\/[^/]+\/[^/]+/i.test(url.pathname)) ||
    /^\/(?:[a-z]{2}-[a-z]{2}\/)?(?:api|search|answers|users|legal|training)\b/i.test(url.pathname)
  ) {
    return null;
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|wt\.|ocid$|ref_)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.toString();
}

export function japaneseDocumentUrl(value) {
  const validated = documentUrl(value);
  if (!validated) {
    throw new Error(`Not a supported documentation URL: ${value}`);
  }
  const url = new URL(validated);
  url.pathname = url.hostname === "docs.github.com"
    ? `/ja${url.pathname.replace(/^\/(?:en|ja)(?=\/)/i, "")}`
    : `/ja-jp${url.pathname.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "")}`;
  return url.toString();
}

export function isSupplementaryDocument(document) {
  return officialUrl(document?.url)?.hostname === "docs.github.com" ||
    (/\bGitHub Copilot\b/i.test(document?.title || "") &&
      !/\b(?:Microsoft 365|M365|Copilot Studio)\b/i.test(document?.title || ""));
}

function isJapaneseUrl(value) {
  return /^\/(?:ja-jp|ja)\//i.test(new URL(value).pathname);
}

export function urlKey(value) {
  const url = officialUrl(value);
  if (!url) {
    return String(value || "");
  }
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_|wt\.|ocid$|ref_)/i.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  const pathname = url.hostname === "docs.github.com"
    ? url.pathname.replace(/^\/(?:en|ja)(?=\/)/i, "")
    : url.pathname.replace(/^\/[a-z]{2}-[a-z]{2}(?=\/)/i, "");
  return `${url.hostname}${pathname.replace(/\/$/, "")}${url.search}`;
}

export function normalizeDocuments(documents = [], originalUrl) {
  const seen = new Set([urlKey(originalUrl)]);
  const result = [];
  const prioritized = [...documents].sort((left, right) =>
    Number(isSupplementaryDocument(left)) - Number(isSupplementaryDocument(right)));
  for (const document of prioritized) {
    const url = documentUrl(document?.url);
    const title = String(document?.title || "").replace(/\s+/g, " ").trim();
    if (!url || !title || seen.has(urlKey(url))) {
      continue;
    }
    seen.add(urlKey(url));
    result.push({ ...document, title, url, ...(isSupplementaryDocument(document) ? { supplemental: true } : {}) });
    if (result.length === MAX_DOCUMENTS) {
      break;
    }
  }
  return result;
}

export function extractDocumentLinks(html, baseUrl, provenance = "source") {
  const $ = cheerio.load(html);
  const candidates = [];
  $("a[href]").each((_, anchor) => {
    const url = documentUrl($(anchor).attr("href"), baseUrl);
    if (url) {
      candidates.push({
        title: $(anchor).text().replace(/\s+/g, " ").trim(),
        url,
        provenance,
        evidenceUrl: baseUrl,
        ...(new URL(url).hostname === "docs.github.com"
          ? { evidence: $(anchor).closest("p, li").text().replace(/\s+/g, " ").trim().slice(0, 600) || $(anchor).text().trim() }
          : {}),
      });
    }
  });
  return normalizeDocuments(candidates);
}

export function articleContent(html, articleUrl) {
  const $ = cheerio.load(html);
  const nextData = $("script#__NEXT_DATA__").text();
  const canonicalUrl = articleUrl || $("link[rel='canonical']").attr("href");
  $("nav, header, footer, aside, script, style, .lia-message-signature, .lia-quilt-column-side-content").remove();
  const content = $(".lia-message-body-content, .lia-message-body, .entry-content, main article, main, article, #main").first();
  if (content.length) {
    return content.html();
  }
  // Aurora publishes the requested blog body in its public Next.js page data.
  const official = officialUrl(canonicalUrl);
  const messageId = official?.pathname.match(/\/(\d+)\/?$/)?.[1];
  if (nextData && official?.hostname === "techcommunity.microsoft.com" && messageId) {
    const state = JSON.parse(nextData).props?.pageProps?.apolloState;
    const body = state?.[`BlogTopicMessage:message:${messageId}`]?.body;
    if (typeof body === "string" && body.trim()) {
      return articleContent(`<article>${body}</article>`);
    }
  }
  throw new Error("Official article content was not found");
}

export function documentFingerprint(event) {
  return createHash("sha256")
    .update(JSON.stringify([
      event.id,
      event.titleEn || event.title,
      event.summaryEn || event.summary,
      event.url,
    ]))
    .digest("hex");
}

export function matchingRecord(event, cache) {
  const record = cache[event.id];
  return record?.inputFingerprint === documentFingerprint(event) ? record : null;
}

export function requiresDocumentEnrichment(event, cache, retryErrors = false) {
  const record = matchingRecord(event, cache);
  return !record ||
    (retryErrors && Boolean(record.error)) ||
    (record.status === "verified" && record.localePreference !== "ja-jp" &&
      record.documents.some((document) => !isJapaneseUrl(document.url)));
}

export function withRelatedDocuments(event, cache) {
  const record = matchingRecord(event, cache);
  const relatedDocuments = normalizeDocuments(
    [...(record?.documents || []), ...(event.relatedDocuments || [])],
    event.url,
  );
  return {
    ...event,
    ...(relatedDocuments.length || event.relatedDocuments ? { relatedDocuments } : {}),
  };
}

export function pendingDocumentEvents(events, cache, limit = 6) {
  return [...events]
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id))
    .filter((event) => {
      const record = matchingRecord(event, cache);
      const documents = withRelatedDocuments(event, cache).relatedDocuments || [];
      return !documents.some((document) => !isSupplementaryDocument(document)) && !record?.mcpStatus;
    })
    .slice(0, limit)
    .map((event) => ({
      id: event.id,
      title: event.titleEn || event.title,
      summary: event.summaryEn || event.summary,
      url: event.url,
      inputFingerprint: documentFingerprint(event),
    }));
}

export function validateDocumentCache(cache) {
  if (!cache || Array.isArray(cache) || typeof cache !== "object") {
    throw new Error("Related document cache must be an object");
  }
  for (const [id, record] of Object.entries(cache)) {
    if (
      !record || typeof record !== "object" || Array.isArray(record) ||
      !/^[a-f0-9]{64}$/.test(record.inputFingerprint || "") ||
      !["verified", "not-found", "error"].includes(record.status) ||
      !Number.isFinite(Date.parse(record.checkedAt)) ||
      !Array.isArray(record.documents) ||
      record.documents.length > MAX_DOCUMENTS ||
      (record.mcpStatus !== undefined && !["verified", "not-found", "error"].includes(record.mcpStatus))
    ) {
      throw new Error(`Invalid related document record: ${id}`);
    }
    if ((record.status === "verified") !== (record.documents.length > 0)) {
      throw new Error(`Verified related document record is empty: ${id}`);
    }
    if ((record.status === "error" || record.mcpStatus === "error") && !record.error) {
      throw new Error(`Related document error has no diagnostic: ${id}`);
    }
    if (record.mcpStatus === "verified" && !record.documents.some((document) => document.provenance === "mcp")) {
      throw new Error(`Verified MCP record has no MCP evidence: ${id}`);
    }
    if (record.mcpStatus === "verified" && !record.documents.some((document) => !isSupplementaryDocument(document))) {
      throw new Error(`Verified MCP record has no primary Microsoft documentation: ${id}`);
    }
    if (normalizeDocuments(record.documents).length !== record.documents.length) {
      throw new Error(`Invalid or duplicate related document URLs: ${id}`);
    }
    for (const document of record.documents) {
      if (
        !["source", "article", "mcp", "reference"].includes(document.provenance) ||
        !officialUrl(document.evidenceUrl) ||
        ((["mcp", "reference"].includes(document.provenance) ||
          new URL(document.url).hostname === "docs.github.com") &&
          !String(document.evidence || "").trim())
      ) {
        throw new Error(`Related document lacks provenance: ${id}`);
      }
    }
  }
}

export async function fetchOfficialPage(value, { fetchImpl = fetch } = {}) {
  let url = officialUrl(value);
  if (!url) {
    throw new Error(`Not an allowed official URL: ${value}`);
  }
  const signal = AbortSignal.timeout(15_000);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const response = await fetchImpl(url.toString(), {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "m365-copilot-update-digest/0.1" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      url = officialUrl(response.headers.get("location"), url);
      if (!url) {
        throw new Error("Official page redirected outside the allow-list");
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new OfficialPageError(`Official page returned HTTP ${response.status}: ${url}`, response.status);
    }
    if (!/text\/html/i.test(response.headers.get("content-type") || "")) {
      await response.body?.cancel();
      throw new Error(`Official page is not HTML: ${url}`);
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) {
        break;
      }
      size += chunk.byteLength;
      if (size > 4_000_000) {
        await reader.cancel();
        throw new Error(`Official page exceeds 4 MB: ${url}`);
      }
      chunks.push(chunk);
    }
    return { url: url.toString(), html: Buffer.concat(chunks).toString("utf8") };
  }
  throw new Error("Too many official page redirects");
}

export async function enrichDocumentCache(events, cache, {
  candidates = new Map(),
  limit = 12,
  requestLimit = 24,
  retryErrors = false,
  fetchPage = fetchOfficialPage,
  now = new Date().toISOString(),
  onWarning = (message) => console.warn(message),
} = {}) {
  const pages = new Map();
  let requests = 0;
  let processed = 0;
  const page = async (url) => {
    const key = url.split("#")[0];
    if (!pages.has(key)) {
      if (requests >= requestLimit) {
        throw new Error("Related document request budget reached");
      }
      requests += 1;
      pages.set(key, fetchPage(key));
    }
    return pages.get(key);
  };
  const sorted = [...events].sort((a, b) =>
    String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id));
  for (const event of sorted) {
    if (processed >= limit || requests >= requestLimit) {
      break;
    }
    const previous = matchingRecord(event, cache);
    if (!requiresDocumentEnrichment(event, cache, retryErrors)) {
      continue;
    }
    processed += 1;
    const documents = [];
    const failures = [];
    let links = normalizeDocuments([
      ...(candidates.get(event.id) || []),
      ...(previous?.documents || []),
    ], event.url);
    try {
      // A Learn release-notes page covers many updates: only use its item links.
      const original = officialUrl(event.url);
      if (!links.length && original && !/\/(?:release-notes|whats-new|roadmap)\/?$/i.test(original.pathname)) {
        const article = await page(event.url);
        links = extractDocumentLinks(articleContent(article.html, article.url), article.url, "article");
      }
    } catch (error) {
      failures.push(error.message);
    }
    for (const candidate of normalizeDocuments(links, event.url)) {
      if (requests >= requestLimit) {
        failures.push("Related document request budget reached");
        break;
      }
      try {
        let response;
        const japaneseUrl = japaneseDocumentUrl(candidate.url);
        if (japaneseUrl !== candidate.url) {
          try {
            const japanese = await page(japaneseUrl);
            const $ = cheerio.load(japanese.html);
            const contentLocale = $("meta[name='ms.contentlocale'], meta[name='contentlocale']").attr("content");
            // A redirect back to English is not evidence of a Japanese edition.
            if (isJapaneseUrl(japanese.url) &&
              (!contentLocale || /^ja\b/i.test(contentLocale)) &&
              $("main h1, article h1, h1").first().text().trim() &&
              /[\u3040-\u30ff\u3400-\u9fff]/.test($("main, article").text())) {
              response = japanese;
            }
          } catch (error) {
            if (!(error instanceof OfficialPageError && [404, 410].includes(error.status))) {
              failures.push(`Japanese edition: ${error.message}`);
            }
          }
        }
        response ||= await page(candidate.url);
        const resolvedUrl = new URL(response.url);
        resolvedUrl.hash = new URL(candidate.url).hash;
        const url = documentUrl(resolvedUrl.toString());
        if (!url) {
          throw new Error("Document redirected outside supported official documentation");
        }
        const $ = cheerio.load(response.html);
        const title = $("main h1, article h1, h1").first().text().replace(/\s+/g, " ").trim();
        if (!title) {
          throw new Error(`Document title was not found: ${url}`);
        }
        documents.push({ ...candidate, title, url });
      } catch (error) {
        failures.push(error.message);
        const confirmed = previous?.documents.find((document) => urlKey(document.url) === urlKey(candidate.url));
        if (confirmed) {
          documents.push(confirmed);
        }
      }
    }
    const normalized = normalizeDocuments([...documents, ...(previous?.documents || [])], event.url);
    cache[event.id] = {
      inputFingerprint: documentFingerprint(event),
      status: normalized.length ? "verified" : failures.length ? "error" : "not-found",
      checkedAt: now,
      localePreference: "ja-jp",
      documents: normalized,
      ...(previous?.mcpStatus ? { mcpStatus: previous.mcpStatus } : {}),
      ...(failures.length ? { error: failures.join("; ") }
        : previous?.mcpStatus === "error" ? { error: previous.error } : {}),
    };
    if (failures.length) {
      onWarning(`Related documents for ${event.id}: ${failures.join("; ")}`);
    }
  }
  return { processed, requests };
}
