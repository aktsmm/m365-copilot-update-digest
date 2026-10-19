(() => {
  // 暗号化済み PDF（.pdf.enc）をブラウザ内でパスワード復号して開く／まとめて保存する。パスワードはサーバーへ送らない。
  // 最新の 1 件は暗号化なしの無料サンプルとして公開している。
  const scriptSrc = document.currentScript ? document.currentScript.src : location.href;
  const root = new URL("../", scriptSrc);
  const MAGIC = "M365PDF1";
  const MERGE_LIMIT = 80;
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

  async function fetchPdf(entry) {
    if (entry.free) {
      const response = await fetch(new URL(`pdf/${entry.key}.pdf`, root));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    }
    const key = await unlock();
    const response = await fetch(new URL(`pdf/${entry.key}.pdf.enc`, root));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return new Uint8Array(await decrypt(key, new Uint8Array(await response.arrayBuffer())));
  }

  function report(error) {
    if (error.message !== "cancelled") {
      window.alert(error.message);
    }
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

  async function mergeVisible(button, status) {
    const all = [...new Set(window.digestVisibleSlideKeys ? window.digestVisibleSlideKeys() : [])];
    const keys = all.slice(0, MERGE_LIMIT);
    if (keys.length === 0) {
      window.alert("表示中のスライドがありません");
      return;
    }
    if (all.length > MERGE_LIMIT && !window.confirm(`PDF にまとめられるのは ${MERGE_LIMIT} 枚までです。先頭の ${MERGE_LIMIT} 枚（全 ${all.length} 枚）で作成します。続けますか？`)) {
      return;
    }
    button.disabled = true;
    try {
      const PDFLib = await loadPdfLib();
      const merged = await PDFLib.PDFDocument.create();
      await appendPdf(merged, "pdf/cover.pdf");
      const keySet = new Set(keys);
      const entries = index.slides.filter((slide) => keySet.has(slide.key));
      for (const png of await tocPages(entries)) {
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
      await appendPdf(merged, "pdf/end.pdf");
      const blob = new Blob([await merged.save()], { type: "application/pdf" });
      const anchor = document.createElement("a");
      anchor.href = URL.createObjectURL(blob);
      anchor.download = "m365-copilot-update-digest.pdf";
      anchor.click();
      status.textContent = `${entries.length} 件を保存しました`;
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

  fetch(new URL("data/slides.json", root))
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
