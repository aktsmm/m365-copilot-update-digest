import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { fitSlide, documentHtml } from "./lib/slide-html.mjs";
import { SLIDES_DIR, loadSlides } from "./lib/slides.mjs";

// 指定した更新のスライドを PDF にして描画を確認する（自動マージ前の検査、エージェント実行後の成果物）。
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const root = path.resolve(flag("root", "."));
const ids = (flag("ids", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const outDir = path.resolve(flag("out", "dist-pdf"));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

const entries = loadSlides(root).filter((entry) => ids.length === 0 || ids.includes(entry.key));
if (entries.length === 0) throw new Error(`no slides found in ${SLIDES_DIR}`);
const invalid = entries.filter((entry) => entry.problems.length);
if (invalid.length) throw new Error(`invalid slide(s): ${invalid.map((entry) => entry.key).join(", ")}`);
const executablePath = findChrome();
if (!executablePath) throw new Error("no Chrome/Chromium found; set CHROME_PATH");

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const pages = [];
  const report = {};
  for (const entry of entries) {
    const fit = await fitSlide(page, entry.slide);
    report[entry.key] = fit.report;
    pages.push(...fit.pages);
  }
  await page.setContent(documentHtml(pages));
  await page.evaluate(() => document.fonts.ready);
  const stem = entries.length === 1 ? entries[0].key : "digest";
  await page.pdf({ path: path.join(outDir, `${stem}.pdf`), width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
  if (process.env.RENDER_PNG) {
    const total = await page.evaluate(() => document.querySelectorAll(".page").length);
    for (let i = 0; i < total; i += 1) {
      await page.evaluate((n) => document.querySelectorAll(".page").forEach((p, j) => (p.style.display = j === n ? "" : "none")), i);
      await page.screenshot({ path: path.join(outDir, `${stem}-p${i + 1}.png`), clip: { x: 0, y: 0, width: 1280, height: 720 } });
    }
  }
  fs.writeFileSync(path.join(outDir, "render-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
  const stuck = Object.entries(report).filter(([, r]) => r.overflow > 0);
  if (stuck.length) throw new Error(`content still overflows at the minimum font size: ${stuck.map(([key]) => key).join(", ")}`);
} finally {
  await browser.close();
}
