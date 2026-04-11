---
type: design
exported_at: 2026-04-11T12:20:39
tools_used: [gh, node, npm, git, fetch_webpage]
outcome_status: success
---

# 自動キュレーションサイト構築プレイブック — M365 Copilot Update Digest の知見

## Summary

Microsoft 365 Copilot の公開アップデートを自動収集・翻訳・要約・記事生成・Pages デプロイまで全自動で動かすパイプラインを構築した。ソース定義駆動 collect → 日本語翻訳 → 重要度スコアリング → 記事 draft 生成 → GitHub Pages デプロイ → Copilot SWE agent による PR 自動作成・validate・auto-merge の全サイクルを完成させた。

## Timeline

### Phase 1 — ソース定義とデータ収集アーキテクチャ

- `config/sources.json` にソース定義（id, name, kind, url, sourceFamily, keywords）を宣言的に配置
- `scripts/collect.mjs` が各ソースの `kind` に応じたフェッチャー（RSS, release notes HTML scraping, roadmap RSS）を切り替え
- **設計判断**: ソース追加は JSON にエントリを足すだけ、フェッチロジックは `kind` で分岐する疎結合設計
- Modified: [config/sources.json](config/sources.json), [scripts/collect.mjs](scripts/collect.mjs)

### Phase 2 — イベント正規化とスコアリング

- 全ソースからのイベントを統一スキーマに正規化（id, title, titleJa, summary, summaryJa, publishedAt, sourceFamily, releaseStage, roleTags, importanceScore）
- `importanceScore` は releaseStage（GA=高, Preview=中）、コスト/ライセンス影響、ガバナンス影響、Agent Builder 関連などのルールベース加点
- `roleTags`（admin / maker）を自動付与し、フィルタ UIに反映
- Modified: [scripts/collect.mjs](scripts/collect.mjs), [scripts/lib/reporting.mjs](scripts/lib/reporting.mjs)

### Phase 3 — 日本語翻訳の非決定性と idempotency 問題

