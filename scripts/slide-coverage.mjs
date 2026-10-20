import fs from "node:fs";
import path from "node:path";
import { SLIDES_DIR } from "./lib/slides.mjs";
import { computeCoverage, coverageProblems } from "./lib/slide-coverage.mjs";
import { escalatedIds, loadRetry } from "./lib/slide-retry.mjs";

// node scripts/slide-coverage.mjs           充足率を JSON で出す
// node scripts/slide-coverage.mjs --check   上限を超えていたら（enforceFrom 以降）失敗にする
const root = process.cwd();
const events = [];
for (const name of fs.readdirSync(path.join(root, "data", "events"))) {
  const log = JSON.parse(fs.readFileSync(path.join(root, "data", "events", name), "utf8"));
  events.push(...(log.events || []).map((event) => ({ id: event.id, publishedAt: event.publishedAt })));
}
const existing = fs.readdirSync(path.join(root, SLIDES_DIR)).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
const coverage = computeCoverage(events, existing, { heldIds: escalatedIds(loadRetry(root)) });
const config = JSON.parse(fs.readFileSync(path.join(root, "config", "slide-coverage.json"), "utf8"));
const { enforced, problems } = coverageProblems(coverage, config);

console.log(JSON.stringify({ coverage, enforced, problems }, null, 2));
if (process.argv.includes("--check") && problems.length > 0) {
  if (enforced) {
    console.error(`slide coverage check failed: ${problems.join(" / ")}`);
    process.exit(1);
  }
  console.error(`slide coverage warning (not enforced until ${config.enforceFrom}): ${problems.join(" / ")}`);
}
