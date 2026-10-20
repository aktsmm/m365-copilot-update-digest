import crypto from "node:crypto";

// 形式: MAGIC(8) | iv(12) | ciphertext | tag(16)。鍵は全ファイル共通の salt から PBKDF2 で導出する。
export const MAGIC = Buffer.from("M365PDF1", "ascii");
export const KDF = { name: "PBKDF2", hash: "SHA-256", iterations: 210000 };
const VERIFIER_PLAINTEXT = "m365-copilot-update-digest";

export function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, KDF.iterations, 32, "sha256");
}

export function encryptBuffer(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
}

export function decryptBuffer(key, blob) {
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not an encrypted PDF");
  const iv = blob.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = blob.subarray(blob.length - 16);
  const body = blob.subarray(MAGIC.length + 12, blob.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/** ブラウザがパスワードの正否を先に確認するための検証値（鍵が合うときだけ復号できる）。 */
// ソルトはパスワードから決まる固定値にする。デプロイのたびに鍵が変わると、ブラウザに古い slides.json や暗号化 PDF が残っているときに復号できなくなる。
// ソルトは秘密ではない（パスワードを変えれば、ソルトも鍵も変わる）。
export function deterministicSalt(password) {
  return crypto.createHash("sha256").update(`m365-copilot-update-digest:pdf-gate:${password}`).digest().subarray(0, 16);
}

export function createGate(password, salt = deterministicSalt(password)) {
  const key = deriveKey(password, salt);
  const verifier = encryptBuffer(key, Buffer.from(VERIFIER_PLAINTEXT, "utf8"));
  return {
    key,
    gate: {
      kdf: { name: KDF.name, hash: KDF.hash, iterations: KDF.iterations },
      salt: salt.toString("base64"),
      verifier: verifier.toString("base64"),
    },
  };
}

export { VERIFIER_PLAINTEXT };
