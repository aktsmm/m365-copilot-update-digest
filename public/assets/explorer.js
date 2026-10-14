(() => {
  const root = document.querySelector("[data-explorer]");
  const indexUrl = document.body.dataset.searchIndex;
  if (!root || !indexUrl) {
    return;
  }

  const locale = root.dataset.locale || "ja";
  const base = document.body.dataset.searchBase || "";
  const PAGE = 30;
  const $ = (selector) => root.querySelector(selector);
  const startInput = $("[data-ex-start]");
  const endInput = $("[data-ex-end]");
  const importanceSelect = $("[data-ex-importance]");
  const textInput = $("[data-ex-text]");
  const results = $("[data-ex-results]");
  const empty = $("[data-ex-empty]");
  const more = $("[data-ex-more]");
  const periodLabel = $("[data-explorer-period]");
  const L = {
    ja: { items: "件", basis: "JST・発行日基準", detail: "日次の該当箇所", source: "原文を開く", related: "関連ドキュメント", slide: "スライド PDF", published: "発行", noRelated: "" },
    en: { items: "items", basis: "JST, by publish date", detail: "View in daily digest", source: "Open source", related: "Related documentation", slide: "Slide PDF", published: "Published", noRelated: "" },
  }[locale];

  let entries = [];
  let facets = { kinds: [], categories: [], importanceLevels: [] };
  let slideIndex = new Map();
  let filtered = [];
  let shown = 0;
  const selected = { kinds: new Set(), categories: new Set() };
  const label = (item) => (locale === "en" ? item.labelEn || item.label : item.label);

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const safeUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch {
      return "";
    }
  };
  const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const rank = { high: 2, notable: 1, normal: 0 };

  function checkboxes(container, items, set, prefix) {
    container.innerHTML = items
      .map((item) => `<label class="check-chip chip-${prefix}-${esc(item.id)}"><input type="checkbox" value="${esc(item.id)}" /> <span>${esc(label(item))}</span></label>`)
      .join("");
    container.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", () => {
        input.checked ? set.add(input.value) : set.delete(input.value);
        apply();
      });
    });
  }

  function matches(entry, tokens) {
    const start = startInput.value;
    const end = endInput.value;
    const date = entry.publishedAt.slice(0, 10);
    if ((start && date < start) || (end && date > end)) return false;
    const level = importanceSelect.value;
    if (level !== "all" && rank[entry.importance] < rank[level]) return false;
    if (selected.kinds.size && !selected.kinds.has(entry.kind)) return false;
    if (selected.categories.size && !(entry.categories || []).some((id) => selected.categories.has(id))) return false;
    if (tokens.length) {
      const hay = [entry.titleJa, entry.titleEn, entry.summaryJa, entry.summaryEn, entry.productArea, entry.sourceName, entry.releaseStage, ...(entry.roleTags || [])]
        .join("\n")
        .toLowerCase();
      return tokens.every((token) => hay.includes(token));
    }
    return true;
  }

  function card(entry) {
    const title = locale === "en" ? entry.titleEn : entry.titleJa;
    const summary = locale === "en" ? entry.summaryEn : entry.summaryJa;
    const href = `${base}${locale === "en" ? "en/" : ""}${entry.detailPath}`;
    const kind = facets.kinds.find((item) => item.id === entry.kind);
    const level = facets.importanceLevels.find((item) => item.id === entry.importance);
    const cats = (entry.categories || []).map((id) => facets.categories.find((item) => item.id === id)).filter(Boolean);
    const docs = (entry.relatedDocuments || []).filter((d) => safeUrl(d.url) && d.title).slice(0, 3);
    const original = safeUrl(entry.url);
    const hasPdf = entry.slideKey && slideIndex.has(entry.slideKey);
    return `<article class="update-card" data-kind="${esc(entry.kind)}">
      <div class="badge-row">
        ${kind ? `<span class="badge badge-kind-${esc(kind.id)}">${esc(label(kind))}</span>` : ""}
        ${entry.importance !== "normal" && level ? `<span class="badge badge-pinned">${esc(label(level))}</span>` : ""}
        <span class="badge badge-product">${esc(entry.productArea)}</span>
        ${cats.map((c) => `<span class="badge badge-cat badge-cat-${esc(c.id)}">${esc(label(c))}</span>`).join("")}
      </div>
      <h3><a href="${esc(href)}">${esc(title)}</a></h3>
      ${locale === "ja" && entry.titleEn && entry.titleEn !== title ? `<p class="card-original-title">${esc(entry.titleEn)}</p>` : ""}
      <p>${esc(summary)}</p>
      <dl class="meta-list"><div><dt>${esc(L.published)}</dt><dd>${esc(entry.publishedAt.slice(0, 10))}</dd></div><div><dt>${locale === "en" ? "Source" : "ソース"}</dt><dd>${esc(entry.sourceName)}</dd></div></dl>
      <div class="card-links">
        ${original ? `<a href="${esc(original)}" target="_blank" rel="noopener noreferrer">${esc(L.source)}</a>` : ""}
        <a href="${esc(href)}">${esc(L.detail)}</a>
        ${hasPdf ? `<a href="#" data-slide-pdf="${esc(entry.slideKey)}">${esc(L.slide)}</a>` : ""}
      </div>
      ${docs.length ? `<div class="related-documents"><strong>${esc(L.related)}</strong><ul>${docs.map((d) => `<li><a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer">${esc(d.title)}</a></li>`).join("")}</ul></div>` : ""}
    </article>`;
  }

  function renderMore() {
    const next = filtered.slice(shown, shown + PAGE);
    results.insertAdjacentHTML("beforeend", next.map(card).join(""));
    shown += next.length;
    more.hidden = shown >= filtered.length;
  }

  function apply() {
    const tokens = textInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    filtered = entries.filter((entry) => matches(entry, tokens));
    results.innerHTML = "";
    shown = 0;
    empty.classList.toggle("hidden", filtered.length > 0);
    renderMore();
    periodLabel.textContent = `${startInput.value || "…"} ～ ${endInput.value || "…"}（${L.basis}）: ${filtered.length} ${L.items}`;
    const jsonButton = $("[data-ex-json]");
    jsonButton.textContent = `JSON（${filtered.length}）`;
    const slideCount = filtered.filter((entry) => entry.slideKey && slideIndex.has(entry.slideKey)).length;
    const jsonCount = filtered.filter((entry) => entry.slideKey).length;
    const counts = { "data-download-merged": slideCount, "data-download-pptx": jsonCount };
    Object.entries(counts).forEach(([attr, n]) => {
      root.querySelectorAll(`[${attr}]`).forEach((b) => {
        b.dataset.label = b.dataset.label || b.textContent;
        b.textContent = `${b.dataset.label}（${n}）`;
      });
    });
  }

  function preset(days) {
    const end = endInput.max || endInput.value;
    endInput.value = end;
    startInput.value = addDays(end, -(days - 1));
    apply();
  }

  window.digestVisibleSlideKeys = () => filtered.map((entry) => entry.slideKey).filter((key) => key && slideIndex.has(key));
  window.digestVisibleSlideJsonKeys = () => filtered.map((entry) => entry.slideKey).filter(Boolean);

  Promise.all([
    fetch(indexUrl).then((r) => r.json()),
    fetch(`${base}data/slides.json`).then((r) => (r.ok ? r.json() : { slides: [] })).catch(() => ({ slides: [] })),
  ])
    .then(([payload, slides]) => {
      entries = (payload.entries || []).slice().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.importanceScore - a.importanceScore);
      facets = payload.facets || facets;
      slideIndex = new Map((slides.slides || []).map((slide) => [slide.key, slide]));
      const latest = entries[0] ? entries[0].publishedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
      endInput.max = latest;
      endInput.value = latest;
      startInput.value = addDays(latest, -29);
      importanceSelect.insertAdjacentHTML("beforeend", facets.importanceLevels.filter((l) => l.id !== "normal").map((l) => `<option value="${esc(l.id)}">${esc(label(l))}</option>`).join(""));
      checkboxes($("[data-ex-kinds]"), facets.kinds, selected.kinds, "kind");
      checkboxes($("[data-ex-categories]"), facets.categories, selected.categories, "cat");
      [startInput, endInput, importanceSelect].forEach((el) => el.addEventListener("change", apply));
      textInput.addEventListener("input", apply);
      root.querySelectorAll("[data-ex-preset]").forEach((b) => b.addEventListener("click", () => preset(Number(b.dataset.exPreset))));
      more.addEventListener("click", renderMore);
      $("[data-ex-json]").addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "m365-copilot-updates.json";
        a.click();
      });
      apply();
      document.dispatchEvent(new CustomEvent("digest:explorer-ready"));
    })
    .catch(() => {
      empty.classList.remove("hidden");
    });
})();
