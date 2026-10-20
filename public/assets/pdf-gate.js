(() => {
  // 暗号化済み PDF（.pdf.enc）をブラウザ内でパスワード復号して開く／まとめて保存する。パスワードはサーバーへ送らない。
  // 最新の 1 件は暗号化なしの無料サンプルとして公開している。
  const scriptSrc = document.currentScript ? document.currentScript.src : location.href;
  const root = new URL("../", scriptSrc);
  const MAGIC = "M365PDF1";
  // 300 枚までは確認なしでまとめる。超えると時間がかかりブラウザが重くなるので警告し、1000 枚を上限にする。
const WARN_AT = 300;
const MERGE_LIMIT = 1000;
  const b64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  let keyPromise = null;
  let gate = null;
  let index = null;

  async function deriveKey(password) {
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: gate.kdf.hash, iterations: gate.kdf.iterations, salt: b64(gate.salt) },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
  }

  async function decrypt(key, bytes) {
    const head = new TextDecoder().decode(bytes.slice(0, MAGIC.length));
    if (head !== MAGIC) {
      throw new Error("invalid file");
    }
    const iv = bytes.slice(MAGIC.length, MAGIC.length + 12);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(MAGIC.length + 12));
  }

  function unlock() {
    if (keyPromise) {
      return keyPromise;
    }
    const password = window.prompt("スライド PDF のパスワードを入力してください");
    if (!password) {
      return Promise.reject(new Error("cancelled"));
    }
    keyPromise = deriveKey(password)
      .then(async (key) => {
        try {
          await decrypt(key, b64(gate.verifier));
        } catch {
          throw new Error("パスワードが違います");
        }
        return key;
      })
      .catch((error) => {
        keyPromise = null;
        throw error;
      });
    return keyPromise;
  }

  // 暗号化 PDF の URL。鍵（ソルト）が変わったら URL も変わるので、古いキャッシュを使い回さない。
  const encUrl = (entry) => `pdf/${entry.key}.pdf.enc?v=${encodeURIComponent((gate.salt || "").slice(0, 12))}`;

  async function fetchPdf(entry) {
    if (entry.free) {
      const response = await fetch(new URL(`pdf/${entry.key}.pdf`, root));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    const key = await unlock();
    // 復号に失敗したら、キャッシュを使わずにもう一度取得する（デプロイ直後は、古い暗号化 PDF が残っていることがある）
    for (const cache of ["default", "reload"]) {
      const response = await fetch(new URL(encUrl(entry), root), { cache });
      if (!response.ok) {
        throw new Error(`PDF を取得できませんでした（HTTP ${response.status}）`);
      }
      try {
        return new Uint8Array(await decrypt(key, new Uint8Array(await response.arrayBuffer())));
      } catch {
        // 次の試行へ
      }
    }
    throw new Error("PDF を復号できませんでした。ページを再読み込みして、もう一度お試しください（公開の更新直後は、古いデータが残っていることがあります）。");
  }

  // メッセージのないエラー（復号の失敗など）でも、空のダイアログを出さない
  function report(error) {
    if (error && error.message === "cancelled") {
      return;
    }
    window.alert((error && error.message) || "PDF の作成に失敗しました。ページを再読み込みして、もう一度お試しください。");
  }

  function loadPdfLib() {
    if (window.PDFLib) {
      return Promise.resolve(window.PDFLib);
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("assets/vendor/pdf-lib.min.js", root).href;
      script.onload = () => resolve(window.PDFLib);
      script.onerror = () => reject(new Error("PDF ライブラリを読み込めませんでした"));
      document.head.appendChild(script);
    });
  }

  async function appendPdf(merged, url) {
    const response = await fetch(new URL(url, root));
    if (response.ok) {
      const doc = await window.PDFLib.PDFDocument.load(await response.arrayBuffer());
      (await merged.copyPages(doc, doc.getPageIndices())).forEach((page) => merged.addPage(page));
    }
  }

  const TOC_PER_PAGE = 15;

  // 目次ページはブラウザの canvas で描いて PNG にする（日本語フォントを PDF に埋め込まずに済む）
  async function tocPages(entries) {
    const totalToc = Math.max(1, Math.ceil(entries.length / TOC_PER_PAGE));
    let pageNo = 2 + totalToc;
    const starts = entries.map((entry) => {
      const start = pageNo;
      pageNo += entry.pages || 1;
      return start;
    });
    const pages = [];
    for (let p = 0; p < totalToc; p += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = 2560;
      canvas.height = 1440;
      const ctx = canvas.getContext("2d");
      ctx.scale(2, 2);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1280, 720);
      const font = (size, weight) => `${weight} ${size}px "Noto Sans JP","Yu Gothic UI","Meiryo","Hiragino Sans",sans-serif`;
      ctx.fillStyle = "#0b2a4a";
      ctx.font = font(32, 700);
      ctx.fillText(totalToc > 1 ? `目次・概要（${p + 1}/${totalToc}）` : "目次・概要", 70, 80);
      ctx.fillStyle = "#3d4a5c";
      ctx.font = font(16, 400);
      ctx.fillText(`${entries.length} 件（種類順、同じ種類は新しい順）`, 70, 112);
      entries.slice(p * TOC_PER_PAGE, (p + 1) * TOC_PER_PAGE).forEach((entry, i) => {
        const y = 160 + i * 36;
        const n = p * TOC_PER_PAGE + i;
        ctx.fillStyle = "#0b6bcb";
        ctx.font = font(18, 700);
        ctx.fillText(`${n + 1}.`, 70, y);
        ctx.fillStyle = "#1b2430";
        ctx.font = font(18, 400);
        let text = `【${entry.label}】${entry.title}`;
        while (ctx.measureText(text).width > 1000 && text.length > 4) {
          text = `${text.slice(0, -2)}…`;
        }
        ctx.fillText(text, 120, y);
        ctx.fillStyle = "#6b778a";
        ctx.textAlign = "right";
        ctx.fillText(`p.${starts[n]}`, 1210, y);
        ctx.textAlign = "left";
      });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      pages.push(new Uint8Array(await blob.arrayBuffer()));
    }
    return pages;
  }

  const KIND_ORDER = ["preview", "ga", "rolling-out", "in-development", "retirement", "update"];
  const KIND_COLOR = { ga: "#1b7f3b", preview: "#7a4fd0", "rolling-out": "#0b6bcb", "in-development": "#d98b00", retirement: "#c62828", update: "#5b6777" };
  const FONT_STACK = '"Noto Sans JP","Yu Gothic UI","Meiryo","Hiragino Sans",sans-serif';

  // 文字数が多くても枠に収まるよう、日本語を 1 文字ずつ数えて折り返す（最大行数を超えたら末尾を … にする）
  function wrapLines(ctx, text, maxWidth, maxLines) {
    const lines = [];
    let line = "";
    for (const ch of String(text).replace(/\s+/g, " ").trim()) {
      if (ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch === " " ? "" : ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      let last = kept[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
      kept[maxLines - 1] = last + "…";
      return kept;
    }
    return lines;
  }

  // スライドがない更新の簡易ページ。要約だけを 1 ページに載せる（canvas で描いて PNG にする。日本語フォントは埋め込まない）
  async function fallbackPage(entry) {
    const W = 1280;
    const H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    const font = (size, weight) => `${weight} ${size}px ${FONT_STACK}`;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    const color = KIND_COLOR[entry.kind] || "#5b6777";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 14, H);
    let x = 70;
    const chip = (text, fill, textColor) => {
      ctx.font = font(18, 700);
      const w = ctx.measureText(text).width + 28;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x, 48, w, 34, 17);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.fillText(text, x + 14, 72);
      x += w + 12;
    };
    if (entry.kindLabel) chip(entry.kindLabel, color, "#fff");
    if (entry.importanceLabel) chip(entry.importanceLabel, "#fde8e8", "#c62828");
    chip("簡易版（要約のみ）", "#eef2f7", "#51607a");
    ctx.fillStyle = "#0b2a4a";
    ctx.font = font(38, 700);
    let y = 150;
    for (const line of wrapLines(ctx, entry.title, 1140, 3)) {
      ctx.fillText(line, 70, y);
      y += 52;
    }
    if (entry.titleEn && entry.titleEn !== entry.title) {
      ctx.fillStyle = "#6b778a";
      ctx.font = font(18, 400);
      for (const line of wrapLines(ctx, entry.titleEn, 1140, 1)) ctx.fillText(line, 70, y - 4);
      y += 28;
    }
    ctx.fillStyle = "#3d4a5c";
    ctx.font = font(18, 400);
    const meta = ["発行 " + entry.publishedJst, entry.source, entry.product, entry.ids.length ? "ID " + entry.ids.join(", ") : ""].filter(Boolean).join("　／　");
    for (const line of wrapLines(ctx, meta, 1140, 1)) ctx.fillText(line, 70, y + 10);
    y += 44;
    if (entry.categories.length) {
      ctx.fillStyle = "#51607a";
      ctx.fillText("カテゴリ: " + entry.categories.join(" ・ "), 70, y);
      y += 40;
    }
    ctx.fillStyle = "#1b2430";
    ctx.font = font(26, 400);
    for (const line of wrapLines(ctx, entry.summary, 1140, 6)) {
      ctx.fillText(line, 70, y + 10);
      y += 42;
    }
    if (entry.reason) {
      y += 6;
      ctx.fillStyle = "#6b778a";
      ctx.font = font(18, 400);
      for (const line of wrapLines(ctx, "注目理由: " + entry.reason, 1140, 2)) {
        ctx.fillText(line, 70, y + 10);
        y += 28;
      }
    }
    ctx.fillStyle = "#6b778a";
    ctx.font = font(16, 400);
    ctx.fillText("この更新には、まだ解説スライドがありません。", 70, H - 78);
    let link = null;
    if (entry.url) {
      ctx.fillStyle = "#0b5cad";
      ctx.font = font(18, 400);
      const label = "原文: " + entry.url;
      const shown = wrapLines(ctx, label, 1140, 1)[0];
      ctx.fillText(shown, 70, H - 44);
      link = { url: entry.url, x: 70, y: H - 64, w: Math.min(ctx.measureText(shown).width, 1140), h: 28 };
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    return { png: new Uint8Array(await blob.arrayBuffer()), link, scale: 960 / W, height: 540 };
  }

  function addLinkAnnotation(PDFLib, doc, page, link, scale, pageHeight) {
    const rect = [link.x * scale, pageHeight - (link.y + link.h) * scale, (link.x + link.w) * scale, pageHeight - link.y * scale];
    const annotation = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: rect, Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFLib.PDFString.of(link.url) } });
    page.node.addAnnot(doc.context.register(annotation));
  }

  async function mergeVisible(button, status) {
    const seen = new Set();
    const visible = (window.digestVisibleEntries ? window.digestVisibleEntries() : []).filter((entry) => (seen.has(entry.key) ? false : seen.add(entry.key)));
    const all = visible.slice(0, MERGE_LIMIT);
    const keys = all.filter((entry) => entry.hasSlide).map((entry) => entry.slideKey);
    if (all.length === 0) {
      window.alert("表示中のスライドがありません");
      return;
    }
    if (visible.length > MERGE_LIMIT) {
      if (!window.confirm(`PDF にまとめられるのは ${MERGE_LIMIT} 枚までです。先頭の ${MERGE_LIMIT} 枚（全 ${visible.length} 枚）で作成します。続けますか？`)) return;
    } else if (all.length > WARN_AT && !window.confirm(`${all.length} 枚をまとめます。${WARN_AT} 枚を超えるため、時間がかかり、ブラウザが重くなることがあります。続けますか？`)) {
      return;
    }
    button.disabled = true;
    try {
      const PDFLib = await loadPdfLib();
      const merged = await PDFLib.PDFDocument.create();
      await appendPdf(merged, "pdf/cover.pdf");
      const keySet = new Set(keys);
      const entries = index.slides.filter((slide) => keySet.has(slide.key));
      const fallbacks = all
        .filter((entry) => !entry.hasSlide)
        .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.publishedJst.localeCompare(a.publishedJst));
      const tocEntries = [...entries, ...fallbacks.map((entry) => ({ label: entry.kindLabel || "更新", title: `（簡易）${entry.title}`, pages: 1 }))];
      for (const png of await tocPages(tocEntries)) {
        const image = await merged.embedPng(png);
        const page = merged.addPage([960, 540]);
        page.drawImage(image, { x: 0, y: 0, width: 960, height: 540 });
      }
      for (let i = 0; i < entries.length; i += 1) {
        status.textContent = `${i + 1} / ${entries.length}`;
        const entry = entries[i];
        const source = await PDFLib.PDFDocument.load(await fetchPdf(entry));
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
      }
      for (let i = 0; i < fallbacks.length; i += 1) {
        status.textContent = `${entries.length + i + 1} / ${tocEntries.length}`;
        const made = await fallbackPage(fallbacks[i]);
        const image = await merged.embedPng(made.png);
        const page = merged.addPage([960, 540]);
        page.drawImage(image, { x: 0, y: 0, width: 960, height: 540 });
        if (made.link) addLinkAnnotation(PDFLib, merged, page, made.link, made.scale, made.height);
      }
      await appendPdf(merged, "pdf/end.pdf");
      const blob = new Blob([await merged.save()], { type: "application/pdf" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = "m365-copilot-update-digest.pdf";
      anchor.click();
      status.textContent = `${tocEntries.length} 件を保存しました`;
    } catch (error) {
      status.textContent = "";
      report(error);
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest && event.target.closest("a[data-slide-pdf]");
    if (!link || !index) {
      return;
    }
    event.preventDefault();
    const entry = index.slides.find((slide) => slide.key === link.getAttribute("data-slide-pdf"));
    if (!entry) {
      return;
    }
    fetchPdf(entry)
      .then((pdf) => window.open(URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })), "_blank", "noopener"))
      .catch(report);
  });

  fetch(new URL("data/slides.json", root), { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!data || !data.slides || data.slides.length === 0) {
        return;
      }
      index = data;
      gate = data.pdfGate;
      document.querySelectorAll("[data-download-merged]").forEach((button) => {
        const status = button.parentElement.querySelector("[data-download-status]");
        button.hidden = false;
        button.addEventListener("click", () => mergeVisible(button, status));
      });
    })
    .catch(() => {});
})();
