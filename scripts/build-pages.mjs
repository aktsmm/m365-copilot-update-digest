import fs from "node:fs/promises";
import path from "node:path";

import {
  formatDate,
  formatDateTime,
  importanceReason,
  importanceScore,
  originalTitleForLocale,
  safeDate,
  slugify,
  sortEvents,
  summaryForLocale,
  titleForLocale,
  toDateOnly,
  weekKey,
  weekRangeLabel,
  withinDays,
  withinHours,
} from "./lib/reporting.mjs";

const workspaceRoot = process.cwd();
const siteDir = path.join(workspaceRoot, "site");
const publicDir = path.join(workspaceRoot, "public");
const eventsDir = path.join(workspaceRoot, "data", "events");
const summariesDir = path.join(workspaceRoot, "summaries", "daily");
const overridesFile = path.join(workspaceRoot, "config", "overrides.json");
const siteMetaFile = path.join(workspaceRoot, "config", "site.json");
const runSummaryFile = path.join(workspaceRoot, "data", "run-summary.json");

const TEXT = {
  ja: {
    htmlLang: "ja",
    switchLabel: "EN",
    navHome: "ホーム",
    navWeekly: "週間まとめ",
    navSearch: "検索",
    navAbout: "About",
    navRepository: "Repository",
    unofficialBadge: "Unofficial update digest",
    headerLead: "非公式アップデートダイジェスト",
    heroTitle: "M365 Copilot の更新を、埋もれさせない。",
    heroCopy:
      "Microsoft 365 Copilot、Copilot Studio、Agent Builder の公開アップデートを継続収集し、重要更新と新着を分けて追えるように整理します。まずは今日 / 今週の重要更新を見て、必要に応じて直近の新着、製品別一覧、週間まとめへ進めます。",
    statsUpdates: "追跡中の更新",
    statsUpdatesDetail: "重複除去後の累計件数",
    statsSources: "監視ソース",
    statsSourcesDetail: "現在有効な公開ソース数",
    statsRun: "直近 run の新規",
    statsRunDetail: "最後の collect で検知した件数",
    importantTitle: "今日 / 今週の重要更新",
    recentTitle: "直近72時間の新着",
    filterTitle: "製品別アップデート",
    productFilterLabel: "製品",
    roleFilterLabel: "役割タグ",
    sourceTypeFilterLabel: "ソース種別",
    allProducts: "すべて",
    allRoles: "すべて",
    allSourceTypes: "すべて",
    adminRole: "管理者向け",
    makerRole: "作成者向け",
    sourceTypeDocs: "Microsoft Learn",
    sourceTypeBlog: "公式ブログ",
    sourceTypeRoadmap: "Roadmap",
    sourceBreakdownTitle: "ソース別一覧",
    weeklyArchiveTitle: "週間まとめ",
    dailyArchiveTitle: "日次アーカイブ",
    searchTitle: "公開済みアップデートを横断検索する。",
    searchBody:
      "タイトル、要約、製品、タグ、日付から、公開済みの更新をまとめて探せます。",
    homeSearchTitle: "トップページから検索する。",
    homeSearchBody:
      "参考サイトのように、トップページ上でそのまま検索できます。最近の更新をその場で探して、必要なら全文検索ページに移れます。",
    searchLink: "検索ページを開く",
    aboutTitle: "About",
    aboutIntro:
      "M365 Copilot Update Digest は、Microsoft 365 Copilot、Copilot Studio、Agent Builder に関する公開アップデートを継続的に整理する非公式サイトです。",
    aboutBody1:
      "公式ブログ、Microsoft Learn、release notes、release plan などの公開ソースをもとに、重要更新と新着を分けて見やすく整理します。",
    aboutBody2:
      "このサイトは Microsoft の公式サービスではありません。内容は公開情報をもとに自動収集・整形しており、原文確認のために元ソースへのリンク、JSON、Markdown を併せて公開します。",
    aboutBody3:
      "重要更新は、リリース段階、コストやライセンスへの影響、Agent Builder / Copilot Studio の新機能、日常利用者への UI 変化などをもとに重み付けします。",
    aboutBody4:
      "自動公開を基本としつつ、最低限の pin / hide override で表示制御できる前提にしています。",
    dailyArchivePageTitle: "日次アーカイブ",
    weeklyArchivePageTitle: "週間まとめ",
    noItems: "該当する更新はありません。",
    noRecent:
      "直近条件に一致する更新がないため、最新順の更新を表示しています。",
    noFiltered: "この条件に一致する更新はありません。",
    highlightsTitle: "重要更新",
    fullListTitle: "全件",
    rawJson: "JSON を開く",
    rawMarkdown: "Markdown を開く",
    openSource: "原文を開く",
    openDigest: "日次ページを見る",
    publishedLabel: "公開日",
    sourceLabel: "ソース",
    whyLabel: "なぜ重要か",
    stageLabel: "リリース段階",
    lastUpdatedLabel: "最終更新",
    lastCheckedLabel: "最終確認",
    footerLead:
      "Public-source based, unofficial curation for M365 Copilot updates.",
    searchInputPlaceholder: "更新、製品、タグ、日付で検索",
    searchStatusReady: "キーワードを入力すると結果を表示します。",
    searchStatusLoading: "検索インデックスを読み込み中...",
    searchStatusEmpty: "一致する更新は見つかりませんでした。",
    searchResultCount: "件ヒット",
    weekOf: "週次",
    originalTitleLabel: "原題",
  },
  en: {
    htmlLang: "en",
    switchLabel: "日本語",
    navHome: "Home",
    navWeekly: "Weekly",
    navSearch: "Search",
    navAbout: "About",
    navRepository: "Repository",
    unofficialBadge: "Unofficial update digest",
    headerLead: "Unofficial update digest",
    heroTitle: "Keep M365 Copilot updates from getting buried.",
    heroCopy:
      "This site continuously collects public Microsoft 365 Copilot, Copilot Studio, and Agent Builder updates, separating high-impact changes from recent arrivals. Start with the most important changes, then move into recent items, product views, and weekly summaries.",
    statsUpdates: "Tracked updates",
    statsUpdatesDetail: "Deduplicated cumulative count",
    statsSources: "Sources",
    statsSourcesDetail: "Active public sources",
    statsRun: "Latest run new items",
    statsRunDetail: "Detected in the most recent collect run",
    importantTitle: "Important updates for today / this week",
    recentTitle: "New in the last 72 hours",
    filterTitle: "Updates by product",
    productFilterLabel: "Product",
    roleFilterLabel: "Role",
    sourceTypeFilterLabel: "Source type",
    allProducts: "All",
    allRoles: "All",
    allSourceTypes: "All",
    adminRole: "Admin-focused",
    makerRole: "Builder-focused",
    sourceTypeDocs: "Microsoft Learn",
    sourceTypeBlog: "Official blogs",
    sourceTypeRoadmap: "Roadmap",
    sourceBreakdownTitle: "By source",
    weeklyArchiveTitle: "Weekly summaries",
    dailyArchiveTitle: "Daily archive",
    searchTitle: "Search published updates.",
    searchBody:
      "Search across titles, summaries, products, tags, and dates from published updates.",
    homeSearchTitle: "Search directly from the home page.",
    homeSearchBody:
      "Use the top page to find recent updates immediately, then move to the full search page when you want a wider scan.",
    searchLink: "Open search",
    aboutTitle: "About",
    aboutIntro:
      "M365 Copilot Update Digest is an unofficial site that continuously organizes public updates about Microsoft 365 Copilot, Copilot Studio, and Agent Builder.",
    aboutBody1:
      "It uses public sources such as official blogs, Microsoft Learn, release notes, and release plans, while separating high-impact changes from recent arrivals.",
    aboutBody2:
      "This is not an official Microsoft service. The content is automatically collected and formatted from public information, and each page keeps links back to original sources plus JSON and Markdown outputs for verification.",
    aboutBody3:
      "Importance is weighted by release stage, cost or licensing impact, new Agent Builder or Copilot Studio capabilities, and meaningful user-facing UI changes.",
    aboutBody4:
      "The site is designed for automatic publishing, with a minimal pin or hide override layer when needed.",
    dailyArchivePageTitle: "Daily archive",
    weeklyArchivePageTitle: "Weekly summaries",
    noItems: "No updates matched this section.",
    noRecent:
      "No items matched the recent window, so the latest updates are shown instead.",
    noFiltered: "No updates matched this filter.",
    highlightsTitle: "Highlights",
    fullListTitle: "Full list",
    rawJson: "Open JSON",
    rawMarkdown: "Open Markdown",
    openSource: "Open source",
    openDigest: "Open daily page",
    publishedLabel: "Published",
    sourceLabel: "Source",
    whyLabel: "Why it matters",
    stageLabel: "Release stage",
    lastUpdatedLabel: "Last updated",
    lastCheckedLabel: "Last checked",
    footerLead:
      "Public-source based, unofficial curation for M365 Copilot updates.",
    searchInputPlaceholder: "Search by update, product, tag, or date",
    searchStatusReady: "Type a keyword to start searching.",
    searchStatusLoading: "Loading search index...",
    searchStatusEmpty: "No matching updates were found.",
    searchResultCount: "matches",
    weekOf: "Week of",
    originalTitleLabel: "Original",
  },
};

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

