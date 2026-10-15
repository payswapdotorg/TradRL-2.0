/**
 * The §13 evaluation-policy contract (W036): the descriptor validation (the
 * registry law above all), the deterministic reduction semantics (canonical
 * order, the explicit overflow rule), and the comparator's tie ladder.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalStream,
  portfolio,
  riskState,
  settledCapsule,
  streamOf,
} from "./fixtures.js";
import { createRewardModel } from "../reward.js";
import { createConstraintProgram } from "../constraints.js";
import {
  comparePolicyEvaluations,
  createEvaluationPolicy,
  evaluateUnderPolicy,
} from "../policy.js";
import type {
  EvaluationPolicySpec,
  HoldoutKind,
  PolicyEvaluation,
  StressKind,
} from "../policy.js";
import type { ConstraintCompliance } from "../constraints.js";
import type { RewardComponentKind, RewardModel } from "../reward.js";

const KINDS: readonly RewardComponentKind[] = [
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
    throw new Error("fixture reward model failed construction");
  }
  return outcome.model;
}

function softProgram() {
  const outcome = createConstraintProgram({
    programId: "cp-soft",
    constraints: [
      {
        constraintId: "eb-1",
        kind: "exposure-budget",
        maxGrossExposureFraction: 0.001,
        penalty: { shape: "linear", coefficient: 10 },
      },
      {
        constraintId: "tb-1",
        kind: "turnover-budget",
        maxCommandsPerView: 0,
        penalty: { shape: "linear", coefficient: 2 },
      },
      {
        constraintId: "de-1",
        kind: "drawdown-envelope",
        maxDrawdownFraction: 0.001,
        penalty: { shape: "linear", coefficient: 1 },
      },
    ],
  });
  if (!outcome.ok) {
    throw new Error("fixture constraint program failed construction");
  }
  return outcome.program;
}

function policySpec(overrides: Partial<EvaluationPolicySpec> = {}): EvaluationPolicySpec {
  return {
    policyId: "pol-1",
    rewardModelId: "model-fixture",
    rewardModelVersion: "1",
    constraintProgramId: "cp-soft",
    penalizedConstraintIds: ["eb-1", "tb-1"],
    penaltyWeight: 0.5,
    axes: {
      holdouts: [
        { axisId: "h-2", kind: "venue" },
        { axisId: "h-1", kind: "unseen-period" },
      ],
      stresses: [{ axisId: "s-1", kind: "execution" }],
      ablations: [{ axisId: "a-1", kind: "organization" }],
      integrity: ["deterministic-replay", "search-history"],
    },
    ...overrides,
  };
}

/** A hand-built evaluation record for the comparator's tie ladder. */
function fakePolicyEvaluation(overrides: {
  compliance?: ConstraintCompliance;
  combinedScore?: number;
  scores?: readonly number[];
  hardViolationCount?: number;
  applied?: number;
}): PolicyEvaluation {
  const scores = overrides.scores ?? [1, -0.5, 1];
  const combinedScore = overrides.combinedScore ?? 1;
  const compliance = overrides.compliance ?? "compliant";
  return {
    policyId: "pol-1",
    reward: {
      modelId: "model-fixture",
      version: "1",
      capsuleCount: 3,
      components: scores.map((score, index) => ({
        kind: KINDS[index] as RewardComponentKind,
        rawValue: score,
        score,
        weight: 1,
        contribution: score,
        provenance: { capsuleIndices: [], readings: [] },
      })),
      total: combinedScore,
    },
    constraints: {
      programId: "cp-soft",
      violations: [],
      penalties: [],
      hardViolationCount: overrides.hardViolationCount ?? 0,
      softPenaltyTotal: 0,
      compliance,
    },
    appliedSoftPenaltyTotal: overrides.applied ?? 0,
    combinedScore,
    compliance,
  };
}

// --- the descriptor validation -----------------------------------------------

test("a valid policy constructs, with axes canonicalized into the §13 kind order", () => {
  const outcome = createEvaluationPolicy(policySpec(), fixtureModel(), softProgram());
  assert.ok(outcome.ok);
  assert.deepEqual(
    outcome.policy.descriptor.axes.holdouts.map((axis) => [axis.axisId, axis.kind]),
    [
      ["h-1", "unseen-period"],
      ["h-2", "venue"],
    ],
  );
  assert.deepEqual(outcome.policy.descriptor.axes.integrity, [
    "search-history",
    "deterministic-replay",
  ]);
  assert.deepEqual(outcome.policy.descriptor.penalizedConstraintIds, ["eb-1", "tb-1"]);
});

