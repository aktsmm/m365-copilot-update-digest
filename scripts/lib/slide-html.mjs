const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const KIND_COLOR = {
  ga: "#1b7f3b",
  preview: "#7a4fd0",
  "rolling-out": "#0b6bcb",
  "in-development": "#5b6777",
  retirement: "#c62828",
  update: "#5b6777",
};

const LEVEL_LABEL = { high: "重要", notable: "注目", normal: "通常" };

export const PDF_CSS = `
@page { size: 1280px 720px; margin: 0 }
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;font-family:"Noto Sans CJK JP","Noto Sans JP","Yu Gothic UI","Meiryo","Segoe UI",sans-serif;color:#1b2430;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:1280px;height:720px;position:relative;overflow:hidden;page-break-after:always;break-after:page;padding:28px 44px 20px;display:flex;flex-direction:column;gap:12px}
.page:last-child{page-break-after:auto;break-after:auto}
.hd{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.t{font-size:30px;font-weight:700;color:#0b2a4a;line-height:1.3}
.en{font-size:14px;color:#6b778a;margin-top:4px}
.badge{color:#fff;font-weight:700;font-size:22px;padding:4px 24px;border-radius:999px;white-space:nowrap}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{font-size:14px;border:1.5px solid #b8c7dc;border-radius:999px;padding:2px 12px;color:#3d4a5c;background:#f3f8ff}
.chip.imp-high{border-color:#c62828;background:#fdecec;color:#c62828;font-weight:700}
.chip.imp-notable{border-color:#d9a441;background:#fff8e8;color:#a8710f;font-weight:700}
.card{border:1.5px solid #b8c7dc;border-radius:10px;padding:14px 20px;background:#fff}
.card h3{margin:0 0 6px;font-size:16px;color:#0b6bcb}
.sum{flex:0 1 auto;min-height:0;overflow:hidden;font-size:var(--fs,20px);line-height:1.6;white-space:pre-wrap}
.why{font-size:15px;color:#3d4a5c}
ul{margin:0;padding-left:22px;font-size:15px;line-height:1.5}
.ft{display:flex;justify-content:space-between;gap:12px;font-size:13px;color:#6b778a;border-top:1px solid #dde3ec;padding-top:8px;margin-top:auto}
.ft a{color:#0b5cad}
`;

function dateJa(value) {
  const [y, m, d] = value.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/** 1 スライド = 1 ページ。本文の長さに応じて文字サイズを段階的に下げる。 */
export function slideHtml(slide, categoryConfig) {
  const color = KIND_COLOR[slide.kind] ?? "#5b6777";
  const labelOf = new Map(categoryConfig.categories.map((category) => [category.id, category.label]));
  const length = (slide.summaryJa ?? "").length;
  const fs = length > 700 ? 15 : length > 520 ? 16.5 : length > 360 ? 18 : 20;
  const related = slide.references.related ?? [];
  const level = slide.meta.importance.level;

  return `<section class="page" data-key="${esc(slide.key)}">
  <div class="hd">
    <div>
      <div class="t">${esc(slide.title.ja)}</div>
      ${slide.title.en && slide.title.en !== slide.title.ja ? `<div class="en">${esc(slide.title.en)}</div>` : ""}
    </div>
    <span class="badge" style="background:${color}">${esc(slide.label)}</span>
  </div>
  <div class="chips">
    <span class="chip">${esc(dateJa(slide.meta.publishedJst))}</span>
    <span class="chip">${esc(slide.meta.productArea)}</span>
    ${slide.meta.categories.map((id) => `<span class="chip">${esc(labelOf.get(id) ?? id)}</span>`).join("")}
    ${level !== "normal" ? `<span class="chip imp-${esc(level)}">${esc(LEVEL_LABEL[level])}</span>` : ""}
    ${slide.meta.stage ? `<span class="chip">${esc(slide.meta.stage)}</span>` : ""}
    ${(slide.meta.roleTags ?? []).map((tag) => `<span class="chip">${esc(tag)}</span>`).join("")}
  </div>
  ${slide.summaryJa ? `<div class="card sum" style="--fs:${fs}px">${esc(slide.summaryJa)}</div>` : ""}
  ${slide.meta.importance.reasonJa ? `<div class="why">注目ポイント: ${esc(slide.meta.importance.reasonJa)}</div>` : ""}
  ${related.length ? `<div class="card"><h3>関連ドキュメント</h3><ul>${related.map((doc) => `<li>${esc(doc.title)}（${esc(doc.url)}）</li>`).join("")}</ul></div>` : ""}
  <div class="ft"><span>出典: ${esc(slide.meta.sourceName)} ／ ${esc(slide.references.source)}</span><span>ID ${esc(slide.key)}</span></div>
</section>`;
}

export function documentHtml(pagesHtml) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>${PDF_CSS}</style></head><body>${pagesHtml}</body></html>`;
}
