import assert from "node:assert/strict";
import test from "node:test";
import { applyAgentSummaries, pendingItems, sourceFingerprint, validateAgentSummary } from "../scripts/lib/agent-summaries.mjs";

const event = (overrides = {}) => ({
  id: "e-1",
  title: "Feature",
  titleEn: "Feature",
  summaryEn: "English text.",
  releaseStage: "GA",
  publishedAt: "2026-10-10T12:00:00Z",
  importanceLevel: "high",
  titleJa: "機械翻訳",
  summaryJa: "機械翻訳の要約",
  ...overrides,
});

const good = (e) => ({
  schema: 1,
  key: e.id,
  sourceFingerprint: sourceFingerprint(e),
  titleJa: "Copilot の新機能が一般提供（GA）に",
  summaryJa: "Copilot の新しい機能が一般提供になりました。管理者は提供状況とライセンス要件を確認してください。詳細は元の発表を参照してください。",
  audienceJa: "Copilot の管理者",
  actionJa: "提供状況とライセンス要件を確認",
});

test("valid summary passes and bad ones are rejected", () => {
  const e = event();
  assert.deepEqual(validateAgentSummary(good(e), "e-1"), []);
  assert.ok(validateAgentSummary({ ...good(e), titleJa: "これは更新です。" }, "e-1").length > 0);
  assert.ok(validateAgentSummary({ ...good(e), summaryJa: "短い" }, "e-1").length > 0);
  assert.ok(validateAgentSummary({ ...good(e), summaryJa: `${good(e).summaryJa} https://example.com` }, "e-1").length > 0);
  assert.ok(validateAgentSummary(good(e), "other").length > 0);
});

test("only fresh, valid summaries override machine translation", () => {
  const e = event();
  const ok = new Map([["e-1", { summary: good(e), problems: [] }]]);
  const [applied] = applyAgentSummaries([e], ok);
  assert.equal(applied.titleJa, good(e).titleJa);
  assert.equal(applied.summaryBy, "agent");

  const stale = event({ summaryEn: "Changed source." });
  assert.equal(applyAgentSummaries([stale], ok)[0].titleJa, "機械翻訳");
  const invalid = new Map([["e-1", { summary: good(e), problems: ["x"] }]]);
  assert.equal(applyAgentSummaries([e], invalid)[0].titleJa, "機械翻訳");
});

test("pending lists high/notable recent items without a fresh summary, high first", () => {
  const now = new Date("2026-10-14T00:00:00Z");
  const done = event({ id: "done" });
  const summaries = new Map([["done", { summary: good(done), problems: [] }]]);
  const items = pendingItems(
    [
      done,
      event({ id: "notable", importanceLevel: "notable" }),
      event({ id: "high-old", publishedAt: "2026-02-01T00:00:00Z" }),
      event({ id: "normal", importanceLevel: "normal" }),
      event({ id: "high" }),
    ],
    summaries,
    { now },
  );
  assert.deepEqual(items.map((item) => item.id), ["high", "notable"]);
});
