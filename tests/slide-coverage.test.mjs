import assert from "node:assert/strict";
import test from "node:test";
import { computeCoverage, coverageProblems } from "../scripts/lib/slide-coverage.mjs";

const now = new Date("2026-10-21T00:00:00Z");
const event = (id, publishedAt) => ({ id, publishedAt });

test("coverage counts real slides per window and separates overdue and held updates", () => {
  const events = [
    event("a", "2026-10-20T12:00:00Z"),
    event("b", "2026-10-10T00:00:00Z"),
    event("c", "2026-10-09T00:00:00Z"),
    event("d", "2026-08-15T00:00:00Z"),
    event("e", "2026-03-01T00:00:00Z"),
  ];
  const coverage = computeCoverage(events, ["b"], { now, heldIds: ["c"] });
  assert.deepEqual(coverage.d30, { total: 3, withSlide: 1, ratio: 1 / 3 });
  assert.equal(coverage.window.total, 4);
  assert.equal(coverage.missing, 3);
  assert.equal(coverage.overdue, 1);
  assert.equal(coverage.held, 1);
});

test("an update from the last 48 hours is not overdue yet", () => {
  const coverage = computeCoverage([event("new", "2026-10-20T20:00:00Z")], [], { now });
  assert.equal(coverage.missing, 1);
  assert.equal(coverage.overdue, 0);
});

test("the guard only fails from enforceFrom, and only above the limits", () => {
  const coverage = { overdue: 25, held: 0 };
  const config = { enforceFrom: "2026-10-25", maxOverdue: 10, maxHeld: 5 };
  const before = coverageProblems(coverage, config, new Date("2026-10-21T00:00:00Z"));
  assert.equal(before.enforced, false);
  assert.equal(before.problems.length, 1);
  assert.equal(coverageProblems(coverage, config, new Date("2026-10-26T00:00:00Z")).enforced, true);
  assert.equal(coverageProblems({ overdue: 3, held: 5 }, config, new Date("2026-10-26T00:00:00Z")).problems.length, 0);
  assert.equal(coverageProblems({ overdue: 0, held: 6 }, config, new Date("2026-10-26T00:00:00Z")).problems.length, 1);
});
