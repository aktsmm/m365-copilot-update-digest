import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// ビルドしたサイトの内部リンク・アセット（href / src）が、すべて site/ 内の実ファイルに解決することを確認する。
// 欠けたアセットは本番でコンソールの 404 になる。外部 URL・data:・mailto:・ページ内リンク（#）は対象外。
const SITE = "site";

function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "raw") continue;
      out.push(...htmlFiles(full));
    } else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function resolves(from, ref) {
  const clean = decodeURIComponent(ref.split("#")[0].split("?")[0]);
  if (!clean) return true;
  const target = path.resolve(path.dirname(from), clean);
  if (!target.startsWith(path.resolve(SITE))) return false;
  if (fs.existsSync(target)) return !fs.statSync(target).isDirectory() || fs.existsSync(path.join(target, "index.html"));
  return false;
}

test("built site has no broken internal links or assets", { timeout: 300_000 }, () => {
  if (!fs.existsSync(path.join(SITE, "index.html"))) execFileSync("node", ["scripts/build-pages.mjs"], { stdio: "ignore" });
  const broken = [];
  let checked = 0;
  for (const file of htmlFiles(SITE)) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const ref = match[1];
      if (/^(https?:|mailto:|data:|#|\/\/|javascript:)/.test(ref)) continue;
      checked += 1;
      if (!resolves(file, ref)) broken.push(`${path.relative(SITE, file)} -> ${ref}`);
    }
  }
  assert.ok(checked > 0, "no internal references were found");
  assert.deepEqual([...new Set(broken)].slice(0, 20), []);
});

test("the page icon is inline, so no /favicon.ico request is made", () => {
  const html = fs.readFileSync(path.join(SITE, "index.html"), "utf8");
  assert.match(html, /<link rel="icon" href="data:/);
});
