import {
  documentFingerprint,
  enrichDocumentCache,
  matchingRecord,
  normalizeDocuments,
  withRelatedDocuments,
} from "./related-documents.mjs";
import { enrichLearnDocuments } from "./learn-mcp.mjs";

export function featureKey(event) {
  return JSON.stringify([
    event.productArea, event.titleEn || event.title,
    event.url, event.summaryEn || event.summary,
  ]);
}

export function missingFeatureGroups(events, cache) {
  const groups = new Map();
  for (const event of [...events].sort((a, b) =>
    String(b.publishedAt).localeCompare(String(a.publishedAt)) ||
    (b.importanceScore || 0) - (a.importanceScore || 0) || a.id.localeCompare(b.id))) {
    if (withRelatedDocuments(event, cache).relatedDocuments?.length) continue;
    const key = featureKey(event);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return [...groups.values()];
}

export function coverageSummary(events, cache) {
  const summary = { total: events.length, withDocuments: 0, notFound: 0, errors: 0, pending: 0 };
  for (const event of events) {
    if (withRelatedDocuments(event, cache).relatedDocuments?.length) {
      summary.withDocuments += 1;
    } else {
      const record = matchingRecord(event, cache);
      if (!record?.mcpStatus) summary.pending += 1;
      else if (record.mcpStatus === "error") summary.errors += 1;
      else summary.notFound += 1;
    }
  }
  return summary;
}

export async function backfillDocumentation(events, cache, {
  findDocuments,
  fetchPage,
  candidates = new Map(),
  maxGroups = Number.MAX_SAFE_INTEGER,
  checkpoint = async () => {},
  onProgress = () => {},
  onWarning = (message) => console.warn(message),
  now = () => new Date().toISOString(),
} = {}) {
  const retryDue = (record) => record?.mcpRetryAfter &&
    Date.parse(record.mcpRetryAfter) <= Date.parse(now());
  const known = new Map();
  for (const event of events) {
    const record = matchingRecord(event, cache);
    if (record && (record.documents.length || (record.mcpStatus && !retryDue(record)))) {
      known.set(featureKey(event), { record, eventId: event.id });
    }
  }
  const groups = missingFeatureGroups(events, cache).filter((group) =>
    group.some((event) => {
      const record = matchingRecord(event, cache);
      return !record?.mcpStatus || retryDue(record);
    }));
  const report = {
    state: "running", targetEvents: groups.flat().length, targetGroups: groups.length,
    processedGroups: 0, reusedEvents: 0, stoppedReason: null,
  };
  for (const group of groups) {
    if (report.processedGroups >= maxGroups) break;
    const event = group[0];
    let record = matchingRecord(event, cache);
    let sourceId = event.id;
    if (known.has(featureKey(event))) {
      const previous = known.get(featureKey(event));
      record = previous.record;
      sourceId = previous.eventId;
    } else {
      await enrichDocumentCache([event], cache, {
        limit: 1, candidates, fetchPage, now: now(), onWarning,
      });
      await enrichLearnDocuments([event], cache, {
        limit: 1, findDocuments, fetchPage, now: now(), onWarning,
      });
      record = matchingRecord(event, cache);
    }
    if (!record) throw new Error(`Backfill did not record a result for ${event.id}`);
    for (const sibling of group) {
      cache[sibling.id] = {
        ...record,
        inputFingerprint: documentFingerprint(sibling),
        documents: normalizeDocuments(record.documents, sibling.url),
        ...(sibling.id !== sourceId ? { reusedFrom: sourceId } : {}),
      };
      if (sibling.id !== sourceId) report.reusedEvents += 1;
    }
    known.set(featureKey(event), { record, eventId: sourceId });
    report.processedGroups += 1;
    if (record.error && /429|too many requests|throttl|quota|503|timed? out|timeout|fetch failed|ECONN/i.test(record.error)) {
      report.stoppedReason = record.error;
      report.state = "paused";
    }
    report.coverage = coverageSummary(events, cache);
    if (report.processedGroups % 5 === 0 || report.stoppedReason) await checkpoint(report);
    onProgress(report, event);
    if (report.stoppedReason) break;
  }
  report.coverage = coverageSummary(events, cache);
  if (!report.stoppedReason) report.state = report.coverage.pending ? "paused" : "completed";
  await checkpoint(report);
  return report;
}