test("descriptor validation fails loud and typed on every law", () => {
  const model = fixtureModel();
  const program = softProgram();
  const cases: readonly [EvaluationPolicySpec, string][] = [
    [policySpec({ policyId: "  " }), "blank-policy-id"],
    [policySpec({ rewardModelId: "other-model" }), "reward-model-reference-mismatch"],
    [policySpec({ rewardModelVersion: "9" }), "reward-model-reference-mismatch"],
    [policySpec({ constraintProgramId: "other-program" }), "constraint-program-reference-mismatch"],
    [policySpec({ penaltyWeight: 0 }), "invalid-penalty-weight"],
    [policySpec({ penalizedConstraintIds: ["no-such-constraint"] }), "unregistered-constraint"],
    [policySpec({ penalizedConstraintIds: ["eb-1", "eb-1"] }), "duplicate-constraint-reference"],
  ];
  const codes = cases.map(([spec, expectedCode]) => {
    const outcome = createEvaluationPolicy(spec, model, program);
    if (outcome.ok) {
      assert.fail(`expected a typed error (${expectedCode}) for ${spec.policyId}`);
    }
    return outcome.errors.map((entry) => entry.code);
  });
  assert.ok(codes[0]?.includes("blank-policy-id"));
  assert.ok(codes[1]?.includes("reward-model-reference-mismatch"));
  assert.ok(codes[2]?.includes("reward-model-reference-mismatch"));
  assert.ok(codes[3]?.includes("constraint-program-reference-mismatch"));
  assert.ok(codes[4]?.includes("invalid-penalty-weight"));
  assert.ok(codes[5]?.includes("unregistered-constraint"));
  assert.ok(codes[6]?.includes("duplicate-constraint-reference"));

  const blankAxis = createEvaluationPolicy(
    policySpec({
      axes: {
        holdouts: [{ axisId: "  ", kind: "unseen-period" }],
        stresses: [],
        ablations: [],
        integrity: ["search-history"],
      },
    }),
    model,
    program,
  );
  assert.ok(!blankAxis.ok);
  assert.ok(blankAxis.errors.some((entry) => entry.code === "blank-axis-id"));

  const duplicateAxis = createEvaluationPolicy(
    policySpec({
      axes: {
        holdouts: [{ axisId: "same", kind: "unseen-period" }],
        stresses: [{ axisId: "same", kind: "execution" }],
        ablations: [],
        integrity: ["search-history"],
      },
    }),
    model,
    program,
  );
  assert.ok(!duplicateAxis.ok);
  assert.ok(duplicateAxis.errors.some((entry) => entry.code === "duplicate-axis-id"));

  const unknownStress = createEvaluationPolicy(
    policySpec({
      axes: {
        holdouts: [],
        stresses: [{ axisId: "s-1", kind: "bogus" as unknown as StressKind }],
        ablations: [],
        integrity: ["search-history"],
      },
    }),
    model,
    program,
  );
  assert.ok(!unknownStress.ok);
  assert.ok(unknownStress.errors.some((entry) => entry.code === "unknown-stress-kind"));

  const unknownHoldout = createEvaluationPolicy(
    policySpec({
      axes: {
        holdouts: [{ axisId: "h-1", kind: "bogus" as unknown as HoldoutKind }],
        stresses: [],
        ablations: [],
        integrity: ["search-history"],
      },
    }),
    model,
    program,
  );
  assert.ok(!unknownHoldout.ok);
  assert.ok(unknownHoldout.errors.some((entry) => entry.code === "unknown-holdout-kind"));

  const emptyIntegrity = createEvaluationPolicy(
    policySpec({
      axes: { holdouts: [], stresses: [], ablations: [], integrity: [] },
    }),
    model,
    program,
  );
  assert.ok(!emptyIntegrity.ok);
  assert.ok(emptyIntegrity.errors.some((entry) => entry.code === "empty-integrity"));

  const duplicateIntegrity = createEvaluationPolicy(
    policySpec({
      axes: {
        holdouts: [],
        stresses: [],
        ablations: [],
        integrity: ["search-history", "search-history"],
      },
    }),
    model,
    program,
  );
  assert.ok(!duplicateIntegrity.ok);
  assert.ok(duplicateIntegrity.errors.some((entry) => entry.code === "duplicate-integrity-requirement"));
});

