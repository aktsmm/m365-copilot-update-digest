import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import * as cheerio from "cheerio";

const script = await fs.readFile(new URL("../public/assets/search.js", import.meta.url), "utf8");
const entry = {
  id: "fixture", titleJa: "Example update", titleEn: "Example update",
  summaryJa: "Summary", summaryEn: "Summary",
  sourceName: "Official", publishedAt: "2026-10-14",
  url: "https://www.microsoft.com/microsoft-365/roadmap?id=123",
  detailPath: "daily/2026-10-14/#update-fixture",
  relatedDocuments: [{
    title: 'Guide <script>alert("bad")</script>',
    url: "https://learn.microsoft.com/ja-jp/copilot/example",
  }],
};

async function searchResult(locale, basePath, data = entry) {
  const input = { value: "Example", addEventListener() {} };
  const results = { innerHTML: "" };
  const status = {};
  const root = {
    dataset: { searchLimit: "50" },
    querySelector: (selector) => ({
      "[data-search-input]": input,
      "[data-search-results]": results,
      "[data-search-status]": status,
    })[selector],
  };
  vm.runInNewContext(script, {
    URL,
    document: {
      body: { dataset: { locale, searchBase: basePath, searchIndex: "search-index.json" } },
      querySelector: () => root,
    },
    fetch: async () => ({ json: async () => ({ entries: [data] }) }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  return cheerio.load(results.innerHTML);
}

test("all four search entry points preserve locale and daily fragment", async () => {
  for (const [locale, base, expected] of [
    ["ja", "", "daily/2026-10-14/#update-fixture"],
    ["ja", "../", "../daily/2026-10-14/#update-fixture"],
    ["en", "../", "../en/daily/2026-10-14/#update-fixture"],
    ["en", "../../", "../../en/daily/2026-10-14/#update-fixture"],
  ]) {
    const $ = await searchResult(locale, base);
    assert.equal($("h2 a").attr("href"), expected);
    assert.equal($(".card-links a").last().attr("href"), expected);
    const external = $(".primary-link");
    assert.equal(external.attr("href"), entry.url);
    assert.equal(external.attr("target"), "_blank");
    assert.match(external.attr("rel"), /noopener/);
    assert.equal($(".related-documents a").length, 1);
    assert.equal($("script").length, 0);
    assert.match($(".related-documents a").text(), /<script>/);
  }
});

test("missing and invalid external links do not break daily navigation", async () => {
  const $ = await searchResult("ja", "", {
    ...entry, url: "javascript:alert(1)", relatedDocuments: [],
  });
  assert.equal($(".primary-link").length, 0);
  assert.equal($(".related-documents").length, 0);
  assert.equal($(".card-links a").length, 1);
  const legacy = { ...entry };
  delete legacy.url;
  delete legacy.relatedDocuments;
  const old = await searchResult("en", "../", legacy);
  assert.equal(old("article").length, 1);
});

test("supplementary documents are explicitly labeled in search results", async () => {
  const $ = await searchResult("ja", "", {
    ...entry,
    relatedDocuments: [{
      title: "GitHub integration", url: "https://docs.github.com/ja/copilot/how-tos/example",
      supplemental: true,
    }],
  });
  assert.equal($(".document-supplemental").text(), "補足");
});

test("missing documentation distinguishes pending research, no verified match and retrieval errors", async () => {
  const states = [
    ["pending", "未調査"],
    ["not-found", "まだ確認できていません"],
    ["error", "取得に失敗"],
  ];
  for (const [relatedDocumentStatus, expected] of states) {
    const $ = await searchResult("ja", "", {
      ...entry, relatedDocuments: [], relatedDocumentStatus,
    });
    assert.ok($(".document-status").text().includes(expected));
    assert.equal($(".related-documents a").length, 0);
  }
});

test("generated search data resolves to exactly one card on each locale's daily page", async () => {
  execFileSync(process.execPath, ["scripts/build-pages.mjs"], { stdio: "pipe" });
  const payload = JSON.parse(await fs.readFile(new URL("../site/search-index.json", import.meta.url), "utf8"));
  for (const searchPage of ["index.html", "search/index.html", "en/index.html", "en/search/index.html"]) {
    const page = cheerio.load(await fs.readFile(new URL(`../site/${searchPage}`, import.meta.url), "utf8"));
    const indexUrl = new URL(page("body").attr("data-search-index"), `https://example.com/${searchPage}`);
    assert.equal(indexUrl.searchParams.get("v"), payload.generatedAt);
  }
  assert.ok(payload.entries.length > 0);
  for (const item of payload.entries) {
    assert.ok(["verified", "pending", "not-found", "error"].includes(item.relatedDocumentStatus));
    assert.equal(item.relatedDocumentStatus === "verified", item.relatedDocuments.length > 0);
  }
  assert.equal(new Set(payload.entries.map((item) => item.detailPath)).size, payload.entries.length);
  const sample = payload.entries[0];
  const reportedIds = [
    "m365-roadmap-rss-bf4d2a67e28222e9",
    "m365-roadmap-rss-d4c68540c4ece67f",
    "m365-roadmap-rss-c6055444dd72457b",
    "m365-copilot-release-notes-4142c6e03eedf599",
  ];
  const reportedPage = cheerio.load(await fs.readFile(new URL("../site/daily/2026-10-06/index.html", import.meta.url), "utf8"));
  for (const id of reportedIds) {
    const card = reportedPage(`[id="update-${id}"]`);
    assert.ok(card.find(".related-documents a").length >= 1, `Missing reported documentation: ${id}`);
    assert.ok(payload.entries.find((item) => item.id === id).relatedDocuments.length >= 1);
  }
  assert.ok(sample.url.startsWith("https://"));
  assert.match(sample.detailPath, /\/#update-/);
  for (const locale of ["", "en/"]) {
    const [dailyPath, fragment] = sample.detailPath.split("#");
    const html = await fs.readFile(new URL(`../site/${locale}${dailyPath}index.html`, import.meta.url), "utf8");
    const $ = cheerio.load(html);
    assert.equal($(`[id="${decodeURIComponent(fragment)}"]`).length, 1);
    const ids = $("[id]").map((_, element) => $(element).attr("id")).get();
    assert.equal(new Set(ids).size, ids.length);
  }
});
