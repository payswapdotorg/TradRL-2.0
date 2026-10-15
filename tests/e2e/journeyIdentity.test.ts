/**
 * The A9 identity laws of the W064 reference journey: the same journey
 * composed twice ⇒ identical content-addressed ids — including when the
 * stage inputs are declared in a DIFFERENT order at the gates that
 * canonicalize their inputs (W054 ingest merges knowledge records in
 * canonical record-id order; W055's cycle seal canonicalizes the loop
 * order). The declarer's input order never leaks into a record's bytes.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { composeJourney } from "../../examples/reference-trading/journey.js";
import { journeyIdOf } from "../../examples/reference-trading/journeyHelpers.js";

const first = composeJourney();
const second = composeJourney();

test("the twin: the same journey composed twice ⇒ the identical journey id", () => {
  assert.equal(second.journeyId, first.journeyId);
  assert.equal(second.journeyId, journeyIdOf(first.lines));
});

test("the twin: every stage's record id is identical", () => {
  assert.deepEqual(second.lines, first.lines);
});

test("the twin: every composed record family is deep-equal", () => {
  assert.deepEqual(second.records.founding, first.records.founding);
  assert.deepEqual(second.records.learning.brain, first.records.learning.brain);
  assert.deepEqual(second.records.commerce.cycle, first.records.commerce.cycle);
  assert.deepEqual(second.records.governance.trail, first.records.governance.trail);
  assert.deepEqual(second.records.governance.report, first.records.governance.report);
  assert.deepEqual(second.records.governance.preparedRequest, first.records.governance.preparedRequest);
});

test("A9: the knowledge-record declaration order never leaks into the brain id", () => {
  const reversed = composeJourney("reversed");
  assert.equal(
    String(reversed.records.learning.brain.brainId),
    String(first.records.learning.brain.brainId),
  );
  // The brain's generation value is carried — the merge canonicalizes.
  assert.deepEqual(reversed.records.learning.brain.records, first.records.learning.brain.records);
});

test("A9: the improvement-cycle step declaration order never leaks into the cycle id", () => {
  const reversed = composeJourney("reversed");
  assert.equal(
    String(reversed.records.commerce.cycle.cycleId),
    String(first.records.commerce.cycle.cycleId),
  );
  assert.deepEqual(reversed.records.commerce.cycle.steps, first.records.commerce.cycle.steps);
});

test("A9: the whole journey is order-invariant — the reversed-declaration journey is the identical journey", () => {
  const reversed = composeJourney("reversed");
  assert.equal(reversed.journeyId, first.journeyId);
  assert.deepEqual(reversed.lines, first.lines);
});

test("the journey id is content-addressed over the stage lines (a rewritten stage changes it)", () => {
  const tampered = [...first.lines];
  const view = first.lines.find((line) => line.stage.startsWith("S14"));
  assert.ok(view !== undefined);
  tampered[tampered.indexOf(view)] = { ...view, recordId: "pitv-00000000" };
  assert.notEqual(journeyIdOf(tampered), first.journeyId);
});
