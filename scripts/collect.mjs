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
const MAX_TRANSLATED_SUMMARIES_PER_RUN = 360;
const MAX_TRANSLATED_TITLES_PER_RUN = 240;
const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const current = await fs.readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (current === next) {
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, next, "utf8");
}

async function writeTextFile(filePath, content) {
  const current = await fs.readFile(filePath, "utf8").catch((error) => {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  });

  if (current === content) {
    return;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

function tokyoDateOnly(value) {
  const date = safeDate(value);
  const parts = TOKYO_DATE_FORMATTER.formatToParts(date).reduce(
    (accumulator, part) => {
      if (part.type !== "literal") {
        accumulator[part.type] = part.value;
      }
      return accumulator;
    },
    {},
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function stablePublishedAt(value, fallbackValue) {
  const dateKey = tokyoDateOnly(value || fallbackValue);
  return `${dateKey}T12:00:00.000Z`;
}

async function removeStaleGeneratedFiles(directoryPath, extension, validKeys) {
  const entries = await fs
    .readdir(directoryPath, { withFileTypes: true })
    .catch((error) => {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) {
      continue;
    }

    const key = entry.name.slice(0, -extension.length);
    if (!validKeys.has(key)) {
      await fs.unlink(path.join(directoryPath, entry.name));
    }
  }
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
  const haystack = [entry.title, entry.summary, ...(entry.categories || [])]
    .join("\n")
    .toLowerCase();

  if (
    includes.length > 0 &&
    !includes.some((keyword) =>
      haystack.includes(String(keyword).toLowerCase()),
    )
  ) {
    return false;
  }

  if (
    excludes.some((keyword) => haystack.includes(String(keyword).toLowerCase()))
  ) {
    return false;
  }

  return true;
}

function isLikelyJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value ?? ""));
}

function shouldIgnoreCachedJapaneseSummary(source, summaryJa) {
  const genericFallbackPattern =
    /の更新です。.+に関する内容で、.+(?:案内されています|進行中です|廃止や移行対応が案内されています|更新内容が案内されています)。/;
  return (
    genericFallbackPattern.test(String(summaryJa ?? "")) ||
    (source.sourceFamily === "Tech Community" &&
      /公開ドキュメント由来の更新です。?$/.test(String(summaryJa ?? "")))
  );
}

function stageDescription(stage) {
  switch (stage) {
    case "GA":
      return "一般提供として案内されています";
    case "Launched":
      return "提供開始済みとして案内されています";
    case "In development":
      return "開発中として案内されています";
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
  const extractedSummary = excerptText(
    normalizeWhitespace(
      String(event.summaryEn || event.summary || "")
        .replace(/\bLearn more\.?$/i, "")
        .replace(/\bUpdated [A-Za-z]+ \d{1,2}, \d{4}:.*$/i, "")
        .replace(/\b(?:GA|Preview|Public Preview|Private Preview) date:\s*[^.\n]+/gi, "")
        .trim(),
    ),
    280,
  );

  if (isLikelyJapanese(extractedSummary) && extractedSummary.length >= 12) {
    return extractedSummary;
  }

  if (/redesigned channels page/.test(String(event.titleEn || event.title || "").toLowerCase())) {
    return "Copilot Studio の Channels ページを刷新。";
  }

  if (extractedSummary && extractedSummary.length >= 18) {
    return extractedSummary;
  }

  if (
    event.titleJa &&
    event.titleJa !== (event.titleEn || event.title) &&
    event.titleJa.length >= 8
  ) {
    return `${event.titleJa} に関する更新。`;
  }

  const audienceText =
    event.roleTags && event.roleTags.length > 0
      ? ` 主な対象は ${event.roleTags.join(" / ")} です。`
      : "";
  const sourceText =
    event.sourceFamily === "Tech Community"
      ? "公式ブログ由来の更新です。"
      : event.sourceFamily === "Roadmap"
        ? `Microsoft 365 Roadmap 由来の更新です${event.roadmapIds?.[0] ? ` (Roadmap ${event.roadmapIds[0]})` : ""}。`
        : "公開ドキュメント由来の更新です。";
  const compactTitle = String(event.title ?? "").replace(
    /\s*\[[^\]]+\]\s*$/g,
    "",
  );
  return normalizeWhitespace(
    `${event.productArea} の更新です。${compactTitle} に関する内容で、${stageDescription(event.releaseStage)}。${sourceText}${audienceText}`,
  );
}

function buildJapaneseFallbackTitle(event) {
  const text =
    `${event.titleEn || event.title || ""}\n${event.summaryEn || event.summary || ""}`.toLowerCase();
  const normalizedTitle = String(event.titleEn || event.title || "")
    .replace(/^microsoft copilot \(microsoft 365\):\s*/i, "")
    .replace(/^microsoft copilot studio:\s*/i, "")
    .replace(/^microsoft copilot:\s*/i, "")
    .replace(/^microsoft viva:\s*/i, "")
    .replace(/^microsoft purview:\s*/i, "")
    .replace(/^microsoft 365 admin center:\s*/i, "")
    .replace(/^outlook:\s*/i, "")
    .replace(/^onedrive:\s*/i, "")
    .replace(/^sharepoint:\s*/i, "")
    .replace(/^powerpoint:\s*/i, "")
    .replace(/^microsoft edge:\s*/i, "")
    .trim();
  const titleText = normalizedTitle.toLowerCase();

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

  if (/redesigned channels page/.test(text)) {
    return `Channels ページを刷新`;
  }

  if (/redesigned channels page/.test(text)) {
    return `Channels ページを刷新`;
  }

  if (/code interpreter/.test(text)) {
    return `コード インタープリタ機能の拡張`;
  }

  if (/onedrive/.test(text) && /summary/.test(text)) {
    return `OneDrive 共有時の Copilot 要約に対応`;
  }

  if (/enhanced m365 copilot memory|personalized with work data/.test(text)) {
    return `M365 Copilot Memory の個人最適化を強化`;
  }

  if (/create word documents from copilot notebooks/.test(text)) {
    return `Copilot Notebooks から Word 文書生成に対応`;
  }

  if (/create excel spreadsheets from copilot notebooks/.test(text)) {
    return `Copilot Notebooks から Excel 作成に対応`;
  }

  if (/web link as a reference in copilot notebooks/.test(text)) {
    return `Copilot Notebooks で Web リンクを参照元に追加可能に`;
  }

  if (/quickly edit an image in powerpoint/.test(text)) {
    return `PowerPoint で画像の即時編集に対応`;
  }

  if (/create interactive visuals in copilot pages/.test(text)) {
    return `Copilot Pages でインタラクティブな可視化を作成可能に`;
  }

  if (/copilot pages/.test(text) && /outlook mobile|android/.test(text)) {
    return `Outlook モバイルで Copilot Pages の閲覧・編集・共有に対応`;
  }

  if (/ai-generated meeting archive/.test(text)) {
    return `Teams で AI 生成の会議アーカイブに対応`;
  }

  if (/copilot search suggestions for outlook/.test(text)) {
    return `Outlook の Copilot 検索候補を強化`;
  }

  if (/triage your inbox on-the-go with copilot voice/.test(text)) {
    return `Outlook mobile の Copilot 音声で受信トレイ整理に対応`;
  }

  if (/discover copilot actions in file preview/.test(text)) {
    return `ファイル プレビューで Copilot アクション提案を表示`;
  }

  if (/scatter image effect/.test(text)) {
    return `Copilot で scatter image effect に対応`;
  }

  if (/copilot settings.*optimize view/.test(text)) {
    return `管理センターの Copilot 設定を最適化ビューへ刷新`;
  }

  if (/agents usage report/.test(text)) {
    return `管理センターに Agents 利用レポートを追加`;
  }

  if (/list email attachments/.test(text)) {
    return `M365 Copilot でメール添付ファイル一覧に対応`;
  }

  if (/export copilot metrics/.test(text)) {
    return `Copilot Dashboard でメトリクスのエクスポートに対応`;
  }

  if (/intelligent summaries in copilot dashboard/.test(text)) {
    return `Copilot Dashboard にインテリジェント要約を追加`;
  }

  if (/satisfaction rate metric/.test(text)) {
    return `Copilot Dashboard に満足度メトリクスを追加`;
  }

  if (/new copilot metrics available/.test(text)) {
    return `Copilot 向け新規メトリクスを追加`;
  }

  if (/deeper copilot insights/.test(text) && /power bi filtering/.test(text)) {
    return `Power BI フィルタリング強化で Copilot インサイトを拡充`;
  }

  if (/researcher council/.test(text)) {
    return `Researcher Council を追加`;
  }

  if (/researcher agent for gcc/.test(text)) {
    return `GCC で Researcher Agent に対応`;
  }

  if (/employee self-service agent in m365 copilot/.test(text)) {
    return `M365 Copilot に従業員セルフサービス Agent を追加`;
  }

  if (/critique in researcher/.test(text)) {
    return `Researcher に Critique 機能を追加`;
  }

  if (/researcher output formats/.test(text)) {
    return `Researcher の出力形式を拡張`;
  }

  if (/project manager agent/.test(text)) {
    return `M365 Copilot に Project Manager Agent を追加`;
  }

  if (/audio overviews/.test(text)) {
    return `Word 文書上部から音声概要にアクセス可能に`;
  }

  if (/mind maps in copilot notebooks/.test(text)) {
    return `Copilot Notebooks に Mind Maps を追加`;
  }

  if (/engage private content in m365 copilot/.test(text)) {
    return `M365 Copilot でプライベート コンテンツ活用を強化`;
  }

  if (/create and edit images with the model of your choice/.test(text)) {
    return `PowerPoint で画像生成・編集モデルを選択可能に`;
  }

  if (/anthropic models/.test(titleText)) {
    return `Anthropic モデルのユーザー・グループ別有効化に対応`;
  }

  if (/enterprise data protection/.test(text) && /edge/.test(text)) {
    return `Edge の Rewrite by Copilot でエンタープライズ データ保護に対応`;
  }

  if (/address bar/.test(text) && /summarizing webpages/.test(text)) {
    return `Edge アドレスバーで要約提案を表示`;
  }

  if (/copilot new tab page/.test(text)) {
    return `Edge の Copilot New Tab Page を刷新`;
  }

  if (/purview in microsoft admin center/.test(text)) {
    return `Microsoft 管理センターで Purview 管理に対応`;
  }

  if (/inline dlp/.test(text) && /prompts/.test(text)) {
    return `Copilot プロンプト向け Inline DLP に対応`;
  }

  if (
    /data loss prevention/.test(text) &&
    /sensitivity labels|all storage locations|safeguard prompts/.test(text)
  ) {
    return `Purview DLP で Copilot の機密データ保護を強化`;
  }

  if (/embedded images/.test(text)) {
    return `埋め込み画像を使った応答精度向上に対応`;
  }

  if (/adobe experience manager/.test(text)) {
    return `Adobe Experience Manager の企業アセット参照に対応`;
  }

  if (/news page in sharepoint sites/.test(text)) {
    return `SharePoint サイトの News ページを刷新`;
  }

  if (/new web part for faqs/.test(text)) {
    return `SharePoint に FAQ 用新規 web part を追加`;
  }

  if (/federated copilot connectors/.test(text)) {
    return `Federated Copilot Connectors に対応`;
  }

  if (/domain exclusion for web grounding/.test(text)) {
    return `Web grounding のドメイン除外に対応`;
  }

  if (/custom skills/.test(text) && /sharepoint/.test(text)) {
    return `SharePoint で custom skills による AI 拡張に対応`;
  }

  if (/lists as a knowledge source/.test(text)) {
    return `SharePoint と OneDrive の Lists を agent の知識ソースに対応`;
  }

  if (/dynamic topics/.test(text)) {
    return `Dynamic Topics を追加`;
  }

  if (/edit with the model of your choice in powerpoint/.test(text)) {
    return `PowerPoint で使用モデルを選択可能に`;
  }

  if (/planner agent in group-based basic plans/.test(text)) {
    return `グループベースの basic plans で Planner Agent に対応`;
  }

  if (/overview experience/.test(text) && /agent dashboard/.test(text)) {
    return `Agent Dashboard の overview と agent categories を刷新`;
  }

  if (/submit agent to agent store/.test(text)) {
    return `Agent Builder から Agent Store へ申請可能に`;
  }

  if (/generate text for a powerpoint slide using slide context/.test(text)) {
    return `PowerPoint のスライド文面生成を強化`;
  }

  if (/content sources in copilot chat/.test(text)) {
    return `Copilot Chat のコンテンツ ソース表示を強化`;
  }

  if (/copilot can edit your document in powerpoint/.test(text)) {
    return `PowerPoint で Copilot による文書編集に対応`;
  }

  if (
    /prepare for your meeting with copilot chat in outlook mobile/.test(text)
  ) {
    return `Outlook mobile で会議準備向け Copilot Chat に対応`;
  }

  if (
    /copilot notebooks?/.test(text) &&
    /overview|summary|insights/.test(text)
  ) {
    return `Copilot Notebooks の要約・インサイトを強化`;
  }

  if (
    /(teams|meeting|meetings|chat|channel|outlook|inbox|voice|archive)/.test(
      titleText,
    )
  ) {
    return `${event.productArea} の会議・チャット機能を更新`;
  }

  if (/connector|connect to|integration/.test(text)) {
    return `${event.productArea} の連携機能を拡張`;
  }

  if (
    /(pay-as-you-go|pricing|billing|cost|capacity|sku|message pack|prepurchase|license assignment|license management|licensing)/.test(
      titleText,
    )
  ) {
    return `${event.productArea} のライセンス・課金関連更新`;
  }

  if (/roadmap/.test(text) && /agent|copilot/.test(text)) {
    return normalizedTitle
      ? excerptText(normalizedTitle, 72)
      : `${event.productArea} の Roadmap 更新`;
  }

  if (normalizedTitle) {
    return excerptText(normalizedTitle, 72);
  }

  return `${event.productArea} の更新`;
}

function roadmapProductArea(title, categories, source) {
  const text = `${title}\n${categories.join("\n")}`.toLowerCase();
  if (/copilot studio/.test(text)) {
    return "Copilot Studio";
  }

  return source.productArea || "Microsoft 365 Copilot";
}

function roadmapStatus(categories) {
  const normalized = categories.map((category) => category.toLowerCase());
  if (normalized.includes("launched")) {
    return "Launched";
  }

  if (normalized.includes("rolling out")) {
    return "Rolling out";
  }

  if (normalized.includes("in development")) {
    return "In development";
  }

  return "Update";
}

function cleanupRoadmapSummary(rawSummary) {
  const summary = stripHtmlText(rawSummary)
    .replace(
      /\b(?:GA|Preview|Public Preview|Private Preview) date:\s*[^.\n]+/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return excerptText(summary, 320);
}

function parseRoadmapRssFeed(source, xmlText) {
  const parsed = xmlParser.parse(xmlText);
  const items = toArray(parsed?.rss?.channel?.item);

  return items
    .map((item) => {
      const title = normalizeWhitespace(readXmlText(item.title));
      const rawSummary = readXmlText(
        item.description || item["content:encoded"] || "",
      );
      const categories = toArray(item.category)
        .map((category) => normalizeWhitespace(readXmlText(category)))
        .filter(Boolean);
      const link = normalizeWhitespace(readXmlText(item.link));
      const publishedAt = new Date(
        readXmlText(item["a10:updated"]) || item.pubDate || Date.now(),
      ).toISOString();

      return {
        id: buildEventId(
          source.id,
          title,
          publishedAt,
          readXmlText(item.guid) || link,
        ),
        title,
        summary: cleanupRoadmapSummary(rawSummary),
        summaryEn: cleanupRoadmapSummary(rawSummary),
        summaryJa: cleanupRoadmapSummary(rawSummary),
        url: link,
        publishedAt,
        productArea: roadmapProductArea(title, categories, source),
        section: roadmapProductArea(title, categories, source),
        roadmapIds: extractRoadmapIds(rawSummary, [
          link,
          readXmlText(item.guid),
        ]),
        releaseStage: roadmapStatus(categories),
        tags: [
          ...new Set([
            roadmapProductArea(title, categories, source),
            ...categories,
          ]),
        ],
        categories,
      };
    })
    .filter((entry) => entry.title && entry.url)
    .filter((entry) => matchesKeywords(source, entry))
    .slice(0, source.maxItems ?? items.length);
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
  const matches = [
    ...String(translatedText ?? "").matchAll(
      /\[\[\[M365_DIGEST_(?:ITEM|TITLE)_(\d+)\]\]\]/g,
    ),
  ];
  const translatedByIndex = new Map();

  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const next = matches[index + 1];
    const itemIndex = Number.parseInt(current[1], 10);
    const start = current.index + current[0].length;
    const end = next ? next.index : translatedText.length;
    translatedByIndex.set(
      itemIndex,
      normalizeWhitespace(translatedText.slice(start, end)),
    );
  }

  return batch.map((event, index) => ({
    event,
    text: translatedByIndex.get(index) || "",
  }));
}

function shouldIgnoreCachedJapaneseTitle(titleJa, titleEn, productArea = "") {
  const genericTitles = new Set([
    `${productArea} の更新`,
    `${productArea} の Roadmap 更新`,
  ]);
  const normalizedTitleEn = String(titleEn ?? "").toLowerCase();
  return (
    !titleJa ||
    !isLikelyJapanese(titleJa) ||
    titleJa === titleEn ||
    genericTitles.has(titleJa) ||
    (titleJa === "Microsoft 365 Copilot のライセンス・課金関連更新" &&
      !/(pay-as-you-go|pricing|billing|cost|capacity|sku|message pack|prepurchase|license assignment|license management|licensing)/.test(
        normalizedTitleEn,
      )) ||
    (/edit with the model of your choice in powerpoint/.test(
      normalizedTitleEn,
    ) &&
      titleJa !== "PowerPoint で使用モデルを選択可能に") ||
    (/ai-generated meeting archive/.test(normalizedTitleEn) &&
      titleJa !== "Teams で AI 生成の会議アーカイブに対応") ||
    (/scatter image effect/.test(normalizedTitleEn) &&
      titleJa !== "Copilot で scatter image effect に対応") ||
    (/redesigned channels page/.test(normalizedTitleEn) &&
      titleJa !== "Channels ページを刷新") ||
    (titleJa === "Microsoft 365 Copilot の会議・チャット機能を更新" &&
      !/(teams|meeting|meetings|chat|channel|outlook|inbox|voice|archive)/.test(
        normalizedTitleEn,
      )) ||
    (titleJa === "Anthropic モデルのユーザー・グループ別有効化に対応" &&
      !/anthropic models/.test(normalizedTitleEn))
  );
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
      !shouldIgnoreCachedJapaneseTitle(
        cached.titleJa,
        event.titleEn,
        event.productArea,
      )
    ) {
      event.titleJa = cached.titleJa;
      continue;
    }

    const existing = existingById.get(event.id);
    if (
      existing &&
      existing.titleEn === event.titleEn &&
      existing.titleJa &&
      !shouldIgnoreCachedJapaneseTitle(
        existing.titleJa,
        event.titleEn,
        event.productArea,
      )
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
      .map(
        (event, index) =>
          `${TITLE_TRANSLATION_MARKER_PREFIX}${index}]]]\n${event.titleEn}`,
      )
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
    event.summaryEn = normalizeWhitespace(
      event.summaryEn || event.summary || "",
    );
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
      .map(
        (event, index) =>
          `${TRANSLATION_MARKER_PREFIX}${index}]]]\n${event.summaryEn}`,
      )
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
    if (
      !title ||
      title.length < 6 ||
      /^Last updated on$/i.test(title) ||
      /^\d{4}-\d{2}-\d{2}$/.test(rawText)
    ) {
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
    .map((item) => {
      const rawSummary = readXmlText(
        item.description || item["content:encoded"] || "",
      );
      const title = normalizeWhitespace(readXmlText(item.title));
      const categories = toArray(item.category)
        .map((category) => normalizeWhitespace(readXmlText(category)))
        .filter(Boolean);
      return {
        id: buildEventId(
          source.id,
          title,
          item.pubDate || item.isoDate || source.id,
          readXmlText(item.guid) || readXmlText(item.link),
        ),
        title,
        summary: excerptText(stripHtmlText(rawSummary), 280),
        summaryEn: excerptText(stripHtmlText(rawSummary), 280),
        summaryJa: excerptText(stripHtmlText(rawSummary), 280),
        url: normalizeWhitespace(readXmlText(item.link)),
        publishedAt: new Date(
          item.pubDate || item.isoDate || Date.now(),
        ).toISOString(),
        productArea: source.productArea,
        section: source.productArea,
        roadmapIds: [],
        releaseStage: detectReleaseStage(
          `${title}\n${rawSummary}\n${categories.join(" ")}`,
        ),
        tags: [...new Set([source.productArea, ...categories])],
        categories,
      };
    })
    .filter((entry) => entry.title && entry.url)
    .filter((entry) => matchesKeywords(source, entry))
    .slice(0, source.maxItems ?? items.length);
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
    case "m365_roadmap_rss":
      return parseRoadmapRssFeed(source, html);
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
    publishedAt: stablePublishedAt(
      event.publishedAt || existingEvent?.publishedAt,
      nowIso,
    ),
    capturedAt: existingEvent?.capturedAt || nowIso,
    sourceLastSeen: existingEvent?.sourceLastSeen || nowIso,
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

function isInvalidPersistedEvent(event) {
  const titleEn = String(event?.titleEn || event?.title || "").trim();
  const summaryEn = String(event?.summaryEn || event?.summary || "").trim();

  if (/^Last updated on$/i.test(titleEn)) {
    return true;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(summaryEn) && /^Last updated on$/i.test(titleEn)) {
    return true;
  }

  return false;
}

function logicalEventKey(event) {
  return [
    String(event.sourceId || "").trim().toLowerCase(),
    String(event.url || "").trim().toLowerCase(),
    String(event.titleEn || event.title || "").trim().toLowerCase(),
    tokyoDateOnly(event.publishedAt || event.capturedAt || Date.now()),
  ].join("\n");
}

function logicalEventScore(event) {
  const publishedAt = safeDate(event.publishedAt).getTime();
  const summaryLength = String(event.summaryJa || event.summary || "").length;
  const japaneseScore = isLikelyJapanese(event.titleJa) ? 1000 : 0;
  const importance = Number(event.importanceScore ?? 0) * 100;
  return japaneseScore + importance + summaryLength + publishedAt / 1_000_000_000_000;
}

function dedupeLogicalEvents(events) {
  const map = new Map();

  for (const event of events) {
    const key = logicalEventKey(event);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, event);
      continue;
    }

    const replacement =
      logicalEventScore(event) >= logicalEventScore(existing)
        ? {
            ...existing,
            ...event,
            id: existing.id,
            capturedAt: existing.capturedAt ?? event.capturedAt,
          }
        : {
            ...event,
            ...existing,
            sourceLastSeen: event.sourceLastSeen ?? existing.sourceLastSeen,
          };
    map.set(key, replacement);
  }

  return [...map.values()];
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
  const existingState = await readJson(stateFile, null);
  const existingRunSummary = await readJson(runSummaryFile, null);
  const existingEvents = (await readExistingEvents()).filter(
    (event) => !isInvalidPersistedEvent(event),
  );
  const existingLogicalKeys = new Set(existingEvents.map(logicalEventKey));
  const existingById = new Map(
    existingEvents.map((event) => [event.id, event]),
  );
  const mergedById = new Map(existingEvents.map((event) => [event.id, event]));
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

        if (isInvalidPersistedEvent(normalized)) {
          continue;
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

  const allEvents = dedupeLogicalEvents(dedupeEvents([...mergedById.values()]));
  const newEventCount = allEvents.filter(
    (event) => !existingLogicalKeys.has(logicalEventKey(event)),
  ).length;
  const groupedEvents = groupEventsByDate(allEvents);
  const groupedDateKeys = new Set(groupedEvents.keys());

  await fs.mkdir(eventsDir, { recursive: true });
  await fs.mkdir(summariesDir, { recursive: true });
  await removeStaleGeneratedFiles(eventsDir, ".json", groupedDateKeys);
  await removeStaleGeneratedFiles(summariesDir, ".md", groupedDateKeys);

  for (const [date, events] of groupedEvents) {
    const sortedEvents = events.sort((left, right) => {
      const importanceDiff =
        (right.importanceScore ?? 0) - (left.importanceScore ?? 0);
      if (importanceDiff !== 0) {
        return importanceDiff;
      }

      return left.title.localeCompare(right.title);
    });

    const logPath = path.join(eventsDir, `${date}.json`);
    const existingLog = await readJson(logPath, null);
    const sameEvents =
      JSON.stringify(existingLog?.events ?? null) === JSON.stringify(sortedEvents);
    const nextLog = {
      date,
      generatedAt: sameEvents ? existingLog?.generatedAt || nowIso : nowIso,
      events: sortedEvents,
    };
    const markdown = buildDailyMarkdown(date, sortedEvents);

    await writeJson(logPath, nextLog);
    await writeTextFile(path.join(summariesDir, `${date}.md`), markdown);
  }

  const nextState = {
    lastRunAt:
      newEventCount === 0 &&
      errors.length === 0 &&
      existingState?.totalEvents === allEvents.length &&
      JSON.stringify(existingState?.sources ?? []) ===
        JSON.stringify(sources.map((source) => source.id))
        ? existingState?.lastRunAt || nowIso
        : nowIso,
    totalEvents: allEvents.length,
    sources: sources.map((source) => source.id),
  };

  const nextRunSummary = {
    generatedAt:
      newEventCount === 0 &&
      errors.length === 0 &&
      existingRunSummary?.totalEvents === allEvents.length &&
      existingRunSummary?.sourceCount === sources.length &&
      Number(existingRunSummary?.newEventCount ?? -1) === 0 &&
      Number(existingRunSummary?.errorCount ?? -1) === 0
        ? existingRunSummary?.generatedAt || nowIso
        : nowIso,
    sourceCount: sources.length,
    totalEvents: allEvents.length,
    newEventCount,
    errorCount: errors.length,
    errors,
  };

  await writeJson(stateFile, nextState);
  await writeJson(runSummaryFile, nextRunSummary);

  await writeJson(summaryCacheFile, summaryCache);

  console.log(
    JSON.stringify(
      {
        generatedAt: nowIso,
        sourceCount: sources.length,
        totalEvents: allEvents.length,
        newEventCount,
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
