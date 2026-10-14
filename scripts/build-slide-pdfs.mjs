import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadCategoryConfig } from "./lib/classify.mjs";
import { createGate, encryptBuffer } from "./lib/pdf-crypto.mjs";
import { documentHtml, slideHtml } from "./lib/slide-html.mjs";
import { stableStringify, validateSlide } from "./lib/slides.mjs";

// site/slides/<key>.json を 1 更新 1 ページの PDF にし、PDF_PASSWORD で暗号化して site/pdf/<key>.pdf.enc に出力する。
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
// 最新の 1 件は、パスワードなしで試せる無料サンプルとして暗号化せずに公開する
const newestKey = files
  .map((file) => JSON.parse(fs.readFileSync(path.join(slidesDir, file), "utf8")))
  .sort((a, b) => b.meta.publishedJst.localeCompare(a.meta.publishedJst) || a.key.localeCompare(b.key))[0]?.key;
const entries = [];
let gate = null;

if (files.length > 0 && !password) {
  console.warn("::warning::PDF_PASSWORD is not set; slide PDFs are not published");
} else if (files.length > 0) {
  const executablePath = findChrome();
  if (!executablePath) throw new Error("no Chrome/Chromium found; set CHROME_PATH");
  const categoryConfig = loadCategoryConfig();
  const created = createGate(password);
  gate = created.gate;
  fs.mkdirSync(pdfDir, { recursive: true });

  const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    // まとめ PDF の表紙（暗号化なし）。データ時点は取得時刻の JST 日付。
    const generated = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    await page.setContent(
      documentHtml(`<section class="page" style="justify-content:center;padding:0 96px;background:linear-gradient(120deg,#fff 0 55%,#eaf3fc 55%)">
  <div style="font-size:22px;font-weight:600;color:#0078d4;letter-spacing:.06em;margin-bottom:12px">非公式ダイジェスト</div>
  <div style="font-size:64px;font-weight:700;color:#243a5e;line-height:1.2;margin-bottom:28px">M365 Copilot<br>Update Digest</div>
  <div style="font-size:26px;color:#0078d4;font-weight:600">${generated} 時点（重要・注目の更新）</div>
  <div style="font-size:15px;color:#6b778a;margin-top:48px;line-height:1.7">Copyright (c) 2026 yamapan (@aktsmm) / CC BY-NC-SA 4.0<br>出典: Microsoft Learn・Tech Community・Microsoft 365 Roadmap。原文は Microsoft に帰属します。<br>日本語の題名・要約には機械翻訳や AI 生成が含まれます。必ず原文をご確認ください。</div>
</section>`),
    );
    await page.evaluate(() => document.fonts.ready);
    fs.writeFileSync(path.join(pdfDir, "cover.pdf"), await page.pdf({ width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true }));
    await page.setContent(
      documentHtml(`<section class="page" style="justify-content:center;padding:0 96px">
  <div style="font-size:30px;font-weight:700;color:#243a5e;margin-bottom:20px">ご利用にあたって</div>
  <div style="font-size:18px;line-height:1.9;color:#3d4a5c">この資料は M365 Copilot Update Digest（非公式）が公開情報から自動生成したものです。<br>日本語の題名・要約には機械翻訳や AI 生成が含まれ、誤りを含む場合があります。必ず原文をご確認ください。<br>Microsoft Learn・Tech Community・Microsoft 365 Roadmap の原文は Microsoft に帰属します。<br>Copyright (c) 2026 yamapan (@aktsmm) / CC BY-NC-SA 4.0<br>https://github.com/aktsmm/m365-copilot-update-digest</div>
</section>`),
    );
    fs.writeFileSync(path.join(pdfDir, "end.pdf"), await page.pdf({ width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true }));
    for (const file of files) {
      try {
        const slide = JSON.parse(fs.readFileSync(path.join(slidesDir, file), "utf8"));
        const problems = validateSlide(slide);
        if (problems.length > 0) throw new Error(problems[0]);
        await page.setContent(documentHtml(slideHtml(slide, categoryConfig)));
        await page.evaluate(() => document.fonts.ready);
        const overflow = await page.evaluate(() => {
          const section = document.querySelector(".page");
          return section.scrollHeight - section.clientHeight;
        });
        if (overflow > 0) throw new Error(`content overflows by ${overflow}px`);
        const pdf = await page.pdf({ width: "1280px", height: "720px", printBackground: true, preferCSSPageSize: true });
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
  `${stableStringify({ schema: 1, pdfGate: gate, slides: entries })}\n`,
  "utf8",
);
console.log(`slide pdfs: ${entries.length}${gate ? "" : " (no password, none published)"}`);