- collect を2回実行すると `titleJa` / `summaryJa` が微妙に揺れる問題を発見
- `shouldIgnoreCachedJapaneseTitle` / `shouldIgnoreCachedJapaneseSummary` が generic fallback を検出して再生成 → 毎回微妙に異なる出力
- **解決**: `sameEvents` 比較から volatile フィールド（`capturedAt`, `sourceLastSeen`, `titleJa`, `summaryJa`, `generatedAt`）を除外し、実質同一なら既存値を保持する `stableKey` 関数を導入
- **教訓**: AI 翻訳出力を含むパイプラインは本質的に非決定的。比較・差分検出は翻訳結果を除外した安定キーで行うこと
- Modified: [scripts/collect.mjs](scripts/collect.mjs#L1735)

### Phase 4 — 記事 draft と X 投稿の自動生成

- `scripts/generate-drafts.mjs` を追加。日次イベントデータから記事 draft（`drafts/articles/daily/YYYY-MM-DD.md`）と X 投稿 draft（`drafts/posts/x/YYYY-MM-DD.md`）を自動生成
- 既存ファイルと同一内容なら書き込みスキップ（idempotent）
- `package.json` の `generate:drafts` script、collect-updates workflow に組み込み
- Modified: [scripts/generate-drafts.mjs](scripts/generate-drafts.mjs), [package.json](package.json)

### Phase 5 — GitHub Pages ビルドと多言語対応

- `scripts/build-pages.mjs` が日本語/英語の静的 HTML を生成（daily, weekly, search, about ページ）
- sourceType の内部 slug を `docs` → `learn` にリネームし、UI ラベルを `Microsoft Learn` に統一
- フィルタ UI: 製品別、役割別（admin/maker）、ソース種別（Microsoft Learn / 公式ブログ / Roadmap）
- Modified: [scripts/build-pages.mjs](scripts/build-pages.mjs)

### Phase 6 — CI/CD パイプライン設計

- **collect-updates.yml**: schedule (毎日) + workflow_dispatch → `npm run collect` → `npm run generate:drafts` → commit & push → deploy-pages dispatch
- **validate-generated-pr.yml**: PR の pull_request イベントで collect/build/drafts を再実行し、canonical 出力と一致するか検証。drift があれば auto-fix push して exit 1 → follow-up run で再検証
- **auto-merge-generated-pr.yml**: validate success → workflow_run イベントで draft 解除 → squash merge → linked issue close → deploy-pages dispatch
- **author-automation-pr.yml**: collect 後に issue 作成 → Copilot SWE agent にアサイン → agent が PR を自動作成
- **deploy-pages.yml**: build:pages → GitHub Pages artifact upload → deployment
- Modified: [.github/workflows/](/.github/workflows/)

### Phase 7 — Generated PR の無限ループ修正（5+ attempts → 最終解決）

- **症状**: validate → auto-fix push → follow-up validate → また diff → 無限ループ
- **原因1**: `github.token` で push すると follow-up workflow が発火しない → `COPILOT_ASSIGN_TOKEN` (PAT) に切り替え
- **原因2**: validate が `refs/pull/N/merge`（synthetic merge commit）を checkout していたため、branch head と異なる diff が出る → `head.sha` を直接 checkout に変更
- **原因3**: collect の翻訳非決定性（Phase 3 参照）
- **最終解決**: stableKey 比較 + PAT push + head.sha checkout の3点セット

## Key Learnings

### アーキテクチャ

- **ソース定義駆動**: 新ジャンルのキュレーションサイトを作る場合、`config/sources.json` 相当のソース定義ファイル + kind ごとのフェッチャーという構造は再利用可能。RSS, HTML scraping, API の3種があれば大半のソースをカバーできる
- **イベント正規化スキーマ**: id, title, summary, publishedAt, source metadata, importance score, tags の統一スキーマを先に決めると、下流の build/draft 生成が安定する
- **静的サイト生成**: テンプレートエンジンを使わず、JavaScript で直接 HTML 文字列を組み立てる構成は軽量だが、ページ数が増えるとメンテナンスが大変。100ページ超えるなら Astro / 11ty 等を検討

### idempotency（最重要）

- **CI 上の再実行で同じ出力を出すこと**がパイプライン安定性の鍵。AI 翻訳・要約を含むパイプラインは本質的に非決定的なので、比較ロジックで揮発性フィールドを除外する設計が必須
- `sameEvents` 比較の `stableKey` パターン: `const { capturedAt, sourceLastSeen, titleJa, summaryJa, generatedAt, ...rest } = evt; return rest;`
- ファイル書き込み前に既存内容と比較して同一ならスキップする `writeTextFile` パターンも有効

### GitHub Actions の罠

- **`github.token` で push しても workflow は再発火しない** — 意図的な無限ループ防止だが、self-heal パターンでは PAT が必要
- **`refs/pull/N/merge` は synthetic merge commit** — PR validation では `head.sha` を explicit に checkout すること
- **workflow_run イベントの pull_requests 配列**: fork からの PR だと空になる。same-repo PR 前提で設計するか、別の手段で PR 番号を渡す
- **Copilot SWE agent**: issue にアサインすると数分〜数十分後に PR を作る。retry limit があり、同一 issue に3回以上 close された PR があると応答しなくなる可能性がある

### 翻訳キャッシュ戦略

- `config/summary-ja-cache.json` で翻訳結果をキャッシュし、再 collect 時に再翻訳を避ける
- generic fallback 検出（`shouldIgnoreCachedJapaneseTitle`）で品質の低いキャッシュを自動的に再生成
- **注意**: この再生成が非決定性の原因になるため、再生成結果は必ず既存値と比較して保存判断すること

### ソース分類の設計

- 内部 slug（`learn`, `blog`, `roadmap`）と表示ラベル（`Microsoft Learn`, `公式ブログ`, `Roadmap`）を分離する
- sourceFamily（データ側）→ sourceTypeSlug（表示側）の変換関数を1箇所に集約すると、分類変更時の影響が限定される

## Commands & Code

### ソース定義の構造（他ジャンルへの応用テンプレート）

```json
[
  {
    "id": "unique-source-id",
    "name": "Human-readable source name",
    "kind": "rss_feed | single_page_update | roadmap_rss",
    "url": "https://example.com/feed",
    "productArea": "Product Category",
    "sourceFamily": "Display Group Name",
    "maxItems": 20,
    "includeKeywords": ["keyword1", "keyword2"]
  }
]
```

### idempotent な collect 比較パターン

```javascript
// 揮発性フィールドを除外して安定比較
const stableKey = (evt) => {
  const {
    capturedAt,
    sourceLastSeen,
    titleJa,
    summaryJa,
    generatedAt,
    ...rest
  } = evt;
  return rest;
};
const sameEvents =
  JSON.stringify((existingLog?.events ?? []).map(stableKey)) ===
  JSON.stringify(sortedEvents.map(stableKey));

// 同一なら既存データを保持（timestamp drift を防止）
const nextLog = {
  date,
  generatedAt: sameEvents ? existingLog?.generatedAt || nowIso : nowIso,
  events: sameEvents ? existingLog.events : sortedEvents,
};
```

### validate workflow の auto-fix + PAT push パターン

```yaml
- name: Auto-fix canonical generated outputs
  if: github.event.pull_request.head.repo.full_name == github.repository
  env:
    PR_HEAD_REF: ${{ github.event.pull_request.head.ref }}
  run: |
    if git diff --quiet -- data summaries drafts; then
      echo "No drift detected."
      exit 0
    fi
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add data summaries drafts
    git commit -m "chore: regenerate canonical digest outputs"
    git push origin "HEAD:${PR_HEAD_REF}"
    echo "Pushed fix. Waiting for rerun." >&2
    exit 1

- name: Checkout (PAT で follow-up workflow を発火させる)
  uses: actions/checkout@v6
  with:
    ref: ${{ github.event.pull_request.head.sha }} # merge ref ではなく head
    token: ${{ secrets.COPILOT_ASSIGN_TOKEN || github.token }}
```

### auto-merge の squash merge + issue close パターン

```javascript
// GraphQL で auto-merge を有効化
await github.graphql(
  `mutation($pullRequestId: ID!) {
    enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: SQUASH}) {
      pullRequest { number }
    }
  }`,
  { pullRequestId: pr.node_id },
);

// auto-merge が使えない場合は直接 merge
await github.rest.pulls.merge({
  owner,
  repo,
  pull_number: pr.number,
  merge_method: "squash",
});
```

## References

- [GitHub Actions: workflow_run event](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#workflow_run)
- [GitHub: Automatic token authentication limitations](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow)
- [Copilot coding agent (SWE agent)](https://docs.github.com/en/copilot/using-github-copilot/using-the-copilot-coding-agent)

## Next Steps

- [ ] 別ジャンル（Azure Updates, Power Platform 等）で同じアーキテクチャを横展開する場合、`config/sources.json` のエントリ追加 + `kind` 対応のフェッチャー追加だけで対応可能か検証
- [ ] 翻訳品質の向上: generic fallback の発生率を下げるため、titleJa / summaryJa の生成ロジックをソース種別ごとに特化させる
- [ ] importanceScore のチューニング: 実際の閲覧データ（GA 等）と照合してスコアリングルールを改善
- [ ] Astro / 11ty 等の SSG への移行検討（ページ数増加時のメンテナンス性）
- [ ] RSS フィード出力の追加（キュレーション結果を他ツールで購読可能にする）
