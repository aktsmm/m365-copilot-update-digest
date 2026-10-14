import assert from "node:assert/strict";
import test from "node:test";
import { parseSource } from "../scripts/collect.mjs";
import {
  articleContent,
  documentFingerprint,
  documentUrl,
  enrichDocumentCache,
  extractDocumentLinks,
  fetchOfficialPage,
  normalizeDocuments,
  OfficialPageError,
  officialUrl,
  japaneseDocumentUrl,
  pendingDocumentEvents,
  validateDocumentCache,
  withRelatedDocuments,
} from "../scripts/lib/related-documents.mjs";

const url = "https://learn.microsoft.com/en-us/copilot/example";
const japaneseUrl = "https://learn.microsoft.com/ja-jp/copilot/example";
const event = {
  id: "example-update",
  title: "Example feature",
  summary: "An example feature update",
  url: "https://techcommunity.microsoft.com/blog/example",
  publishedAt: "2026-10-14",
};
const candidate = {
  title: "Example documentation",
  url,
  provenance: "source",
  evidenceUrl: event.url,
};
const now = "2026-10-14T05:00:00.000Z";
const documentPage = async (value) => ({
  url: value,
  html: value.includes("/ja-jp/")
    ? "<main><h1>機能の設定ガイド</h1><p>機能の設定手順です。</p></main>"
    : "<main><h1>Verified feature documentation</h1><p>Feature instructions</p></main>",
});

test("only HTTPS exact official hosts and Learn document paths are allowed", () => {
  for (const value of [
    "javascript:alert(1)",
    "http://learn.microsoft.com/copilot/example",
    "https://learn.microsoft.com.evil.test/copilot/example",
    "https://learn.microsoft.com@evil.test/copilot/example",
    "https://user:secret@learn.microsoft.com/copilot/example",
    "https://learn.microsoft.com:8443/copilot/example",
  ]) {
    assert.equal(officialUrl(value), null, value);
  }
  assert.equal(documentUrl("https://learn.microsoft.com/search/?terms=copilot"), null);
  assert.equal(documentUrl("https://learn.microsoft.com/ja-jp/training/support"), null);
  assert.equal(documentUrl("https://learn.microsoft.com/"), null);
  assert.equal(documentUrl("https://www.microsoft.com/products/copilot"), null);
  assert.equal(documentUrl("/ja-jp/copilot/example?utm_source=feed#setup", url),
    "https://learn.microsoft.com/ja-jp/copilot/example#setup");
});

test("links resolve relatives, deduplicate locales and fragments, and exclude the original document", () => {
  const links = extractDocumentLinks(`
    <a href="/ja-jp/copilot/example">First document</a>
    <a href="${url}#setup">Same document</a>
    <a href="/ja-jp/copilot/second?utm_source=feed">Second document</a>
    <a href="https://evil.test/copilot/third">Not official</a>
    <a href="javascript:alert(1)">Not a URL</a>`, url);
  assert.equal(links.length, 2);
  assert.equal(normalizeDocuments(links, `${url}#overview`).length, 1);
  assert.equal(normalizeDocuments([{ ...candidate, url: `${url}#date` }], `${url}?tabs=all&view=latest`).length, 0);
  assert.equal(normalizeDocuments([...links, ...links]).length, 2);
  assert.equal(normalizeDocuments([1, 2, 3, 4].map((id) => ({
    ...candidate, url: `${url}${id}`,
  }))).length, 3);
});

test("Microsoft product documents rank before GitHub supplements, including at the result limit", () => {
  const github = {
    ...candidate, title: "GitHub integration guide",
    url: "https://docs.github.com/en/copilot/how-tos/example",
    evidence: "The update adds a GitHub integration.",
  };
  const documents = normalizeDocuments([
    github,
    { ...candidate, title: "Skills overview (GitHub Copilot)", url: `${url}-github` },
    { ...candidate, title: "Microsoft 365 guide", url: `${url}-m365` },
    { ...candidate, title: "Copilot Studio guide", url: `${url}-studio` },
  ]);
  assert.deepEqual(documents.map((document) => document.title), [
    "Microsoft 365 guide", "Copilot Studio guide", "GitHub integration guide",
  ]);
  assert.equal(documents[2].supplemental, true);
  assert.equal(japaneseDocumentUrl(github.url), "https://docs.github.com/ja/copilot/how-tos/example");
  assert.equal(normalizeDocuments([github, { ...github, url: japaneseDocumentUrl(github.url) }]).length, 1);
  const cache = { [event.id]: {
    inputFingerprint: documentFingerprint(event), status: "verified",
    checkedAt: now, documents: [github],
  } };
  validateDocumentCache(cache);
  assert.equal(pendingDocumentEvents([event], cache).length, 1);
  assert.throws(() => validateDocumentCache({
    [event.id]: { ...cache[event.id], mcpStatus: "verified", documents: [{ ...github, provenance: "mcp" }] },
  }), /primary Microsoft/);
});

