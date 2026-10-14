/**
 * ソース単位の取得状態。complete = 1 件以上取得、empty = 取得できたが 0 件（フィードが空、または解析の変化。一覧では注意として残す）、
 * partial = 一部のみ（MRC の totalCount と一致しない等）、failed = 取得失敗。
 * partial / failed が 1 つでもあれば全体を partial とし、サイトと API は「件数が少なくても 0 件とは限らない」と扱う。
 */
export function summarizeCoverage(sourceStatuses) {
  const sources = [...sourceStatuses].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const broken = sources.some((source) => source.status === "partial" || source.status === "failed");
  return { status: sources.length > 0 && !broken ? "complete" : "partial", sources };
}

export function brokenSources(coverage) {
  return (coverage?.sources ?? []).filter((source) => source.status === "partial" || source.status === "failed");
}

/** 件数は毎回揺れるので、変化検出には状態だけを使う。 */
export function coverageStatusKey(coverage) {
  if (!coverage) return "none";
  return JSON.stringify([coverage.status, (coverage.sources ?? []).map((source) => [source.sourceId, source.status])]);
}
