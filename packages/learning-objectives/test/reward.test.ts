/**
 * The reward contract laws (W036): the §13 sole-P&L construction gate, the
 * canonical reduction, A9 determinism (the twin test), the comparator's tie
 * rules, and the fail-closed seams.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalStream,
  money,
  portfolio,
  riskState,
  settledCapsule,
  streamOf,
} from "./fixtures.js";
import {
  REWARD_COMPONENT_FAMILY,
  REWARD_COMPONENT_KINDS,
  compareRewardEvaluations,
  createRewardModel,
} from "../reward.js";
import { evaluateRewardComponent } from "../components.js";
import type { CurrencyCode } from "tradrl-world-contracts";
import type { RewardComponentKind, RewardComponentSpec, RewardEvaluation, RewardModel } from "../reward.js";

const CANONICAL_KINDS: readonly RewardComponentKind[] = [
  "realized-pnl",
  "drawdown-control",
  "execution-quality",
];

function fixtureModel(): RewardModel {
  const outcome = createRewardModel({
    modelId: "model-fixture",
    version: "1",
    components: [
      { kind: "realized-pnl", weight: 1, scale: 1000 },
      { kind: "drawdown-control", weight: 1, scale: 1000 },
      { kind: "execution-quality", weight: 0.5, scale: 1 },
    ],
  });
  if (!outcome.ok) {
    throw new Error(`fixture reward model failed construction: ${String(outcome.errors.length)}`);
  }
  return outcome.model;
}

/** A hand-built evaluation record for the comparator's tie rules. */
function fakeEvaluation(total: number, scores: readonly number[]): RewardEvaluation {
  return {
    modelId: "model-fixture",
    version: "1",
    capsuleCount: 3,
    components: scores.map((score, index) => ({
      kind: CANONICAL_KINDS[index] as RewardComponentKind,
      rawValue: score,
      score,
      weight: 1,
      contribution: score,
      provenance: { capsuleIndices: [], readings: [] },
    })),
    total,
  };
}

// --- THE §13 LAW --------------------------------------------------------------

test("THE LAW: a single realized-pnl component is refused at construction, loudly", () => {
  const outcome = createRewardModel({
    modelId: "unlawful-pure-pnl",
    version: "1",
    components: [{ kind: "realized-pnl", weight: 1, scale: 1000 }],
  });
  assert.ok(!outcome.ok);
  const lawError = outcome.errors.find((entry) => entry.code === "pnl-sole-objective");
  assert.ok(lawError !== undefined, "the sole-P&L error must be present");
  assert.match(lawError.message, /Raw P&L is never the sole objective/);
});

test("THE LAW: an all-financial-outcome composition is equally unlawful", () => {
  const outcome = createRewardModel({
    modelId: "unlawful-all-outcome",
    version: "1",
    components: [
      { kind: "realized-pnl", weight: 1, scale: 1000 },
      { kind: "risk-adjusted-return", weight: 1, scale: 1000 },
    ],
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "pnl-sole-objective"));
});

test("the family table is the law's structural lever (closed)", () => {
  assert.equal(REWARD_COMPONENT_FAMILY["realized-pnl"], "financial-outcome");
  assert.equal(REWARD_COMPONENT_FAMILY["risk-adjusted-return"], "financial-outcome");
  assert.equal(REWARD_COMPONENT_FAMILY["drawdown-control"], "risk-control");
  assert.equal(REWARD_COMPONENT_FAMILY["execution-quality"], "process");
  assert.deepEqual(REWARD_COMPONENT_KINDS, [
    "realized-pnl",
    "risk-adjusted-return",
    "drawdown-control",
    "exposure-discipline",
    "execution-quality",
    "protocol-compliance",
  ]);
});

// --- construction ------------------------------------------------------------

