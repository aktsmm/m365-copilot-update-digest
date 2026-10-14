import { jstDate } from "./slides.mjs";

export const API_VERSION = "v1";
const BASE = `api/${API_VERSION}`;

const LICENSE = {
  name: "CC BY-NC-SA 4.0",
  spdx: "CC-BY-NC-SA-4.0",
  url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  author: "yamapan (aktsmm)",
  excludes: "Microsoft Learn・Tech Community・Microsoft 365 Roadmap の原文は Microsoft に帰属します",
};

function addDays(date, days) {
  const time = Date.parse(`${date}T00:00:00Z`) + days * 86400000;
  return new Date(time).toISOString().slice(0, 10);
}

const byNewest = (left, right) =>
  right.publishedJst.localeCompare(left.publishedJst) || left.key.localeCompare(right.key);

export function publicItem(event, slideKeys = new Set()) {
  return {
    key: event.id,
    title: { ja: event.titleJa || event.title, en: event.titleEn || event.title },
    summary: { ja: event.summaryJa || event.summary || "", en: event.summaryEn || event.summary || "" },
    publishedJst: jstDate(event.publishedAt),
    stage: event.releaseStage || null,
    productArea: event.productArea,
    sourceId: event.sourceId,
    sourceName: event.sourceName,
    sourceFamily: event.sourceFamily,
    categories: event.categories,
    importance: { level: event.importanceLevel, score: event.importanceScore, reasonJa: event.importanceReason || null },
    roleTags: event.roleTags || [],
    roadmapIds: event.roadmapIds || [],
    tags: event.tags || [],
    related: (event.relatedDocuments || []).map((document) => ({ title: document.title, url: document.url })),
    relatedDocumentStatus: event.relatedDocumentStatus || null,
    urls: {
      self: `${BASE}/updates/${event.id}.json`,
      source: event.url,
      ...(slideKeys.has(event.id) ? { slide: `slides/${event.id}.json`, slidePdfEncrypted: `pdf/${event.id}.pdf.enc` } : {}),
    },
  };
}

/** 静的 JSON API。純粋関数: 同じ入力なら同じファイルを返す。 */
export function buildApi(events, { snapshotAt, categoryConfig, coverage, slideKeys = new Set() }) {
  const items = events.map((event) => publicItem(event, slideKeys)).sort(byNewest);
  const files = [];
  const months = new Map();
  for (const item of items) {
    const month = item.publishedJst.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(item);
  }
  const monthKeys = [...months.keys()].sort().reverse();
  const categories = categoryConfig.categories.map(({ id, label, labelEn }) => ({ id, label, labelEn }));

  files.push({
    path: `${BASE}/index.json`,
    body: {
      schema: 1,
      apiVersion: API_VERSION,
      snapshotAt: snapshotAt ?? null,
      itemCount: items.length,
      slideCount: slideKeys.size,
      license: LICENSE,
      coverage: coverage ?? null,
      notes: [
        "静的 JSON です。検索 API はないため、月別ファイルを取得してクライアント側で絞り込んでください。",
        "日付は JST の暦日です。",
        "coverage.status が complete 以外のときは、ソースの取得に欠けがある可能性があり、件数が少なくても 0 件とは限りません。",
        "スライド PDF は暗号化して公開しています（data/slides.json の pdfGate）。スライド JSON は slides/{key}.json から取得できます。",
      ],
      categories,
      importanceLevels: categoryConfig.importanceLevels.map(({ id, label, labelEn, minScore }) => ({ id, label, labelEn, minScore })),
      months: monthKeys.map((month) => ({ month, count: months.get(month).length, url: `${BASE}/months/${month}.json` })),
      endpoints: {
        latest: `${BASE}/latest.json`,
        month: `${BASE}/months/{YYYY-MM}.json`,
        update: `${BASE}/updates/{key}.json`,
        category: `${BASE}/categories/{category}.json`,
        slide: "slides/{key}.json",
        slideIndex: "data/slides.json",
      },
    },
  });

  for (const month of monthKeys) {
    const list = months.get(month);
    files.push({ path: `${BASE}/months/${month}.json`, body: { schema: 1, month, count: list.length, items: list } });
  }

  for (const item of items) {
    files.push({ path: `${BASE}/updates/${item.key}.json`, body: { schema: 1, item } });
  }

  for (const category of categories) {
    const list = items.filter((item) => item.categories.includes(category.id));
    files.push({
      path: `${BASE}/categories/${category.id}.json`,
      body: {
        schema: 1,
        category,
        count: list.length,
        items: list.map((item) => ({
          key: item.key,
          title: item.title.ja,
          publishedJst: item.publishedJst,
          importance: item.importance.level,
          url: item.urls.self,
        })),
      },
    });
  }

  const end = snapshotAt ? jstDate(snapshotAt) : null;
  const start = end ? addDays(end, -29) : null;
  const latest = end ? items.filter((item) => item.publishedJst >= start && item.publishedJst <= end) : [];
  files.push({
    path: `${BASE}/latest.json`,
    body: { schema: 1, period: end ? { start, end } : null, count: latest.length, items: latest },
  });

  return files.sort((left, right) => left.path.localeCompare(right.path));
}