test("THE REGISTRY LAW: a hard constraint can never be priced (hard-constraint-penalty)", () => {
  const program = createConstraintProgram({
    programId: "cp-hard",
    constraints: [{ constraintId: "rl-1", kind: "risk-limit", limits: {} }],
  });
  assert.ok(program.ok);
  const outcome = createEvaluationPolicy(
    policySpec({ constraintProgramId: "cp-hard", penalizedConstraintIds: ["rl-1"] }),
    fixtureModel(),
    program.program,
  );
  assert.ok(!outcome.ok);
  const error = outcome.errors.find((entry) => entry.code === "hard-constraint-penalty");
  assert.ok(error !== undefined);
  assert.equal(error.constraintId, "rl-1");
});

// --- the reduction semantics ---------------------------------------------------

test("the reduction: canonical component order + penalized soft penalties in record order", () => {
  const outcome = createEvaluationPolicy(policySpec(), fixtureModel(), softProgram());
  assert.ok(outcome.ok);
  const evaluation = outcome.policy.evaluate(canonicalStream());
  assert.ok(evaluation.ok);
  const result = evaluation.evaluation;
  assert.equal(result.policyId, "pol-1");
  assert.equal(result.reward.total, 1);
  assert.deepEqual(
    result.reward.components.map((component) => component.kind),
    KINDS,
  );
  const exposurePenalty = 10 * (1010 / 101000 - 0.001);
  const turnoverPenalty = 2 * 1;
  assert.equal(result.appliedSoftPenaltyTotal, exposurePenalty + turnoverPenalty);
  assert.equal(result.combinedScore, 1 - 0.5 * (exposurePenalty + turnoverPenalty));
  assert.equal(result.compliance, "compliant");
  // Only the POLICY's penalized constraints apply: de-1's penalty is measured
  // by the constraint seam but never priced by this policy.
  assert.ok(result.constraints.softPenaltyTotal > result.appliedSoftPenaltyTotal);
});

test("hard violations gate compliance and never enter the score", () => {
  const model = fixtureModel();
  const program = createConstraintProgram({
    programId: "cp-gate",
    constraints: [{ constraintId: "vp-1", kind: "venue-policy", allowedOrderKinds: ["limit"] }],
  });
  assert.ok(program.ok);
  const outcome = createEvaluationPolicy(
    {
      policyId: "pol-gate",
      rewardModelId: "model-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-gate",
      penalizedConstraintIds: [],
      penaltyWeight: 1,
      axes: { holdouts: [], stresses: [], ablations: [], integrity: ["search-history"] },
    },
    model,
    program.program,
  );
  assert.ok(outcome.ok);
  const stream = streamOf([
    settledCapsule(
      {
        pass: 1,
        observedAt: 1000,
        decisions: [
          { decisionId: "d-1", orderKind: "market", side: "buy", quantity: "10", issuedAt: 1000 },
        ],
        outcomes: [{ decisionId: "d-1", status: "acked", issuedAt: 1000 }],
      },
      { asOf: 1100, portfolio: portfolio({ equity: "100000", realizedPnl: "500" }) },
    ),
  ]);
  const evaluation = outcome.policy.evaluate(stream);
  assert.ok(evaluation.ok);
  assert.equal(evaluation.evaluation.compliance, "non-compliant");
  assert.equal(evaluation.evaluation.constraints.hardViolationCount, 1);
  assert.equal(evaluation.evaluation.appliedSoftPenaltyTotal, 0);
  assert.equal(evaluation.evaluation.combinedScore, evaluation.evaluation.reward.total);
});

test("THE OVERFLOW RULE: a non-finite combined score is a typed error, never a clamp", () => {
  const outcome = createEvaluationPolicy(
    policySpec({ penaltyWeight: 1e308 }),
    fixtureModel(),
    softProgram(),
  );
  assert.ok(outcome.ok);
  const evaluation = outcome.policy.evaluate(canonicalStream());
  assert.ok(!evaluation.ok);
  const error = evaluation.errors[0];
  assert.ok(error !== undefined);
  assert.equal(error.code, "non-finite-combined");
});

