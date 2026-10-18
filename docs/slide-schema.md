# スライド JSON（1 更新 = 1 枚）

直近 3 か月の更新を、重要度を問わず（重要なものから順に）、1 更新 1 枚の解説スライドにします。本家 [azure-update-digest](https://github.com/aktsmm/azure-update-digest) のスライド仕様を M365 向けにしたものです。

- スキーマ: [`schema/slide.schema.json`](../schema/slide.schema.json)（JSON Schema 2020-12）。任意項目 `qa` に想定問答（質問と根拠付きの回答、最大 5 件）を持てます。スライドには描画せず、PowerPoint のスライドノートにだけ出力します。
- 品質の基準（完成見本）: [`examples/slide.sample.json`](../examples/slide.sample.json)（GA とプレビューの 2 枚）
- 生成: gh-aw の [`slide.md`](../.github/workflows/slide.md)（Learn MCP で根拠を取得し、`data/slides/{key}.json` を書く）
- 検証・描画: `npm run validate:slides` / `npm run pdf -- --ids <key> --out dist-pdf`
- 公開: `npm run build:pages` が `site/slides/{key}.json` を、`npm run build:slide-pdfs` が暗号化 PDF を出力

## 運用の流れ

1. **Dispatch slide generation**（毎日 03:00 / 15:00 JST）: スライドがない更新（直近 3 か月、重要な順、同じなら新しい順）を各最大 30 件、`slide.lock.yml` へ 1 件ずつ起動
2. **slide（gh-aw）**: `.work/slide-input.json`（原文・段階・提供範囲・検証済み Learn 候補）を入力に、Learn の実ページを取得してスライド JSON を書き、検証と PDF 描画を行い PR を作成（タイトル `[slides] …`）
3. **Auto-merge slides**: PR が `data/slides/{key}.json` 1 件だけで、スキーマ・意味検証・描画確認を main 側のコードで通ったものだけをマージし、Pages を再デプロイ。検証や描画確認に落ちた PR はコメントを付けてクローズし、次回の生成で作り直す
4. **Dispatch slide Q&A backfill**（毎日 04:00 JST）: 想定問答（`qa`）がない既存スライドを最大 20 件、[`slide-qa.md`](../.github/workflows/slide-qa.md)（gh-aw）へ 1 件ずつ起動。`scripts/check-qa-only.mjs` で `qa` 以外が変わっていないことを確認し、同じ Auto-merge slides でマージ
5. **Watchdog**（毎日 05:41 JST、AI なし）: 40 分を超えて動くエージェント実行を取り消し、失敗した Pages デプロイを 1 回だけ再実行

## 想定問答（`qa`、任意）

発表者が聞かれそうな質問（提供時期、対応の要否、ライセンス・前提条件、制限、類似機能との違い、管理設定など）を、最大 5 件持てます。`question` は 4〜120 文字、`answer` は他の文と同じ claim（出自・断定の強さ・検証状態・根拠）です。**スライドには描画せず**、PowerPoint のスライドノートにだけ「【想定問答】Q1. … A. …」と出力します。推測・提案・未確認の回答には（推測）（提案）（未確認）の印と根拠 URL を付けます。`api/v1/qa.json` と各更新の `qa` からも取得できます。

## 方針

1. **確認できることだけ書く。** 確認できない項目は省くか、パネルの `availability` を `present` 以外にして描画しません。「未確認」「記載なし」「要確認」「〜と推定される」などの社内メモ的・言い逃れ的な文言は検証で拒否します（機能名の「推定メモリ使用量」のような語は可）。
2. **すべての文（claim）に出自・断定の強さ・検証状態・根拠を持たせる。** `verified` には `evidence` が必須、`fact` の出自に `editorial` は使えず、提案（`recommendation`）は `verified` にできません。提案は橙色の破線枠で事実と区別します。
3. **月単位の時期は月単位のまま。** 架空の日付にしません。
4. **根拠 URL は許可ホストのみ**（learn.microsoft.com / www.microsoft.com / techcommunity.microsoft.com など）。関連資料（`references.learn`）は最大 3 件で、`ja-jp` が存在すればそちらを使い、フッターにクリックできるリンクとして出します。

## `kind` とパネル

| kind | 元の段階 | core パネル | detail パネル |
| --- | --- | --- | --- |
| `ga` | GA / Launched | how-it-works, how-to-start | prerequisites-limits, related-features, use-case |
| `rolling-out` | Rolling out | how-it-works, how-to-start | prerequisites-limits, rollout-scope, use-case |
| `preview` | Preview | scope, constraints | evaluate |
| `in-development` | In development | scope, constraints | prepare |
| `retirement` | Retirement / Cancelled | impact, migration | action-plan |
| `update` | 上記以外 | scope | impact-check |

並び順は `preview` → `ga` → `rolling-out` → `in-development` → `retirement` → `update`、同種別は発行日の新しい順です。

## 画面

タイトル・副題、「誰に関係するか／嬉しい点／対応の要否」、Before → After（または「何が嬉しいのか」）、種類別パネル、用語ミニ解説、提案、フッターの原文・関連資料リンク、提供範囲（クラウド環境・プラットフォーム）を 1 枚に収めます。収まらないときは文字サイズを下げ、それでも収まらなければ詳細パネルを 2 枚目へ回します（`npm run pdf` と `build:slide-pdfs` は最小サイズでも溢れる場合に失敗として扱います）。

## PDF の暗号化

`PDF_PASSWORD`（リポジトリ Secret）が設定されているときだけ PDF を公開します。最新の 1 件は暗号化なしの無料サンプルです。形式は `M365PDF1 | iv(12) | ciphertext | tag(16)`（AES-256-GCM）で、鍵は `data/slides.json` の `pdfGate.salt` から PBKDF2-SHA256（210000 回）で導出します。`pdfGate.verifier` でパスワードの正否を先に確認します。パスワードを変えたら `deploy-pages.yml` を再実行してください。

## まとめ PDF（表紙・目次・終了ページ）

「PDF」ボタンは、チェックで選んだ表示中の更新を 1 つの PDF にまとめます。表紙、目次・概要（種類順、ページ番号付き。ブラウザの canvas で描画して挿入）、各スライド、終了ページの順です。

## PowerPoint 書き出し

サイトのボタンで、各カードのチェックで選んだスライドを、ブラウザ内で編集可能な .pptx にできます（`public/assets/pptx-export.js`、pptxgenjs）。パスワードは不要で、`slides/{key}.json` を入力にします。想定問答（`qa`）があるスライドは、スライドノートに出力します。