test("GitHub documentation also prefers a verified Japanese edition", async () => {
  const github = {
    ...candidate, title: "Copilot Studio GitHub integration",
    url: "https://docs.github.com/en/copilot/how-tos/example",
    evidence: "Integration setup linked from the official update.",
  };
  const cache = {};
  await enrichDocumentCache([event], cache, {
    candidates: new Map([[event.id, [github]]]),
    fetchPage: async (value) => ({
      url: value, html: "<main><h1>連携ガイド</h1><p>GitHub 連携の設定手順です。</p></main>",
    }),
    now,
  });
  assert.equal(cache[event.id].documents[0].url, "https://docs.github.com/ja/copilot/how-tos/example");
  assert.equal(cache[event.id].documents[0].supplemental, true);
  validateDocumentCache(cache);
});

test("article extraction excludes navigation, signatures and sidebars", () => {
  const content = articleContent(`<header><a href="${url}/header">Header</a></header>
    <main><article><p><a href="${url}">Documentation</a></p>
    <aside><a href="${url}/other">Unrelated</a></aside></article></main>`);
  assert.equal(extractDocumentLinks(content, event.url).length, 1);
  assert.throws(() => articleContent("<div>Not an article</div>"), /content was not found/);
});

test("Aurora page data extracts only the requested blog, not other messages or footer links", () => {
  const page = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { apolloState: {
      "BlogTopicMessage:message:123": { body: `<p><a href="${url}">Feature documentation</a></p>` },
      "BlogTopicMessage:message:999": { body: `<p><a href="${url}/other">Another post</a></p>` },
      "Footer": { html: `<a href="${url}/footer">Navigation</a>` },
    } } },
  })}</script>`;
  const content = articleContent(page, "https://techcommunity.microsoft.com/blog/board/post/123");
  assert.equal(extractDocumentLinks(content, event.url).length, 1);
  assert.throws(() => articleContent(page, "https://techcommunity.microsoft.com/blog/board/post/456"), /content was not found/);
});

test("release-note and Studio parsers keep documentation scoped to each update item", () => {
  for (const [kind, heading] of [
    ["m365_release_notes", "<h2>October 14, 2026</h2><h3>Copilot</h3>"],
    ["copilot_studio_whats_new", "<h3>October 2026</h3>"],
  ]) {
    const source = { id: kind, kind, url, productArea: "Copilot" };
    const parsed = parseSource(source, `<main>${heading}<ul>
      <li>First update feature <a href="/en-us/copilot/first">First guide</a></li>
      <li>Second update feature <a href="/en-us/copilot/second">Second guide</a></li>
    </ul></main>`, now);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].documentCandidates.length, 1);
    assert.equal(parsed[0].documentCandidates[0].url, "https://learn.microsoft.com/en-us/copilot/first");
    assert.equal(parsed[1].documentCandidates[0].url, "https://learn.microsoft.com/en-us/copilot/second");
  }
});

test("blog and roadmap RSS parsers retain explicit links in encoded content", () => {
  for (const kind of ["rss_feed", "m365_roadmap_rss"]) {
    const parsed = parseSource({ id: kind, kind, url: event.url, productArea: "Copilot" }, `
      <rss><channel><item><title>Copilot feature update</title><link>${event.url}</link>
      <pubDate>Wed, 14 Oct 2026 00:00:00 GMT</pubDate>
      <description><![CDATA[Copilot feature announcement]]></description>
      <content:encoded><![CDATA[<p><a href="${url}">Feature guide</a></p>]]></content:encoded>
      </item></channel></rss>`, now);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].documentCandidates.length, 1, kind);
    assert.equal(parsed[0].documentCandidates[0].url, url);
  }
});

test("explicit links are verified, cached and stable on the next run", async () => {
  const cache = {};
  const options = { candidates: new Map([[event.id, [candidate]]]), fetchPage: documentPage, now };
  const first = await enrichDocumentCache([event], cache, options);
  assert.deepEqual(first, { processed: 1, requests: 1 });
  assert.equal(cache[event.id].documents[0].title, "機能の設定ガイド");
  assert.equal(cache[event.id].documents[0].url, japaneseUrl);
  validateDocumentCache(cache);
  const saved = JSON.stringify(cache);
  assert.deepEqual(await enrichDocumentCache([event], cache, options), { processed: 0, requests: 0 });
  assert.equal(JSON.stringify(cache), saved);
  assert.equal(withRelatedDocuments(event, cache).relatedDocuments.length, 1);
  assert.deepEqual(pendingDocumentEvents([event], cache), []);
});

test("official article fallback follows only its explicit Learn links", async () => {
  const cache = {};
  const called = [];
  await enrichDocumentCache([event], cache, {
    fetchPage: async (value) => {
      called.push(value);
      return value === event.url
        ? { url: value, html: `<main><a href="${url}#setup">Feature</a></main>` }
        : documentPage(value);
    },
    now,
  });
  assert.deepEqual(called, [event.url, japaneseUrl]);
  assert.equal(cache[event.id].documents[0].provenance, "article");
  assert.equal(cache[event.id].documents[0].url, `${japaneseUrl}#setup`);
});

