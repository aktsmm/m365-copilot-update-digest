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

  async function mergeVisible(button, status) {
    const keys = [...new Set(window.digestVisibleSlideKeys ? window.digestVisibleSlideKeys() : [])].slice(0, MERGE_LIMIT);
    if (keys.length === 0) {
      window.alert("表示中のスライドがありません");
      return;
    }
    button.disabled = true;
    try {
      const PDFLib = await loadPdfLib();
      const merged = await PDFLib.PDFDocument.create();
      await appendPdf(merged, "pdf/cover.pdf");
      for (let i = 0; i < keys.length; i += 1) {
        status.textContent = `${i + 1} / ${keys.length}`;
        const entry = index.slides.find((slide) => slide.key === keys[i]);
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
      status.textContent = `${keys.length} 件を保存しました`;
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
