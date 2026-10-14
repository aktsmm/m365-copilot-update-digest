import fs from "node:fs";

const lc = (value) => String(value ?? "").toLowerCase();

export function loadCategoryConfig(file = new URL("../../config/categories.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function eventTitles(event) {
  return [event.titleEn, event.title].filter(Boolean);
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