test("English is retained when a Japanese edition does not exist", async () => {
  const cache = {};
  const called = [];
  await enrichDocumentCache([event], cache, {
    candidates: new Map([[event.id, [candidate]]]),
    fetchPage: async (value) => {
      called.push(value);
      if (value.includes("/ja-jp/")) {
        throw new OfficialPageError("Japanese document not found", 404);
      }
      return documentPage(value);
    },
    now,
  });
  assert.deepEqual(called, [japaneseUrl, url]);
  assert.equal(cache[event.id].documents[0].url, url);
  assert.equal(cache[event.id].localePreference, "ja-jp");
  assert.equal(cache[event.id].error, undefined);
  assert.deepEqual(await enrichDocumentCache([event], cache), { processed: 0, requests: 0 });
});

test("Japanese URLs that redirect to English or serve English content are not selected", async () => {
  for (const redirected of [true, false]) {
    const cache = {};
    await enrichDocumentCache([event], cache, {
      candidates: new Map([[event.id, [candidate]]]),
      fetchPage: async (value) => value === japaneseUrl
        ? { url: redirected ? url : japaneseUrl, html: "<main><h1>English documentation</h1><p>English only</p></main>" }
        : documentPage(value),
      now,
    });

    assert.equal(cache[event.id].documents[0].url, url);
  }
});

test("Japanese navigation alone does not establish a Japanese article translation", async () => {
  const cache = {};
  await enrichDocumentCache([event], cache, {
    candidates: new Map([[event.id, [candidate]]]), now,
    fetchPage: async (value) => value === japaneseUrl
      ? { url: value, html: "<main><nav>日本語のナビゲーション</nav><div class='content'><h1>English guide</h1></div><div class='content'>English article body</div></main>" }
      : documentPage(value),
  });
  assert.equal(cache[event.id].documents[0].url, url);
});

test("existing English documents are upgraded once, and transient failures never erase confirmed links", async () => {
  const record = {
    inputFingerprint: documentFingerprint(event), status: "verified",
    checkedAt: now, documents: [candidate],
  };
  const cache = { [event.id]: record };
  await enrichDocumentCache([event], cache, {
    candidates: new Map([[event.id, []]]), fetchPage: documentPage, now,
  });
  assert.equal(cache[event.id].documents[0].url, japaneseUrl);
  assert.deepEqual(await enrichDocumentCache([event], cache), { processed: 0, requests: 0 });
  const failed = { [event.id]: record };
  await enrichDocumentCache([event], failed, {
    fetchPage: async () => { throw new OfficialPageError("HTTP 503", 503); },
    onWarning() {}, now,
  });
  assert.equal(failed[event.id].documents[0].url, url);
  assert.equal(failed[event.id].status, "verified");
  assert.match(failed[event.id].error, /503/);
  validateDocumentCache(failed);
  await enrichDocumentCache([event], failed, { retryErrors: true, fetchPage: documentPage, now });
  assert.equal(failed[event.id].documents[0].url, japaneseUrl);
  assert.equal(failed[event.id].error, undefined);
});

