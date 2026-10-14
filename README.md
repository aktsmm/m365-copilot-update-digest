# M365 Copilot Update Digest

Microsoft 365 Copilot、Copilot Studio、Agent Builder の公開アップデートを継続的に収集し、日次 JSON、日次 Markdown、記事 draft、X 投稿 draft、GitHub Pages 向けの静的サイトを生成するリポジトリです。

現段階の実装は MVP で、次の 5 系統を収集対象にしています。

- Microsoft 365 Copilot release notes (Microsoft Learn)
- What's new in Copilot Studio (Microsoft Learn)
- Microsoft 365 Copilot Blog (Tech Community RSS)
- Copilot Studio Blog (Tech Community RSS)
- Microsoft 365 Roadmap（Microsoft Release Communications MCP）

## できること

- カテゴリ（Copilot Chat / エージェント・拡張 / Office・Teams アプリ / セキュリティ・コンプライアンス / 管理・ライセンス など）と重要度（重要 / 注目 / 通常）で絞り込む（`config/categories.json`）
- 重要・注目の更新を、直近 3 か月分、1 更新 1 枚のスライド JSON にし、パスワード保護した PDF も公開する（[docs/slide-schema.md](docs/slide-schema.md)）
- 静的 JSON API を公開する（[docs/api.md](docs/api.md)）
- ソース別の取得状態（complete / empty / partial / failed）を記録し、欠けがあるときはサイトに明示する

- 公開ソースからアップデートを取得して日次 JSON に保存する
- 日次 Markdown を生成する
- 日次イベントから記事 draft と X 投稿 draft を生成する
- GitHub Pages 向けにトップ、日次、週次、検索、About を含む静的サイトを生成する
- トップと検索ページの検索結果から、原文・関連ドキュメント・日次ページの該当箇所を直接開く
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

自動化 workflow の静的ガード:

```bash
npm run validate:workflows
```

GitHub 上でも workflow / validator 変更時に **Validate automation workflows** が同じガードを実行します。

リンク収集と検索導線の回帰テスト:

```bash
npm test
```

## 原文と関連ドキュメント

検索結果には「原文を開く」「日次の該当箇所を見る」と、確認済みの関連ドキュメントを最大3件表示します。外部ページは別タブで開きます。日次ページでは対象の更新カードへ移動し、枠を強調します。日本語・英語、トップ内検索・検索ページで共通の動作です。

関連資料は次の順で補完します。

1. 更新項目・RSS 本文に明記された Microsoft Learn のリンク
2. リンクがない場合、Microsoft 公式原文の本文内リンク（再帰クロールなし）
3. まだ関連資料がない項目について、通常の収集処理が公式 MCP クライアント SDK で Learn MCP の検索・本文取得を行う

この通常補完は公開・認証不要の `https://learn.microsoft.com/api/mcp` に接続するため、GitHub の Copilot cloud agent 用 MCP 設定やブラウザーサインインを待ちません。初期化後にツール一覧を取得し、検索と本文取得のみを使います。製品・プラットフォーム・機能語を保守的に照合し、別の製品、特定ベンダー向けの手順、原文そのものの重複は採用しません。自動で照合できない資料は、根拠を記録した個別確認で補います。

M365 / Copilot Studio の主資料は **Microsoft Learn MCP で確認する対象製品の Microsoft 公式ドキュメント**です。GitHub Copilot は調査を実行するエージェントであって、GitHub の製品資料を M365 の主資料にするという意味ではありません。GitHub 連携など更新との関係が確認できる場合は、`docs.github.com` の公式資料も根拠付きの補足として採用できます。表示は Microsoft の主資料を先に並べます。GitHub 資料しかない項目は、Microsoft 主資料の MCP 調査候補として残します。

一覧型の release notes / what's new / Roadmap ページ全体から、別の更新の資料を拾うことはしません。Tech Community の公開ページデータも記事 ID を照合し、該当記事の本文だけを使います。原文と同じ文書、重複、非公式ホスト、不正な URL は除外します。資料が見つからない場合は関連資料欄を省略し、原文・日次リンクは維持します。資料の存在は、その機能の GA やすべての環境での提供を保証するものではありません。

**関連ドキュメントは日本語版を優先**します。`ja-jp` 版を実際に取得して文書の本文・見出しを確認し、英語へリダイレクトされただけの場合は日本語版ありと扱いません。日本語版が確認できないときは元の確認済み文書を残します。既存の英語資料も補完バッチの対象となり、日本語確認後は `localePreference: "ja-jp"` を記録して繰り返し照会を防ぎます。原文リンクそのものは元ソースの URL を維持します。

