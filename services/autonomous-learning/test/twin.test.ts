/**
 * The A9 determinism twin (W055): the same records + the same step
 * declarations ⇒ the DEEP-EQUAL cycle with the SAME canonical id, whatever
 * order the inputs came in; and the re-validator agrees on both.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeImprovementCycle, improvementCycleDigestOf, validateImprovementCycle } from "../index.js";
import { aCycleInput } from "./fixtures.js";

test("the twin: two compositions over the same inputs are deep-equal with the same id", () => {
  const left = composeImprovementCycle(aCycleInput());
  const right = composeImprovementCycle(aCycleInput());
  assert.ok(left.ok);
  assert.ok(right.ok);
  assert.deepEqual(left.cycle, right.cycle);
  assert.equal(left.cycle.cycleId, right.cycle.cycleId);
  assert.equal(improvementCycleDigestOf(left.cycle), left.cycle.cycleId);
});

test("the order twin: permuted inputs seal the identical cycle (input order never leaks)", () => {
  const input = aCycleInput();
  const permuted = {
    ...input,
    steps: [...input.steps].reverse(),
    pairings: [...input.pairings].reverse(),
    skills: [...input.skills].reverse(),
    plans: [...input.plans].reverse(),
  };
  const left = composeImprovementCycle(input);
  const right = composeImprovementCycle(permuted);
  assert.ok(left.ok);
  assert.ok(right.ok);
  assert.deepEqual(left.cycle, right.cycle);
  assert.equal(left.cycle.cycleId, right.cycle.cycleId);
});

test("the re-validation twin: both twins re-validate from their own recorded data", () => {
  const input = aCycleInput();
  const left = composeImprovementCycle(input);
  const right = composeImprovementCycle({ ...input, steps: [...input.steps].reverse() });
  assert.ok(left.ok);
  assert.ok(right.ok);
  assert.deepEqual(validateImprovementCycle(left.cycle), { ok: true });
  assert.deepEqual(validateImprovementCycle(right.cycle), { ok: true });
});
