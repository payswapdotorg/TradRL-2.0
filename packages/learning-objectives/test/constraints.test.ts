/**
 * The constraint contract laws (W036): the registry construction gate, the
 * canonical hard/soft evaluation ordering, typed ordered evidence-linked
 * violation records, and the fail-closed seams.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Quantity } from "tradrl-world-contracts";
import {
  breach,
  canonicalStream,
  money,
  portfolio,
  position,
  riskState,
  settledCapsule,
  streamOf,
} from "./fixtures.js";
import { CONSTRAINT_KINDS, createConstraintProgram } from "../constraints.js";
import { evaluateConstraints } from "../constraintEvaluation.js";
import type { ConstraintProgram, ConstraintSpec } from "../constraints.js";

function softProgramOutcome() {
  return createConstraintProgram({
    programId: "cp-soft",
    constraints: [
      {
        constraintId: "de-1",
        kind: "drawdown-envelope",
        maxDrawdownFraction: 0.001,
        penalty: { shape: "linear", coefficient: 1 },
      },
      {
        constraintId: "tb-1",
        kind: "turnover-budget",
        maxCommandsPerView: 0,
        penalty: { shape: "linear", coefficient: 2 },
      },
      {
        constraintId: "eb-1",
        kind: "exposure-budget",
        maxGrossExposureFraction: 0.001,
        penalty: { shape: "linear", coefficient: 10 },
      },
    ],
  });
}

// --- the registry construction gate -------------------------------------------

test("the registry canonicalizes constraints into the closed kind order (hard first)", () => {
  const outcome = createConstraintProgram({
    programId: "cp-mixed",
    constraints: [
      { constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.5, penalty: { shape: "linear", coefficient: 1 } },
      { constraintId: "ag-1", kind: "authorization-gate", requiredPermissions: { canTrade: true, canShort: false, liveExecutionAllowed: false } },
      { constraintId: "rl-1", kind: "risk-limit", limits: {} },
      { constraintId: "vp-1", kind: "venue-policy", allowedOrderKinds: ["limit"] },
    ],
  });
  assert.ok(outcome.ok);
  assert.deepEqual(
    outcome.program.descriptor.constraints.map((constraint) => constraint.kind),
    ["risk-limit", "venue-policy", "authorization-gate", "exposure-budget"],
  );
  assert.deepEqual(outcome.program.constraintIds, ["ag-1", "eb-1", "rl-1", "vp-1"]);
  assert.ok(outcome.program.has("rl-1"));
  assert.ok(!outcome.program.has("nope"));
});

test("registry construction errors are loud, typed, and closed", () => {
  const blank = createConstraintProgram({ programId: "  ", constraints: [{ constraintId: "rl-1", kind: "risk-limit", limits: {} }] });
  assert.ok(!blank.ok);
  assert.ok(blank.errors.some((entry) => entry.code === "blank-program-id"));

  const empty = createConstraintProgram({ programId: "cp", constraints: [] });
  assert.ok(!empty.ok);
  assert.ok(empty.errors.some((entry) => entry.code === "empty-program"));

  const duplicate = createConstraintProgram({
    programId: "cp",
    constraints: [
      { constraintId: "rl-1", kind: "risk-limit", limits: {} },
      { constraintId: "rl-1", kind: "risk-limit", limits: {} },
    ],
  });
  assert.ok(!duplicate.ok);
  assert.ok(duplicate.errors.some((entry) => entry.code === "duplicate-constraint-id"));

  const unknown = createConstraintProgram({
    programId: "cp",
    constraints: [{ constraintId: "x-1", kind: "bogus" } as unknown as ConstraintSpec],
  });
  assert.ok(!unknown.ok);
  assert.ok(unknown.errors.some((entry) => entry.code === "unknown-constraint-kind"));

  const venue = createConstraintProgram({
    programId: "cp",
    constraints: [{ constraintId: "vp-1", kind: "venue-policy", allowedOrderKinds: [] }],
  });
  assert.ok(!venue.ok);
  assert.ok(venue.errors.some((entry) => entry.code === "empty-allowed-order-kinds"));

  const fraction = createConstraintProgram({
    programId: "cp",
    constraints: [{ constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 1.5, penalty: { shape: "linear", coefficient: 1 } }],
  });
  assert.ok(!fraction.ok);
  assert.ok(fraction.errors.some((entry) => entry.code === "invalid-budget-fraction"));

  const turnover = createConstraintProgram({
    programId: "cp",
    constraints: [{ constraintId: "tb-1", kind: "turnover-budget", maxCommandsPerView: -1, penalty: { shape: "linear", coefficient: 1 } }],
  });
  assert.ok(!turnover.ok);
  assert.ok(turnover.errors.some((entry) => entry.code === "invalid-command-budget"));

  const penalty = createConstraintProgram({
    programId: "cp",
    constraints: [{ constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.5, penalty: { shape: "linear", coefficient: 0 } }],
  });
  assert.ok(!penalty.ok);
  assert.ok(penalty.errors.some((entry) => entry.code === "invalid-penalty-shape"));

  const decimal = createConstraintProgram({
    programId: "cp",
    constraints: [{ constraintId: "rl-1", kind: "risk-limit", limits: { maxOrderQuantity: "1e3" as Quantity } }],
  });
  assert.ok(!decimal.ok);
  assert.ok(decimal.errors.some((entry) => entry.code === "malformed-decimal"));
});

// --- the soft evaluation (shaped penalties, canonical order) -------------------

test("soft penalties are typed, shaped, canonically ordered, and folded in order", () => {
  const outcome = softProgramOutcome();
  assert.ok(outcome.ok);
  const evaluation = evaluateConstraints(outcome.program, canonicalStream());
  assert.ok(evaluation.ok);
  const result = evaluation.evaluation;
  assert.equal(result.programId, "cp-soft");
  assert.equal(result.hardViolationCount, 0);
  assert.equal(result.compliance, "compliant");

  // Capsule 2: gross exposure 10 × 101 = 1010 over equity 101000 → 0.01.
  const exposureMagnitude = 1010 / 101000 - 0.001;
  const turnoverMagnitude = 1;
  // Capsule 3: drawdown 500 over peak 101000.
  const drawdownMagnitude = 500 / 101000 - 0.001;
  assert.deepEqual(
    result.penalties.map((penalty) => [penalty.capsuleIndex, penalty.constraintId, penalty.code]),
    [
      [1, "eb-1", "exposure-over-budget"],
      [1, "tb-1", "commands-over-budget"],
      [2, "de-1", "drawdown-over-envelope"],
    ],
  );
  const exposurePenalty = result.penalties[0];
  const turnoverPenalty = result.penalties[1];
  const drawdownPenalty = result.penalties[2];
  assert.ok(exposurePenalty !== undefined && turnoverPenalty !== undefined && drawdownPenalty !== undefined);
  assert.equal(exposurePenalty.severity, "soft");
  assert.equal(exposurePenalty.magnitude, exposureMagnitude);
  assert.equal(exposurePenalty.penalty, 10 * exposureMagnitude);
  assert.equal(exposurePenalty.occurredAt, 2100);
  assert.equal(turnoverPenalty.magnitude, turnoverMagnitude);
  assert.equal(turnoverPenalty.penalty, 2 * turnoverMagnitude);
  assert.equal(drawdownPenalty.magnitude, drawdownMagnitude);
  assert.equal(drawdownPenalty.penalty, drawdownMagnitude);
  assert.equal(
    result.softPenaltyTotal,
    10 * exposureMagnitude + 2 * turnoverMagnitude + drawdownMagnitude,
  );
});

// --- the hard evaluation (violations: typed, ordered, evidence-linked) ---------

test("hard violations are typed, canonically ordered, and evidence-linked", () => {
  const program = createConstraintProgram({
    programId: "cp-hard",
    constraints: [
      { constraintId: "ag-1", kind: "authorization-gate", requiredPermissions: { canTrade: true, canShort: false, liveExecutionAllowed: false } },
      { constraintId: "vp-1", kind: "venue-policy", allowedOrderKinds: ["limit"] },
      { constraintId: "rl-1", kind: "risk-limit", limits: { maxOrderQuantity: "5" as Quantity, maxPositionQuantity: "5" as Quantity } },
    ],
  });
  assert.ok(program.ok);
  const stream = streamOf([
    settledCapsule(
      { pass: 1, observedAt: 1000 },
      { asOf: 1100, riskState: riskState([breach("order-size", 1050)]) },
    ),
    settledCapsule(
      {
        pass: 2,
        observedAt: 2000,
        decisions: [{ decisionId: "d-1", orderKind: "market", side: "buy", quantity: "10", issuedAt: 2000 }],
        outcomes: [{ decisionId: "d-1", status: "authorize-rejected", issuedAt: 2000 }],
      },
      {
        asOf: 2100,
        portfolio: portfolio({
          equity: "100000",
          positions: [position({ quantity: "10", markPrice: "101" })],
        }),
      },
    ),
  ]);
  const evaluation = evaluateConstraints(program.program, stream);
  assert.ok(evaluation.ok);
  const result = evaluation.evaluation;
  assert.equal(result.compliance, "non-compliant");
  assert.equal(result.hardViolationCount, 5);
  // The canonical total order: capsule index → constraint kind → id → code.
  assert.deepEqual(
    result.violations.map((violation) => [violation.capsuleIndex, violation.constraintId, violation.code]),
    [
      [0, "rl-1", "runtime-breach"],
      [1, "rl-1", "order-quantity"],
      [1, "rl-1", "position-quantity"],
      [1, "vp-1", "order-kind-not-allowed"],
      [1, "ag-1", "authorization-denied"],
    ],
  );
  const runtimeBreach = result.violations[0];
  const orderQuantity = result.violations[1];
  const authorization = result.violations[4];
  assert.ok(runtimeBreach !== undefined && orderQuantity !== undefined && authorization !== undefined);
  assert.equal(runtimeBreach.severity, "hard");
  assert.equal(runtimeBreach.occurredAt, 1050);
  assert.equal(orderQuantity.limit, "maxOrderQuantity 5");
  assert.equal(orderQuantity.observed, "10");
  assert.equal(orderQuantity.occurredAt, 2000);
  assert.equal(String(orderQuantity.decisionId), "d-1");
  assert.equal(String(orderQuantity.commandId), "cmd-d-1");
  assert.equal(String(authorization.decisionId), "d-1");
  assert.match(authorization.observed, /permission-denied/);
  const positionQuantity = result.violations[2];
  assert.ok(positionQuantity !== undefined);
  assert.equal(positionQuantity.decisionId, undefined);
});

// --- determinism + the fail-closed seams ---------------------------------------

test("A9 determinism: fixed program + fixed stream → deep-equal evaluations", () => {
  const outcome = softProgramOutcome();
  assert.ok(outcome.ok);
  assert.deepEqual(
    evaluateConstraints(outcome.program, canonicalStream()),
    evaluateConstraints(outcome.program, canonicalStream()),
  );
});

test("constraints are never evaluated over malformed evidence (malformed-evidence)", () => {
  const outcome = softProgramOutcome();
  assert.ok(outcome.ok);
  const malformed = streamOf([
    settledCapsule(
      { pass: 1, observedAt: 1000 },
      { asOf: 1100, portfolio: portfolio({ equity: "1e5" }) },
    ),
  ]);
  const evaluation = evaluateConstraints(outcome.program, malformed);
  assert.ok(!evaluation.ok);
  const error = evaluation.errors[0];
  assert.ok(error !== undefined);
  assert.equal(error.code, "malformed-evidence");
  assert.ok(error.evidenceErrors !== undefined && error.evidenceErrors.length > 0);
});

test("a money-reading checker failure is a typed check-error (missing-portfolio-read)", () => {
  const outcome = softProgramOutcome();
  assert.ok(outcome.ok);
  const dry = streamOf([
    settledCapsule({ pass: 1, observedAt: 1000 }, { asOf: 1100, riskState: riskState() }),
  ]);
  const evaluation = evaluateConstraints(outcome.program, dry);
  assert.ok(!evaluation.ok);
  const error = evaluation.errors[0];
  assert.ok(error !== undefined);
  assert.equal(error.code, "check-error");
  assert.equal(error.checkError?.code, "missing-portfolio-read");
});

test("an unknown constraint kind reaching evaluation is a typed error (bypassed construction)", () => {
  const bypassed: ConstraintProgram = {
    descriptor: {
      programId: "cp-bypassed",
      constraints: [{ constraintId: "x-1", kind: "bogus" } as unknown as ConstraintSpec],
    },
    constraintIds: ["x-1"],
    has: (): boolean => true,
  };
  const evaluation = evaluateConstraints(bypassed, canonicalStream());
  assert.ok(!evaluation.ok);
  const error = evaluation.errors[0];
  assert.ok(error !== undefined);
  assert.equal(error.code, "check-error");
  assert.equal(error.checkError?.code, "unknown-constraint-kind");
  assert.match(error.message, /bogus/);
});

test("the gross-exposure limit reads the declared money boundary (typed limit rendering)", () => {
  const program = createConstraintProgram({
    programId: "cp-exposure",
    constraints: [{ constraintId: "rl-2", kind: "risk-limit", limits: { maxGrossExposure: money("500") } }],
  });
  assert.ok(program.ok);
  const evaluation = evaluateConstraints(program.program, canonicalStream());
  assert.ok(evaluation.ok);
  const violation = evaluation.evaluation.violations[0];
  assert.ok(violation !== undefined);
  assert.equal(violation.code, "gross-exposure");
  assert.equal(violation.limit, "maxGrossExposure 500 USD");
  assert.equal(violation.capsuleIndex, 1);
  assert.equal(evaluation.evaluation.compliance, "non-compliant");
});

test("the closed constraint kind set is the canonical order", () => {
  assert.deepEqual(CONSTRAINT_KINDS, [
    "risk-limit",
    "venue-policy",
    "authorization-gate",
    "exposure-budget",
    "turnover-budget",
    "drawdown-envelope",
  ]);
});
