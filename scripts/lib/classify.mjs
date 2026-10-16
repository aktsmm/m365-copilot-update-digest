import fs from "node:fs";

const lc = (value) => String(value ?? "").toLowerCase();

export function loadCategoryConfig(file = new URL("../../config/categories.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const NOISE_PREFIX = /^\s*Microsoft Copilot \(Microsoft 365\)\s*:\s*/i;
const NOISE_PLATFORM = /\s*\[[^\]]*\]\s*$/;

// 先頭の製品名接頭辞と末尾の [Windows、Web] などの提供プラットフォーム表記は分類のノイズになるため除く
function eventTitles(event) {
  return [event.titleEn, event.title].filter(Boolean).map((title) => title.replace(NOISE_PREFIX, "").replace(NOISE_PLATFORM, ""));
}

/** Returns display category ids in config order. An update may belong to several; none falls back to fallbackId. */
export function classifyCategories(event, config) {
  const products = new Set([event.productArea, event.section].filter(Boolean).map(lc));
  const tags = new Set((event.tags || []).map(lc));
  const hits = new Set();

  for (const category of config.categories) {
    if (category.id === config.fallbackId) continue;
    const matched =
      category.products.some((value) => products.has(lc(value))) ||
      category.tags.some((value) => tags.has(lc(value))) ||
      category.titleRegex.some((pattern) => {
        const regex = new RegExp(pattern, "i");
        return eventTitles(event).some((title) => regex.test(title));
      });
    if (matched) hits.add(category.id);
  }

  if (hits.size === 0) hits.add(config.fallbackId);
  const order = config.categories.map((category) => category.id);
  return [...hits].sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

export function importanceLevel(score, config) {
  const levels = [...config.importanceLevels].sort((left, right) => right.minScore - left.minScore);
  return levels.find((level) => Number(score) >= level.minScore)?.id ?? levels.at(-1).id;
}

export function annotateEvent(event, config) {
  return {
    ...event,
    categories: classifyCategories(event, config),
    importanceLevel: importanceLevel(event.importanceScore, config),
  };
}