test("a multi-family model constructs, and errors are loud and typed", () => {
  const ok = createRewardModel({
    modelId: "m",
    version: "1",
    components: [{ kind: "realized-pnl", weight: 1, scale: 1000 }, { kind: "execution-quality", weight: 1, scale: 1 }],
  });
  assert.ok(ok.ok);

  const blank = createRewardModel({ modelId: "  ", version: "1", components: [{ kind: "drawdown-control", weight: 1, scale: 1 }] });
  assert.ok(!blank.ok);
  assert.ok(blank.errors.some((entry) => entry.code === "blank-model-id"));

  const empty = createRewardModel({ modelId: "m", version: "1", components: [] });
  assert.ok(!empty.ok);
  assert.ok(empty.errors.some((entry) => entry.code === "empty-model"));

  const duplicate = createRewardModel({
    modelId: "m",
    version: "1",
    components: [
      { kind: "realized-pnl", weight: 1, scale: 1000 },
      { kind: "realized-pnl", weight: 2, scale: 1000 },
    ],
  });
  assert.ok(!duplicate.ok);
  assert.ok(duplicate.errors.some((entry) => entry.code === "duplicate-component-kind"));

  const weight = createRewardModel({
    modelId: "m",
    version: "1",
    components: [{ kind: "execution-quality", weight: 0, scale: 1 }],
  });
  assert.ok(!weight.ok);
  assert.ok(weight.errors.some((entry) => entry.code === "invalid-weight"));

  const scale = createRewardModel({
    modelId: "m",
    version: "1",
    components: [{ kind: "execution-quality", weight: 1, scale: -1 }],
  });
  assert.ok(!scale.ok);
  assert.ok(scale.errors.some((entry) => entry.code === "invalid-scale"));

  const unknown = createRewardModel({
    modelId: "m",
    version: "1",
    components: [{ kind: "bogus" as unknown as RewardComponentKind, weight: 1, scale: 1 }],
  });
  assert.ok(!unknown.ok);
  assert.ok(unknown.errors.some((entry) => entry.code === "unknown-component-kind"));
});

test("canonicalization: a permuted declaration is the IDENTICAL model (A9)", () => {
  const declared: readonly RewardComponentSpec[] = [
    { kind: "realized-pnl", weight: 1, scale: 1000 },
    { kind: "drawdown-control", weight: 1, scale: 1000 },
    { kind: "execution-quality", weight: 0.5, scale: 1 },
  ];
  const forward = createRewardModel({ modelId: "m", version: "1", components: declared });
  const permuted = createRewardModel({
    modelId: "m",
    version: "1",
    components: [...declared].reverse(),
  });
  assert.ok(forward.ok);
  assert.ok(permuted.ok);
  assert.deepEqual(forward.model.descriptor, permuted.model.descriptor);
  assert.deepEqual(forward.model.componentKinds, permuted.model.componentKinds);
  assert.deepEqual(
    forward.model.evaluate(canonicalStream()),
    permuted.model.evaluate(canonicalStream()),
  );
});

// --- the reduction (composition + determinism) --------------------------------

test("composition: canonical order, exact scores, provenance as data", () => {
  const outcome = fixtureModel().evaluate(canonicalStream());
  assert.ok(outcome.ok);
  const evaluation = outcome.evaluation;
  assert.equal(evaluation.modelId, "model-fixture");
  assert.equal(evaluation.capsuleCount, 3);
  assert.deepEqual(
    evaluation.components.map((component) => component.kind),
    CANONICAL_KINDS,
  );
  const realized = evaluation.components[0];
  const drawdown = evaluation.components[1];
  const execution = evaluation.components[2];
  assert.ok(realized !== undefined && drawdown !== undefined && execution !== undefined);
  assert.equal(realized.rawValue, 1000);
  assert.equal(realized.score, 1);
  assert.equal(realized.contribution, 1);
  assert.deepEqual(realized.provenance.capsuleIndices, [2]);
  assert.equal(drawdown.rawValue, -500);
  assert.equal(drawdown.score, -0.5);
  assert.equal(drawdown.contribution, -0.5);
  assert.equal(execution.rawValue, 1);
  assert.equal(execution.score, 1);
  assert.equal(execution.contribution, 0.5);
  assert.equal(evaluation.total, 1);
});

test("A9 DETERMINISM (the twin test): fixed model + fixed stream → deep-equal results", () => {
  const model = fixtureModel();
  const stream = canonicalStream();
  assert.deepEqual(model.evaluate(stream), model.evaluate(stream));
});

test("execution-quality over an idle stream is the disclosed neutral (raw 0)", () => {
  const idle = streamOf([
    settledCapsule({ pass: 1, observedAt: 1000 }, { asOf: 1100, portfolio: portfolio({ equity: "100000" }) }),
    settledCapsule({ pass: 2, observedAt: 2000 }, { asOf: 2100, portfolio: portfolio({ equity: "100000" }) }),
  ]);
  const outcome = evaluateRewardComponent({ kind: "execution-quality", weight: 1, scale: 1 }, idle);
  assert.ok(outcome.ok);
  assert.equal(outcome.result.rawValue, 0);
  assert.equal(outcome.result.score, 0);
  assert.match(
    outcome.result.provenance.readings[0] ?? "",
    /idle neutral|no commands issued/,
  );
});