test("the reduction propagates seam failures typed (reward-error / constraint-error)", () => {
  const model = fixtureModel();
  const program = softProgram();
  const malformed = streamOf([
    settledCapsule(
      { pass: 1, observedAt: 1000 },
      { asOf: 1100, portfolio: portfolio({ equity: "1e5" }) },
    ),
  ]);
  const malformedOutcome = evaluateUnderPolicy(policySpec(), model, program, malformed);
  assert.ok(!malformedOutcome.ok);
  assert.equal(malformedOutcome.errors[0]?.code, "reward-error");
  assert.ok(
    malformedOutcome.errors[0]?.rewardErrors !== undefined &&
      malformedOutcome.errors[0].rewardErrors.length > 0,
  );

  // A process-only model succeeds over a portfolio-free stream, but the
  // exposure-budget checker fails closed — the constraint seam propagates.
  const processModel = createRewardModel({
    modelId: "model-process",
    version: "1",
    components: [
      { kind: "execution-quality", weight: 1, scale: 1 },
      { kind: "protocol-compliance", weight: 1, scale: 1 },
    ],
  });
  assert.ok(processModel.ok);
  const dry = streamOf([
    settledCapsule({ pass: 1, observedAt: 1000 }, { asOf: 1100, riskState: riskState() }),
    settledCapsule({ pass: 2, observedAt: 2000 }, { asOf: 2100, riskState: riskState() }),
  ]);
  const processPolicy = createEvaluationPolicy(
    {
      policyId: "pol-process",
      rewardModelId: "model-process",
      rewardModelVersion: "1",
      constraintProgramId: "cp-soft",
      penalizedConstraintIds: ["eb-1"],
      penaltyWeight: 1,
      axes: { holdouts: [], stresses: [], ablations: [], integrity: ["search-history"] },
    },
    processModel.model,
    program,
  );
  assert.ok(processPolicy.ok);
  const dryOutcome = processPolicy.policy.evaluate(dry);
  assert.ok(!dryOutcome.ok);
  assert.equal(dryOutcome.errors[0]?.code, "constraint-error");
  assert.equal(dryOutcome.errors[0]?.constraintErrors?.[0]?.checkError?.code, "missing-portfolio-read");
});

test("A9 determinism: fixed policy + fixed stream → deep-equal evaluations", () => {
  const outcome = createEvaluationPolicy(policySpec(), fixtureModel(), softProgram());
  assert.ok(outcome.ok);
  assert.deepEqual(
    outcome.policy.evaluate(canonicalStream()),
    outcome.policy.evaluate(canonicalStream()),
  );
});

// --- the comparator (the explicit tie ladder) ----------------------------------

test("the tie ladder: compliance gates, then score, then component scores, then counts", () => {
  const compliant = fakePolicyEvaluation({ compliance: "compliant", combinedScore: 1 });
  const unlawful = fakePolicyEvaluation({ compliance: "non-compliant", combinedScore: 99 });
  assert.equal(comparePolicyEvaluations(compliant, unlawful), 1);
  assert.equal(comparePolicyEvaluations(unlawful, compliant), -1);

  const high = fakePolicyEvaluation({ combinedScore: 2 });
  const low = fakePolicyEvaluation({ combinedScore: 1 });
  assert.equal(comparePolicyEvaluations(high, low), 1);
  assert.equal(comparePolicyEvaluations(low, high), -1);

  const tieBetter = fakePolicyEvaluation({ combinedScore: 1, scores: [1, -0.5, 1] });
  const tieWorse = fakePolicyEvaluation({ combinedScore: 1, scores: [1, -0.6, 1] });
  assert.equal(comparePolicyEvaluations(tieBetter, tieWorse), 1);
  assert.equal(comparePolicyEvaluations(tieWorse, tieBetter), -1);

  const fewerHard = fakePolicyEvaluation({ hardViolationCount: 0 });
  const moreHard = fakePolicyEvaluation({ hardViolationCount: 2 });
  assert.equal(comparePolicyEvaluations(fewerHard, moreHard), 1);
  assert.equal(comparePolicyEvaluations(moreHard, fewerHard), -1);

  const smallerPenalty = fakePolicyEvaluation({ applied: 0.5 });
  const largerPenalty = fakePolicyEvaluation({ applied: 2 });
  assert.equal(comparePolicyEvaluations(smallerPenalty, largerPenalty), 1);
  assert.equal(comparePolicyEvaluations(largerPenalty, smallerPenalty), -1);

  assert.equal(
    comparePolicyEvaluations(fakePolicyEvaluation({}), fakePolicyEvaluation({})),
    0,
  );
});

test("the comparator refuses evaluations of different policies (protocol breach)", () => {
  const a = fakePolicyEvaluation({});
  const other = { ...fakePolicyEvaluation({}), policyId: "pol-other" };
  assert.throws(() => comparePolicyEvaluations(a, other), /protocol breach/);
});
