import crypto from "node:crypto";

export function safeDate(value) {
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    return new Date();
  }

  return date;
}

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hashText(value) {
  return crypto
    .createHash("sha256")
    .update(String(value ?? ""))
    .digest("hex");
}

export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function toDateOnly(value) {
  const date = safeDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function mondayStart(value) {
  const date = safeDate(value);
  const next = new Date(date);
  const day = next.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function weekKey(value) {
  return toDateOnly(mondayStart(value));
}

export function weekRangeLabel(value, locale = "ja") {
  const start = mondayStart(value);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  if (locale === "en") {
    return `${formatDate(start, "en")} - ${formatDate(end, "en")}`;
  }

  return `${formatDate(start, "ja")} - ${formatDate(end, "ja")}`;
}

export function formatDate(value, locale = "ja") {
  const target = locale === "ja" ? "ja-JP" : "en-US";
  return safeDate(value).toLocaleDateString(target, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(value, locale = "ja") {
  const target = locale === "ja" ? "ja-JP" : "en-GB";
  return safeDate(value).toLocaleString(target, {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function excerptText(value, maxLength = 260) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

export function buildEventId(sourceId, title, publishedAt, section = "") {
  const digest = hashText(
    `${sourceId}\n${publishedAt}\n${section}\n${title}`,
  ).slice(0, 16);
  return `${sourceId}-${digest}`;
}

export function detectReleaseStage(value) {
  const text = String(value ?? "").toLowerCase();

  if (/retire|retirement|deprecated|deprecation|end of support/.test(text)) {
    return "Retirement";
  }

  if (/general availability|generally available|\bga\b/.test(text)) {
    return "GA";
  }

  if (/preview|private preview|public preview|beta|experimental/.test(text)) {
    return "Preview";
  }

  if (/rolling out|roll out|rollout/.test(text)) {
    return "Rolling out";
  }

  return "Update";
}

export function detectAudienceTags(title, summary, productArea = "") {
  const text = `${title}\n${summary}\n${productArea}`.toLowerCase();
  const tags = new Set();

  if (
    /admin|governance|policy|policies|security|purview|license|licensing|billing|cost|capacity|sharing|permissions|tenant|compliance|dlp|dashboard/.test(
      text,
    )
  ) {
    tags.add("管理者向け");
  }

  if (
    /studio|agent|builder|prompt|connector|connectors|mcp|workflow|flow|tool|tools|model|models|evaluation|orchestration|publish|deploy|deployment|knowledge|adaptive card|sdk|api/.test(
      text,
    )
  ) {
    tags.add("作成者向け");
  }

  if (tags.size === 0 && /copilot studio|agent builder/.test(text)) {
    tags.add("作成者向け");
  }

  if (
    tags.size === 0 &&
    /copilot|teams|word|excel|powerpoint|chat|search/.test(text)
  ) {
    tags.add("管理者向け");
    tags.add("作成者向け");
  }

  if (tags.size === 0) {
    tags.add("管理者向け");
    tags.add("作成者向け");
  }

  return [...tags];
}

function analysisText(event) {
  return [
    event.title,
    event.titleEn,
    event.titleJa,
    event.summary,
    event.summaryEn,
    event.summaryJa,
    event.productArea,
    event.section,
    event.releaseStage,
    event.sourceName,
    event.sourceFamily,
    ...(event.tags || []),
    ...(event.roleTags || []),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

const SIGNAL_DEFINITIONS = [
  {
    key: "official-channel",
    score: 18,
    pattern:
      /welcome to the .*blog|launch of the .*blog|blog launch|ブログ開始|ブログ開設/,
    reasonJa: "新しい公式発信チャネルの開始や強化が案内されたため",
    reasonEn: "because it establishes or expands an official update channel",
  },
  {
    key: "licensing",
    score: 20,
    pattern: /license|licensing|billing|cost|capacity|pricing|pay-as-you-go/,
    reasonJa: "コストやライセンス判断に関わるため",
    reasonEn: "because it impacts cost or licensing decisions",
  },
  {
    key: "security-governance",
    score: 18,
    pattern:
      /admin|governance|security|policy|policies|compliance|purview|sharing|permissions|tenant|dlp|resilien|backup|archive/,
    reasonJa: "管理やガバナンスへの影響が大きいため",
    reasonEn: "because it materially affects administration or governance",
  },
  {
    key: "analytics",
    score: 14,
    pattern: /analytics|adoption|report|dashboard|insights|power bi|usage/,
    reasonJa: "導入状況の可視化や分析に関わるため",
    reasonEn: "because it affects adoption visibility or analytics",
  },
  {
    key: "builder",
    score: 16,
    pattern:
      /agent evaluation|evaluation|copilot studio|agent builder|mcp|orchestration|model|models|gpt|claude|code interpreter|prompt builder|sdk|api/,
    reasonJa: "エージェント構築や品質管理に関わるため",
    reasonEn: "because it changes builder workflows or agent quality management",
  },
  {
    key: "integration",
    score: 14,
    pattern:
      /connector|connect to|integration|bitbucket|gitlab|zendesk|coda|hubspot|notion|veeva|external services|federated/,
    reasonJa: "外部サービス連携や拡張性に影響するため",
    reasonEn: "because it affects integrations or extensibility",
  },
  {
    key: "documents",
    score: 12,
    pattern:
      /word|excel|powerpoint|ppt|onedrive|pdf|document|documents|presentation|slide|notebook|onenote/,
    reasonJa: "文書や資料作成の体験変化が大きいため",
    reasonEn: "because it changes document or presentation workflows",
  },
  {
    key: "communication",
    score: 12,
    pattern:
      /teams|meeting|meetings|chat|channel|calendar|outlook|email|recap|conversation/,
    reasonJa: "会議やコミュニケーションの業務導線に直結するため",
    reasonEn: "because it directly affects meetings or communication workflows",
  },
  {
    key: "search-knowledge",
    score: 12,
    pattern: /search|knowledge|retriev|ground|file summary|query|wiki|faq/,
    reasonJa: "検索やナレッジ活用の精度に影響するため",
    reasonEn: "because it affects search or knowledge workflows",
  },
  {
    key: "ux",
    score: 10,
    pattern: /ui|ux|experience|streamlined|fewer confirmation|workflow|app learning/,
    reasonJa: "日常利用時の体験変化が大きいため",
    reasonEn: "because it noticeably changes the day-to-day user experience",
  },
];

function matchedSignals(event) {
  const text = analysisText(event);
  return SIGNAL_DEFINITIONS.filter((signal) => signal.pattern.test(text));
}

export function importanceScore(event) {
  const stageWeights = {
    Retirement: 95,
    GA: 85,
    Preview: 70,
    "Rolling out": 65,
    Update: 50,
  };

  let score = stageWeights[event.releaseStage] ?? 50;
  score += matchedSignals(event)
    .slice(0, 3)
    .reduce((sum, signal) => sum + signal.score, 0);

  if (/what'?s new|whats new|release notes/.test(analysisText(event))) {
    score += 10;
  }

  if (/tech community/.test(analysisText(event))) {
    score += 4;
  }

  if (event.roleTags?.includes("管理者向け")) {
    score += 2;
  }

  if (event.roleTags?.includes("作成者向け")) {
    score += 2;
  }

  if (event.isPinned) {
    score += 100;
  }

  return score;
}

export function importanceReason(event, locale = "ja") {
  const reasons = [];

  if (event.releaseStage === "Retirement") {
    reasons.push(
      locale === "ja"
        ? "廃止や移行判断に影響するため"
        : "because it affects deprecation and migration planning",
    );
  } else if (event.releaseStage === "GA") {
    reasons.push(
      locale === "ja"
        ? "GA になり実運用へ直結するため"
        : "because it is generally available and production-relevant",
    );
  } else if (event.releaseStage === "Preview") {
    reasons.push(
      locale === "ja"
        ? "Preview の方向性を早めに把握できるため"
        : "because it signals preview direction early",
    );
  }

  if (/what'?s new|whats new|release notes/.test(analysisText(event))) {
    reasons.push(
      locale === "ja"
        ? "更新まとめや公式リリース整理として追いやすいため"
        : "because it is part of an official update roundup or release-note stream",
    );
  }

  for (const signal of matchedSignals(event)) {
    reasons.push(locale === "ja" ? signal.reasonJa : signal.reasonEn);
  }

  if (reasons.length === 1) {
    if (event.roleTags?.includes("管理者向け")) {
      reasons.push(
        locale === "ja"
          ? "管理者の運用判断に関わるため"
          : "because it matters for admin operations",
      );
    } else if (event.roleTags?.includes("作成者向け")) {
      reasons.push(
        locale === "ja"
          ? "作成者の構築判断に関わるため"
          : "because it matters for builder decisions",
      );
    }
  }

  if (reasons.length === 0) {
    return locale === "ja"
      ? "公開ソースで更新が確認されたため"
      : "because the update was confirmed on a public source";
  }

  return [...new Set(reasons)].slice(0, 2).join(locale === "ja" ? " / " : " / ");
}

export function dedupeEvents(events) {
  const map = new Map();

  for (const event of events) {
    const existing = map.get(event.id);
    if (!existing) {
      map.set(event.id, event);
      continue;
    }

    const replacement =
      importanceScore(event) > importanceScore(existing)
        ? {
            ...existing,
            ...event,
            capturedAt: existing.capturedAt ?? event.capturedAt,
          }
        : {
            ...event,
            ...existing,
            sourceLastSeen: event.sourceLastSeen ?? existing.sourceLastSeen,
          };
    map.set(event.id, replacement);
  }

  return [...map.values()];
}

export function sortEvents(events) {
  return [...events].sort((left, right) => {
    const importanceDiff =
      (right.importanceScore ?? 0) - (left.importanceScore ?? 0);
    if (importanceDiff !== 0) {
      return importanceDiff;
    }

    const publishedDiff =
      safeDate(right.publishedAt) - safeDate(left.publishedAt);
    if (publishedDiff !== 0) {
      return publishedDiff;
    }

    return left.title.localeCompare(right.title);
  });
}

export function titleForLocale(event, locale = "ja") {
  if (locale === "en") {
    return event.titleEn || event.title || "";
  }

  return event.titleJa || event.title || "";
}

export function originalTitleForLocale(event, locale = "ja") {
  if (locale === "en") {
    return "";
  }

  const localized = titleForLocale(event, locale);
  const original = event.titleEn || event.title || "";
  return localized && original && localized !== original ? original : "";
}

export function summaryForLocale(event, locale = "ja") {
  if (locale === "en") {
    return event.summaryEn || event.summary || "";
  }

  return event.summaryJa || event.summary || "";
}

export function withinHours(value, hours, now = new Date()) {
  return (
    safeDate(value).getTime() >=
    safeDate(now).getTime() - hours * 60 * 60 * 1000
  );
}

export function withinDays(value, days, now = new Date()) {
  return (
    safeDate(value).getTime() >=
    safeDate(now).getTime() - days * 24 * 60 * 60 * 1000
  );
}

export function buildDailyMarkdown(date, events) {
  const sorted = sortEvents(events);
  const highlights = sorted.slice(0, Math.min(5, sorted.length));
  const lines = [
    "---",
    `date: ${date}`,
    `count: ${events.length}`,
    "---",
    "",
    `# ${date}`,
    "",
    "## 今日の重要更新",
    "",
  ];

  for (const event of highlights) {
    lines.push(`- [${titleForLocale(event, "ja")}](${event.url})`);
    lines.push(`  - ソース: ${event.sourceName}`);
    lines.push(`  - 領域: ${event.productArea}`);
    lines.push(`  - なぜ重要か: ${event.importanceReason}`);
  }

  lines.push("", "## 全件", "");

  for (const event of sorted) {
    lines.push(`### ${titleForLocale(event, "ja")}`);
    lines.push("");
    if (originalTitleForLocale(event, "ja")) {
      lines.push(`- 原題: ${originalTitleForLocale(event, "ja")}`);
    }
    lines.push(`- ソース: ${event.sourceName}`);
    lines.push(`- 公開日: ${formatDate(event.publishedAt, "ja")}`);
    lines.push(`- リリース段階: ${event.releaseStage}`);
    lines.push(`- 役割タグ: ${event.roleTags.join(" / ")}`);
    lines.push(`- URL: ${event.url}`);
    lines.push("");
    lines.push(summaryForLocale(event, "ja"));
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
