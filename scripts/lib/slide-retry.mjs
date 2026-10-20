import fs from "node:fs";
import path from "node:path";
import { stableStringify } from "./slides.mjs";

// スライド生成の失敗を更新ごとに記録する。次の再試行でエージェントに渡し（同じ失敗を避けさせる）、
// 3 回続けて失敗したら保留（escalated）にして、保守エージェントが原因を調べる。
export const RETRY_FILE = "data/slide-retry.json";
export const ESCALATE_AT = 3;
const MAX_ERRORS = 3;
const MAX_LENGTH = 400;

export function loadRetry(root = process.cwd()) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(root, RETRY_FILE), "utf8"));
    return state && typeof state === "object" && !Array.isArray(state) ? state : {};
  } catch {
    return {};
  }
}

export function saveRetry(state, root = process.cwd()) {
  const file = path.join(root, RETRY_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${stableStringify(state)}\n`, "utf8");
}

export function recordFailure(state, id, message, now = new Date()) {
  const previous = state[id] ?? { attempts: 0, errors: [] };
  const text = String(message ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH) || "validation failed";
  return {
    ...state,
    [id]: {
      attempts: previous.attempts + 1,
      lastAt: now.toISOString(),
      errors: [...previous.errors, text].slice(-MAX_ERRORS),
    },
  };
}

/** すでにスライドがある更新の記録は、もう要らない。 */
export function pruneSolved(state, existingIds) {
  const existing = new Set(existingIds);
  return Object.fromEntries(Object.entries(state).filter(([id]) => !existing.has(id)));
}

export function escalatedIds(state) {
  return Object.entries(state)
    .filter(([, entry]) => entry.attempts >= ESCALATE_AT)
    .map(([id]) => id)
    .sort();
}

export function previousFailures(state, id) {
  return state[id]?.errors ?? [];
}
