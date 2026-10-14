import fs from "node:fs";
import path from "node:path";
import { SLIDES_DIR, loadSlides } from "./lib/slides.mjs";

// data/slides/*.json を検証する（1 ファイル = 1 スライドの封筒）。問題があれば終了コード 1。
const root = path.resolve(process.argv[2] ?? ".");
const dir = path.join(root, SLIDES_DIR);
if (!fs.existsSync(dir)) {
  console.log(`no ${SLIDES_DIR}; nothing to validate`);
  process.exit(0);
}
let bad = 0;
const slides = loadSlides(root);
for (const entry of slides) {
  if (entry.problems.length) {
    bad += entry.problems.length;
    console.error(`✗ ${entry.key}.json`);
    for (const problem of entry.problems.slice(0, 40)) console.error(`   [${problem.slide}] ${problem.message}`);
  } else {
    console.log(`✓ ${entry.key}.json`);
  }
}
if (bad) {
  console.error(`slide validation failed: ${bad} problem(s)`);
  process.exit(1);
}
console.log(`slide validation ok: ${slides.length} file(s)`);
