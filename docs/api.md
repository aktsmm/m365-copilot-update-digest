# JSON API（静的）

GitHub Pages から配信する読み取り専用の静的 JSON です。認証は不要で、ブラウザや Power Automate、スクリプトから `GET` できます。

ベース URL: `https://aktsmm.github.io/m365-copilot-update-digest/`

## エンドポイント（`api/v1/`）

| パス | 内容 |
| --- | --- |
| `api/v1/index.json` | バージョン、取得時点（`snapshotAt`）、件数、ソース別の取得状態（`coverage`）、カテゴリと重要度の定義、月の一覧、エンドポイント一覧 |
| `api/v1/latest.json` | 取得時点までの直近 30 日（JST）の更新 |
| `api/v1/months/YYYY-MM.json` | 月別の更新一覧（発行日の JST 月） |
| `api/v1/updates/{key}.json` | 1 件の詳細 |
| `api/v1/categories/{category}.json` | カテゴリ別の軽量索引（複数所属あり） |
| `slides/{key}.json` | スライド JSON（[スキーマ](../schema/slide.schema.json)）。直近 3 か月の「重要」「注目」のみ |
| `data/slides.json` | 公開している暗号化 PDF の一覧と、復号用の検証値（`pdfGate`） |

検索 API はありません。月別ファイルを取得して、クライアント側で絞り込んでください。

## 更新（item）のフィールド

`key`、`title` / `summary`（`ja` / `en`）、`publishedJst`、`stage`、`productArea`、`sourceId` / `sourceName` / `sourceFamily`、`categories`（表示カテゴリ、複数可）、`importance`（`level` / `score` / `reasonJa`）、`roleTags`、`roadmapIds`、`tags`、`related`（Microsoft Learn の確認済み資料）、`urls`（`self` / `source` / 存在する場合 `slide` と `slidePdfEncrypted`）。

## 注意

- **取得状態**: `coverage.status` が `complete` 以外のときは、ソースの取得に欠けがある可能性があります。件数が少なくても 0 件とは限りません。`coverage.sources[]` の `empty` は「取得できたが 0 件」（フィードが空など）です。
- **安定性**: `schema` と `apiVersion` を持ちます。互換性のない変更は `api/v2/` に分けます。
- **スライド PDF**: 最新の 1 件は暗号化なしの無料サンプル（`pdf/{key}.pdf`、`data/slides.json` の `free: true`）です。それ以外の `pdf/{key}.pdf.enc` は AES-256-GCM で暗号化しています（形式は `scripts/lib/pdf-crypto.mjs`）。サイトのリンクからパスワードを入力するとブラウザ内で復号して開き、表示中のスライドを 1 つの PDF にまとめて保存もできます。
- **ライセンス**: CC BY-NC-SA 4.0。Microsoft の原文は対象外です。出典を明記してください。
