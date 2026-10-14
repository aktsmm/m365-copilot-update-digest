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
  const KIND_COLOR = { ga: "1B7F3B", preview: "7A4FD0", "rolling-out": "0B6BCB", "in-development": "5B6777", retirement: "C62828", update: "5B6777" };
  const LEVEL_LABEL = { high: "重要", notable: "注目", normal: "通常" };

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

  function addSlide(pptx, slide) {
    const s = pptx.addSlide();
    const color = KIND_COLOR[slide.kind] || "5B6777";
    s.addText(slide.title.ja, { x: 0.5, y: 0.3, w: 10.6, h: 1.0, fontFace: FONT, fontSize: 26, bold: true, color: "0B2A4A", valign: "top", fit: "shrink" });
    s.addText(slide.label, { x: 11.3, y: 0.35, w: 1.6, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: "FFFFFF", align: "center", fill: { color }, shape: pptx.ShapeType.roundRect, rectRadius: 0.25 });
    if (slide.title.en && slide.title.en !== slide.title.ja) {
      s.addText(slide.title.en, { x: 0.5, y: 1.3, w: 12.3, h: 0.35, fontFace: FONT, fontSize: 11, color: "6B778A", fit: "shrink" });
    }
    const chips = [slide.meta.publishedJst, slide.meta.productArea, slide.meta.stage, slide.meta.importance.level !== "normal" ? LEVEL_LABEL[slide.meta.importance.level] : "", ...(slide.meta.roleTags || [])].filter(Boolean);
    s.addText(chips.join("   ｜   "), { x: 0.5, y: 1.7, w: 12.3, h: 0.4, fontFace: FONT, fontSize: 12, color: "3D4A5C", fit: "shrink" });

    let y = 2.2;
    const boxes = [
      slide.audienceJa ? ["誰に関係するか", slide.audienceJa, "0B6BCB"] : null,
      slide.actionJa ? ["対応・確認", slide.actionJa, "1B7F3B"] : null,
    ].filter(Boolean);
    boxes.forEach(([label, text, line], index) => {
      const w = boxes.length === 1 ? 12.3 : 6.05;
      s.addText([{ text: `${label}\n`, options: { fontSize: 11, color: "5B6777" } }, { text, options: { fontSize: 15, bold: true, color: "0B2A4A" } }], {
        x: 0.5 + index * 6.25, y, w, h: 0.95, fontFace: FONT, valign: "top", line: { color: line, width: 1.25 }, fit: "shrink",
      });
    });
    if (boxes.length) {
      y += 1.1;
    }
    if (slide.summaryJa) {
      const h = 6.3 - y;
      s.addText(slide.summaryJa, { x: 0.5, y, w: 12.3, h, fontFace: FONT, fontSize: slide.summaryJa.length > 500 ? 14 : 18, color: "1B2430", valign: "top", line: { color: "B8C7DC", width: 1 }, fit: "shrink" });
    }
    const related = (slide.references.related || []).map((doc) => ({ text: `${doc.title}\n`, options: { hyperlink: { url: doc.url }, fontSize: 11, color: "0B5CAD" } }));
    if (related.length) {
      s.addText([{ text: "関連ドキュメント\n", options: { bold: true, fontSize: 11, color: "0B6BCB" } }, ...related], { x: 0.5, y: 6.35, w: 12.3, h: 0.75, fontFace: FONT, valign: "top", fit: "shrink" });
    }
    s.addText([{ text: `出典: ${slide.meta.sourceName} ／ `, options: { color: "6B778A" } }, { text: slide.references.source, options: { hyperlink: { url: slide.references.source }, color: "0B5CAD" } }], { x: 0.5, y: 7.1, w: 11, h: 0.3, fontFace: FONT, fontSize: 9 });
    s.addText(`ID ${slide.key}`, { x: 11, y: 7.1, w: 1.8, h: 0.3, fontFace: FONT, fontSize: 9, color: "6B778A", align: "right" });
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
      pptx.title = "M365 Copilot Update Digest";
      for (let i = 0; i < unique.length; i += 1) {
        status.textContent = `${i + 1} / ${unique.length}`;
        const response = await fetch(new URL(`slides/${unique[i]}.json`, root));
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        addSlide(pptx, await response.json());
      }
      await pptx.writeFile({ fileName: "m365-copilot-update-digest.pptx" });
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
