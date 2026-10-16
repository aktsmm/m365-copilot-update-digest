(() => {
  // 表示中のスライドを、編集できる PowerPoint（.pptx）としてブラウザ内で作って保存する。スライド JSON（slides/{key}.json）が入力。
  const buttons = [...document.querySelectorAll("[data-download-pptx]")];
  if (buttons.length === 0) {
    return;
  }

  const scriptSrc = document.currentScript ? document.currentScript.src : location.href;
  const root = new URL("../", scriptSrc);
  const LIMIT = 80;
  const FONT = "Yu Gothic";
  const KIND_COLOR = { ga: "1B7F3B", preview: "7A4FD0", "rolling-out": "0B6BCB", "in-development": "D98B00", retirement: "C62828", update: "5B6777" };
  const ACT = { yes: "要対応", optional: "任意", no: "対応不要", unknown: "情報" };
  const ACT_LINE = { yes: "C62828", optional: "1B7F3B", no: "0B6BCB", unknown: "0B6BCB" };
  const plain = (text) => String(text).replace(/\*\*/g, "");

  // **太字** を run 単位に分ける
  function runs(text, base) {
    return String(text)
      .split(/(\*\*.+?\*\*)/g)
      .filter(Boolean)
      .map((part) => (part.startsWith("**") ? { text: part.slice(2, -2), options: { ...base, bold: true } } : { text: part, options: base }));
  }

  function loadPptx() {
    if (window.PptxGenJS) {
      return Promise.resolve(window.PptxGenJS);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("assets/vendor/pptxgen.bundle.js", root).href;
      script.onload = () => resolve(window.PptxGenJS);
      script.onerror = () => reject(new Error("PowerPoint ライブラリを読み込めませんでした"));
      document.head.appendChild(script);
    });
  }

  function card(s, x, y, w, h, heading, lines, color, dashed) {
    const body = lines.flatMap((line, i) => [
      ...runs(line, { fontSize: 11, color: "1B2430", bullet: { indent: 12 }, breakLine: i < lines.length - 1 }),
    ]);
    s.addText([{ text: heading, options: { fontSize: 12, bold: true, color, breakLine: true } }, ...body], {
      x, y, w, h, fontFace: FONT, valign: "top", margin: 5, fit: "shrink",
      line: { color: dashed ? "D9A441" : "B8C7DC", width: 1.25, dashType: dashed ? "dash" : "solid" },
    });
  }

  function addSlide(pptx, slide) {
    const s = pptx.addSlide();
    const color = KIND_COLOR[slide.kind] || "5B6777";
    s.addText(slide.title.ja + (slide.title.subtitleJa ? `\n― ${slide.title.subtitleJa}` : ""), { x: 0.4, y: 0.2, w: 10.8, h: 0.95, fontFace: FONT, fontSize: 22, bold: true, color: "0B2A4A", valign: "top", fit: "shrink" });
    s.addText(slide.label, { x: 11.5, y: 0.25, w: 1.5, h: 0.42, fontFace: FONT, fontSize: 14, bold: true, color: "FFFFFF", align: "center", fill: { color }, shape: pptx.ShapeType.roundRect, rectRadius: 0.2 });
    s.addText(`${slide.title.en}　掲載 ${slide.meta.publishedJst}`, { x: 0.4, y: 1.15, w: 12.5, h: 0.28, fontFace: FONT, fontSize: 9, color: "6B778A", fit: "shrink" });

    const imp = [
      ["誰に関係するか", slide.audience.who.text, "0B6BCB", true],
      [slide.audience.changeNature === "benefit" ? "嬉しい点" : "変わること", slide.audience.change.text, "C9D4E6", false],
      ["対応の要否", `${ACT[slide.action.required] || ""}　${slide.action.summary.text}`, ACT_LINE[slide.action.required] || "0B6BCB", false],
    ];
    imp.forEach(([label, text, line, bold], i) => {
      s.addText([{ text: `${label}\n`, options: { fontSize: 9, color: "5B6777" } }, ...runs(text, { fontSize: 11, color: "0B2A4A", bold })], {
        x: 0.4 + i * 4.2, y: 1.48, w: 4.1, h: 0.72, fontFace: FONT, valign: "top", margin: 4, line: { color: line, width: 1.25 }, fit: "shrink",
      });
    });

    const panels = slide.panels.filter((p) => p.availability === "present" && (p.priority === "core" || p.priority === "detail"));
    const isSug = (p) => (p.items || []).every((i) => i.assertion === "recommendation");
    const main = panels.filter((p) => !isSug(p));
    const sug = panels.filter(isSug);
    let y = 2.3;
    const ba = slide.beforeAfter && (slide.beforeAfter.before || slide.beforeAfter.after);
    if (ba) {
      const lines = [slide.beforeAfter.before && `Before: ${plain(slide.beforeAfter.before.text)}`, slide.beforeAfter.after && `${slide.beforeAfter.before ? "After" : "できるようになること"}: ${plain(slide.beforeAfter.after.text)}`].filter(Boolean);
      s.addText([{ text: `${slide.beforeAfter.before ? "Before → After" : "何が嬉しいのか"}\n`, options: { fontSize: 12, bold: true, color: "0B6BCB" } }, ...lines.map((l, i) => ({ text: l, options: { fontSize: 11, color: "1B2430", breakLine: i < lines.length - 1 } }))], {
        x: 0.4, y, w: 8.4, h: 0.85, fontFace: FONT, valign: "top", margin: 5, fit: "shrink", fill: { color: "F3F8FF" }, line: { color: "0B6BCB", width: 1.25 },
      });
      y += 0.92;
    }
    const core = main.filter((p) => p.priority === "core");
    const detail = main.filter((p) => p.priority !== "core");
    core.forEach((p) => {
      const h = Math.min(1.25, 0.45 + (p.items || []).length * 0.3);
      card(s, 0.4, y, 8.4, h, p.heading, (p.items || []).map((i) => i.text), "0B6BCB", false);
      y += h + 0.07;
    });
    if (detail.length) {
      const w = (8.4 - 0.1 * (detail.length - 1)) / detail.length;
      const h = Math.max(0.9, 6.95 - y);
      detail.forEach((p, i) => card(s, 0.4 + i * (w + 0.1), y, w, h, p.heading, (p.items || []).map((x) => x.text), "0B6BCB", false));
    }

    let sy = 2.3;
    if ((slide.glossary || []).length) {
      const lines = slide.glossary.flatMap((g) => [{ text: `${g.term}　`, options: { bold: true, fontSize: 10, color: "0B2A4A" } }, { text: `${g.oneLine.text}\n`, options: { fontSize: 9.5, color: "1B2430" } }]);
      s.addText([{ text: "用語ミニ解説\n", options: { fontSize: 12, bold: true, color: "0B6BCB" } }, ...lines], { x: 9.0, y: sy, w: 3.95, h: 3.4, fontFace: FONT, valign: "top", margin: 5, fit: "shrink", fill: { color: "F1F7FF" }, line: { color: "7AA7D9", width: 1.25 } });
      sy += 3.5;
    }
    if (sug.length) {
      card(s, 9.0, sy, 3.95, Math.max(0.8, 6.95 - sy), `${sug[0].heading}（提案）`, sug.flatMap((p) => (p.items || []).map((i) => i.text)), "A8710F", true);
    }

    const links = [{ text: "発表 ", options: { bold: true, color: "3D4A5C" } }, { text: "原文（公式）", options: { hyperlink: { url: slide.references.announcement }, color: "0B5CAD" } }];
    (slide.references.learn || []).slice(0, 3).forEach((l) => links.push({ text: "　｜　", options: { color: "6B778A" } }, { text: l.title, options: { hyperlink: { url: l.url }, color: "0B5CAD" } }));
    s.addText(links, { x: 0.4, y: 7.0, w: 10.5, h: 0.3, fontFace: FONT, fontSize: 9, fit: "shrink" });
    const clouds = (slide.meta.cloudInstances || []).join(" ／ ");
    s.addText(`${clouds ? `提供範囲: ${clouds}　` : ""}ID ${slide.key}`, { x: 9.0, y: 7.1, w: 3.95, h: 0.25, fontFace: FONT, fontSize: 8, color: "6B778A", align: "right", fit: "shrink" });

    if ((slide.qa || []).length) {
      const mark = (a) => (a.assertion === "inference" ? "（推測）" : a.assertion === "recommendation" ? "（提案）" : a.verification === "verified" ? "" : "（未確認）");
      const notes = slide.qa.map((entry, i) => {
        const src = (entry.answer.evidence || []).map((e) => e.url).filter(Boolean)[0];
        return `Q${i + 1}. ${entry.question}\nA. ${plain(entry.answer.text)}${mark(entry.answer)}${src ? `\n根拠: ${src}` : ""}`;
      });
      s.addNotes(`【想定問答】\n\n${notes.join("\n\n")}`);
    }
  }

  // 先頭の概要表（15 件ごとに分割）。ページ番号は概要スライドの枚数を含めて数える。
  function addSummary(pptx, slides) {
    const PER = 15;
    const pages = Math.max(1, Math.ceil(slides.length / PER));
    const head = (text, align) => ({ text, options: { bold: true, color: "FFFFFF", fill: { color: "0B2A4A" }, align: align || "left", fontFace: FONT, fontSize: 11 } });
    for (let p = 0; p < pages; p += 1) {
      const s = pptx.addSlide();
      s.addText(pages > 1 ? `目次・概要（${p + 1}/${pages}）` : "目次・概要", { x: 0.4, y: 0.25, w: 9, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: "0B2A4A" });
      s.addText(`${slides.length} 件（表示中の更新）`, { x: 0.4, y: 0.85, w: 9, h: 0.3, fontFace: FONT, fontSize: 11, color: "3D4A5C" });
      const rows = [[head("#", "right"), head("種類"), head("タイトル"), head("掲載日"), head("ページ", "right")]];
      slides.slice(p * PER, (p + 1) * PER).forEach((slide, i) => {
        const n = p * PER + i;
        const cell = (text, align) => ({ text, options: { fontFace: FONT, fontSize: 10.5, color: "1B2430", align: align || "left" } });
        rows.push([cell(String(n + 1), "right"), cell(slide.label), cell(slide.title.ja), cell(slide.meta.publishedJst), cell(String(pages + 1 + n), "right")]);
      });
      s.addTable(rows, { x: 0.4, y: 1.3, w: 12.5, colW: [0.5, 1.4, 8.2, 1.4, 1.0], border: { type: "solid", color: "C9D4E6", pt: 0.75 }, valign: "middle", rowH: 0.36 });
    }
  }
  async function run(button, status) {
    const keys = window.digestVisibleSlideJsonKeys ? window.digestVisibleSlideJsonKeys() : [];
    const unique = [...new Set(keys)].slice(0, LIMIT);
    if (unique.length === 0) {
      window.alert("表示中のスライドがありません");
      return;
    }
    button.disabled = true;
    try {
      const PptxGenJS = await loadPptx();
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.title = "Microsoft Copilot Update Digest";
      const slides = [];
      for (let i = 0; i < unique.length; i += 1) {
        status.textContent = `${i + 1} / ${unique.length}`;
        const response = await fetch(new URL(`slides/${unique[i]}.json`, root));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        slides.push((await response.json()).slides[0]);
      }
      addSummary(pptx, slides);
      slides.forEach((slide) => addSlide(pptx, slide));      await pptx.writeFile({ fileName: "m365-copilot-update-digest.pptx" });
      status.textContent = `${unique.length} 件を保存しました`;
    } catch (error) {
      status.textContent = "";
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  buttons.forEach((button) => {
    const status = button.parentElement.querySelector("[data-download-status]");
    button.hidden = false;
    button.addEventListener("click", () => run(button, status));
  });
})();
