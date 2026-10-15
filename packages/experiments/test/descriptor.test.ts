/**
 * The experiment descriptor laws (W037) — the deterministic identity (the
 * canonical hash over the descriptor) and the fail-closed construction gate
 * (structure + the W036 construction laws, their own typed errors carried
 * verbatim).
 *
 * Run: pnpm --filter experiments test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { EXPERIMENT_ID_PREFIX, createExperiment, experimentIdOf } from "../descriptor.js";
import { experimentDescriptor, fixtureExperiment } from "./fixtures.js";

test("the canonical experiment constructs with live W036 handles", () => {
  const experiment = fixtureExperiment();
  assert.equal(experiment.rewardModel.descriptor.modelId, "model-fixture");
  assert.equal(experiment.program.descriptor.programId, "cp-soft");
  assert.equal(experiment.policy.descriptor.policyId, "pol-fixture");
  assert.ok(experiment.experimentId.startsWith(EXPERIMENT_ID_PREFIX));
  assert.ok(/^exp-[0-9a-f]{8}$/.test(experiment.experimentId));
});

test("the identity twin law: same descriptor bytes ⇒ same experiment id (A9)", () => {
  const first = experimentIdOf(experimentDescriptor());
  const second = experimentIdOf(experimentDescriptor());
  assert.equal(first, second);
  assert.equal(first, fixtureExperiment().experimentId);
});

test("any differing descriptor byte yields a different id", () => {
  const base = experimentIdOf(experimentDescriptor());
  const varied = experimentIdOf(experimentDescriptor({ name: "exp-other" }));
  const worldVaried = experimentIdOf(
    experimentDescriptor({ world: { worldId: "world-beta", definitionDigest: "defdigest-fixture-1" } }),
  );
  assert.notEqual(varied, base);
  assert.notEqual(worldVaried, base);
});

test("structure laws: blank name/scope/world/digest, no participants (fail-closed)", () => {
  for (const [overrides, code] of [
    [{ name: " " }, "blank-experiment-name"],
    [{ tenantId: "" }, "blank-scope-member"],
    [{ projectId: "  " }, "blank-scope-member"],
    [{ world: { worldId: "", definitionDigest: "d" } }, "blank-world-id"],
    [{ world: { worldId: "world-alpha", definitionDigest: "" } }, "missing-world-digest"],
    [{ participants: [] }, "no-participants"],
  ] as const) {
    const outcome = createExperiment(experimentDescriptor(overrides));
    assert.ok(!outcome.ok, `override ${JSON.stringify(overrides)} must fail`);
    assert.ok(
      outcome.errors.some((entry) => entry.code === code),
      `expected '${code}', got ${JSON.stringify(outcome.errors.map((entry) => entry.code))}`,
    );
  }
});

test("participant laws: blank members and duplicate possessions fail typed", () => {
  const blank = createExperiment(
    experimentDescriptor({
      participants: [{ possessionId: "", bodyId: "body-1", substrateId: "substrate-fixture" }],
    }),
  );
  assert.ok(!blank.ok);
  assert.ok(blank.errors.some((entry) => entry.code === "blank-participant-member"));

  const duplicate = createExperiment(
    experimentDescriptor({
      participants: [
        { possessionId: "possession-1", bodyId: "body-1", substrateId: "substrate-fixture" },
        { possessionId: "possession-1", bodyId: "body-2", substrateId: "substrate-fixture" },
      ],
    }),
  );
  assert.ok(!duplicate.ok);
  assert.ok(duplicate.errors.some((entry) => entry.code === "duplicate-participant"));
});

test("a reward model failing W036's §13 law is refused with the law carried verbatim", () => {
  // All-financial-outcome components: W036's structural "pnl-sole-objective"
  // law must surface here BY NAME (the experiment never declares an
  // objective that cannot be lawfully evaluated).
  const outcome = createExperiment(
    experimentDescriptor({
      rewardModel: {
        modelId: "model-fixture",
        version: "1",
        components: [
          { kind: "realized-pnl", weight: 1, scale: 1000 },
          { kind: "risk-adjusted-return", weight: 1, scale: 1000 },
        ],
      },
    }),
  );
  assert.ok(!outcome.ok);
  const error = outcome.errors.find((entry) => entry.code === "reward-model-construction");
  assert.ok(error !== undefined);
  assert.ok(
    error.rewardModelErrors?.some((entry) => entry.code === "pnl-sole-objective"),
    "the §13 sole-P&L law must be carried verbatim",
  );
});

test("a constraint program failing the W036 registry gate is refused, errors carried", () => {
  const outcome = createExperiment(
    experimentDescriptor({ constraints: { programId: "cp-empty", constraints: [] } }),
  );
  assert.ok(!outcome.ok);
  const error = outcome.errors.find((entry) => entry.code === "constraint-program-construction");
  assert.ok(error !== undefined);
  assert.ok(error.constraintProgramErrors?.some((entry) => entry.code === "empty-program"));
});

test("an evaluation policy failing the W036 gate is refused, errors carried", () => {
  const unregistered = createExperiment(
    experimentDescriptor({
      policy: {
        ...experimentDescriptor().policy,
        penalizedConstraintIds: ["no-such-constraint"],
      },
    }),
  );
  assert.ok(!unregistered.ok);
  const error = unregistered.errors.find((entry) => entry.code === "policy-construction");
  assert.ok(error !== undefined);
  assert.ok(error.policyErrors?.some((entry) => entry.code === "unregistered-constraint"));

  const wrongModel = createExperiment(
    experimentDescriptor({
      policy: { ...experimentDescriptor().policy, rewardModelId: "other-model" },
    }),
  );
  assert.ok(!wrongModel.ok);
  assert.ok(
    wrongModel.errors.some(
      (entry) =>
        entry.code === "policy-construction" &&
        entry.policyErrors?.some((policyError) => policyError.code === "reward-model-reference-mismatch"),
    ),
  );
});
