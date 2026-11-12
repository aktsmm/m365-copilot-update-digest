import fs from "node:fs";
import path from "node:path";

// エージェントが書いた列挙値の軽微な取り違え（大文字・前後の空白・よくある別名）を、決定的に直す。
// 直せるのは「意味が一意に決まるもの」だけ。それ以外は検証に落とし、失敗理由を次の生成へ渡す（slide-retry）。
export const ALIASES = {
  changeNature: { benefit: "benefit", positive: "benefit", improvement: "benefit", good: "benefit", neutral: "neutral", info: "neutral", informational: "neutral", none: "neutral", breaking: "breaking", negative: "breaking", removal: "breaking", deprecation: "breaking", "breaking-change": "breaking" },
  required: { yes: "yes", required: "yes", mandatory: "yes", optional: "optional", recommended: "optional", no: "no", none: "no", "not-required": "no", unknown: "unknown" },
  importance: { normal: "normal", low: "normal", notable: "notable", medium: "notable", high: "high", important: "high", critical: "high" },
  priority: { core: "core", primary: "core", main: "core", detail: "detail", secondary: "detail", appendix: "appendix", extra: "appendix" },
  availability: { present: "present", available: "present", "not-stated": "not-stated", notstated: "not-stated", "not-applicable": "not-applicable", na: "not-applicable", "n/a": "not-applicable", unverified: "unverified" },
  verification: { verified: "verified", "source-only": "source-only", sourceonly: "source-only", unverified: "unverified", stale: "stale" },
  assertion: { fact: "fact", inference: "inference", recommendation: "recommendation" },
  origin: { mrc: "mrc", learn: "learn", derived: "derived", editorial: "editorial" },
  kind: { ga: "ga", "generally-available": "ga", preview: "preview", "rolling-out": "rolling-out", rollingout: "rolling-out", "in-development": "in-development", indevelopment: "in-development", retirement: "retirement", retired: "retirement", update: "update" },
};

const norm = (value) => String(value).trim().toLowerCase().replace(/[_\s]+/g, "-");

/** deck（または部分木）の列挙値を直し、直した箇所の一覧を返す。 */
export function repairEnums(node, changes = [], pathParts = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => repairEnums(item, changes, [...pathParts, i]));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const table = ALIASES[key];
      if (table && typeof value === "string") {
        const fixed = table[norm(value)] ?? table[norm(value).replace(/-/g, "")];
        if (fixed && fixed !== value) {
          node[key] = fixed;
          changes.push({ path: [...pathParts, key].join("/"), from: value, to: fixed });
        }
      } else {
        repairEnums(value, changes, [...pathParts, key]);
      }
    }
  }
  return changes;
}

/** ファイルを読み、直せたら書き戻す。戻り値は直した箇所の一覧。 */
export function repairFile(file) {
  const deck = JSON.parse(fs.readFileSync(file, "utf8"));
  const changes = repairEnums(deck);
  if (changes.length) fs.writeFileSync(file, `${JSON.stringify(deck, null, 2)}\n`);
  return changes;
}

export function slidePath(id, root = process.cwd()) {
  return path.join(root, "data/slides", `${id}.json`);
}