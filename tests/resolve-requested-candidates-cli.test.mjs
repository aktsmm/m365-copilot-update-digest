import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { documentFingerprint, withPublicationSource } from "../scripts/lib/related-documents.mjs";

// scripts/resolve-requested-candidates.mjs の終了コード: 依頼された更新の調査が終わっていなければ 1（PR の検証を通さない）。
const script = path.resolve("scripts/resolve-requested-candidates.mjs");
const sources = JSON.parse(fs.readFileSync("config/sources.json", "utf8"));
const event = { id: "req-1", title: "Teams: Do something useful with agents", titleEn: "Teams: Do something useful with agents", summary: "s", summaryEn: "s", url: "https://www.microsoft.com/microsoft-365/roadmap?id=999999", publishedAt: "2026-10-01T00:00:00Z", importanceScore: 1 };
const issueBody = (ids) => `intro\n\`\`\`json\n${JSON.stringify(ids.map((id) => ({ id })))}\n\`\`\`\n`;

function run({ cache = {}, ids = ["req-1"], body, events = [event] }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-candidates-"));
  try {
    fs.mkdirSync(path.join(dir, "config"));
    fs.mkdirSync(path.join(dir, "data", "events"), { recursive: true });
    fs.writeFileSync(path.join(dir, "config", "sources.json"), JSON.stringify(sources));
    fs.writeFileSync(path.join(dir, "config", "related-documents.json"), JSON.stringify(cache));
    fs.writeFileSync(path.join(dir, "data", "events", "2026-10-01.json"), JSON.stringify({ events }));
    fs.writeFileSync(path.join(dir, "issue.md"), body ?? issueBody(ids));
    const result = spawnSync(process.execPath, [script, "issue.md"], { cwd: dir, encoding: "utf8" });
    return { status: result.status, out: result.stdout, err: result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const record = (extra = {}) => ({
  inputFingerprint: documentFingerprint(withPublicationSource(event, sources)),
  status: "not-found", checkedAt: "2026-11-15T00:00:00.000Z", localePreference: "ja-jp", documents: [], mcpStatus: "not-found", mcpRetryAfter: "2999-01-01T00:00:00.000Z", ...extra,
});

test("exit 0 when every requested update has been researched", () => {
  assert.equal(run({ cache: { "req-1": record() } }).status, 0);
});

test("exit 1 when a requested update has not been researched", () => {
  const result = run({ cache: {} });
  assert.equal(result.status, 1);
  assert.match(result.err, /not fully researched/);
});

test("exit 1 when the research ended in a Learn MCP error", () => {
  const errored = record({ status: "error", mcpStatus: "error", mcpRetryAfter: "2999-01-01T00:00:00.000Z", error: "Learn MCP: HTTP 503" });
  const result = run({ cache: { "req-1": errored } });
  assert.equal(result.status, 1);
  assert.match(result.out, /"errored": \[\s*"req-1"/);
});

test("exit 1 when a requested update is not in the event data at all", () => {
  const result = run({ cache: { "req-1": record() }, ids: ["req-1", "gone"] });
  assert.equal(result.status, 1);
  assert.match(result.out, /"missing": \[\s*"gone"/);
});

test("exit 0 when the issue has no candidate list (nothing was requested)", () => {
  assert.equal(run({ body: "no list here" }).status, 0);
});