// --- the comparator (explicit tie rules) --------------------------------------

test("the comparator: totals decide, then canonical component scores, then 0", () => {
  const high = fakeEvaluation(2, [1, -0.5, 1]);
  const low = fakeEvaluation(1, [1, -0.5, 1]);
  assert.equal(compareRewardEvaluations(high, low), 1);
  assert.equal(compareRewardEvaluations(low, high), -1);

  const tieBetter = fakeEvaluation(1, [1, -0.5, 1]);
  const tieWorse = fakeEvaluation(1, [1, -0.6, 1]);
  assert.equal(compareRewardEvaluations(tieBetter, tieWorse), 1);
  assert.equal(compareRewardEvaluations(tieWorse, tieBetter), -1);

  assert.equal(compareRewardEvaluations(tieBetter, fakeEvaluation(1, [1, -0.5, 1])), 0);
});

test("the comparator refuses evaluations of different models (protocol breach)", () => {
  const a = fakeEvaluation(1, [1, -0.5, 1]);
  const first = a.components[0];
  assert.ok(first !== undefined);
  const otherModel = {
    ...fakeEvaluation(1, [1, -0.5, 1]),
    components: [{ ...first, kind: "protocol-compliance" as RewardComponentKind }],
  };
  assert.throws(() => compareRewardEvaluations(a, otherModel), /protocol breach/);
});

// --- the fail-closed seams ----------------------------------------------------

test("malformed evidence never silently scores (malformed-evidence, errors carried)", () => {
  const malformed = streamOf([
    settledCapsule(
      { pass: 1, observedAt: 1000 },
      { asOf: 1100, portfolio: portfolio({ equity: "1e5" }) },
    ),
  ]);
  const outcome = fixtureModel().evaluate(malformed);
  assert.ok(!outcome.ok);
  const error = outcome.errors[0];
  assert.ok(error !== undefined);
  assert.equal(error.code, "malformed-evidence");
  assert.ok(error.evidenceErrors !== undefined && error.evidenceErrors.length > 0);
});

test("mixed-currency money fails closed (mixed-currency)", () => {
  const mixed = streamOf([
    settledCapsule(
      { pass: 1, observedAt: 1000 },
      {
        asOf: 1100,
        portfolio: { ...portfolio({ equity: "100000" }), realizedPnl: money("0", "EUR" as CurrencyCode) },
      },
    ),
  ]);
  const outcome = fixtureModel().evaluate(mixed);
  assert.ok(!outcome.ok);
  const error = outcome.errors[0];
  assert.ok(error !== undefined);
  assert.equal(error.code, "component-error");
  assert.equal(error.componentError?.code, "mixed-currency");
});

test("non-positive equity fails closed (non-positive-equity)", () => {
  const flat = streamOf([
    settledCapsule(
      { pass: 1, observedAt: 1000 },
      { asOf: 1100, portfolio: portfolio({ equity: "0" }) },
    ),
  ]);
  const outcome = fixtureModel().evaluate(flat);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors[0]?.componentError?.code, "non-positive-equity");
});

test("a stream with no portfolio read fails closed (missing-portfolio-read)", () => {
  const dry = streamOf([
    settledCapsule({ pass: 1, observedAt: 1000 }, { asOf: 1100, riskState: riskState() }),
  ]);
  const outcome = evaluateRewardComponent({ kind: "realized-pnl", weight: 1, scale: 1000 }, dry);
  assert.ok(!outcome.ok);
  assert.equal(outcome.error.code, "missing-portfolio-read");
});

test("an unknown component kind is a typed error, never a silent default", () => {
  const outcome = evaluateRewardComponent(
    { kind: "bogus" as unknown as RewardComponentKind, weight: 1, scale: 1 },
    canonicalStream(),
  );
  assert.ok(!outcome.ok);
  assert.equal(outcome.error.code, "unknown-component-kind");
  assert.match(outcome.error.message, /unknown reward component kind 'bogus'/);
});