async function writeText(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents, "utf8");
}

async function copyDirectory(sourceDir, destinationDir) {
  const entries = await fs
    .readdir(sourceDir, { withFileTypes: true })
    .catch((error) => {
      if (error.code === "ENOENT") {
        return [];
      }

      throw error;
    });

  await fs.mkdir(destinationDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }

    await fs.copyFile(sourcePath, destinationPath);
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
    if (log) {
      logs.push(log);
    }
  }

  return logs.sort((left, right) => safeDate(right.date) - safeDate(left.date));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function localePath(locale, subpath = "") {
  return locale === "en" ? `en/${subpath}` : subpath;
}

function relativeHref(depth, targetPath) {
  return `${depth === 0 ? "" : "../".repeat(depth)}${targetPath}`;
}

function productSlug(value) {
  return slugify(value) || "other";
}

function roleSlug(value) {
  if (value === "管理者向け") {
    return "admin";
  }

  if (value === "作成者向け") {
    return "maker";
  }

  return slugify(value) || "other";
}

function sourceTypeSlug(value) {
  if (value === "Tech Community") {
    return "blog";
  }

  if (value === "Roadmap") {
    return "roadmap";
  }

  return "learn";
}

function sourceTypeLabel(sourceFamily, text) {
  const type = sourceTypeSlug(sourceFamily);
  if (type === "blog") {
    return text.sourceTypeBlog;
  }

  if (type === "roadmap") {
    return text.sourceTypeRoadmap;
  }

  return text.sourceTypeDocs;
}

