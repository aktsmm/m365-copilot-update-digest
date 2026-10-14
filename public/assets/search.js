(() => {
  const root = document.querySelector("[data-search-root]");
  const locale = document.body.dataset.locale || "ja";
  const indexUrl = document.body.dataset.searchIndex;
  const basePath = document.body.dataset.searchBase || "";
  const input = root?.querySelector("[data-search-input]");
  const results = root?.querySelector("[data-search-results]");
  const status = root?.querySelector("[data-search-status]");
  const maxResults = Number.parseInt(root?.dataset.searchLimit || "50", 10);

  if (!root || !indexUrl || !input || !results || !status) {
    return;
  }

  const messages = {
    ja: {
      ready: "キーワードを入力すると結果を表示します。",
      empty: "一致する更新は見つかりませんでした。",
      matches: "件ヒット",
      open: "日次の該当箇所を見る",
      original: "原文を開く",
      related: "関連ドキュメント",
      supplemental: "補足",
      source: "ソース",
      published: "公開日",
    },
    en: {
      ready: "Type a keyword to start searching.",
      empty: "No matching updates were found.",
      matches: "matches",
      open: "View update in daily digest",
      original: "Open source",
      related: "Related documentation",
      supplemental: "Supplementary",
      source: "Source",
      published: "Published",
    },
  };

  const text = messages[locale] || messages.ja;

  function normalize(value) {
    return String(value ?? "").toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function tokenize(value) {
    return normalize(value)
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function externalUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  }

  function renderResults(entries) {
    if (entries.length === 0) {
      results.innerHTML = "";
      status.textContent = text.empty;
      return;
    }

    status.textContent = `${entries.length} ${text.matches}`;
    results.innerHTML = entries
      .map((entry) => {
        const href = `${basePath}${locale === "en" ? "en/" : ""}${entry.detailPath}`;
        const summary = locale === "en" ? entry.summaryEn : entry.summaryJa;
        const title = locale === "en" ? entry.titleEn : entry.titleJa;
        const original = externalUrl(entry.url);
        const documents = (entry.relatedDocuments || [])
          .filter((document) => externalUrl(document.url) && document.title)
          .slice(0, 3);
        return `
          <article class="search-result-card">
            <h2><a href="${escapeHtml(href)}">${escapeHtml(title)}</a></h2>
            <p>${escapeHtml(summary)}</p>
            <dl class="meta-list compact">
              <div><dt>${escapeHtml(text.published)}</dt><dd>${escapeHtml(entry.publishedAt.slice(0, 10))}</dd></div>
              <div><dt>${escapeHtml(text.source)}</dt><dd>${escapeHtml(entry.sourceName)}</dd></div>
            </dl>
            <div class="card-links">
              ${original ? `<a class="primary-link" href="${escapeHtml(original)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text.original)}</a>` : ""}
              <a href="${escapeHtml(href)}">${escapeHtml(text.open)}</a>
            </div>
            ${documents.length ? `<div class="related-documents"><strong>${escapeHtml(text.related)}</strong><ul>${documents.map((document) => `<li><a href="${escapeHtml(externalUrl(document.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.title)}</a>${document.supplemental ? `<span class="document-supplemental">${escapeHtml(text.supplemental)}</span>` : ""}</li>`).join("")}</ul></div>` : ""}
          </article>
        `;
      })
      .join("");
  }

  fetch(indexUrl)
    .then((response) => response.json())
    .then((payload) => {
      const entries = payload.entries || [];
      status.textContent = text.ready;

      const search = () => {
        const tokens = tokenize(input.value);
        if (tokens.length === 0) {
          results.innerHTML = "";
          status.textContent = text.ready;
          return;
        }

        const filtered = entries
          .filter((entry) => {
            const haystack = normalize(
              [
                entry.titleJa,
                entry.titleEn,
                entry.summaryJa,
                entry.summaryEn,
                entry.productArea,
                entry.sourceName,
                entry.releaseStage,
                ...(entry.roleTags || []),
                entry.publishedAt,
              ].join("\n"),
            );
            return tokens.every((token) => haystack.includes(token));
          })
          .slice(0, maxResults);

        renderResults(filtered);
      };

      input.addEventListener("input", search);
      search();
    })
    .catch(() => {
      status.textContent = text.empty;
    });
})();
