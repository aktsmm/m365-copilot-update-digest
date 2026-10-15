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
    ja: { items: "件", basis: "JST・発行日基準", detail: "日次の該当箇所", source: "原文を開く", related: "関連ドキュメント", include: "出力に含める", why: "注目理由", published: "発行", noRelated: "" },
    en: { items: "items", basis: "JST, by publish date", detail: "View in daily digest", source: "Open source", related: "Related documentation", include: "Include in export", why: "Why it matters", published: "Published", noRelated: "" },
  }[locale];

  let entries = [];
  let facets = { kinds: [], categories: [], importanceLevels: [] };
  let slideIndex = new Map();
  let filtered = [];
  let shown = 0;
  let lastSig = "";
  const excluded = new Set();
  const chosen = () => filtered.filter((entry) => !excluded.has(entry.id));
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

  function card(entry, index) {
    const title = locale === "en" ? entry.titleEn : entry.titleJa;
    const summary = locale === "en" ? entry.summaryEn : entry.summaryJa;
    const href = `${base}${locale === "en" ? "en/" : ""}${entry.detailPath}`;
    const kind = facets.kinds.find((item) => item.id === entry.kind);
    const level = facets.importanceLevels.find((item) => item.id === entry.importance);
    const cats = (entry.categories || []).map((id) => facets.categories.find((item) => item.id === id)).filter(Boolean);
    const docs = (entry.relatedDocuments || []).filter((d) => safeUrl(d.url) && d.title).slice(0, 3);
    const original = safeUrl(entry.url);
    const hasPdf = entry.slideKey && slideIndex.has(entry.slideKey);
    const ids = entry.roadmapIds || [];
    const roles = (entry.roleTags || []).slice(0, 3);
    const reason = locale === "ja" ? entry.importanceReason : "";
    return `<article class="update-card" data-kind="${esc(entry.kind)}">
      <div class="ex-head">
        <label class="ex-sel" title="${esc(L.include)}"><input type="checkbox" class="selbox" data-id="${esc(entry.id)}"${excluded.has(entry.id) ? "" : " checked"} aria-label="${esc(L.include)}" /></label>
        <h3><span class="ex-no">${index + 1}.</span> <a href="${esc(href)}">${esc(title)}</a></h3>
        ${kind ? `<span class="badge badge-kind-${esc(kind.id)}">${esc(label(kind))}</span>` : ""}
      </div>
      ${locale === "ja" && entry.titleEn && entry.titleEn !== title ? `<p class="card-original-title">${esc(entry.titleEn)}</p>` : ""}
      <div class="ex-meta">${esc(L.published)} ${esc(entry.publishedAt.slice(0, 10))} ／ ${esc(entry.sourceName)}${ids.length ? ` ／ ID ${esc(ids.join(", "))}` : ""}</div>
      <div class="badge-row">
        ${entry.importance !== "normal" && level ? `<span class="badge badge-pinned">${esc(label(level))}</span>` : ""}
        <span class="badge badge-product">${esc(entry.productArea)}</span>
        ${cats.map((c) => `<span class="badge badge-cat badge-cat-${esc(c.id)}">${esc(label(c))}</span>`).join("")}
        ${roles.map((r) => `<span class="badge badge-role">${esc(r)}</span>`).join("")}
      </div>
      <p class="ex-summary">${esc(summary)}</p>
      ${reason ? `<p class="ex-reason">${esc(L.why)}: ${esc(reason)}</p>` : ""}
      <div class="ex-links">
        ${original ? `<a href="${esc(original)}" target="_blank" rel="noopener noreferrer">${esc(L.source)}</a>` : ""}
        <a href="${esc(href)}">${esc(L.detail)}</a>
        ${docs.length ? `<span class="ex-docs">${esc(L.related)}: ${docs.map((d) => `<a href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer">${esc(d.title)}</a>`).join(" ・ ")}</span>` : ""}
      </div>
    </article>`;
  }

  function renderMore() {
    const next = filtered.slice(shown, shown + PAGE);
    results.insertAdjacentHTML("beforeend", next.map((entry, i) => card(entry, shown + i)).join(""));
    shown += next.length;
    more.hidden = shown >= filtered.length;
  }

  function apply() {
    const tokens = textInput.value.toLowerCase().split(/\s+/).filter(Boolean);
    filtered = entries.filter((entry) => matches(entry, tokens));
    const sig = filtered.map((entry) => entry.id).join("|");
    if (sig !== lastSig) {
      excluded.clear();
      lastSig = sig;
    }
    results.innerHTML = "";
    shown = 0;
    empty.classList.toggle("hidden", filtered.length > 0);
    renderMore();
    periodLabel.textContent = `${startInput.value || "…"} ～ ${endInput.value || "…"}（${L.basis}）: ${filtered.length} ${L.items}`;
    syncExport();
    syncUrl();
  }

  function syncUrl() {
    const p = new URLSearchParams();
    if (startInput.value) p.set("start", startInput.value);
    if (endInput.value) p.set("end", endInput.value);
    if (importanceSelect.value !== "all") p.set("imp", importanceSelect.value);
    if (selected.kinds.size) p.set("kind", [...selected.kinds].join(","));
    if (selected.categories.size) p.set("cat", [...selected.categories].join(","));
    if (textInput.value.trim()) p.set("q", textInput.value.trim());
    const qs = p.toString();
    history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
  }

  function syncExport() {
    const picked = chosen();
    $("[data-ex-selcount]").textContent = `${picked.length} / ${filtered.length}`;
    results.querySelectorAll(".selbox").forEach((box) => {
      box.checked = !excluded.has(box.dataset.id);
    });
    const jsonButton = $("[data-ex-json]");
    jsonButton.textContent = `JSON（${picked.length}）`;
    const slideCount = picked.filter((entry) => entry.slideKey && slideIndex.has(entry.slideKey)).length;
    const jsonCount = picked.filter((entry) => entry.slideKey).length;
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

  window.digestVisibleSlideKeys = () => chosen().map((entry) => entry.slideKey).filter((key) => key && slideIndex.has(key));
  window.digestVisibleSlideJsonKeys = () => chosen().map((entry) => entry.slideKey).filter(Boolean);

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
      const defaults = { start: startInput.value, end: endInput.value };
      const params = new URLSearchParams(location.search);
      if (params.get("start")) startInput.value = params.get("start");
      if (params.get("end")) endInput.value = params.get("end");
      if (params.get("imp") && [...importanceSelect.options].some((o) => o.value === params.get("imp"))) importanceSelect.value = params.get("imp");
      if (params.get("q")) textInput.value = params.get("q");
      [["kind", selected.kinds, "[data-ex-kinds]"], ["cat", selected.categories, "[data-ex-categories]"]].forEach(([name, set, selector]) => {
        (params.get(name) || "").split(",").filter(Boolean).forEach((id) => {
          const box = $(selector).querySelector(`input[value="${CSS.escape(id)}"]`);
          if (box) {
            box.checked = true;
            set.add(id);
          }
        });
      });
      $("[data-ex-reset]").addEventListener("click", () => {
        startInput.value = defaults.start;
        endInput.value = defaults.end;
        importanceSelect.value = "all";
        textInput.value = "";
        selected.kinds.clear();
        selected.categories.clear();
        root.querySelectorAll("[data-ex-kinds] input, [data-ex-categories] input").forEach((box) => {
          box.checked = false;
        });
        apply();
      });
      const sample = [...slideIndex.values()].find((slide) => slide.free);
      if (sample) {
        const link = $("[data-ex-sample]");
        link.href = `${base}pdf/${sample.key}.pdf`;
        link.hidden = false;
      }
      root.querySelectorAll("[data-ex-preset]").forEach((b) => b.addEventListener("click", () => preset(Number(b.dataset.exPreset))));
      more.addEventListener("click", renderMore);
      results.addEventListener("change", (event) => {
        const box = event.target.closest(".selbox");
        if (!box) return;
        box.checked ? excluded.delete(box.dataset.id) : excluded.add(box.dataset.id);
        syncExport();
      });
      $("[data-ex-selall]").addEventListener("click", () => {
        excluded.clear();
        syncExport();
      });
      $("[data-ex-selnone]").addEventListener("click", () => {
        filtered.forEach((entry) => excluded.add(entry.id));
        syncExport();
      });
      $("[data-ex-json]").addEventListener("click", () => {
        const blob = new Blob([JSON.stringify(chosen(), null, 2)], { type: "application/json" });
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
