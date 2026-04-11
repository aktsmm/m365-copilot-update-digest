import fs from "node:fs/promises";
import path from "node:path";

import {
  formatDate,
  sortEvents,
  summaryForLocale,
  titleForLocale,
} from "./lib/reporting.mjs";

const workspaceRoot = process.cwd();
const eventsDir = path.join(workspaceRoot, "data", "events");
const runSummaryFile = path.join(workspaceRoot, "data", "run-summary.json");
const siteMetaFile = path.join(workspaceRoot, "config", "site.json");
const draftsRootDir = path.join(workspaceRoot, "drafts");
const articleDraftsDir = path.join(draftsRootDir, "articles", "daily");
const xDraftsDir = path.join(draftsRootDir, "posts", "x");

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

async function readDailyLogs() {
  const entries = await fs
    .readdir(eventsDir, { withFileTypes: true })
    .catch((error) => {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    });

  const logs = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const log = await readJson(path.join(eventsDir, entry.name), null);
    if (log?.date && Array.isArray(log.events)) {
      logs.push(log);
    }
  }

  return logs.sort((left, right) => String(right.date).localeCompare(left.date));
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function clipText(value, maxLength = 140) {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function derivePagesBaseUrl(repositoryUrl) {
  const match = String(repositoryUrl ?? "").match(
    /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  );

  if (!match) {
    return "";
  }

  return `https://${match[1]}.github.io/${match[2]}`;
}

function buildProductBreakdown(events) {
  return [...events.reduce((map, event) => {
    const key = String(event.productArea || "Other").trim() || "Other";
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map()).entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count]) => `- ${label}: ${count}件`)
    .join("\n");
}

function buildArticleDraft(log, runSummary, siteMeta) {
  const sorted = sortEvents(log.events || []);
  const highlights = sorted.slice(0, Math.min(5, sorted.length));
  const topPoints = highlights.slice(0, Math.min(3, highlights.length));
  const pagesBaseUrl = derivePagesBaseUrl(siteMeta.repositoryUrl);
  const digestUrl = pagesBaseUrl ? `${pagesBaseUrl}/daily/${log.date}/` : "";
  const generatedAt = log.generatedAt || runSummary.generatedAt || "";
  const lead =
    `本日の公開アップデートは ${sorted.length} 件です。監視ソース ${Number(runSummary.sourceCount ?? 0)} 件を継続確認し、重要度の高い更新から優先的に整理しました。`;
  const topPointLines = topPoints.length > 0
    ? topPoints
        .map(
          (event) =>
            `- ${titleForLocale(event, "ja")}\n  ${clipText(event.importanceReason || "重要更新として抽出", 96)}`,
        )
        .join("\n")
    : "- 重要更新はありません。";
  const detailSections = highlights.length > 0
    ? highlights
        .map((event) => {
          const lines = [
            `### ${titleForLocale(event, "ja")}`,
            "",
            `- ソース: ${event.sourceName}`,
            `- 領域: ${event.productArea}`,
            `- 公開日: ${formatDate(event.publishedAt, "ja")}`,
            `- なぜ重要か: ${event.importanceReason || "重要更新として抽出"}`,
            event.url ? `- URL: ${event.url}` : "",
            "",
            clipText(summaryForLocale(event, "ja"), 220) || "要約なし",
            "",
          ].filter(Boolean);

          return lines.join("\n");
        })
        .join("\n")
    : "### 重要更新はありません。\n";

  const lines = [
    "---",
    `date: ${log.date}`,
    `generatedAt: ${generatedAt}`,
    `source: data/events/${log.date}.json`,
    `type: daily-article-draft`,
    "---",
    "",
    `# ${formatDate(log.date, "ja")} の M365 Copilot 更新まとめ`,
    "",
    lead,
    "",
    digestUrl ? `参照ページ: ${digestUrl}` : "",
    "",
    "## まず押さえたいポイント",
    "",
    topPointLines,
    "",
    "## 重要更新の詳細",
    "",
    detailSections,
    "## 製品別の件数感",
    "",
    buildProductBreakdown(sorted) || "- 該当なし",
    "",
    "## 編集メモ",
    "",
    "- 冒頭は最重要トピックから始める。",
    "- 管理者向け影響と現場向け影響を分けて補足する。",
    `- 元データ: data/events/${log.date}.json`,
    `- 元サマリー: summaries/daily/${log.date}.md`,
    "",
  ].filter((line, index, all) => {
    if (line !== "") {
      return true;
    }

    return all[index - 1] !== "";
  });

  return `${lines.join("\n")}\n`;
}

function buildXDraft(log, runSummary, siteMeta) {
  const sorted = sortEvents(log.events || []);
  const highlights = sorted.slice(0, Math.min(3, sorted.length));
  const pagesBaseUrl = derivePagesBaseUrl(siteMeta.repositoryUrl);
  const digestUrl = pagesBaseUrl ? `${pagesBaseUrl}/daily/${log.date}/` : "";
  const highlightTitles = highlights.map((event) => `「${clipText(titleForLocale(event, "ja"), 34)}」`);
  const mainPost = [
    `M365 Copilot / Copilot Studio の更新を ${sorted.length} 件整理しました。`,
    highlightTitles.length > 0 ? `特に ${highlightTitles.join("、")} が重要です。` : "本日は大きな更新は少なめです。",
    digestUrl ? `日次まとめ: ${digestUrl}` : "",
    "#Microsoft365Copilot #CopilotStudio",
  ]
    .filter(Boolean)
    .join(" ");

  const thread = [
    `1. 今日の更新は ${sorted.length} 件。監視ソースは ${Number(runSummary.sourceCount ?? 0)} 件です。`,
    ...highlights.map(
      (event, index) =>
        `${index + 2}. ${titleForLocale(event, "ja")}\n${clipText(summaryForLocale(event, "ja"), 88)}`,
    ),
  ];

  const lines = [
    "---",
    `date: ${log.date}`,
    `type: x-draft`,
    `source: data/events/${log.date}.json`,
    "---",
    "",
    `# X 投稿下書き ${log.date}`,
    "",
    "## 単発投稿案",
    "",
    mainPost,
    "",
    `文字数目安: ${Array.from(mainPost).length}`,
    "",
    "## スレッド案",
    "",
    ...thread.flatMap((item) => [item, ""]),
  ];

  return `${lines.join("\n")}\n`;
}

async function main() {
  const runSummary = await readJson(runSummaryFile, {
    sourceCount: 0,
    generatedAt: "",
  });
  const siteMeta = await readJson(siteMetaFile, {
    siteName: "M365 Copilot Update Digest",
    repositoryUrl: "",
  });
  const dailyLogs = await readDailyLogs();
  const validDates = new Set(dailyLogs.map((log) => log.date));

  await fs.mkdir(draftsRootDir, { recursive: true });
  await removeStaleGeneratedFiles(articleDraftsDir, ".md", validDates);
  await removeStaleGeneratedFiles(xDraftsDir, ".md", validDates);

  for (const log of dailyLogs) {
    await writeTextFile(
      path.join(articleDraftsDir, `${log.date}.md`),
      buildArticleDraft(log, runSummary, siteMeta),
    );
    await writeTextFile(
      path.join(xDraftsDir, `${log.date}.md`),
      buildXDraft(log, runSummary, siteMeta),
    );
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: runSummary.generatedAt || dailyLogs[0]?.generatedAt || null,
        articleDraftCount: dailyLogs.length,
        xDraftCount: dailyLogs.length,
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