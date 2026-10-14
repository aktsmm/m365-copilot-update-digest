# スライド JSON（1 更新 = 1 枚）

重要度が「重要」「注目」の更新を、直近 3 か月分、1 更新 1 枚のスライドとして出力します。

- スキーマ: [`schema/slide.schema.json`](../schema/slide.schema.json)（JSON Schema 2020-12）
- 生成: `scripts/lib/slides.mjs`（`npm run build:pages` が `site/slides/{key}.json` を出力）
- PDF: `npm run build:slide-pdfs`（`site/pdf/{key}.pdf.enc`、`site/data/slides.json`）

## 方針

1. **公開ソースにある内容だけで作る。** タイトル・要約・段階・関連ドキュメントはイベントデータそのままで、LLM による書き足しはしません。
2. **同じ入力なら同じ出力。** キー順を固定し、生成時刻を混ぜません。`inputFingerprint` は入力と分類設定のハッシュです。
3. **不正なスライドは公開を止めない。** スキーマ検証に失敗した 1 件は警告してスキップします。

## `kind`

| kind | 元の `releaseStage` |
| --- | --- |
| `ga` | GA / Launched |
| `preview` | Preview |
| `rolling-out` | Rolling out |
| `in-development` | In development |
| `retirement` | Retirement / Cancelled |
| `update` | 上記以外 |

並び順は `preview` → `ga` → `rolling-out` → `in-development` → `retirement` → `update`、同種別は発行日の新しい順です。

## PDF の暗号化

`PDF_PASSWORD`（リポジトリ Secret）が設定されているときだけ PDF を公開します。形式は `M365PDF1 | iv(12) | ciphertext | tag(16)`（AES-256-GCM）で、鍵は `data/slides.json` の `pdfGate.salt` から PBKDF2-SHA256（210000 回）で導出します。`pdfGate.verifier` でパスワードの正否を先に確認します。パスワードを変えたら `deploy-pages.yml` を再実行してください。
