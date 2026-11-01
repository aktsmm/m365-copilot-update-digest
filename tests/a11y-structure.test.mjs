import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// キーボード・スクリーンリーダー向けの最低限の構造（本文ランドマーク、スキップリンク、件数の読み上げ）を保つ。
const source = fs.readFileSync("scripts/build-pages.mjs", "utf8");

test("every page has a main landmark and a skip link in both languages", () => {
  assert.match(source, /<main id="main"/);
  assert.match(source, /<a class="skip-link" href="#main">/);
  assert.equal((source.match(/skipToContent:/g) || []).length, 2);
});

test("filter result count and export status are announced to screen readers", () => {
  assert.match(source, /data-explorer-period role="status" aria-live="polite"/);
  assert.match(source, /data-download-status role="status" aria-live="polite"/);
});

test("the skip link has styles that show it on focus", () => {
  const css = fs.readFileSync("public/assets/styles.css", "utf8");
  assert.match(css, /\.skip-link:focus/);
});