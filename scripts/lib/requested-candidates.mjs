import { pendingDocumentEvents } from "./related-documents.mjs";

/** 自動化 Issue の本文（```json の候補一覧）から、調査を依頼された更新を取り出す。 */
export function parseRequestedCandidates(body) {
  const match = String(body || "").match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!match) return [];
  try {
    const list = JSON.parse(match[1]);
    return Array.isArray(list) ? list.filter((item) => item && typeof item.id === "string") : [];
  } catch {
    return [];
  }
}

/** PR 本文の「Fixes #123」などから、紐づく Issue 番号を取り出す。 */
export function linkedIssueNumber(body) {
  const match = String(body || "").match(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

/**
 * 依頼された更新のうち、キャッシュ上でまだ調査済みになっていないもの。
 * エージェントが別の候補を調べて PR を出した場合、依頼された更新はここに残る。
 */
export function unresolvedCandidates(requested, events, cache, now = new Date().toISOString()) {
  const wanted = new Set(requested.map((item) => item.id));
  return pendingDocumentEvents(events, cache, Math.max(events.length, 1), now)
    .filter((item) => wanted.has(item.id))
    .map((item) => item.id);
}
