import fs from "node:fs/promises";
import path from "node:path";

import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { translate } from "@vitalets/google-translate-api";

import {
  buildDailyMarkdown,
  buildEventId,
  dedupeEvents,
  detectAudienceTags,
  detectReleaseStage,
  excerptText,
  importanceReason,
  importanceScore,
  normalizeWhitespace,
  safeDate,
  slugify,
  toDateOnly,
} from "./lib/reporting.mjs";

const workspaceRoot = process.cwd();
const sourcesFile = path.join(workspaceRoot, "config", "sources.json");
const summaryCacheFile = path.join(
  workspaceRoot,
  "config",
  "summary-ja-cache.json",
);
const eventsDir = path.join(workspaceRoot, "data", "events");
const summariesDir = path.join(workspaceRoot, "summaries", "daily");
const stateFile = path.join(workspaceRoot, "data", "state.json");
const runSummaryFile = path.join(workspaceRoot, "data", "run-summary.json");
const TRANSLATION_MARKER_PREFIX = "[[[M365_DIGEST_ITEM_";
const TITLE_TRANSLATION_MARKER_PREFIX = "[[[M365_DIGEST_TITLE_";
const MAX_TRANSLATION_BATCH_CHARS = 3600;
const MAX_TRANSLATION_BATCH_ITEMS = 12;
const MAX_TITLE_TRANSLATION_BATCH_CHARS = 2200;
const MAX_TITLE_TRANSLATION_BATCH_ITEMS = 28;
const MAX_TRANSLATED_SUMMARIES_PER_RUN = 80;
const MAX_TRANSLATED_TITLES_PER_RUN = 240;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
  htmlEntities: false,
});

async function readJson(filePath, fallbackValue) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) {
      return fallbackValue;
    }

    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallbackValue;
    }

    throw error;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "m365-copilot-update-digest/0.1",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

async function readExistingEvents() {
  const entries = await fs
    .readdir(eventsDir, { withFileTypes: true })
    .catch((error) => {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    });

  const existing = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const log = await readJson(path.join(eventsDir, entry.name), null);
    for (const event of log?.events ?? []) {
      existing.push(event);
    }
  }

  return existing;
}

function toArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function stripHtmlText(html) {
  let decoded = String(html ?? "");
  for (let index = 0; index < 3; index += 1) {
    const next = decoded
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&nbsp;|&#160;/gi, " ");
    if (next === decoded) {
      break;
    }

    decoded = next;
  }
  const $ = cheerio.load(decoded);
  return normalizeWhitespace($.text());
}

function readXmlText(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    return value["#text"] ?? value.__cdata ?? "";
  }

  return String(value);
}

function matchesKeywords(source, entry) {
  const includes = source.includeKeywords ?? [];
  const excludes = source.excludeKeywords ?? [];
  const haystack = [
    entry.title,
    entry.summary,
    ...(entry.categories || []),
  ]
    .join("\n")
    .toLowerCase();

  if (includes.length > 0 && !includes.some((keyword) => haystack.includes(String(keyword).toLowerCase()))) {
    return false;
  }

  if (excludes.some((keyword) => haystack.includes(String(keyword).toLowerCase()))) {
    return false;
  }

  return true;
}

function isLikelyJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value ?? ""));
}

function shouldIgnoreCachedJapaneseSummary(source, summaryJa) {
  return (
    source.sourceFamily === "Tech Community" &&
    /公開ドキュメント由来の更新です。?$/.test(String(summaryJa ?? ""))
  );
}

function stageDescription(stage) {
  switch (stage) {
    case "GA":
      return "一般提供として案内されています";
    case "Preview":
      return "プレビューとして案内されています";
    case "Rolling out":
      return "ロールアウトが進行中です";
    case "Retirement":
      return "廃止や移行対応が案内されています";
    default:
      return "更新内容が案内されています";
  }
}

