import fs from "node:fs";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";

export const SLIDES_DIR = "data/slides";

/** 利用者に見せる文言に混ぜない、社内メモ的な表現。 */
export const FORBIDDEN_PHRASES = ["未確認", "記載なし", "要確認", "推定", "未発表", "判定保留", "AI 生成", "AI生成", "データ時点", "（原文）", "（Learn）", "初心者向け"];

/** 根拠・参照 URL に許可するホスト。 */
export const ALLOWED_HOSTS = new Set(["learn.microsoft.com", "www.microsoft.com", "techcommunity.microsoft.com", "azure.microsoft.com", "support.microsoft.com", "devblogs.microsoft.com"]);

const KIND_BY_STAGE = {
  GA: "ga",
  Launched: "ga",
  Preview: "preview",
  "Rolling out": "rolling-out",
  "In development": "in-development",
  Retirement: "retirement",
  Cancelled: "retirement",
};

export const KIND_LABEL = {
  ga: "提供開始",
  preview: "プレビュー",
  "rolling-out": "展開中",
  "in-development": "開発中",
  retirement: "廃止・終了",
  update: "アップデート",
};

export const KIND_LABEL_EN = {
  ga: "GA",
  preview: "Preview",
  "rolling-out": "Rolling out",
  "in-development": "In development",
  retirement: "Retired",
  update: "Update",
};

export const KIND_ORDER = ["preview", "ga", "rolling-out", "in-development", "retirement", "update"];
export const KIND_IDS = KIND_ORDER;

/** 種類ごとの標準パネル（表示順）。 */
export const PANEL_TEMPLATE = {
  ga: { core: ["how-it-works", "how-to-start"], detail: ["prerequisites-limits", "related-features", "use-case"] },
  "rolling-out": { core: ["how-it-works", "how-to-start"], detail: ["prerequisites-limits", "rollout-scope", "use-case"] },
  preview: { core: ["scope", "constraints"], detail: ["evaluate"] },
  "in-development": { core: ["scope", "constraints"], detail: ["prepare"] },
  retirement: { core: ["impact", "migration"], detail: ["action-plan"] },
  update: { core: ["scope"], detail: ["impact-check"] },
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function jstDate(value) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** now を含む直近 months か月（JST）の初日。 */
export function retentionStart(now, months) {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const start = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - (months - 1), 1));
  return start.toISOString().slice(0, 10);
}

export function slideKind(event) {
  return KIND_BY_STAGE[event.releaseStage] ?? "update";
}

export function stableStringify(value) {
  const sort = (input) => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort().map((key) => [key, sort(input[key])]));
    }
    return input;
  };
  return JSON.stringify(sort(value));
}

/** 種類、新しい順、キーの順。 */
export function orderSlides(items, get = (item) => item) {
  return [...items].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    return (
      KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) ||
      y.publishedJst.localeCompare(x.publishedJst) ||
      x.key.localeCompare(y.key)
    );
  });
}

/** スライドを作る対象: 直近 months か月で、指定した重要度以上の更新（新しい順）。 */
export function selectSlideEvents(events, { now = new Date(), months = 3, levels = ["high", "notable"] } = {}) {
  const since = retentionStart(now, months);
  return events
    .filter((event) => levels.includes(event.importanceLevel) && (jstDate(event.publishedAt) ?? "") >= since)
    .sort((a, b) => (jstDate(b.publishedAt) ?? "").localeCompare(jstDate(a.publishedAt) ?? "") || a.id.localeCompare(b.id));
}

let compiled = null;
function validator() {
  if (!compiled) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../schema/slide.schema.json", import.meta.url), "utf8"));
    compiled = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  }
  return compiled;
}