`config/related-documents.json` はイベント ID をキーに、入力 fingerprint、確認日時、`verified` / `not-found` / `error`、文書一覧と出典を保持します。MCP 補完は `mcpStatus` と本文との対応根拠 `evidence` も保存します。MCP が使えず既知の公式ページを直接確認した資料は `provenance: "reference"` と根拠を保存し、MCP 利用済みとは扱いません。確認済み結果は再利用し、MCP の未発見は7日後、エラーは1日後に再調査します。障害時も確認済み資料を維持します。通常収集の本文リンク補完は最大12項目・24ページ取得、MCP 補完は最大6項目・各3候補の本文照合に制限します。リダイレクト先も公式ホストを検証し、取得にはタイムアウトと容量上限を設けます。失敗は警告とキャッシュのエラー欄、`data/run-summary.json` の関連資料集計に残ります。

過去分の補完は、先に対象を確認してから保存します（イベント JSON や翻訳を直接書き換えません）。

```bash
node scripts/enrich-documents.mjs --limit 12
node scripts/enrich-documents.mjs --write --limit 12
```

日次ページの重要更新に絞る場合は `--date YYYY-MM-DD --limit 4` を指定します。先に `--write` なしで対象を確認します。GitHub Actions の **Collect updates** も手動実行で `document_date` と `document_limit` を指定すると、翻訳・記事生成を行わず、その日の重要更新だけを補完します。このモードは Learn MCP の検索・本文取得を実際に確認し、自動改善 Issue の作成を起動しません。

全期間の未補完項目は次のコマンドで監査・一括補完できます。

```bash
npm run backfill:documents
node scripts/backfill-documents.mjs --write
```

同じ製品・原文 URL・タイトル・要約の機能は、過去の日付違いにも確認結果を再利用します。原文内の明示リンクを先に復元し、残りを Learn MCP で直列に照合します。検索では資料の製品名・対象コンポーネントも確認し、適合度の高い主資料1件を優先します。Microsoft Learn に加え、原文が案内する Microsoft Support の実在記事も対象です。

リリースノート内の元リンクが外部サイトや空欄の場合でも、根拠には収集元の公式掲載ページを使います。元リンクやイベント識別子を変えて、既存のデータや確認結果の対応を崩すことはしません。

結果は5機能ごとに `config/related-documents.json` と `data/documentation-coverage.json` へ保存します。`--max-groups 30` などで区切っても、次回は調査済みの未発見項目を飛ばして続きから再開します。検索条件を改善して未発見分を再確認するときだけ `--recheck-unfound` を指定します。429・一時的な通信障害では停止して途中結果を残し、無制限にリトライしません。レポートの `completed` は未調査項目の走査完了を意味し、すべての項目に資料が存在するという意味ではありません。

関連資料がないカードにも、未調査・対応資料未確認・取得失敗の状態を表示します。未発見を取得成功や「活動0件」と同じ扱いにはしません。対応する資料を確認できない更新へ、無関係な製品トップページを数合わせで付けることはしません。

単一イベントは `--id <event-id>` で選択できます。一時障害を明示的に再試行する場合は `--write --retry-errors --id <event-id>` を使います。MCP の未調査候補は `--pending --limit 6` で取得します。未発見・MCP エラーを再調査する場合は、対象レコードだけをレビューして削除し、再度補完します。毎回全キャッシュを削除しないでください。

ビルドはキャッシュをイベントに重ねて表示するため、補完キャッシュだけの変更でも公開できます。通常の `collect` では関連資料をイベント JSON にも反映します。canonical 検証では `DIGEST_DOCUMENT_ENRICHMENT=0` を指定し、新しいネットワーク補完バッチを始めず保存済み結果だけを反映します。

### Copilot cloud agent の Learn MCP 設定（任意の追加調査用）

ローカルの MCP 設定や Node.js の Actions ジョブとは別に、リポジトリの **Settings → Copilot → MCP servers** で、既存設定を残して次のサーバーを追加します。設定ファイルをリポジトリに置くだけでは、このクラウド設定を行ったことにはなりません。

