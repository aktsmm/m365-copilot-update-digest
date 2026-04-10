# M365 Copilot Update Digest

Microsoft 365 Copilot、Copilot Studio、Agent Builder の公開アップデートを継続的に収集し、日次 JSON、日次 Markdown、GitHub Pages 向けの静的サイトを生成するリポジトリです。

現段階の実装は MVP で、まずは次の 4 系統を収集対象にしています。

- Microsoft 365 Copilot release notes
- What's new in Copilot Studio
- Microsoft 365 Copilot Blog (Tech Community RSS)
- Copilot Studio Blog (Tech Community RSS)

## できること

- 公開ソースからアップデートを取得して日次 JSON に保存する
- 日次 Markdown を生成する
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

## 出力先

- data/events: 日次イベント JSON
- summaries/daily: 日次 Markdown
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
