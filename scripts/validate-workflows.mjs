import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const workflowDir = path.join(root, ".github", "workflows");

const files = {
  gitAttributes: path.join(root, ".gitattributes"),
  collectUpdates: path.join(workflowDir, "collect-updates.yml"),
  validateGeneratedPr: path.join(workflowDir, "validate-generated-pr.yml"),
  requestReview: path.join(workflowDir, "request-copilot-review.yml"),
  autoMerge: path.join(workflowDir, "auto-merge-generated-pr.yml"),
  reconcile: path.join(workflowDir, "reconcile-generated-prs.yml"),
  rerunBlocked: path.join(workflowDir, "rerun-blocked-copilot-workflows.yml"),
  workflowGuard: path.join(workflowDir, "validate-automation-workflows.yml"),
};

function readWorkflow(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function requireText(content, expected, description) {
  if (!content.includes(expected)) {
    throw new Error(`${description}: missing ${expected}`);
  }
}

function requireOccurrences(content, expected, minCount, description) {
  const count = content.split(expected).length - 1;
  if (count < minCount) {
    throw new Error(
      `${description}: expected at least ${minCount} occurrences of ${expected}, found ${count}`,
    );
  }
}

const collectUpdates = readWorkflow(files.collectUpdates);
const gitAttributes = readWorkflow(files.gitAttributes);
const validateGeneratedPr = readWorkflow(files.validateGeneratedPr);
const requestReview = readWorkflow(files.requestReview);
const autoMerge = readWorkflow(files.autoMerge);
const reconcile = readWorkflow(files.reconcile);
const rerunBlocked = readWorkflow(files.rerunBlocked);
const workflowGuard = readWorkflow(files.workflowGuard);

requireText(
  requestReview,
  "pr.head?.ref",
  "Request Copilot review must prefer the PR head branch when resolving the automation date",
);
requireText(
  requestReview,
  "sourceMarkerPattern",
  "Request Copilot review must remove stale source markers before prepending the canonical source marker",
);
requireText(
  requestReview,
  ".filter((line) => !sourceMarkerPattern.test(line.trim()))",
  "Request Copilot review must delete duplicate Generated from markers",
);
requireText(
  requestReview,
  "latestDate(files.flatMap",
  "Request Copilot review must use a deterministic fallback when only changed files expose dates",
);

requireOccurrences(
  autoMerge,
  "closingIssuesReferences(first: 50)",
  1,
  "Auto-merge must close GitHub-linked issues, not only explicit body refs",
);
requireText(
  autoMerge,
  "Closed automatically after generated PR #",
  "Auto-merge must leave an audit trail when it closes linked issues",
);
requireText(
  autoMerge,
  "Auto merge is not allowed for this repository",
  "Auto-merge must direct-merge generated PRs when repository auto-merge is disabled",
);
requireText(
  autoMerge,
  "core.setFailed(`Failed to enable auto-merge for PR #",
  "Auto-merge must not report green when an unexpected auto-merge setup failure occurs",
);
requireText(
  autoMerge,
  "core.setFailed(`Failed to mark PR #${pr.number} ready for review:",
  "Auto-merge must not report green when a draft generated PR cannot be marked ready for review",
);

requireOccurrences(
  reconcile,
  "closingIssuesReferences(first: 50)",
  3,
  "Reconciler must use GitHub linked issue references in all cleanup paths",
);
requireText(
  reconcile,
  "Normalize generated PR metadata",
  "Reconciler must normalize generated PR metadata when review normalization is missed",
);
requireText(
  reconcile,
  "generated-pr-reconciler-normalized",
  "Reconciler metadata normalization must leave an idempotent audit comment marker",
);
requireText(
  reconcile,
  "Title, source marker, labels, and linked issue reference were aligned by the reconciler.",
  "Reconciler metadata normalization must repair title, source marker, labels, and linked issue references",
);
requireText(
  reconcile,
  "openLinkedIssueNumbers",
  "Reconciler orphan detection must consider GitHub-linked open PRs",
);
requireText(
  reconcile,
  "const bodyPattern = /^Generated from `?data\\/events\\/\\d{4}-\\d{2}-\\d{2}\\.json`?/m;",
  "Reconciler stale no-op detection must accept canonical source markers with or without backticks",
);
requireText(
  reconcile,
  "if (!isGeneratedPr || !isStale)",
  "Reconciler stale no-op cleanup must cover generated PRs with no file changes whether draft or ready",
);
requireText(
  reconcile,
  "remained with no file changes",
  "Reconciler stale no-op cleanup audit text must not assume the PR is a draft",
);
requireText(
  reconcile,
  "generatedPrChecksArePassing",
  "Reconciler stuck generated PR auto-merge must verify checks before merging",
);
requireText(
  reconcile,
  "workflow_id: 'validate-generated-pr.yml'",
  "Reconciler stuck generated PR auto-merge must require the Validate generated PR workflow, not any validate check",
);
requireText(
  reconcile,
  "head_sha: pull.head.sha",
  "Reconciler stuck generated PR auto-merge must bind validation runs to the PR head SHA",
);
requireText(
  reconcile,
  "has no successful Validate generated PR workflow run for head SHA",
  "Reconciler stuck generated PR auto-merge must log when generated PR validation is missing",
);
requireText(
  reconcile,
  "closeStaleConflictedGeneratedPr",
  "Reconciler must close stale conflicted generated PRs even when they are marked for human review",
);
requireText(
  reconcile,
  "Close stale conflicted generated PRs",
  "Reconciler stale conflict cleanup must run as its own observable step",
);
requireText(
  reconcile,
  "mergeStateStatus === 'DIRTY'",
  "Reconciler stale conflict cleanup must use GraphQL mergeStateStatus to avoid REST mergeability timing gaps",
);
requireText(
  reconcile,
  "Closed stale conflicted generated PR #",
  "Reconciler must leave an audit trail when it closes stale conflicted generated PRs",
);

requireText(
  workflowGuard,
  "npm run validate:workflows",
  "Workflow guard must run the local automation invariant validator on GitHub Actions",
);
requireText(
  workflowGuard,
  ".github/workflows/**",
  "Workflow guard must trigger when automation workflow files change",
);
requireText(
  workflowGuard,
  "github.event.pull_request.head.repo.full_name == github.repository",
  "Workflow guard pull_request runs must be limited to same-repository branches",
);

requireText(
  collectUpdates,
  "git diff --quiet -- data summaries drafts config/summary-ja-cache.json",
  "Collect workflow must commit summary cache-only generated changes",
);
requireText(
  gitAttributes,
  "drafts/**/*.md text eol=lf",
  "Generated draft markdown must keep LF line endings across Windows and GitHub Actions",
);
requireText(
  gitAttributes,
  "summaries/**/*.md text eol=lf",
  "Generated daily summaries must keep LF line endings across Windows and GitHub Actions",
);
requireText(
  gitAttributes,
  "data/**/*.json text eol=lf",
  "Generated event JSON must keep LF line endings across Windows and GitHub Actions",
);
requireOccurrences(
  validateGeneratedPr,
  "config/summary-ja-cache.json",
  4,
  "Generated PR validation must include summary cache in allow-list, auto-fix, and canonical drift checks",
);

requireText(
  rerunBlocked,
  "isExpectedGeneratedPrAutofix",
  "Blocked workflow reruns must skip expected generated PR auto-fix failures",
);
requireText(
  rerunBlocked,
  "Auto-fix canonical generated outputs",
  "Blocked workflow reruns must inspect the generated PR auto-fix step",
);

console.log("Workflow automation invariants OK");
