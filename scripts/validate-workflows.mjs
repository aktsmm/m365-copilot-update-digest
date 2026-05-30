import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const workflowDir = path.join(root, '.github', 'workflows');

const files = {
  requestReview: path.join(workflowDir, 'request-copilot-review.yml'),
  autoMerge: path.join(workflowDir, 'auto-merge-generated-pr.yml'),
  reconcile: path.join(workflowDir, 'reconcile-generated-prs.yml'),
};

function readWorkflow(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function requireText(content, expected, description) {
  if (!content.includes(expected)) {
    throw new Error(`${description}: missing ${expected}`);
  }
}

function requireOccurrences(content, expected, minCount, description) {
  const count = content.split(expected).length - 1;
  if (count < minCount) {
    throw new Error(`${description}: expected at least ${minCount} occurrences of ${expected}, found ${count}`);
  }
}

const requestReview = readWorkflow(files.requestReview);
const autoMerge = readWorkflow(files.autoMerge);
const reconcile = readWorkflow(files.reconcile);

requireText(
  requestReview,
  'pr.head?.ref',
  'Request Copilot review must prefer the PR head branch when resolving the automation date',
);
requireText(
  requestReview,
  'sourceMarkerPattern',
  'Request Copilot review must remove stale source markers before prepending the canonical source marker',
);
requireText(
  requestReview,
  '.filter((line) => !sourceMarkerPattern.test(line.trim()))',
  'Request Copilot review must delete duplicate Generated from markers',
);
requireText(
  requestReview,
  'latestDate(files.flatMap',
  'Request Copilot review must use a deterministic fallback when only changed files expose dates',
);

requireOccurrences(
  autoMerge,
  'closingIssuesReferences(first: 50)',
  1,
  'Auto-merge must close GitHub-linked issues, not only explicit body refs',
);
requireText(
  autoMerge,
  'Closed automatically after generated PR #',
  'Auto-merge must leave an audit trail when it closes linked issues',
);

requireOccurrences(
  reconcile,
  'closingIssuesReferences(first: 50)',
  3,
  'Reconciler must use GitHub linked issue references in all cleanup paths',
);
requireText(
  reconcile,
  'openLinkedIssueNumbers',
  'Reconciler orphan detection must consider GitHub-linked open PRs',
);

console.log('Workflow automation invariants OK');
