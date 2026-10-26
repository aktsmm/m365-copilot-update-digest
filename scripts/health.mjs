import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// パイプラインの健康状態を Markdown 1 枚にまとめる（AI 不使用）。STATUS_OUT があればそこへ、なければ標準出力へ書く。
const root = process.cwd();
const gh = (...args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const json = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};
const countFiles = (dir, ext = ".json") => {
  try {
    return fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith(ext)).length;
  } catch {
    return 0;
  }
};

const nodeCount = (script, args = []) => {
  try {
    const out = execFileSync("node", [script, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out ? out.split(/\r?\n/).length : 0;
  } catch {
    return -1;
  }
};

const slides = countFiles("data/slides");

// 公開サイトの slides.json の件数が、リポジトリのスライド数と一致するか（デプロイが止まっていないか）を確かめる
async function liveSlideCount() {
  try {
    const response = await fetch("https://aktsmm.github.io/m365-copilot-update-digest/data/slides.json", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) return -1;
    return (await response.json()).slides.length;
  } catch {
    return -1;
  }
}
const liveSlides = await liveSlideCount();
const summaries = countFiles("data/summaries");
const pendingSlides = nodeCount("scripts/pending-slides.mjs", ["--limit", "5000", "--out", ".work/health-pending.json"]);
const pendingQa = nodeCount("scripts/pending-qa.mjs", ["--limit", "5000"]);
const pendingSummaries = nodeCount("scripts/pending.mjs", ["--limit", "5000"]);

const coverage = (() => {
  try {
    return JSON.parse(execFileSync("node", ["scripts/slide-coverage.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
})();
const pct = (entry) => `${entry.withSlide} / ${entry.total}（${Math.round(entry.ratio * 100)}%）`;

const runSummary = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data/run-summary.json"), "utf8"));
  } catch {
    return {};
  }
})();

const WORKFLOWS = [
  "collect-updates.yml",
  "deploy-pages.yml",
  "summarize.lock.yml",
  "slide-dispatch.yml",
  "slide.lock.yml",
  "slide-qa-dispatch.yml",
  "slide-qa.lock.yml",
  "auto-merge-slides.yml",
  "auto-merge-summaries.yml",
  "auto-merge-maintenance.yml",
  "watchdog.yml",
  "full-tests.yml",
  "maintenance.lock.yml",
];

const rows = WORKFLOWS.map((workflow) => {
  const runs = json(gh("run", "list", "--workflow", workflow, "--limit", "20", "--json", "conclusion,status,createdAt"), []);
  const done = runs.filter((run) => run.status === "completed");
  const last = done[0];
  const failed = done.filter((run) => run.conclusion === "failure").length;
  const inFlight = runs.filter((run) => run.status !== "completed").length;
  return `| \`${workflow}\` | ${last ? `${last.conclusion}（${last.createdAt.slice(0, 16).replace("T", " ")} UTC）` : "実行なし"} | ${done.length ? `${failed} / ${done.length}` : "-"} | ${inFlight} |`;
});

const prs = json(gh("pr", "list", "--state", "open", "--limit", "50", "--json", "number,title,createdAt"), []);
const issues = json(gh("issue", "list", "--state", "open", "--limit", "30", "--json", "number,title,labels"), []).filter((issue) => !(issue.labels ?? []).some((label) => label.name === "pipeline-status"));

const lines = [];
lines.push("# Pipeline status");
lines.push("");
lines.push(`更新: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC（毎日自動更新。AI は使っていません）`);
lines.push("");
lines.push("## データ");
lines.push("");
lines.push(`- スライド: ${slides} 件（未作成 ${pendingSlides < 0 ? "?" : pendingSlides} 件、想定問答の未追加 ${pendingQa < 0 ? "?" : pendingQa} 件）`);
if (coverage) {
  lines.push(`- 本物のスライドがある割合: 直近 30 日 ${pct(coverage.coverage.d30)}、90 日 ${pct(coverage.coverage.d90)}（スライドがない更新は、PDF・PPTX では簡易ページで出るので件数は揃います）`);
  lines.push(`- 48 時間より前に出たのに本物のスライドがない: ${coverage.coverage.overdue} 件、失敗が続いて保留中: ${coverage.coverage.held} 件${coverage.problems.length ? `（${coverage.enforced ? "上限超過" : "追いつき中のため警告のみ"}）` : ""}`);
}
lines.push(`- 公開サイト: ${liveSlides < 0 ? "確認できませんでした" : liveSlides === slides ? `スライド ${liveSlides} 件（リポジトリと一致）` : `スライド ${liveSlides} 件（リポジトリは ${slides} 件。デプロイが遅れている可能性があります）`}`);
lines.push(`- 日本語要約: ${summaries} 件（未生成・要再生成 ${pendingSummaries < 0 ? "?" : pendingSummaries} 件）`);
if (runSummary.sourceCount != null) lines.push(`- 監視ソース: ${runSummary.sourceCount}（取得状態: ${runSummary.coverage?.status ?? "不明"}、エラー ${runSummary.errorCount ?? 0} 件）`);
lines.push("");
lines.push("## ワークフロー（直近 20 回）");
lines.push("");
lines.push("| Workflow | 直近の結果 | 失敗 / 完了 | 実行中 |");
lines.push("| --- | --- | --- | --- |");
lines.push(...rows);
lines.push("");
lines.push(`## 開いている PR（${prs.length} 件）`);
lines.push("");
lines.push(prs.length ? prs.map((pr) => `- #${pr.number} ${pr.title}（${pr.createdAt.slice(0, 10)}）`).join("\n") : "なし");
lines.push("");
lines.push(`## 開いている Issue（${issues.length} 件）`);
lines.push("");
lines.push(issues.length ? issues.map((issue) => `- #${issue.number} ${issue.title}`).join("\n") : "なし");
lines.push("");

const body = `${lines.join("\n")}\n`;
if (process.env.STATUS_OUT) {
  fs.mkdirSync(path.dirname(process.env.STATUS_OUT), { recursive: true });
  fs.writeFileSync(process.env.STATUS_OUT, body, "utf8");
  console.log(`wrote ${process.env.STATUS_OUT}`);
} else {
  process.stdout.write(body);
}