/** スライドに出る文（すべて）。 */
export function renderedTexts(slide) {
  const out = [slide.title?.ja ?? "", slide.title?.subtitleJa ?? "", slide.audience?.who?.text ?? "", slide.audience?.change?.text ?? "", slide.action?.summary?.text ?? ""];
  if (slide.beforeAfter?.before) out.push(slide.beforeAfter.before.text);
  if (slide.beforeAfter?.after) out.push(slide.beforeAfter.after.text);
  for (const panel of slide.panels ?? []) {
    out.push(panel.heading ?? "");
    if (panel.availability === "present") for (const item of panel.items ?? []) out.push(item.text);
  }
  for (const entry of slide.glossary ?? []) out.push(entry.term ?? "", entry.oneLine?.text ?? "");
  for (const entry of slide.timeline ?? []) out.push(entry.label ?? "");
  return out;
}

function claimsOf(slide) {
  const claims = [slide.audience?.who, slide.audience?.change, slide.action?.summary, slide.beforeAfter?.before, slide.beforeAfter?.after].filter(Boolean);
  for (const panel of slide.panels ?? []) for (const item of panel.items ?? []) claims.push(item);
  for (const entry of slide.glossary ?? []) if (entry.oneLine) claims.push(entry.oneLine);
  return claims;
}

/** スキーマでは表せない検査もまとめて行い、問題の一覧（{slide, message}）を返す。空なら有効。 */
export function validateDeck(deck) {
  const problems = [];
  const check = validator();
  if (!check(deck)) {
    for (const error of check.errors ?? []) problems.push({ slide: "(deck)", message: `${error.instancePath || "/"} ${error.message ?? ""} ${JSON.stringify(error.params)}`.trim() });
  }
  for (const slide of deck?.slides ?? []) {
    const key = String(slide.key ?? "?");
    for (const text of renderedTexts(slide)) {
      for (const word of FORBIDDEN_PHRASES) if (text.includes(word)) problems.push({ slide: key, message: `forbidden phrase "${word}" in: ${text.slice(0, 60)}` });
    }
    const urls = [slide.references?.announcement, ...(slide.references?.learn ?? []).map((link) => link.url)];
    for (const claim of claimsOf(slide)) for (const evidence of claim.evidence ?? []) urls.push(evidence.url);
    for (const url of urls.filter(Boolean)) {
      try {
        const host = new URL(url).hostname;
        if (!ALLOWED_HOSTS.has(host)) problems.push({ slide: key, message: `evidence/reference host not allowed: ${host}` });
      } catch {
        problems.push({ slide: key, message: `invalid url: ${url}` });
      }
    }
    for (const claim of claimsOf(slide)) {
      if (claim.assertion === "recommendation" && claim.verification === "verified") problems.push({ slide: key, message: `a recommendation cannot be "verified": ${claim.text.slice(0, 40)}` });
    }
    if (slide.panels && !slide.panels.some((panel) => panel.priority === "core" && panel.availability === "present")) problems.push({ slide: key, message: "no core panel is present" });
    const seen = new Set();
    for (const link of slide.references?.learn ?? []) {
      if (seen.has(link.url)) problems.push({ slide: key, message: `duplicate learn link: ${link.url}` });
      seen.add(link.url);
      if ((link.locale === "ja-jp") !== link.url.includes("/ja-jp/")) problems.push({ slide: key, message: `learn link locale does not match URL: ${link.url}` });
    }
  }
  const keys = (deck?.slides ?? []).map((slide) => slide.key);
  if (new Set(keys).size !== keys.length) problems.push({ slide: "(deck)", message: "duplicate slide keys" });
  return problems;
}

/** data/slides/{key}.json を読み、検証結果を付けて返す。ファイルは 1 スライドだけを持つ。 */
export function loadSlides(root = process.cwd()) {
  const dir = path.join(root, SLIDES_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      const expected = name.slice(0, -5);
      let deck;
      try {
        deck = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (error) {
        return { key: expected, file, slide: null, problems: [{ slide: "(file)", message: `invalid JSON: ${error.message}` }] };
      }
      const problems = validateDeck(deck);
      const keys = (deck.slides ?? []).map((slide) => slide.key);
      if (keys.length !== 1 || keys[0] !== expected) problems.push({ slide: "(file)", message: `file ${name} must hold exactly slide ${expected}, found [${keys.join(",")}]` });
      return { key: expected, file, slide: deck.slides?.[0] ?? null, problems };
    });
}
