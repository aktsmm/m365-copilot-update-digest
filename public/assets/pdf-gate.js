(() => {
  // 暗号化済み PDF（.pdf.enc）をブラウザ内でパスワード復号して開く。パスワードはサーバーへ送らない。
  const links = [...document.querySelectorAll("[data-slide-pdf]")];
  if (links.length === 0) {
    return;
  }

  const root = new URL("../", document.currentScript ? document.currentScript.src : location.href);
  const MAGIC = "M365PDF1";
  const b64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  let keyPromise = null;
  let gate = null;

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

  async function unlock() {
    if (keyPromise) {
      return keyPromise;
    }
    const password = window.prompt("スライド PDF のパスワードを入力してください");
    if (!password) {
      throw new Error("cancelled");
    }
    const key = await deriveKey(password);
    try {
      await decrypt(key, b64(gate.verifier));
    } catch {
      throw new Error("パスワードが違います");
    }
    keyPromise = Promise.resolve(key);
    return keyPromise;
  }

  async function open(link) {
    const key = await unlock();
    const response = await fetch(link.href);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const pdf = await decrypt(key, new Uint8Array(await response.arrayBuffer()));
    window.open(URL.createObjectURL(new Blob([pdf], { type: "application/pdf" })), "_blank", "noopener");
  }

  fetch(new URL("data/slides.json", root))
    .then((response) => (response.ok ? response.json() : null))
    .then((index) => {
      if (!index || !index.pdfGate) {
        return;
      }
      gate = index.pdfGate;
      const published = new Set(index.slides.map((slide) => slide.key));
      links.forEach((link) => {
        if (!published.has(link.getAttribute("data-slide-pdf"))) {
          return;
        }
        link.hidden = false;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          open(link).catch((error) => {
            if (error.message !== "cancelled") {
              window.alert(error.message);
              keyPromise = null;
            }
          });
        });
      });
    })
    .catch(() => {});
})();
