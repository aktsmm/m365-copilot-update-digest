# M365 Copilot Update Digest

Microsoft 365 Copilot、Copilot Studio、Agent Builder の公開アップデートを継続的に収集し、日次 JSON、日次 Markdown、記事 draft、X 投稿 draft、GitHub Pages 向けの静的サイトを生成するリポジトリです。

現段階の実装は MVP で、次の 5 系統を収集対象にしています。

- Microsoft 365 Copilot release notes (Microsoft Learn)
- What's new in Copilot Studio (Microsoft Learn)
- Microsoft 365 Copilot Blog (Tech Community RSS)
- Copilot Studio Blog (Tech Community RSS)
- Microsoft 365 Roadmap (RSS)

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

- 公開で安定取得できる release plan 系ソースの追加
- RSS フィード出力（キュレーション結果を他ツールで購読可能にする）
- AI 要約の精度改善（ソース種別ごとの特化）
- SSG（Astro / 11ty 等）への移行検討

## Cloud Automation

このリポジトリは **手動操作なしで毎日サイトが更新される** 全自動パイプラインで運用されています。

```
┌─────────────┐    ┌──────────────┐    ┌────────────────┐    ┌─────────────┐
│  Collect     │───>│  Generate    │───>│  Commit & Push │───>│  Deploy     │
│  updates     │    │  drafts      │    │  to main       │    │  Pages      │
│  (schedule)  │    │              │    │                │    │             │
└─────────────┘    └──────────────┘    └────────────────┘    └─────────────┘
       │                                                            │
       v                                                            v
┌─────────────┐    ┌──────────────┐    ┌────────────────┐    ┌─────────────┐
│  Author      │───>│  Copilot SWE │───>│  Validate PR   │───>│  Auto-merge │
│  automation  │    │  agent が PR │    │  (canonical    │    │  & Redeploy │
│  (Issue作成) │    │  を自動作成  │    │   検証)        │    │             │
└─────────────┘    └──────────────┘    └────────────────┘    └─────────────┘
```

### 日次自動更新の流れ

| ステップ | Workflow | 何が起きるか |
|---|---|---|
| 1 | **Collect updates** (schedule: 毎日) | RSS / HTML から新着を収集し、翻訳・要約・重要度スコアリングを実行 |
| 2 | （同じ run 内） | `generate:drafts` で記事 draft と X 投稿 draft を自動生成 |
| 3 | （同じ run 内） | `data/`, `summaries/`, `drafts/`, `config/summary-ja-cache.json` を main に自動 push |
| 4 | **Deploy GitHub Pages** (push トリガー) | 静的サイトをビルドして GitHub Pages に公開 |

### Copilot による自動改善の流れ

| ステップ | Workflow | 何が起きるか |
|---|---|---|
| 5 | **Author automation PR** | 最新イベントを見て改善が必要なら Issue を作成し、Copilot Cloud Agent にアサイン |
| 6 | **Copilot cloud agent** | Issue をもとに PR を自動作成 |
| 7 | **Validate generated PR** | `collect` + `generate:drafts` を再実行し、出力が canonical と一致するか検証。drift があれば自動修正 push |
| 8 | **Auto-merge generated PR** | 検証 success → draft 解除 → squash merge → linked issue close → Pages 再デプロイ |

### 必要な設定

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
