# M365 Copilot Update Digest

Microsoft 365 Copilot、Copilot Studio、Agent Builder の公開アップデートを継続的に収集し、日次 JSON、日次 Markdown、記事 draft、X 投稿 draft、GitHub Pages 向けの静的サイトを生成するリポジトリです。

現段階の実装は MVP で、まずは次の 4 系統を収集対象にしています。

- Microsoft 365 Copilot release notes
- What's new in Copilot Studio
- Microsoft 365 Copilot Blog (Tech Community RSS)
- Copilot Studio Blog (Tech Community RSS)

## できること

- 公開ソースからアップデートを取得して日次 JSON に保存する
- 日次 Markdown を生成する
- 日次イベントから記事 draft と X 投稿 draft を生成する
- GitHub Pages 向けにトップ、日次、週次、検索、About を含む静的サイトを生成する
- JSON と Markdown の raw データをサイトから参照できるようにする
- pin / hide の最小 override を JSON 設定で持つ

## セットアップ

前提:

- Node.js 22 以上
- npm

インストール:

```bash
npm install
```

## ローカル実行

収集:

```bash
npm run collect
```

サイト生成:

```bash
npm run build:pages
```

記事 draft / 投稿 draft 生成:

```bash
npm run generate:drafts
```

## 出力先

- data/events: 日次イベント JSON
- summaries/daily: 日次 Markdown
- drafts/articles/daily: 日次記事 draft
- drafts/posts/x: X 投稿 draft
- site: 静的サイト出力

## 実装方針

- 日本語既定、英語補助の二言語表示
- トップは厳選、アーカイブと検索は網羅
- 直近 72 時間の新着を別導線で出して取りこぼし感を防ぐ
- 見た目はブラウンベージュではなく、Copilot らしい淡い寒色オーロラ調
- 公式ロゴは使わず、抽象モチーフで寄せる
- 非公式であることをヘッダー近くに短く明示する

## 今後の拡張候補

- Tech Community blog 系ソースの追加
- 公開で安定取得できる release plan 系ソースの追加
- source family ごとのフィルタ拡張
- AI 要約の後段追加
- notify / draft 生成の追加

## Cloud Automation

このリポジトリでは、GitHub Actions と GitHub Copilot Cloud Agent を組み合わせた自動運用を前提にできます。

流れ:

1. `Collect updates` が定期実行され、`npm run collect` で収集、翻訳、要約生成を行う
2. 同じ run で `npm run generate:drafts` を実行し、記事 draft と X 投稿 draft を生成する
3. 生成された `data/**` と `summaries/**` と `drafts/**` と `config/summary-ja-cache.json` を main に自動 push する
4. `Deploy GitHub Pages` が Pages を再生成して公開する
5. `Author automation PR` が最新イベントを見て、改善が必要な場合は Issue を作成し、Copilot Cloud Agent に assignment する
6. Copilot が PR を作ると `Request Copilot review` と `Validate generated PR` が走る
7. `Validate generated PR` は `npm run collect` と `npm run generate:drafts` の結果が canonical でなければ PR branch に自動で書き戻す
8. 検証が通れば `Auto-merge generated PR` が merge し、`Redeploy Pages after generated PR merge` が再デプロイする

必要な設定:

- repository で GitHub Copilot coding agent を有効にする
- secret `COPILOT_ASSIGN_TOKEN` を設定する
- token には少なくとも Issues / Pull requests / Contents / Actions を扱える権限を持たせる

Cloud Agent に許可している変更対象:

- `scripts/collect.mjs`
- `scripts/generate-drafts.mjs`
- `scripts/lib/reporting.mjs`
- `config/sources.json`
- `config/summary-ja-cache.json`
- `npm run collect` で再生成される `data/**` と `summaries/daily/**`
- `npm run generate:drafts` で再生成される `drafts/articles/daily/**` と `drafts/posts/x/**`

Cloud Agent に触らせないもの:

- `public/assets/**`
- `site/**`
- workflow ファイル全般

## License

このリポジトリには [LICENSE](LICENSE) を追加しています。

- README や generated content は CC BY-NC-SA 4.0 を基本に扱う
- Microsoft Corporation とその affiliates には追加許諾を付ける
- Third-party content や trademark は各権利者に帰属する