function buildJapaneseFallbackSummary(event) {
  const audienceText =
    event.roleTags && event.roleTags.length > 0
      ? ` 主な対象は ${event.roleTags.join(" / ")} です。`
      : "";
  const sourceText =
    event.sourceFamily === "Tech Community"
      ? "公式ブログ由来の更新です。"
      : "公開ドキュメント由来の更新です。";
  const compactTitle = String(event.title ?? "").replace(/\s*\[[^\]]+\]\s*$/g, "");
  return normalizeWhitespace(
    `${event.productArea} の更新です。${compactTitle} に関する内容で、${stageDescription(event.releaseStage)}。${sourceText}${audienceText}`,
  );
}

function buildJapaneseFallbackTitle(event) {
  const text = `${event.titleEn || event.title || ""}\n${event.summaryEn || event.summary || ""}`.toLowerCase();

  if (/welcome to the .*blog|launch of the .*blog/.test(text)) {
    return `${event.productArea} 公式ブログ開始`;
  }

  if (/agent evaluation/.test(text)) {
    return `${event.productArea} のエージェント評価`;
  }

  if (/security|governance|analytics/.test(text)) {
    return `${event.productArea} のセキュリティ・管理・分析機能を強化`;
  }

  if (/copilot in word/.test(text)) {
    return `Word の Copilot 機能強化`;
  }

  if (/code interpreter/.test(text)) {
    return `コード インタープリタ機能の拡張`;
  }

  if (/onedrive/.test(text) && /summary/.test(text)) {
    return `OneDrive 共有時の Copilot 要約に対応`;
  }

  if (/teams|meeting|chat|channel/.test(text)) {
    return `${event.productArea} の会議・チャット機能を更新`;
  }

  if (/connector|connect to|integration/.test(text)) {
    return `${event.productArea} の連携機能を拡張`;
  }

  if (/license|pricing|billing|cost|capacity/.test(text)) {
    return `${event.productArea} のライセンス・課金関連更新`;
  }

  return `${event.productArea} の更新`;
}

