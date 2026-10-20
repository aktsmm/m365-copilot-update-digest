import assert from "node:assert/strict";
import test from "node:test";
import { ESCALATE_AT, escalatedIds, previousFailures, pruneSolved, recordFailure } from "../scripts/lib/slide-retry.mjs";

test("failures accumulate per update, keep the last three messages, and escalate at three attempts", () => {
  let state = {};
  for (let i = 1; i <= 4; i += 1) state = recordFailure(state, "u1", `error ${i}`, new Date("2026-10-21T00:00:00Z"));
  assert.equal(state.u1.attempts, 4);
  assert.deepEqual(previousFailures(state, "u1"), ["error 2", "error 3", "error 4"]);
  state = recordFailure(state, "u2", "only once");
  assert.deepEqual(escalatedIds(state), ["u1"]);
  assert.equal(ESCALATE_AT, 3);
  assert.deepEqual(previousFailures(state, "missing"), []);
});

test("long or empty messages are normalised, and solved updates are pruned", () => {
  let state = recordFailure({}, "u1", `${"x".repeat(900)}\n  line`);
  assert.ok(state.u1.errors[0].length <= 400);
  state = recordFailure(state, "u2", "");
  assert.equal(state.u2.errors[0], "validation failed");
  assert.deepEqual(Object.keys(pruneSolved(state, ["u1"])), ["u2"]);
});