test("release-note and roadmap aggregate pages are not mined for unrelated updates", async () => {
  for (const original of [
    "https://learn.microsoft.com/en-us/copilot/release-notes?tabs=all#date",
    "https://learn.microsoft.com/en-us/copilot/whats-new",
    "https://www.microsoft.com/microsoft-365/roadmap?id=123",
  ]) {
    const cache = {};
    await enrichDocumentCache([{ ...event, url: original }], cache, {
      fetchPage: async () => assert.fail("Aggregate pages must not be crawled"),
      now,
    });
    assert.equal(cache[event.id].status, "not-found");
  }
});

test("failure and no result are distinct; request limits and cached failures are respected", async () => {
  const cache = {};
  const warnings = [];
  await enrichDocumentCache([event], cache, {
    fetchPage: async () => { throw new Error("HTTP 429"); },
    onWarning: (value) => warnings.push(value),
    now,
  });
  assert.equal(cache[event.id].status, "error");
  assert.match(cache[event.id].error, /429/);
  assert.equal(warnings.length, 1);
  assert.equal(pendingDocumentEvents([event], cache).length, 1);
  cache[event.id].mcpStatus = "error";
  assert.equal(pendingDocumentEvents([event], cache).length, 0);
  validateDocumentCache(cache);
  assert.deepEqual(await enrichDocumentCache([event], cache), { processed: 0, requests: 0 });
  const limited = {};
  const result = await enrichDocumentCache([event, { ...event, id: "second" }], limited, {
    candidates: new Map([[event.id, [candidate]]]),
    fetchPage: documentPage,
    requestLimit: 1,
    now,
  });
  assert.equal(result.requests, 1);
});

test("legacy events stay unchanged, and stale cache input is not displayed", () => {
  assert.deepEqual(withRelatedDocuments(event, {}), event);
  const cache = { [event.id]: {
    inputFingerprint: documentFingerprint(event),
    status: "verified", checkedAt: now, documents: [candidate],
  } };
  assert.equal(withRelatedDocuments(event, cache).relatedDocuments.length, 1);
  const changed = { ...event, summary: "A different feature" };
  assert.equal(withRelatedDocuments(changed, cache).relatedDocuments, undefined);
});

test("cache validation rejects malformed data, unverified sources and silent MCP failures", () => {
  const record = {
    inputFingerprint: documentFingerprint(event),
    status: "verified", checkedAt: now, documents: [candidate],
  };
  validateDocumentCache({ [event.id]: record });
  assert.throws(() => validateDocumentCache([]), /must be an object/);
  assert.throws(() => validateDocumentCache({ invalid: null }), /Invalid related document record/);
  assert.throws(() => validateDocumentCache({ bad: { ...record, documents: [candidate, candidate] } }), /duplicate/);
  assert.throws(() => validateDocumentCache({ bad: { ...record, documents: [{ ...candidate, provenance: "guess" }] } }), /provenance/);
  assert.throws(() => validateDocumentCache({ bad: { ...record, mcpStatus: "error" } }), /diagnostic/);
  assert.throws(() => validateDocumentCache({ bad: { ...record, documents: [{ ...candidate, provenance: "mcp" }] } }), /provenance/);
  validateDocumentCache({ good: { ...record, documents: [{ ...candidate, provenance: "mcp", evidence: "The feature is documented here." }], mcpStatus: "verified" } });
});

test("network retrieval rejects nonofficial redirects, non-HTML and HTTP failures", async () => {
  await assert.rejects(fetchOfficialPage(event.url, {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }),
  }), /outside the allow-list/);
  await assert.rejects(fetchOfficialPage(event.url, {
    fetchImpl: async () => new Response("blocked", { status: 403 }),
  }), /HTTP 403/);
  await assert.rejects(fetchOfficialPage(event.url, {
    fetchImpl: async () => new Response("binary", { headers: { "content-type": "application/pdf" } }),
  }), /not HTML/);
  const result = await fetchOfficialPage(event.url, {
    fetchImpl: async () => new Response("<main>Article</main>", { headers: { "content-type": "text/html" } }),
  });
  assert.equal(result.html, "<main>Article</main>");
});
