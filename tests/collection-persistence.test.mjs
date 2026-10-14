import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { documentFingerprint } from "../scripts/lib/related-documents.mjs";

test("collect persists saved enrichment and a canonical rerun has no output drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "digest-document-test-"));
  try {
    const event = {
      id: "sample-blog-update", sourceId: "sample-blog", sourceName: "Official",
      sourceFamily: "Tech Community", productArea: "Copilot Studio",
      title: "Example feature", titleEn: "Example feature", titleJa: "機能の更新",
      summary: "Example feature documentation", summaryEn: "Example feature documentation",
      summaryJa: "機能の設定と利用方法の更新です。",
      url: "https://techcommunity.microsoft.com/blog/board/post/123",
      publishedAt: "2026-10-14T12:00:00.000Z",
      roleTags: [], tags: [], roadmapIds: [], releaseStage: "Update",
    };
    const documents = [{
      title: "Feature guide", url: "https://learn.microsoft.com/ja-jp/copilot/feature",
      provenance: "mcp", evidenceUrl: event.url, evidence: "The guide documents this feature.",
    }];
    await fs.mkdir(path.join(root, "config"), { recursive: true });
    await fs.mkdir(path.join(root, "data", "events"), { recursive: true });
    await fs.writeFile(path.join(root, "config", "sources.json"), "[]\n");
    await fs.writeFile(path.join(root, "config", "related-documents.json"), JSON.stringify({
      [event.id]: {
        inputFingerprint: documentFingerprint(event), status: "verified",
        mcpStatus: "verified", checkedAt: "2026-10-14T05:00:00.000Z", documents,
      },
    }));
    const eventFile = path.join(root, "data", "events", "2026-10-14.json");
    await fs.writeFile(eventFile, JSON.stringify({ date: "2026-10-14", events: [event] }));
    const run = () => execFileSync(process.execPath, [
      fileURLToPath(new URL("../scripts/collect.mjs", import.meta.url)),
    ], {
      cwd: root, env: { ...process.env, DIGEST_DOCUMENT_ENRICHMENT: "0" },
      stdio: "pipe", timeout: 30_000,
    });
    run();
    assert.deepEqual(JSON.parse(await fs.readFile(eventFile, "utf8")).events[0].relatedDocuments, documents);
    const tracked = [
      eventFile, path.join(root, "data", "run-summary.json"),
      path.join(root, "config", "related-documents.json"),
      path.join(root, "summaries", "daily", "2026-10-14.md"),
    ];
    const first = await Promise.all(tracked.map((file) => fs.readFile(file, "utf8")));
    run();
    const second = await Promise.all(tracked.map((file) => fs.readFile(file, "utf8")));
    assert.deepEqual(second, first);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