function buildTranslationBatches(events, pickText, maxChars, maxItems) {
  const batches = [];
  let currentBatch = [];
  let currentChars = 0;

  for (const event of events) {
    const text = normalizeWhitespace(pickText(event));
    if (!text) {
      continue;
    }

    const estimatedChars = text.length + 48;
    const exceedsBatch =
      currentBatch.length >= maxItems ||
      currentChars + estimatedChars > maxChars;

    if (currentBatch.length > 0 && exceedsBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(event);
    currentChars += estimatedChars;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function splitTranslatedBatch(translatedText, batch) {
  const matches = [...String(translatedText ?? "").matchAll(/\[\[\[M365_DIGEST_(?:ITEM|TITLE)_(\d+)\]\]\]/g)];
  const translatedByIndex = new Map();

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const itemIndex = Number.parseInt(current[1], 10);
    const start = current.index + current[0].length;
    const end = next ? next.index : translatedText.length;
    translatedByIndex.set(itemIndex, normalizeWhitespace(translatedText.slice(start, end)));
  }

  return batch.map((event, index) => ({
    event,
    text: translatedByIndex.get(index) || "",
  }));
}

function shouldIgnoreCachedJapaneseTitle(titleJa, titleEn) {
  return !titleJa || !isLikelyJapanese(titleJa) || titleJa === titleEn;
}

async function localizeJapaneseTitles(
  events,
  existingById,
  summaryCache,
  nowIso,
) {
  const pending = [];

  for (const event of events) {
    event.titleEn = normalizeWhitespace(event.titleEn || event.title || "");

    if (!event.titleEn) {
      event.titleJa = "";
      continue;
    }

    if (isLikelyJapanese(event.titleJa || event.titleEn)) {
      event.titleJa = normalizeWhitespace(event.titleJa || event.titleEn);
      summaryCache[event.id] = {
        ...summaryCache[event.id],
        title: event.titleEn,
        titleJa: event.titleJa,
        updatedAt: nowIso,
      };
      continue;
    }

    const cached = summaryCache[event.id];
    if (
      cached &&
      cached.title === event.titleEn &&
      cached.titleJa &&
      !shouldIgnoreCachedJapaneseTitle(cached.titleJa, event.titleEn)
    ) {
      event.titleJa = cached.titleJa;
      continue;
    }

    const existing = existingById.get(event.id);
    if (
      existing &&
      existing.titleEn === event.titleEn &&
      existing.titleJa &&
      !shouldIgnoreCachedJapaneseTitle(existing.titleJa, event.titleEn)
    ) {
      event.titleJa = existing.titleJa;
      summaryCache[event.id] = {
        ...summaryCache[event.id],
        title: event.titleEn,
        titleJa: event.titleJa,
        updatedAt: nowIso,
      };
      continue;
    }

    pending.push(event);
  }

  pending.sort(
    (left, right) =>
      new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0),
  );

  const translatable = pending.slice(0, MAX_TRANSLATED_TITLES_PER_RUN);
  const fallbackOnly = pending.slice(MAX_TRANSLATED_TITLES_PER_RUN);
  const batches = buildTranslationBatches(
    translatable,
    (event) => event.titleEn,
    MAX_TITLE_TRANSLATION_BATCH_CHARS,
    MAX_TITLE_TRANSLATION_BATCH_ITEMS,
  );

  for (const batch of batches) {
    const requestText = batch
      .map((event, index) => `${TITLE_TRANSLATION_MARKER_PREFIX}${index}]]]\n${event.titleEn}`)
      .join("\n");

    try {
      const result = await translate(requestText, { to: "ja" });
      const translatedEntries = splitTranslatedBatch(result.text, batch);
      for (const entry of translatedEntries) {
        entry.event.titleJa =
          entry.text && entry.text !== entry.event.titleEn
            ? excerptText(entry.text, 96)
            : buildJapaneseFallbackTitle(entry.event);
        summaryCache[entry.event.id] = {
          ...summaryCache[entry.event.id],
          title: entry.event.titleEn,
          titleJa: entry.event.titleJa,
          updatedAt: nowIso,
        };
      }
    } catch {
      for (const event of batch) {
        event.titleJa = buildJapaneseFallbackTitle(event);
        summaryCache[event.id] = {
          ...summaryCache[event.id],
          title: event.titleEn,
          titleJa: event.titleJa,
          updatedAt: nowIso,
        };
      }
    }
  }

  for (const event of fallbackOnly) {
    event.titleJa = buildJapaneseFallbackTitle(event);
    summaryCache[event.id] = {
      ...summaryCache[event.id],
      title: event.titleEn,
      titleJa: event.titleJa,
      updatedAt: nowIso,
    };
  }

  for (const event of pending) {
    if (!event.titleJa) {
      event.titleJa = buildJapaneseFallbackTitle(event);
      summaryCache[event.id] = {
        ...summaryCache[event.id],
        title: event.titleEn,
        titleJa: event.titleJa,
        updatedAt: nowIso,
      };
    }
  }

  return events;
}

async function localizeJapaneseSummaries(
  source,
  events,
  existingById,
  summaryCache,
  nowIso,
) {
  const pending = [];

  for (const event of events) {
    event.summaryEn = normalizeWhitespace(event.summaryEn || event.summary || "");
    event.sourceFamily = event.sourceFamily || source.sourceFamily || "Other";
    event.productArea = event.productArea || source.productArea;

    if (!event.summaryEn) {
      event.summaryJa = "";
      continue;
    }

    if (isLikelyJapanese(event.summaryJa || event.summaryEn)) {
      event.summaryJa = normalizeWhitespace(event.summaryJa || event.summaryEn);
      summaryCache[event.id] = {
        summary: event.summaryEn,
        summaryJa: event.summaryJa,
        updatedAt: nowIso,
      };
      continue;
    }

    const cached = summaryCache[event.id];
    if (
      cached &&
      cached.summary === event.summaryEn &&
      cached.summaryJa &&
      !shouldIgnoreCachedJapaneseSummary(source, cached.summaryJa)
    ) {
      event.summaryJa = cached.summaryJa;
      continue;
    }

    const existing = existingById.get(event.id);
    if (
      existing &&
      existing.summary === event.summary &&
      existing.summaryJa &&
      existing.summaryJa !== (existing.summaryEn || existing.summary) &&
      !shouldIgnoreCachedJapaneseSummary(source, existing.summaryJa)
    ) {
      event.summaryJa = existing.summaryJa;
      summaryCache[event.id] = {
        summary: event.summaryEn,
        summaryJa: event.summaryJa,
        updatedAt: nowIso,
      };
      continue;
    }

    pending.push(event);
  }

  pending.sort(
    (left, right) =>
      new Date(right.publishedAt || 0) - new Date(left.publishedAt || 0),
  );

  const translatable = pending.slice(0, MAX_TRANSLATED_SUMMARIES_PER_RUN);
  const fallbackOnly = pending.slice(MAX_TRANSLATED_SUMMARIES_PER_RUN);
  const batches = buildTranslationBatches(
    translatable,
    (event) => event.summaryEn,
    MAX_TRANSLATION_BATCH_CHARS,
    MAX_TRANSLATION_BATCH_ITEMS,
  );

  for (const batch of batches) {
    const requestText = batch
      .map((event, index) => `${TRANSLATION_MARKER_PREFIX}${index}]]]\n${event.summaryEn}`)
      .join("\n");

    try {
      const result = await translate(requestText, { to: "ja" });
      const translatedEntries = splitTranslatedBatch(result.text, batch);
      for (const entry of translatedEntries) {
        entry.event.summaryJa =
          entry.text && entry.text !== entry.event.summaryEn
            ? excerptText(entry.text, 280)
            : buildJapaneseFallbackSummary(entry.event);
        summaryCache[entry.event.id] = {
          summary: entry.event.summaryEn,
          summaryJa: entry.event.summaryJa,
          updatedAt: nowIso,
        };
      }
    } catch {
      for (const event of batch) {
        event.summaryJa = buildJapaneseFallbackSummary(event);
        summaryCache[event.id] = {
          summary: event.summaryEn,
          summaryJa: event.summaryJa,
          updatedAt: nowIso,
        };
      }
    }
  }

  for (const event of fallbackOnly) {
    event.summaryJa = buildJapaneseFallbackSummary(event);
    summaryCache[event.id] = {
      summary: event.summaryEn,
      summaryJa: event.summaryJa,
      updatedAt: nowIso,
    };
  }

  for (const event of pending) {
    if (!event.summaryJa) {
      event.summaryJa = buildJapaneseFallbackSummary(event);
      summaryCache[event.id] = {
        summary: event.summaryEn,
        summaryJa: event.summaryJa,
        updatedAt: nowIso,
      };
    }
  }

  return events;
}

function rootElement($) {
  const main = $("main").first();
  return main.length ? main : $("body").first();
}

function parseUsDateHeading(text) {
  if (
    !/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}$/i.test(
      text,
    )
  ) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseMonthHeading(text) {
  if (
    !/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(
      text,
    )
  ) {
    return null;
  }

  const date = new Date(`${text} 1`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function extractRoadmapIds(rawText, links) {
  const ids = new Set();

  for (const href of links) {
    const match = href.match(/[?&]id=(\d+)|searchterms=(\d+)/i);
    if (match?.[1] || match?.[2]) {
      ids.add(match[1] ?? match[2]);
    }
  }

  const inlineMatch = rawText.match(/Roadmap ID(?:s)?:\s*([\d,\s]+)/i);
  if (inlineMatch?.[1]) {
    for (const candidate of inlineMatch[1].split(/[,\s]+/)) {
      if (/^\d+$/.test(candidate)) {
        ids.add(candidate);
      }
    }
  }

  return [...ids];
}

function firstUsefulLink(baseUrl, links, fallbackAnchor) {
  const resolved = links
    .map((href) => {
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  const firstNonRoadmap = resolved.find(
    (href) => !/microsoft-365\/roadmap/i.test(href),
  );
  return firstNonRoadmap || fallbackAnchor || baseUrl;
}

function splitLeadText(rawText, title) {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  let text = lines.slice(1).join(" ").trim() || rawText;
  if (text.startsWith(title)) {
    text = text.slice(title.length).trim();
  }

  text = text
    .split(
      /Roadmap ID(?:s)?:|Details:|What changed:|Why this matters:|Why:|Try this:|Additional resources:/i,
    )[0]
    .trim();

  return excerptText(text || rawText, 280);
}

function topLevelListItem($, element) {
  return $(element).parents("li").length === 0;
}

function extractM365ReleaseNotes(source, html) {
  const $ = cheerio.load(html);
  const main = rootElement($);
  const events = [];
  let currentDate = null;
  let currentSection = source.productArea;

  main.find("h2, h3, li").each((_, element) => {
    const tag = String(element.tagName ?? "").toLowerCase();
    const text = normalizeWhitespace($(element).text());
    if (!text) {
      return;
    }

    if (tag === "h2") {
      currentDate = parseUsDateHeading(text);
      return;
    }

    if (tag === "h3") {
      currentSection = text;
      return;
    }

    if (tag !== "li" || !currentDate || !topLevelListItem($, element)) {
      return;
    }

    const rawText = normalizeWhitespace($(element).text());
    const title = rawText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)[0];

    if (!title || title.length < 6) {
      return;
    }

    const links = $(element)
      .find("a[href]")
      .map((__, anchor) => $(anchor).attr("href"))
      .get()
      .filter(Boolean);
    const anchorUrl = `${source.url}#${slugify(toDateOnly(currentDate))}`;
    const event = {
      id: buildEventId(source.id, title, currentDate, currentSection),
      title,
      summary: splitLeadText(rawText, title),
      summaryEn: splitLeadText(rawText, title),
      summaryJa: splitLeadText(rawText, title),
      url: firstUsefulLink(source.url, links, anchorUrl),
      publishedAt: currentDate,
      productArea: source.productArea,
      section: currentSection,
      roadmapIds: extractRoadmapIds(rawText, links),
      releaseStage: detectReleaseStage(rawText),
      tags: [currentSection].filter(Boolean),
    };
    events.push(event);
  });

  return events;
}

function extractCopilotStudioWhatsNew(source, html) {
  const $ = cheerio.load(html);
  const main = rootElement($);
  const events = [];
  let currentMonth = null;

  main.find("h3, li").each((_, element) => {
    const tag = String(element.tagName ?? "").toLowerCase();
    const text = normalizeWhitespace($(element).text());
    if (!text) {
      return;
    }

    if (tag === "h3") {
      currentMonth = parseMonthHeading(text);
      return;
    }

    if (tag !== "li" || !currentMonth || !topLevelListItem($, element)) {
      return;
    }

    const rawText = normalizeWhitespace($(element).text());
    const tentativeTitle =
      rawText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)[0] || rawText.split(/\.(?=\s+[A-Z(])|:\s+/)[0].trim();
    const title = excerptText(tentativeTitle || rawText, 120);
    if (!title || title.length < 6) {
      return;
    }

    const links = $(element)
      .find("a[href]")
      .map((__, anchor) => $(anchor).attr("href"))
      .get()
      .filter(Boolean);

    const event = {
      id: buildEventId(source.id, title, currentMonth, title),
      title,
      summary: splitLeadText(rawText, title),
      summaryEn: splitLeadText(rawText, title),
      summaryJa: splitLeadText(rawText, title),
      url: firstUsefulLink(source.url, links, `${source.url}#${slugify(text)}`),
      publishedAt: currentMonth,
      productArea: source.productArea,
      section: source.productArea,
      roadmapIds: [],
      releaseStage: detectReleaseStage(rawText),
      tags: [source.productArea],
    };
    events.push(event);
  });

  return events;
}

function extractLastUpdated(text) {
  const normalized = normalizeWhitespace(text);
  const learnMatch = normalized.match(
    /Last updated on\s+(\d{2})\/(\d{2})\/(\d{4})/i,
  );
  if (learnMatch) {
    const date = new Date(
      `${learnMatch[3]}-${learnMatch[1]}-${learnMatch[2]}T00:00:00Z`,
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const monthMatch = normalized.match(
    /Updated\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i,
  );
  if (monthMatch) {
    const date = new Date(monthMatch[1]);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function parseRssFeed(source, xmlText) {
  const parsed = xmlParser.parse(xmlText);
  const items = toArray(parsed?.rss?.channel?.item);

  return items
    .slice(0, source.maxItems ?? items.length)
    .map((item) => {
      const rawSummary = readXmlText(item.description || item["content:encoded"] || "");
      const title = normalizeWhitespace(readXmlText(item.title));
      const categories = toArray(item.category).map((category) => normalizeWhitespace(readXmlText(category))).filter(Boolean);
      return {
        id: buildEventId(source.id, title, item.pubDate || item.isoDate || source.id, readXmlText(item.guid) || readXmlText(item.link)),
        title,
        summary: excerptText(stripHtmlText(rawSummary), 280),
        summaryEn: excerptText(stripHtmlText(rawSummary), 280),
        summaryJa: excerptText(stripHtmlText(rawSummary), 280),
        url: normalizeWhitespace(readXmlText(item.link)),
        publishedAt: new Date(item.pubDate || item.isoDate || Date.now()).toISOString(),
        productArea: source.productArea,
        section: source.productArea,
        roadmapIds: [],
        releaseStage: detectReleaseStage(`${title}\n${rawSummary}\n${categories.join(" ")}`),
        tags: [...new Set([source.productArea, ...categories])],
        categories,
      };
    })
    .filter((entry) => entry.title && entry.url)
    .filter((entry) => matchesKeywords(source, entry));
}

function extractSinglePageUpdate(source, html, nowIso) {
  const $ = cheerio.load(html);
  const main = rootElement($);
  const title =
    normalizeWhitespace(main.find("h1").first().text()) || source.name;
  const paragraphs = main
    .find("p")
    .map((_, element) => normalizeWhitespace($(element).text()))
    .get()
    .filter(
      (value) =>
        value &&
        !/^Last updated on/i.test(value) &&
        value.length > 40 &&
        value !== "Note",
    );
  const summary = excerptText(
    paragraphs[0] || normalizeWhitespace(main.text()),
    280,
  );
  const publishedAt = extractLastUpdated(main.text()) || nowIso;
  return [
    {
      id: buildEventId(
        source.id,
        source.updateTitle || `${title} updated`,
        publishedAt,
      ),
      title: source.updateTitle || `${title} updated`,
      summary,
      summaryEn: summary,
      summaryJa: summary,
      url: source.url,
      publishedAt,
      productArea: source.productArea,
      section: source.productArea,
      roadmapIds: [],
      releaseStage: detectReleaseStage(summary),
      tags: [source.productArea],
    },
  ];
}

function parseSource(source, html, nowIso) {
  switch (source.kind) {
    case "m365_release_notes":
      return extractM365ReleaseNotes(source, html);
    case "copilot_studio_whats_new":
      return extractCopilotStudioWhatsNew(source, html);
    case "rss_feed":
      return parseRssFeed(source, html);
    case "single_page_update":
      return extractSinglePageUpdate(source, html, nowIso);
    default:
      throw new Error(`Unsupported source kind: ${source.kind}`);
  }
}

function normalizeEvent(source, event, existingEvent, nowIso) {
  const roleTags = detectAudienceTags(
    event.title,
    event.summary,
    event.productArea || source.productArea,
  );
  const normalized = {
    id: event.id,
    sourceId: source.id,
    sourceName: source.name,
    sourceFamily: source.sourceFamily || "Other",
    productArea: event.productArea || source.productArea,
    section: event.section || source.productArea,
    title: event.title,
    titleJa: event.titleJa || event.title,
    titleEn: event.titleEn || event.title,
    summary: event.summary,
    summaryJa: event.summaryJa || event.summary,
    summaryEn: event.summaryEn || event.summary,
    url: event.url || source.url,
    publishedAt: event.publishedAt || nowIso,
    capturedAt: existingEvent?.capturedAt || nowIso,
    sourceLastSeen: nowIso,
    roadmapIds: event.roadmapIds || [],
    releaseStage:
      event.releaseStage ||
      detectReleaseStage(`${event.title}\n${event.summary}`),
    roleTags,
    tags: [...new Set([...(event.tags || []), ...roleTags])],
  };

  normalized.importanceScore = importanceScore(normalized);
  normalized.importanceReason = importanceReason(normalized, "ja");
  if (!normalized.summaryJa || normalized.summaryJa === normalized.summaryEn) {
    normalized.summaryJa = buildJapaneseFallbackSummary(normalized);
  }
  return normalized;
}

function groupEventsByDate(events) {
  const groups = new Map();
  for (const event of events) {
    const key = toDateOnly(event.publishedAt);
    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(event);
  }

  return groups;
}

async function main() {
  const nowIso = new Date().toISOString();
  const sources = await readJson(sourcesFile, []);
  const summaryCache = await readJson(summaryCacheFile, {});
  const existingEvents = await readExistingEvents();
  const existingById = new Map(
    existingEvents.map((event) => [event.id, event]),
  );
  const mergedById = new Map(existingEvents.map((event) => [event.id, event]));
  const newEventIds = new Set();
  const errors = [];

  for (const source of sources) {
    try {
      const html = await fetchText(source.url);
      const localizedEvents = await localizeJapaneseTitles(
        parseSource(source, html, nowIso),
        existingById,
        summaryCache,
        nowIso,
      );
      const parsedEvents = await localizeJapaneseSummaries(
        source,
        localizedEvents,
        existingById,
        summaryCache,
        nowIso,
      );

      for (const parsedEvent of parsedEvents) {
        const previous = existingById.get(parsedEvent.id);
        const normalized = normalizeEvent(
          source,
          parsedEvent,
          previous,
          nowIso,
        );

        if (!previous) {
          newEventIds.add(normalized.id);
        }

        mergedById.set(normalized.id, normalized);
      }
    } catch (error) {
      errors.push({
        sourceId: source.id,
        sourceName: source.name,
        message: error.message,
      });
    }
  }

  const allEvents = dedupeEvents([...mergedById.values()]);
  const groupedEvents = groupEventsByDate(allEvents);

  await fs.mkdir(eventsDir, { recursive: true });
  await fs.mkdir(summariesDir, { recursive: true });

  for (const [date, events] of groupedEvents) {
    const sortedEvents = events.sort((left, right) => {
      const importanceDiff =
        (right.importanceScore ?? 0) - (left.importanceScore ?? 0);
      if (importanceDiff !== 0) {
        return importanceDiff;
      }

      return left.title.localeCompare(right.title);
    });

    await writeJson(path.join(eventsDir, `${date}.json`), {
      date,
      generatedAt: nowIso,
      events: sortedEvents,
    });

    await fs.writeFile(
      path.join(summariesDir, `${date}.md`),
      buildDailyMarkdown(date, sortedEvents),
      "utf8",
    );
  }

  await writeJson(stateFile, {
    lastRunAt: nowIso,
    totalEvents: allEvents.length,
    sources: sources.map((source) => source.id),
  });

  await writeJson(runSummaryFile, {
    generatedAt: nowIso,
    sourceCount: sources.length,
    totalEvents: allEvents.length,
    newEventCount: newEventIds.size,
    errorCount: errors.length,
    errors,
  });

  await writeJson(summaryCacheFile, summaryCache);

  console.log(
    JSON.stringify(
      {
        generatedAt: nowIso,
        sourceCount: sources.length,
        totalEvents: allEvents.length,
        newEventCount: newEventIds.size,
        errorCount: errors.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
