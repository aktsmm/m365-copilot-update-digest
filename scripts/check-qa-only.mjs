import fs from "node:fs";
import { execFileSync } from "node:child_process";

// qa だけを変更した PR であることを確認する。qa 以外が元（HEAD）と違えば失敗にする。
const id = process.argv[2];
if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
  console.error("usage: node scripts/check-qa-only.mjs <slide-id>");
  process.exit(2);
}
const file = `data/slides/${id}.json`;
const strip = (deck) => {
  const copy = structuredClone(deck);
  for (const slide of copy.slides ?? []) delete slide.qa;
  return copy;
};
const before = JSON.parse(execFileSync("git", ["show", `HEAD:${file}`], { encoding: "utf8" }));
const after = JSON.parse(fs.readFileSync(file, "utf8"));
if (JSON.stringify(strip(before)) !== JSON.stringify(strip(after))) {
  console.error(`${file}: fields other than qa changed`);
  process.exit(1);
}
if (!(after.slides?.[0]?.qa?.length >= 1)) {
  console.error(`${file}: qa is missing`);
  process.exit(1);
}
console.log(`${file}: only qa changed (${after.slides[0].qa.length} item(s))`);