```json
{
  "mcpServers": {
    "microsoft-learn": {
      "type": "http",
      "url": "https://learn.microsoft.com/api/mcp",
      "tools": ["microsoft_docs_search", "microsoft_docs_fetch"]
    }
  }
}
```

Learn MCP は公開文書用の認証不要サービスです。cloud agent の設定にはリポジトリ管理権限と GitHub サインインが必要です。ローカルでのツール成功はクラウドでの利用成功を意味しません。設定保存後、cloud agent の実行ログで Learn の検索・本文取得と、キャッシュに保存された根拠を確認します。MCP が利用できない場合はエラーを記録し、推測 URL を作らない運用にします。

既存の **Author automation PR** が未調査項目を最大6件選んで補完を依頼します。結果は通常の生成 PR 検証を通します。キャッシュだけの更新も収集コミットと Pages デプロイの対象です。

参照（2026-10-14 確認）:

- [GitHub: リポジトリの MCP 設定](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/configure-mcp-servers)
- [Microsoft Learn MCP Server の概要](https://learn.microsoft.com/ja-jp/training/support/mcp)
- [Microsoft Learn MCP 開発者向けリファレンス](https://learn.microsoft.com/ja-jp/training/support/mcp-developer-reference)

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

| ステップ | Workflow                                | 何が起きるか                                                                                                                   |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1        | **Collect updates** (schedule: 毎日)    | RSS / HTML から新着を収集し、翻訳・要約・重要度スコアリングを実行                                                              |
| 2        | （同じ run 内）                         | `generate:drafts` で記事 draft と X 投稿 draft を自動生成                                                                      |
| 3        | （同じ run 内）                         | `data/`, `summaries/`, `drafts/`, `config/summary-ja-cache.json` を main に自動 push。summary cache だけの差分も取りこぼさない |
| 4        | **Deploy GitHub Pages** (push トリガー) | 静的サイトをビルドして GitHub Pages に公開                                                                                     |

### Copilot による自動改善の流れ

| ステップ | Workflow                                    | 何が起きるか                                                                                                                                                                                                                          |
| -------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5        | **Author automation PR**                    | 最新イベントを見て改善が必要なら Issue を作成し、Copilot Cloud Agent にアサイン                                                                                                                                                       |
| 6        | **Copilot cloud agent**                     | Issue をもとに PR を自動作成                                                                                                                                                                                                          |
| 7        | **Validate generated PR**                   | `collect` + `generate:drafts` を再実行し、出力が canonical と一致するか検証。drift があれば自動修正 push                                                                                                                              |
| 8        | **Auto-merge generated PR**                 | 検証 success → draft 解除 → squash merge / auto-merge 有効化 → linked issue close                                                                                                                                                     |
| 9        | **Redeploy Pages after generated PR merge** | generated PR の merge 完了を検知し、GitHub Pages の再デプロイを dispatch                                                                                                                                                              |
| 10       | **Reconcile generated PRs**                 | 30 分ごとに generated PR の title/body/label/linked issue を自己修復し、stuck PR の自動マージ、コンフリクト PR のクローズ、孤立 issue のクローズ、重複 PR の整理を実行。GitHub の linked issue 情報も参照して PR 本文だけに依存しない |

workflow / validator 変更は **Validate automation workflows** が GitHub 上でも検証します。同一リポジトリ内の PR と main push で `npm run validate:workflows` を実行します。

### 必要な設定

- Roadmap は MRC（`https://www.microsoft.com/releasecommunications/mcp`）から取得する。MRC が使えないときは RSS へ切り替えず、そのソースを `failed` として記録する（既存データは保持）
- スライド PDF を公開するには、リポジトリ Secret `PDF_PASSWORD` を設定する（未設定なら PDF は公開されず、スライド JSON と API だけ公開される）。変更後は **Deploy GitHub Pages** を再実行する

- repository で GitHub Copilot coding agent を有効にする
- secret `COPILOT_ASSIGN_TOKEN` を設定する
- token には少なくとも Issues / Pull requests / Contents / Actions を扱える権限を持たせる
- **Settings → General → "Automatically delete head branches"** を有効にする

Cloud Agent に許可している変更対象:

- `scripts/collect.mjs`
- `scripts/generate-drafts.mjs`
- `scripts/lib/reporting.mjs`
- `scripts/lib/related-documents.mjs`
- `scripts/lib/learn-mcp.mjs`
- `config/sources.json`
- `config/summary-ja-cache.json`
- `config/related-documents.json`
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
