import crypto from "node:crypto";
import fs from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";

export const SLIDE_SCHEMA_VERSION = 1;

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

const KIND_ORDER = ["preview", "ga", "rolling-out", "in-development", "retirement", "update"];
export const KIND_IDS = KIND_ORDER;

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

/** 公開対象: 直近 months か月で、指定した重要度以上の更新。 */
export function selectSlideEvents(events, { now = new Date(), months = 3, levels = ["high", "notable"] } = {}) {
  const since = retentionStart(now, months);
  return events
    .filter((event) => levels.includes(event.importanceLevel) && (jstDate(event.publishedAt) ?? "") >= since)
    .sort(compareSlideEvents);
}

function compareSlideEvents(left, right) {
  const kind = KIND_ORDER.indexOf(slideKind(left)) - KIND_ORDER.indexOf(slideKind(right));
  if (kind !== 0) return kind;
  const date = (jstDate(right.publishedAt) ?? "").localeCompare(jstDate(left.publishedAt) ?? "");
  return date !== 0 ? date : left.id.localeCompare(right.id);
}

export function buildSlide(event, categoryConfig) {
  const kind = slideKind(event);
  const labelOf = new Map(categoryConfig.categories.map((category) => [category.id, category.label]));
  const related = (event.relatedDocuments || [])
    .filter((document) => typeof document.url === "string" && document.url.startsWith("https://"))
    .slice(0, 3)
    .map((document) => ({ title: document.title, url: document.url }));
  const summaryJa = event.summaryJa || event.summary || "";

  const slide = {
    schemaVersion: SLIDE_SCHEMA_VERSION,
    key: event.id,
    kind,
    label: KIND_LABEL[kind],
    title: {
      ja: event.titleJa || event.title,
      ...(event.titleEn || event.title ? { en: event.titleEn || event.title } : {}),
    },
    ...(summaryJa ? { summaryJa: summaryJa.length > 900 ? `${summaryJa.slice(0, 897)}...` : summaryJa } : {}),
    ...(event.audienceJa ? { audienceJa: event.audienceJa } : {}),
    ...(event.actionJa ? { actionJa: event.actionJa } : {}),
    meta: {
      publishedJst: jstDate(event.publishedAt),
      ...(event.releaseStage ? { stage: event.releaseStage } : {}),
      productArea: event.productArea,
      sourceName: event.sourceName,
      categories: event.categories,
      ...(event.roleTags?.length ? { roleTags: event.roleTags } : {}),
      ...(event.roadmapIds?.length ? { roadmapIds: event.roadmapIds } : {}),
      importance: {
        level: event.importanceLevel,
        score: event.importanceScore,
        ...(event.importanceReason ? { reasonJa: event.importanceReason } : {}),
      },
    },
    references: { source: event.url, ...(related.length ? { related } : {}) },
  };
  slide.inputFingerprint = crypto
    .createHash("sha256")
    .update(stableStringify({ slide, categoryLabels: [...labelOf.entries()] }))
    .digest("hex");
  return slide;
}

export function renderedTexts(slide) {
  return [
    slide.label,
    slide.title.ja,
    slide.title.en ?? "",
    slide.summaryJa ?? "",
    slide.meta.importance.reasonJa ?? "",
    ...(slide.references.related ?? []).map((document) => document.title),
  ];
}

let compiled = null;
function validator() {
  if (!compiled) {
    const schema = JSON.parse(fs.readFileSync(new URL("../../schema/slide.schema.json", import.meta.url), "utf8"));
    compiled = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  }
  return compiled;
}

/** スキーマを検査し、問題の一覧を返す（空なら有効）。本文は公開ソースの翻訳なので語句では弾かない。 */
export function validateSlide(slide) {
  const check = validator();
  const problems = [];
  if (!check(slide)) {
    for (const error of check.errors ?? []) problems.push(`${error.instancePath || "/"} ${error.message}`);
  }
  return problems;
}