function overrideIds(entries) {
  return new Set(
    (entries || [])
      .map((entry) => (typeof entry === "string" ? entry : entry?.id))
      .filter(Boolean),
  );
}

function applyOverrides(events, overrides) {
  const pinned = overrideIds(overrides.pin);
  const hidden = overrideIds(overrides.hide);

  return events
    .map((event) => {
      const next = {
        ...event,
        isPinned: pinned.has(event.id),
      };
      next.importanceScore = importanceScore(next);
      next.importanceReason = importanceReason(next, "ja");
      return next;
    })
    .filter((event) => !hidden.has(event.id));
}

function buildWeeklyGroups(events) {
  const groups = new Map();
  for (const event of events) {
    const key = weekKey(event.publishedAt);
    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(event);
  }

  return [...groups.entries()]
    .map(([key, values]) => ({
      key,
      events: sortEvents(values),
      labelJa: weekRangeLabel(key, "ja"),
      labelEn: weekRangeLabel(key, "en"),
    }))
    .sort((left, right) => safeDate(right.key) - safeDate(left.key));
}

function renderBadge(label, tone = "neutral") {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function renderSectionHeading(title, actionHtml = "") {
  return `<div class="section-heading"><h2>${escapeHtml(title)}</h2>${actionHtml}</div>`;
}

function renderFilterToolbar(events, text) {
  const products = [...new Set(events.map((event) => event.productArea))];
  const sourceTypes = ["learn", "blog", "roadmap"];

  return `
      <div class="filter-toolbar">
        <div class="filter-group">
          <span>${escapeHtml(text.productFilterLabel)}</span>
          <div class="chip-row">
            <button class="chip is-active" type="button" data-product-filter="all">${escapeHtml(text.allProducts)}</button>
            ${products.map((product) => `<button class="chip" type="button" data-product-filter="${escapeHtml(productSlug(product))}">${escapeHtml(product)}</button>`).join("")}
          </div>
        </div>
        <div class="filter-group">
          <span>${escapeHtml(text.roleFilterLabel)}</span>
          <div class="chip-row">
            <button class="chip is-active" type="button" data-role-filter="all">${escapeHtml(text.allRoles)}</button>
            <button class="chip" type="button" data-role-filter="admin">${escapeHtml(text.adminRole)}</button>
            <button class="chip" type="button" data-role-filter="maker">${escapeHtml(text.makerRole)}</button>
          </div>
        </div>
        <div class="filter-group">
          <span>${escapeHtml(text.sourceTypeFilterLabel)}</span>
          <div class="chip-row">
            <button class="chip is-active" type="button" data-source-filter="all">${escapeHtml(text.allSourceTypes)}</button>
            ${sourceTypes.map((type) => `<button class="chip" type="button" data-source-filter="${escapeHtml(type)}">${escapeHtml(type === "blog" ? text.sourceTypeBlog : type === "roadmap" ? text.sourceTypeRoadmap : text.sourceTypeDocs)}</button>`).join("")}
          </div>
        </div>
      </div>`;
}

function renderUpdateCard(event, locale, depth, text, options = {}) {
  const summary = summaryForLocale(event, locale);
  const localizedTitle = titleForLocale(event, locale);
  const originalTitle = originalTitleForLocale(event, locale);
  const product = escapeHtml(event.productArea);
  const sourceType = sourceTypeSlug(event.sourceFamily);
  const detailHref = options.detailHref || "";
  const originalHref = escapeHtml(event.url);
  const why =
    locale === "en" ? importanceReason(event, "en") : event.importanceReason;
  const cardRoles = event.roleTags.map((role) => roleSlug(role)).join(" ");
  const productValue = productSlug(event.productArea);
  const roleBadges = event.roleTags
    .map((role) =>
      renderBadge(
        locale === "en"
          ? role === "管理者向け"
            ? text.adminRole
            : text.makerRole
          : role,
        "role",
      ),
    )
    .join("");
  const roadmapBadges = (event.roadmapIds || [])
    .slice(0, 2)
    .map((id) => renderBadge(`Roadmap ${id}`, "roadmap"))
    .join("");

  return `
    <article class="update-card" data-card-item data-product="${escapeHtml(productValue)}" data-roles="${escapeHtml(cardRoles)}" data-source-type="${escapeHtml(sourceType)}">
      <div class="badge-row">
        ${event.isPinned ? renderBadge("Pinned", "pinned") : ""}
        ${renderBadge(product, "product")}
        ${renderBadge(sourceTypeLabel(event.sourceFamily, text), "source-type")}
        ${renderBadge(locale === "en" ? event.sourceName : event.sourceName, "source")}
        ${renderBadge(event.releaseStage, "stage")}
        ${roleBadges}
        ${roadmapBadges}
      </div>
      <h3>${escapeHtml(localizedTitle)}</h3>
      ${originalTitle ? `<p class="card-original-title"><strong>${escapeHtml(text.originalTitleLabel)}:</strong> ${escapeHtml(originalTitle)}</p>` : ""}
      <p>${escapeHtml(summary)}</p>
      <dl class="meta-list">
        <div><dt>${escapeHtml(text.publishedLabel)}</dt><dd>${escapeHtml(formatDate(event.publishedAt, locale))}</dd></div>
        <div><dt>${escapeHtml(text.sourceLabel)}</dt><dd>${escapeHtml(event.sourceName)}</dd></div>
        <div><dt>${escapeHtml(text.whyLabel)}</dt><dd>${escapeHtml(why)}</dd></div>
      </dl>
      <div class="card-links">
        <a href="${originalHref}" target="_blank" rel="noreferrer">${escapeHtml(text.openSource)}</a>
        ${detailHref ? `<a href="${escapeHtml(detailHref)}">${escapeHtml(text.openDigest)}</a>` : ""}
      </div>
    </article>
  `;
}

function renderArchiveRow(href, title, subtitle) {
  return `<a class="archive-row" href="${escapeHtml(href)}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></a>`;
}

function renderLastUpdated(locale, siteMeta, className = "hero-meta-item") {
  if (!siteMeta.lastUpdatedAt) {
    return "";
  }

  const text = TEXT[locale];
  return `<p class="${escapeHtml(className)}"><span>${escapeHtml(text.lastUpdatedLabel)}</span><strong>${escapeHtml(formatDateTime(siteMeta.lastUpdatedAt, locale))}</strong></p>`;
}

function renderLastChecked(locale, siteMeta, className = "hero-meta-item") {
  if (!siteMeta.lastCheckedAt) {
    return "";
  }

  const text = TEXT[locale];
  return `<p class="${escapeHtml(className)}"><span>${escapeHtml(text.lastCheckedLabel)}</span><strong>${escapeHtml(formatDateTime(siteMeta.lastCheckedAt, locale))}</strong></p>`;
}

function renderSourceCount(locale, sourceCount, className = "hero-meta-item") {
  if (sourceCount == null) {
    return "";
  }

  const text = TEXT[locale];
  return `<p class="${escapeHtml(className)}"><span>${escapeHtml(text.statsSources)}</span><strong>${escapeHtml(String(sourceCount))}</strong></p>`;
}

function renderHeroMeta(...items) {
  const html = items.filter(Boolean).join("");
  return html ? `<div class="hero-meta">${html}</div>` : "";
}

function renderNav(locale, depth, activeNav, siteMeta, alternatePath) {
  const text = TEXT[locale];
  const navItems = [
    {
      key: "home",
      label: text.navHome,
      href: relativeHref(depth, localePath(locale, "")),
    },
    {
      key: "weekly",
      label: text.navWeekly,
      href: relativeHref(depth, localePath(locale, "weekly/")),
    },
    {
      key: "search",
      label: text.navSearch,
      href: relativeHref(depth, localePath(locale, "search/")),
    },
    {
      key: "about",
      label: text.navAbout,
      href: relativeHref(depth, localePath(locale, "about/")),
    },
  ];

  const navHtml = navItems
    .map(
      (item) =>
        `<a class="${item.key === activeNav ? "is-active" : ""}" href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`,
    )
    .join("");
  const repoHtml = siteMeta.repositoryUrl
    ? `<a href="${escapeHtml(siteMeta.repositoryUrl)}" target="_blank" rel="noreferrer">${escapeHtml(text.navRepository)}</a>`
    : `<span class="nav-disabled">${escapeHtml(text.navRepository)}</span>`;
  const switchHtml = alternatePath
    ? `<a class="lang-switch" href="${escapeHtml(relativeHref(depth, alternatePath))}">${escapeHtml(text.switchLabel)}</a>`
    : "";

  return `<header class="site-header"><div class="site-header-copy"><a class="site-brand" href="${escapeHtml(relativeHref(depth, localePath(locale, "")))}">${escapeHtml(siteMeta.siteName)}</a><p class="site-lead">${escapeHtml(text.headerLead)}</p></div><nav class="site-nav">${navHtml}${repoHtml}${switchHtml}</nav></header>`;
}

function renderLayout({
  locale,
  depth,
  title,
  activeNav,
  alternatePath,
  siteMeta,
  bodyClass = "",
  bodyAttributes = "",
  extraScripts = [],
  content,
}) {
  const text = TEXT[locale];
  const assetHref = relativeHref(depth, "assets/styles.css");
  const defaultScript = relativeHref(depth, "assets/site.js");
  const scripts = [defaultScript, ...extraScripts]
    .map((href) => `<script defer src="${escapeHtml(href)}"></script>`)
    .join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(text.htmlLang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(siteMeta[`tagline${locale === "en" ? "En" : "Ja"}`] || siteMeta.taglineJa)}" />
    <link rel="stylesheet" href="${escapeHtml(assetHref)}" />
  </head>
  <body class="${escapeHtml(bodyClass)}" ${bodyAttributes}>
    <div class="page-shell">
      ${renderNav(locale, depth, activeNav, siteMeta, alternatePath)}
      ${content}
      <footer class="site-footer">
        <p>${escapeHtml(TEXT[locale].footerLead)}</p>
      </footer>
    </div>
    ${scripts}
  </body>
</html>`;
}

function renderEmptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderSearchShell(locale, depth, text, options = {}) {
  const sectionClass = options.sectionClass ?? "section-block search-shell";
  const limit = options.limit ?? 50;
  const heading = options.heading ?? text.searchTitle;
  const body = options.body ?? text.searchBody;
  const showLink = options.showLink ?? false;
  const linkHref = options.linkHref ?? "";

  return `
    <section class="${escapeHtml(sectionClass)}" data-search-root data-search-limit="${escapeHtml(String(limit))}">
      <div class="section-heading"><h2>${escapeHtml(heading)}</h2>${showLink && linkHref ? `<a class="section-link" href="${escapeHtml(linkHref)}">${escapeHtml(text.searchLink)}</a>` : ""}</div>
      <p>${escapeHtml(body)}</p>
      <label class="search-label" for="site-search-input">${escapeHtml(heading)}</label>
      <input id="site-search-input" class="search-input" data-search-input type="search" placeholder="${escapeHtml(text.searchInputPlaceholder)}" />
      <p class="search-status" data-search-status>${escapeHtml(text.searchStatusLoading)}</p>
      <div class="search-results" data-search-results></div>
    </section>
  `;
}

function buildSearchIndex(events) {
  return events.map((event) => ({
    id: event.id,
    titleJa: event.titleJa || event.title,
    titleEn: event.titleEn || event.title,
    summaryJa: event.summaryJa || event.summary,
    summaryEn: event.summaryEn || event.summary,
    productArea: event.productArea,
    sourceName: event.sourceName,
    releaseStage: event.releaseStage,
    roleTags: event.roleTags || [],
    publishedAt: event.publishedAt,
    detailPath: `daily/${toDateOnly(event.publishedAt)}/`,
  }));
}

async function copyRawFiles() {
  const rawEventsDir = path.join(siteDir, "raw", "events");
  const rawSummariesDir = path.join(siteDir, "raw", "summaries", "daily");
  await fs.mkdir(rawEventsDir, { recursive: true });
  await fs.mkdir(rawSummariesDir, { recursive: true });

  const eventEntries = await fs
    .readdir(eventsDir, { withFileTypes: true })
    .catch(() => []);
  for (const entry of eventEntries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      await fs.copyFile(
        path.join(eventsDir, entry.name),
        path.join(rawEventsDir, entry.name),
      );
    }
  }

  const summaryEntries = await fs
    .readdir(summariesDir, { withFileTypes: true })
    .catch(() => []);
  for (const entry of summaryEntries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      await fs.copyFile(
        path.join(summariesDir, entry.name),
        path.join(rawSummariesDir, entry.name),
      );
    }
  }
}

function renderIndexPage(
  locale,
  siteMeta,
  visibleEvents,
  dailyLogs,
  weeklyGroups,
  runSummary,
) {
  const text = TEXT[locale];
  const now = new Date();
  const sorted = sortEvents(visibleEvents);
  const importantWindow = sorted.filter((event) =>
    withinDays(event.publishedAt, 7, now),
  );
  const importantEvents = (
    importantWindow.length > 0 ? importantWindow : sorted
  ).slice(0, 4);
  const recentWindow = sorted.filter((event) =>
    withinHours(event.publishedAt, 72, now),
  );
  const recentEvents = (recentWindow.length > 0 ? recentWindow : sorted).slice(
    0,
    24,
  );
  const recentDaily = dailyLogs.slice(0, 12);
  const recentWeekly = weeklyGroups.slice(0, 6);
  const sourceTypeCounts = ["learn", "blog", "roadmap"]
    .map((type) => ({
      type,
      events: sorted.filter(
        (event) => sourceTypeSlug(event.sourceFamily) === type,
      ),
    }))
    .filter((entry) => entry.events.length > 0)
    .map((entry) => ({
      ...entry,
      count: entry.events.length,
      sourceNames: [...new Set(entry.events.map((event) => event.sourceName))],
    }));
  const sourceCounts = [
    ...sorted
      .reduce((map, event) => {
        const count = map.get(event.sourceName) ?? 0;
        map.set(event.sourceName, count + 1);
        return map;
      }, new Map())
      .entries(),
  ].sort((left, right) => right[1] - left[1]);
  const content = `
    <section class="hero">
      <div class="hero-copy-block">
        <span class="eyebrow">${escapeHtml(text.unofficialBadge)}</span>
        <h1>${escapeHtml(text.heroTitle)}</h1>
        <p class="hero-copy">${escapeHtml(text.heroCopy)}</p>
        ${renderHeroMeta(
          renderLastUpdated(locale, siteMeta),
          renderLastChecked(locale, siteMeta),
          renderSourceCount(
            locale,
            runSummary.sourceCount ?? sourceCounts.length,
          ),
        )}
      </div>
      <div class="metric-grid">
        <article class="metric-card"><span>${escapeHtml(text.statsUpdates)}</span><strong>${escapeHtml(String(sorted.length))}</strong><small>${escapeHtml(text.statsUpdatesDetail)}</small></article>
        <article class="metric-card"><span>${escapeHtml(text.statsRun)}</span><strong>${escapeHtml(String(runSummary.newEventCount ?? 0))}</strong><small>${escapeHtml(text.statsRunDetail)}</small></article>
      </div>
    </section>

    ${renderSearchShell(locale, locale === "en" ? 1 : 0, text, {
      sectionClass: "section-block search-shell home-search-shell",
      limit: 6,
      heading: text.homeSearchTitle,
      body: text.homeSearchBody,
      showLink: true,
      linkHref: relativeHref(
        locale === "en" ? 1 : 0,
        localePath(locale, "search/"),
      ),
    })}

    <section class="section-block">
      ${renderSectionHeading(text.importantTitle)}
      <div class="card-grid">${importantEvents.length > 0 ? importantEvents.map((event) => renderUpdateCard(event, locale, locale === "en" ? 1 : 0, text, { detailHref: relativeHref(locale === "en" ? 1 : 0, localePath(locale, `daily/${toDateOnly(event.publishedAt)}/`)) })).join("") : renderEmptyState(text.noItems)}</div>
    </section>

    <section class="section-block" data-card-filters>
      ${renderSectionHeading(text.recentTitle)}
      ${recentEvents.length > 0 ? renderFilterToolbar(recentEvents, text) : ""}
      ${recentWindow.length === 0 ? `<p class="section-note">${escapeHtml(text.noRecent)}</p>` : ""}
      <div class="card-grid" data-filter-cards>${recentEvents.length > 0 ? recentEvents.map((event) => renderUpdateCard(event, locale, locale === "en" ? 1 : 0, text, { detailHref: relativeHref(locale === "en" ? 1 : 0, localePath(locale, `daily/${toDateOnly(event.publishedAt)}/`)) })).join("") : renderEmptyState(text.noItems)}</div>
      <p class="empty-state hidden" data-filter-empty>${escapeHtml(text.noFiltered)}</p>
    </section>

    <section class="section-block two-column">
      <div class="column-card">
        ${renderSectionHeading(text.sourceBreakdownTitle)}
        <div class="source-list">${sourceTypeCounts
          .map(
            (entry) =>
              `<div class="source-row"><span class="source-row-copy"><strong>${escapeHtml(entry.type === "blog" ? text.sourceTypeBlog : entry.type === "roadmap" ? text.sourceTypeRoadmap : text.sourceTypeDocs)}</strong><small>${escapeHtml(entry.sourceNames.join(" / "))}</small></span><strong>${escapeHtml(String(entry.count))}</strong></div>`,
          )
          .join("")}</div>
      </div>
      <div class="column-card search-card">
        ${renderSectionHeading(text.searchTitle)}
        <p>${escapeHtml(text.searchBody)}</p>
        <a class="primary-link" href="${escapeHtml(relativeHref(locale === "en" ? 1 : 0, localePath(locale, "search/")))}">${escapeHtml(text.searchLink)}</a>
      </div>
    </section>

    <section class="section-block two-column archive-columns">
      <div class="column-card">
        ${renderSectionHeading(text.weeklyArchiveTitle, `<a class="section-link" href="${escapeHtml(relativeHref(locale === "en" ? 1 : 0, localePath(locale, "weekly/")))}">${escapeHtml(text.navWeekly)}</a>`)}
        <div class="archive-list">${recentWeekly.length > 0 ? recentWeekly.map((week) => renderArchiveRow(relativeHref(locale === "en" ? 1 : 0, localePath(locale, `weekly/${week.key}/`)), locale === "en" ? week.labelEn : week.labelJa, `${week.events.length} ${locale === "en" ? "updates" : "件"}`)).join("") : renderEmptyState(text.noItems)}</div>
      </div>
      <div class="column-card">
        ${renderSectionHeading(text.dailyArchiveTitle, `<a class="section-link" href="${escapeHtml(relativeHref(locale === "en" ? 1 : 0, localePath(locale, "daily/")))}">${escapeHtml(text.dailyArchivePageTitle)}</a>`)}
        <div class="archive-list">${recentDaily.length > 0 ? recentDaily.map((log) => renderArchiveRow(relativeHref(locale === "en" ? 1 : 0, localePath(locale, `daily/${log.date}/`)), locale === "en" ? log.date : formatDate(log.date, "ja"), `${log.events.length} ${locale === "en" ? "updates" : "件"}`)).join("") : renderEmptyState(text.noItems)}</div>
      </div>
    </section>
  `;

  return renderLayout({
    locale,
    depth: locale === "en" ? 1 : 0,
    title: siteMeta.siteName,
    activeNav: "home",
    alternatePath: locale === "en" ? "" : "en/",
    siteMeta,
    bodyAttributes: `data-locale="${escapeHtml(locale)}" data-search-index="${escapeHtml(relativeHref(locale === "en" ? 1 : 0, "search-index.json"))}" data-search-base="${escapeHtml(relativeHref(locale === "en" ? 1 : 0, ""))}"`,
    extraScripts: [relativeHref(locale === "en" ? 1 : 0, "assets/search.js")],
    content,
  });
}

function renderDailyPage(locale, siteMeta, log) {
  const text = TEXT[locale];
  const depth = locale === "en" ? 3 : 2;
  const sortedEvents = sortEvents(log.events);
  const highlights = sortedEvents.slice(0, Math.min(5, sortedEvents.length));
  const rawJsonHref = relativeHref(depth, `raw/events/${log.date}.json`);
  const rawMdHref = relativeHref(depth, `raw/summaries/daily/${log.date}.md`);
  const content = `
    <section class="page-hero page-hero-compact">
      <span class="eyebrow">${escapeHtml(locale === "en" ? "Daily digest" : "日次ダイジェスト")}</span>
      <h1>${escapeHtml(locale === "en" ? log.date : formatDate(log.date, "ja"))}</h1>
      <p>${escapeHtml(siteMeta[`tagline${locale === "en" ? "En" : "Ja"}`] || siteMeta.taglineJa)}</p>
      ${renderHeroMeta(
        renderLastUpdated(locale, siteMeta),
        renderLastChecked(locale, siteMeta),
      )}
      <div class="hero-links"><a href="${escapeHtml(rawJsonHref)}">${escapeHtml(text.rawJson)}</a><a href="${escapeHtml(rawMdHref)}">${escapeHtml(text.rawMarkdown)}</a></div>
    </section>
    <section class="section-block">
      ${renderSectionHeading(text.highlightsTitle)}
      <div class="card-grid">${highlights.map((event) => renderUpdateCard(event, locale, depth, text)).join("")}</div>
    </section>
    <section class="section-block">
      ${renderSectionHeading(text.fullListTitle)}
      <div class="card-grid">${sortedEvents.map((event) => renderUpdateCard(event, locale, depth, text)).join("")}</div>
    </section>
  `;

  return renderLayout({
    locale,
    depth,
    title: `${siteMeta.siteName} | ${log.date}`,
    activeNav: "home",
    alternatePath:
      locale === "en" ? `daily/${log.date}/` : `en/daily/${log.date}/`,
    siteMeta,
    content,
  });
}

function renderWeeklyPage(locale, siteMeta, week) {
  const text = TEXT[locale];
  const depth = locale === "en" ? 3 : 2;
  const titleLabel =
    locale === "en" ? `${text.weekOf} ${week.labelEn}` : week.labelJa;
  const content = `
    <section class="page-hero page-hero-compact">
      <span class="eyebrow">${escapeHtml(locale === "en" ? "Weekly summary" : "週間まとめ")}</span>
      <h1>${escapeHtml(titleLabel)}</h1>
      <p>${escapeHtml(locale === "en" ? `${week.events.length} updates in this week window.` : `この週の更新は ${week.events.length} 件です。`)}</p>
      ${renderHeroMeta(
        renderLastUpdated(locale, siteMeta),
        renderLastChecked(locale, siteMeta),
      )}
    </section>
    <section class="section-block">
      ${renderSectionHeading(text.highlightsTitle)}
      <div class="card-grid">${week.events
        .slice(0, Math.min(10, week.events.length))
        .map((event) =>
          renderUpdateCard(event, locale, depth, text, {
            detailHref: relativeHref(
              depth,
              localePath(locale, `daily/${toDateOnly(event.publishedAt)}/`),
            ),
          }),
        )
        .join("")}</div>
    </section>
  `;

  return renderLayout({
    locale,
    depth,
    title: `${siteMeta.siteName} | ${titleLabel}`,
    activeNav: "weekly",
    alternatePath:
      locale === "en" ? `weekly/${week.key}/` : `en/weekly/${week.key}/`,
    siteMeta,
    content,
  });
}

function renderArchivePage(locale, siteMeta, dailyLogs, weeklyGroups, type) {
  const text = TEXT[locale];
  const isWeekly = type === "weekly";
  const depth = locale === "en" ? 2 : 1;
  const title = isWeekly
    ? text.weeklyArchivePageTitle
    : text.dailyArchivePageTitle;
  const items = isWeekly ? weeklyGroups : dailyLogs;
  const listHtml = isWeekly
    ? items
        .map((week) =>
          renderArchiveRow(
            relativeHref(depth, localePath(locale, `weekly/${week.key}/`)),
            locale === "en" ? week.labelEn : week.labelJa,
            `${week.events.length} ${locale === "en" ? "updates" : "件"}`,
          ),
        )
        .join("")
    : items
        .map((log) =>
          renderArchiveRow(
            relativeHref(depth, localePath(locale, `daily/${log.date}/`)),
            locale === "en" ? log.date : formatDate(log.date, "ja"),
            `${log.events.length} ${locale === "en" ? "updates" : "件"}`,
          ),
        )
        .join("");
  const content = `
    <section class="page-hero page-hero-compact">
      <span class="eyebrow">${escapeHtml(isWeekly ? text.navWeekly : text.navHome)}</span>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(locale === "en" ? "Browse generated archives." : "生成済みアーカイブを一覧で確認できます。")}</p>
      ${renderHeroMeta(
        renderLastUpdated(locale, siteMeta),
        renderLastChecked(locale, siteMeta),
      )}
    </section>
    <section class="section-block archive-page-list">
      <div class="archive-list">${listHtml || renderEmptyState(text.noItems)}</div>
    </section>
  `;

  return renderLayout({
    locale,
    depth,
    title: `${siteMeta.siteName} | ${title}`,
    activeNav: isWeekly ? "weekly" : "home",
    alternatePath: locale === "en" ? `${type}/` : `en/${type}/`,
    siteMeta,
    content,
  });
}

function renderAboutPage(locale, siteMeta) {
  const text = TEXT[locale];
  const depth = locale === "en" ? 2 : 1;
  const content = `
    <section class="page-hero page-hero-compact">
      <span class="eyebrow">${escapeHtml(text.unofficialBadge)}</span>
      <h1>${escapeHtml(text.aboutTitle)}</h1>
      <p>${escapeHtml(text.aboutIntro)}</p>
      ${renderHeroMeta(
        renderLastUpdated(locale, siteMeta),
        renderLastChecked(locale, siteMeta),
      )}
    </section>
    <section class="section-block prose-card">
      <p>${escapeHtml(text.aboutBody1)}</p>
      <p>${escapeHtml(text.aboutBody2)}</p>
      <p>${escapeHtml(text.aboutBody3)}</p>
      <p>${escapeHtml(text.aboutBody4)}</p>
    </section>
  `;

  return renderLayout({
    locale,
    depth,
    title: `${siteMeta.siteName} | ${text.aboutTitle}`,
    activeNav: "about",
    alternatePath: locale === "en" ? "about/" : "en/about/",
    siteMeta,
    content,
  });
}

function renderSearchPage(locale, siteMeta) {
  const text = TEXT[locale];
  const depth = locale === "en" ? 2 : 1;
  const searchScript = relativeHref(depth, "assets/search.js");
  const content = `
    <section class="page-hero page-hero-compact">
      <span class="eyebrow">${escapeHtml(text.navSearch)}</span>
      <h1>${escapeHtml(text.searchTitle)}</h1>
      <p>${escapeHtml(text.searchBody)}</p>
      ${renderHeroMeta(
        renderLastUpdated(locale, siteMeta),
        renderLastChecked(locale, siteMeta),
      )}
    </section>
    ${renderSearchShell(locale, depth, text, {
      sectionClass: "section-block search-shell",
      limit: 50,
      heading: text.searchTitle,
      body: text.searchBody,
      showLink: false,
    })}
  `;

  return renderLayout({
    locale,
    depth,
    title: `${siteMeta.siteName} | ${text.navSearch}`,
    activeNav: "search",
    alternatePath: locale === "en" ? "search/" : "en/search/",
    siteMeta,
    bodyAttributes: `data-locale="${escapeHtml(locale)}" data-search-index="${escapeHtml(relativeHref(depth, "search-index.json"))}" data-search-base="${escapeHtml(relativeHref(depth, ""))}"`,
    extraScripts: [searchScript],
    content,
  });
}

async function main() {
  const siteMeta = await readJson(siteMetaFile, {
    siteName: "M365 Copilot Update Digest",
    taglineJa: "",
    taglineEn: "",
    repositoryUrl: "",
  });
  const overrides = await readJson(overridesFile, { pin: [], hide: [] });
  const runSummary = await readJson(runSummaryFile, {
    sourceCount: 0,
    newEventCount: 0,
  });
  const rawDailyLogs = await readDailyLogs();
  const allEvents = applyOverrides(
    rawDailyLogs.flatMap((log) => log.events || []),
    overrides,
  );
  const dailyLogs = rawDailyLogs
    .map((log) => ({
      ...log,
      events: sortEvents(
        allEvents.filter((event) => toDateOnly(event.publishedAt) === log.date),
      ),
    }))
    .filter((log) => log.events.length > 0);
  const weeklyGroups = buildWeeklyGroups(allEvents);
  const siteContext = {
    ...siteMeta,
    lastUpdatedAt: runSummary.generatedAt || dailyLogs[0]?.generatedAt || null,
    lastCheckedAt:
      runSummary.lastCheckedAt ||
      runSummary.generatedAt ||
      dailyLogs[0]?.generatedAt ||
      null,
  };

  await fs.rm(siteDir, { recursive: true, force: true });
  await fs.mkdir(siteDir, { recursive: true });
  await copyDirectory(publicDir, siteDir);
  await copyRawFiles();
  await writeText(path.join(siteDir, ".nojekyll"), "\n");
  await writeText(
    path.join(siteDir, "search-index.json"),
    `${JSON.stringify({ generatedAt: siteContext.lastUpdatedAt || new Date().toISOString(), entries: buildSearchIndex(allEvents) }, null, 2)}\n`,
  );

  for (const locale of ["ja", "en"]) {
    const localeRoot = locale === "en" ? path.join(siteDir, "en") : siteDir;
    await fs.mkdir(localeRoot, { recursive: true });
    await writeText(
      path.join(localeRoot, "index.html"),
      renderIndexPage(
        locale,
        siteContext,
        allEvents,
        dailyLogs,
        weeklyGroups,
        runSummary,
      ),
    );
    await writeText(
      path.join(localeRoot, "search", "index.html"),
      renderSearchPage(locale, siteContext),
    );
    await writeText(
      path.join(localeRoot, "about", "index.html"),
      renderAboutPage(locale, siteContext),
    );
    await writeText(
      path.join(localeRoot, "daily", "index.html"),
      renderArchivePage(locale, siteContext, dailyLogs, weeklyGroups, "daily"),
    );
    await writeText(
      path.join(localeRoot, "weekly", "index.html"),
      renderArchivePage(locale, siteContext, dailyLogs, weeklyGroups, "weekly"),
    );

    for (const log of dailyLogs) {
      await writeText(
        path.join(localeRoot, "daily", log.date, "index.html"),
        renderDailyPage(locale, siteContext, log),
      );
    }

    for (const week of weeklyGroups) {
      await writeText(
        path.join(localeRoot, "weekly", week.key, "index.html"),
        renderWeeklyPage(locale, siteContext, week),
      );
    }
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        pages: {
          daily: dailyLogs.length,
          weekly: weeklyGroups.length,
        },
        totalEvents: allEvents.length,
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
