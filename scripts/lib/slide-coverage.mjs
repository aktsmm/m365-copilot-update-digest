import { jstDate, retentionStart } from "./slides.mjs";

// スライドの充足率。直近 30 日・90 日（日付は JST）と、スライド対象の 3 か月のうち、本物のスライドがある割合を数える。
// 簡易ページ（スライドがない更新の代わり）で出力の件数は揃うが、本物のスライドが作れているかはここで見張る。
export const HOURS_BEFORE_OVERDUE = 48;

const daysAgo = (now, days) => jstDate(new Date(now.getTime() - days * 86400000).toISOString());

export function computeCoverage(events, existingIds, { now = new Date(), months = 3, heldIds = [] } = {}) {
  const existing = new Set(existingIds);
  const held = new Set(heldIds);
  const since = { d30: daysAgo(now, 30), d90: daysAgo(now, 90), window: retentionStart(now, months) };
  const overdueBefore = now.getTime() - HOURS_BEFORE_OVERDUE * 3600_000;
  const count = (from) => {
    const inRange = events.filter((event) => (jstDate(event.publishedAt) ?? "") >= from);
    const withSlide = inRange.filter((event) => existing.has(event.id)).length;
    return { total: inRange.length, withSlide, ratio: inRange.length ? withSlide / inRange.length : 1 };
  };
  const inWindow = events.filter((event) => (jstDate(event.publishedAt) ?? "") >= since.window);
  const missing = inWindow.filter((event) => !existing.has(event.id));
  const overdue = missing.filter((event) => Date.parse(event.publishedAt) < overdueBefore);
  return {
    d30: count(since.d30),
    d90: count(since.d90),
    window: count(since.window),
    missing: missing.length,
    overdue: overdue.filter((event) => !held.has(event.id)).length,
    held: missing.filter((event) => held.has(event.id)).length,
  };
}

/** 失敗にするかの判定。enforceFrom より前（追いつき中）は警告だけで、失敗にしない。 */
export function coverageProblems(coverage, config, now = new Date()) {
  const problems = [];
  const enforced = now.toISOString().slice(0, 10) >= (config.enforceFrom ?? "9999-12-31");
  if (coverage.overdue > (config.maxOverdue ?? 10)) problems.push(`${HOURS_BEFORE_OVERDUE} 時間より前に出た更新のうち、本物のスライドがないものが ${coverage.overdue} 件（上限 ${config.maxOverdue ?? 10} 件）`);
  if (coverage.held > (config.maxHeld ?? 5)) problems.push(`失敗が続いて保留中の更新が ${coverage.held} 件（上限 ${config.maxHeld ?? 5} 件）`);
  return { enforced, problems };
}
