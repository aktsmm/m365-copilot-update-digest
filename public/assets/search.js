(() => {
  const locale = document.body.dataset.locale || "ja";
  const indexUrl = document.body.dataset.searchIndex;
  const input = document.querySelector("[data-search-input]");
  const results = document.querySelector("[data-search-results]");
  const status = document.querySelector("[data-search-status]");

  if (!indexUrl || !input || !results || !status) {
    return;
  }

  const messages = {
    ja: {
      ready: "キーワードを入力すると結果を表示します。",
      empty: "一致する更新は見つかりませんでした。",
      matches: "件ヒット",
      open: "日次ページを見る",
      source: "ソース",
      published: "公開日",
    },
    en: {
      ready: "Type a keyword to start searching.",
      empty: "No matching updates were found.",
      matches: "matches",
      open: "Open daily page",
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

  function renderResults(entries) {
    if (entries.length === 0) {
      results.innerHTML = "";
      status.textContent = text.empty;
      return;
    }

    status.textContent = `${entries.length} ${text.matches}`;
    results.innerHTML = entries
      .map((entry) => {
        const href = `../${entry.detailPath}`;
        const summary = locale === "en" ? entry.summaryEn : entry.summaryJa;
        return `
          <article class="search-result-card">
            <h2><a href="${escapeHtml(href)}">${escapeHtml(entry.title)}</a></h2>
            <p>${escapeHtml(summary)}</p>
            <dl class="meta-list compact">
              <div><dt>${escapeHtml(text.published)}</dt><dd>${escapeHtml(entry.publishedAt.slice(0, 10))}</dd></div>
              <div><dt>${escapeHtml(text.source)}</dt><dd>${escapeHtml(entry.sourceName)}</dd></div>
            </dl>
            <a class="primary-link" href="${escapeHtml(href)}">${escapeHtml(text.open)}</a>
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
                entry.title,
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
          .slice(0, 50);

        renderResults(filtered);
      };

      input.addEventListener("input", search);
      search();
    })
    .catch(() => {
      status.textContent = text.empty;
    });
})();
