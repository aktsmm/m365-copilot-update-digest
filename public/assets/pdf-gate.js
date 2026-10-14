(() => {
  // 暗号化済み PDF（.pdf.enc）をブラウザ内でパスワード復号して開く／まとめて保存する。パスワードはサーバーへ送らない。
  // 最新の 1 件は暗号化なしの無料サンプルとして公開している。
  const links = [...document.querySelectorAll("[data-slide-pdf]")];
  if (links.length === 0) {
    return;
  }

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

  async function mergeVisible(button, status) {
    const visible = links.filter((link) => !link.hidden && !link.closest("[data-card-item]").classList.contains("hidden"));
    const keys = [...new Set(visible.map((link) => link.getAttribute("data-slide-pdf")))].slice(0, MERGE_LIMIT);
    if (keys.length === 0) {
      window.alert("表示中のスライドがありません");
      return;
    }
    button.disabled = true;
    try {
      const PDFLib = await loadPdfLib();
      const merged = await PDFLib.PDFDocument.create();
      for (let i = 0; i < keys.length; i += 1) {
        status.textContent = `${i + 1} / ${keys.length}`;
        const entry = index.slides.find((slide) => slide.key === keys[i]);
        const source = await PDFLib.PDFDocument.load(await fetchPdf(entry));
        const pages = await merged.copyPages(source, source.getPageIndices());
        pages.forEach((page) => merged.addPage(page));
      }
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

  fetch(new URL("data/slides.json", root))
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (!data || !data.slides || data.slides.length === 0) {
        return;
      }
      index = data;
      gate = data.pdfGate;
      const published = new Map(data.slides.map((slide) => [slide.key, slide]));
      links.forEach((link) => {
        const entry = published.get(link.getAttribute("data-slide-pdf"));
        if (!entry || (!gate && !entry.free)) {
          return;
        }
        link.hidden = false;
        if (entry.free) {
          link.href = new URL(`pdf/${entry.key}.pdf`, root).href;
          link.target = "_blank";
          link.rel = "noopener";
          return;
        }
        link.addEventListener("click", (event) => {
          event.preventDefault();
          fetchPdf(entry)
            .then((pdf) => window.open(URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })), "_blank", "noopener"))
            .catch(report);
        });
      });

      document.querySelectorAll("[data-download-toolbar]").forEach((toolbar) => {
        toolbar.hidden = false;
        const button = toolbar.querySelector("[data-download-merged]");
        const status = toolbar.querySelector("[data-download-status]");
        button.addEventListener("click", () => mergeVisible(button, status));
      });
    })
    .catch(() => {});
})();
