import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SUMMARY_DIR = "data/summaries";

const URL_PATTERN = /https?:\/\/|www\./i;
const MARKDOWN_PATTERN = /[*_`#]{2,}|^\s*[-*]\s|\[[^\]]+\]\([^)]+\)/m;
const JAPANESE_PATTERN = /[\u3040-\u30ff\u3400-\u9fff]/;
const TITLE_BAD_ENDINGS = /(?:。|です|ます|ました|ください)$/;

/** 原文（英語の題名・要約・段階）が変わったときだけ再生成するための指紋。 */
export function sourceFingerprint(event) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([event.titleEn || event.title || "", event.summaryEn || event.summary || "", event.releaseStage || ""]))
    .digest("hex")
    .slice(0, 16);
}

export function validateAgentSummary(summary, fileKey) {
  const problems = [];
  const bad = (message) => problems.push(message);
  if (!summary || typeof summary !== "object") return ["not an object"];
  if (summary.schema !== 1) bad("schema must be 1");
  if (summary.key !== fileKey) bad("key must match the file name");
  if (!/^[0-9a-f]{16}$/.test(summary.sourceFingerprint ?? "")) bad("sourceFingerprint must be 16 hex chars");

  const title = summary.titleJa;
  if (typeof title !== "string" || title.length < 8 || title.length > 80) bad("titleJa must be 8-80 characters");
  else {
    if (!JAPANESE_PATTERN.test(title)) bad("titleJa must contain Japanese");
    if (TITLE_BAD_ENDINGS.test(title.trim())) bad("titleJa must be noun-ending");
    if (/\n/.test(title) || URL_PATTERN.test(title) || MARKDOWN_PATTERN.test(title)) bad("titleJa must be a single plain line without URLs");
  }

  const text = summary.summaryJa;
  if (typeof text !== "string" || text.length < 60 || text.length > 300) bad("summaryJa must be 60-300 characters");
  else {
    if (!JAPANESE_PATTERN.test(text)) bad("summaryJa must contain Japanese");
    if (URL_PATTERN.test(text) || MARKDOWN_PATTERN.test(text)) bad("summaryJa must be plain text without URLs");
  }

  for (const field of ["audienceJa", "actionJa"]) {
    const value = summary[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length < 4 || value.length > 120 || URL_PATTERN.test(value) || /\n/.test(value) || !JAPANESE_PATTERN.test(value)) {
      bad(`${field} must be one plain Japanese line of 4-120 characters`);
    }
  }
  return problems;
}

export function loadAgentSummaries(root = process.cwd()) {
  const dir = path.join(root, SUMMARY_DIR);
  const result = new Map();
  if (!fs.existsSync(dir)) return result;
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort()) {
    const key = name.slice(0, -5);
    const summary = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
    result.set(key, { summary, problems: validateAgentSummary(summary, key), file: path.join(dir, name) });
  }
  return result;
}

/** 指紋が現在の原文と一致し、検証を通った要約だけを上書きする。古い要約は使わない。 */
export function applyAgentSummaries(events, summaries) {
  return events.map((event) => {
    const entry = summaries.get(event.id);
    if (!entry || entry.problems.length > 0 || entry.summary.sourceFingerprint !== sourceFingerprint(event)) return event;
    return {
      ...event,
      titleJa: entry.summary.titleJa,
      summaryJa: entry.summary.summaryJa,
      ...(entry.summary.audienceJa ? { audienceJa: entry.summary.audienceJa } : {}),
      ...(entry.summary.actionJa ? { actionJa: entry.summary.actionJa } : {}),
      summaryBy: "agent",
    };
  });
}

/** 未生成・古い要約の更新を、重要度の高い順、新しい順に返す。 */
export function pendingItems(events, summaries, { limit = 30, now = new Date(), months = 3 } = {}) {
  const levelRank = { high: 0, notable: 1, normal: 2 };
  const since = new Date(now.getTime() + 9 * 3600_000);
  since.setUTCMonth(since.getUTCMonth() - (months - 1), 1);
  const sinceKey = since.toISOString().slice(0, 10);
  return events
    .filter((event) => levelRank[event.importanceLevel] <= 1 && String(event.publishedAt).slice(0, 10) >= sinceKey)
    .filter((event) => {
      const entry = summaries.get(event.id);
      return !entry || entry.problems.length > 0 || entry.summary.sourceFingerprint !== sourceFingerprint(event);
    })
    .sort((a, b) => levelRank[a.importanceLevel] - levelRank[b.importanceLevel] || String(b.publishedAt).localeCompare(String(a.publishedAt)) || a.id.localeCompare(b.id))
    .slice(0, limit);
}
