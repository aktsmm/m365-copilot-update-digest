import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { createGate, encryptBuffer } from "./lib/pdf-crypto.mjs";
import { documentHtml, fitSlide } from "./lib/slide-html.mjs";
import { orderSlides, stableStringify, validateDeck } from "./lib/slides.mjs";

// site/slides/<key>.json を 1 更新 1〜2 ページの PDF にし、PDF_PASSWORD で暗号化して site/pdf/<key>.pdf.enc に出力する。
// PDF_PASSWORD が無いときは PDF を公開しない（スライド JSON と API はそのまま公開される）。
const siteDir = path.resolve(process.env.SITE_DIR ?? "site");
const slidesDir = path.join(siteDir, "slides");
const pdfDir = path.join(siteDir, "pdf");
const password = process.env.PDF_PASSWORD ?? "";

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

const files = fs.existsSync(slidesDir) ? fs.readdirSync(slidesDir).filter((name) => name.endsWith(".json")).sort() : [];
const decks = files.map((file) => ({ file, deck: JSON.parse(fs.readFileSync(path.join(slidesDir, file), "utf8")) }));
// 最新の 1 件は、パスワードなしで試せる無料サンプルとして暗号化せずに公開する
const newestKey = decks
  .map(({ deck }) => deck.slides[0])
  .sort((a, b) => b.meta.publishedJst.localeCompare(a.meta.publishedJst) || a.key.localeCompare(b.key))[0]?.key;
const entries = [];
let gate = null;

if (decks.length > 0 && !password) {
  console.warn("::warning::PDF_PASSWORD is not set; slide PDFs are not published");
} else if (decks.length > 0) {
  const executablePath = findChrome();
  if (!executablePath) throw new Error("no Chrome/Chromium found; set CHROME_PATH");
  const created = createGate(password);
  gate = created.gate;
  fs.mkdirSync(pdfDir, { recursive: true });

  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const render = async (html) => {
      await page.setContent(documentHtml(html));
      await page.evaluate(() => document.fonts.ready);
      return page.pdf({ width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
    };
    // まとめ PDF の表紙と終了ページ（暗号化なし）
    const generated = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(pdfDir, "cover.pdf"),
      await render([
        `<section class="page cover"><div class="cv-bar"></div><div class="cv-body"><div class="cv-eyebrow">Microsoft 365 Copilot</div><h1>M365 Copilot<br>Update Digest</h1><div class="cv-period">${generated} 時点（重要・注目の更新）</div></div><div class="cv-foot"><span>非公式ダイジェスト ／ Copyright (c) 2026 yamapan (@aktsmm) ／ CC BY-NC-SA 4.0</span><span>出典: Microsoft Learn ／ Tech Community ／ Microsoft 365 Roadmap</span></div></section>`,
      ]),
    );
    fs.writeFileSync(
      path.join(pdfDir, "end.pdf"),
      await render([
        `<section class="page end"><div class="cv-bar"></div><div class="en-body"><h1>以上</h1><div class="en-sub">M365 Copilot Update Digest</div><div style="margin-top:36px;font-size:16px;color:#6b778a">https://github.com/aktsmm/m365-copilot-update-digest</div></div><div class="en-foot"><span>Created by yamapan（GitHub: aktsmm）</span><span>GitHub Actions ＋ Agentic Workflow（GitHub Copilot）で生成しています。改善要望は GitHub（Issue）で対応します。</span></div></section>`,
      ]),
    );

    for (const { file, deck } of decks) {
      try {
        const problems = validateDeck(deck);
        if (problems.length > 0) throw new Error(problems[0].message);
        const slide = deck.slides[0];
        const fit = await fitSlide(page, slide);
        if (fit.report.overflow > 0) throw new Error("content still overflows at the minimum font size");
        const pdf = await render(fit.pages);
        const blob = encryptBuffer(created.key, pdf);
        fs.writeFileSync(path.join(pdfDir, `${slide.key}.pdf.enc`), blob);
        const free = slide.key === newestKey;
        if (free) fs.writeFileSync(path.join(pdfDir, `${slide.key}.pdf`), pdf);
        entries.push({
          key: slide.key,
          kind: slide.kind,
          label: slide.label,
          title: slide.title.ja,
          publishedJst: slide.meta.publishedJst,
          categories: slide.meta.categories,
          pages: fit.pages.length,
          bytes: blob.length,
          ...(free ? { free: true } : {}),
        });
      } catch (error) {
        // 1 件の失敗で公開全体を止めない
        console.warn(`::warning::skipping ${file}: ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }
}

fs.mkdirSync(path.join(siteDir, "data"), { recursive: true });
fs.writeFileSync(
  path.join(siteDir, "data", "slides.json"),
  `${stableStringify({ schema: 1, pdfGate: gate, slides: orderSlides(entries) })}\n`,
  "utf8",
);
console.log(`slide pdfs: ${entries.length}${gate ? "" : " (no password, none published)"}`);
