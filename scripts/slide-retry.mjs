import fs from "node:fs";
import path from "node:path";
import { SLIDES_DIR } from "./lib/slides.mjs";
import { escalatedIds, loadRetry, pruneSolved, recordFailure, saveRetry } from "./lib/slide-retry.mjs";

// node scripts/slide-retry.mjs record <id>   （失敗の理由は環境変数 RETRY_MESSAGE）
// node scripts/slide-retry.mjs prune         （スライドができた更新の記録を消す）
// node scripts/slide-retry.mjs escalated     （3 回続けて失敗して保留中の ID を 1 行ずつ出す）
// node scripts/slide-retry.mjs reset <id>    （保守エージェントが原因を直したあと、再試行できるように記録を消す）
const [command, id] = process.argv.slice(2);
const root = process.cwd();
const existing = () => {
  try {
    return fs.readdirSync(path.join(root, SLIDES_DIR)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  } catch {
    return [];
  }
};

let state = loadRetry(root);
if (command === "record") {
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) throw new Error("record needs an update id");
  state = recordFailure(state, id, process.env.RETRY_MESSAGE);
  saveRetry(pruneSolved(state, existing()), root);
  console.log(`recorded failure for ${id}: attempts=${state[id].attempts}`);
} else if (command === "prune") {
  const before = Object.keys(state).length;
  state = pruneSolved(state, existing());
  if (Object.keys(state).length !== before) saveRetry(state, root);
  console.log(`pruned ${before - Object.keys(state).length} solved entr${before - Object.keys(state).length === 1 ? "y" : "ies"}`);
} else if (command === "escalated") {
  for (const escalatedId of escalatedIds(state)) console.log(escalatedId);
} else if (command === "reset") {
  if (!id || !state[id]) throw new Error("reset needs an id that is recorded");
  delete state[id];
  saveRetry(state, root);
  console.log(`reset ${id}`);
} else {
  console.error("usage: slide-retry.mjs record <id> | prune | escalated | reset <id>");
  process.exit(2);
}
