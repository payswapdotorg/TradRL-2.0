/**
 * REAL bridge fixtures for the W047 service tests (the no-shim law): REAL
 * W044 bindings through bindAgent/bindOrganization over the world-agent-
 * runtime's own test fixtures (commissioned bodies forged through
 * body-forge's REAL gates — zero fixture drift; the W041/W044 fixture
 * lineage), a REAL W038 experiment evaluation through createExperiment →
 * experimentManifestOf → evaluateExperiment, and REAL W037 trajectories
 * through trajectoryRecordOf over the parameterized session builders in
 * ./session.ts. Disclosed in-header.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { createExperiment, experimentManifestOf } from "experiments";
import type { Experiment, ExperimentDescriptor } from "experiments";
import { evaluateExperiment } from "evaluation";
import type { ExperimentEvaluation } from "evaluation";
import { trajectoryRecordOf } from "trajectory";
import type { TrajectoryRecord } from "trajectory";
import { bindAgent, bindOrganization } from "world-agent-runtime";
import type { AgentBinding, OrganizationBinding } from "world-agent-runtime";
import {
  bindingWorldDefinition,
  compiledPlanFixture,
  commissionedBodyFixture,
  grantsFor,
  orgCommissionedBodyFixture,
  SCOPE,
} from "../../../world-agent-runtime/test/fixtures.js";
import {
  canonicalPasses,
  canonicalResultingStates,
  sessionContext,
  telemetryOf,
} from "./session.js";

export const RL_WORLD_DEFINITION_DIGEST = "worlddefdigest-rl-bridge-fixture-1";
export const RL_ENGINE_VERSION = "engine-rl-fixture-1";

// --- the experiment (REAL W036 specs through createExperiment's own gate) ----

function experimentDescriptor(participants: readonly { possessionId: string; bodyId: string; substrateId: string }[]): ExperimentDescriptor {
  return {
    name: "rl-bridge-fixture-experiment",
    tenantId: SCOPE.tenantId,
    projectId: SCOPE.projectId,
    world: { worldId: String(SCOPE.worldId), definitionDigest: RL_WORLD_DEFINITION_DIGEST },
    participants,
    rewardModel: {
      modelId: "model-fixture",
      version: "1",
      components: [
        { kind: "realized-pnl", weight: 1, scale: 1000 },
        { kind: "drawdown-control", weight: 1, scale: 1000 },
        { kind: "execution-quality", weight: 0.5, scale: 1 },
      ],
    },
    constraints: {
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
    },
    policy: {
      policyId: "pol-fixture",
      rewardModelId: "model-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-soft",
      penalizedConstraintIds: ["eb-1", "tb-1"],
      penaltyWeight: 0.5,
      axes: {
        holdouts: [
          { axisId: "h-1", kind: "unseen-period" },
          { axisId: "h-2", kind: "venue" },
        ],
        stresses: [{ axisId: "s-1", kind: "execution" }],
        ablations: [],
        integrity: ["evidence-chain", "deterministic-replay"],
      },
    },
  };
}

// --- the complete bridge fixture ----------------------------------------------

export interface BridgeFixture {
  readonly experiment: Experiment;
  readonly records: readonly TrajectoryRecord[];
  readonly evaluation: ExperimentEvaluation;
  readonly agentBinding: AgentBinding;
}

/**
 * The canonical bridge fixture: `sessionCount` REAL trajectories (the
 * second and later as immutable branches of the first), one REAL W038
 * experiment evaluation over all of them, and the REAL W044 agent binding
 * that proves their sessions' mind in the binding world.
 */
export function bridgeFixture(sessionCount = 2): BridgeFixture {
  const commissioned = commissionedBodyFixture();
  const bound = bindAgent(bindingWorldDefinition(), commissioned, grantsFor(commissioned));
  if (!bound.ok) {
    throw new Error(`bridge fixture binding failed (${bound.errors.map((entry) => entry.code).join(", ")})`);
  }
  const experiment = createExperiment(
    experimentDescriptor([
      {
        possessionId: String(commissioned.possession.possessionId),
        bodyId: String(commissioned.body.bodyId),
        substrateId: String(commissioned.substrate.substrateId),
      },
    ]),
  );
  if (!experiment.ok) {
    throw new Error(`bridge fixture experiment failed (${experiment.errors.map((entry) => entry.code).join(", ")})`);
  }

  const records: TrajectoryRecord[] = [];
  for (let index = 1; index <= sessionCount; index += 1) {
    const ctx = sessionContext(commissioned);
    const scope = {
      tenantId: SCOPE.tenantId,
      projectId: SCOPE.projectId,
      worldId: String(SCOPE.worldId),
      experimentId: String(experiment.experiment.experimentId),
      sessionId: `session-rl-fixture-${String(index)}`,
    };
    const captured = trajectoryRecordOf({
      scope,
      telemetry: telemetryOf(ctx, canonicalPasses(ctx)),
      resultingStates: canonicalResultingStates(ctx),
      policy: experiment.experiment.policy,
      determinism: {
        worldDefinitionDigest: RL_WORLD_DEFINITION_DIGEST,
        engineVersion: RL_ENGINE_VERSION,
        seed: `seed-rl-fixture-${String(index)}`,
      },
      lineage:
        index === 1
          ? undefined
          : { parent: records[0]!.trajectoryId, root: records[0]!.trajectoryId, ordinal: index - 1 },
    });
    if (!captured.ok) {
      throw new Error(`bridge fixture trajectory ${String(index)} failed (${captured.errors.map((entry) => entry.code).join(", ")})`);
    }
    records.push(captured.record);
  }

  const manifest = experimentManifestOf(experiment.experiment, {
    trajectories: records.map((record) => ({ trajectoryId: record.trajectoryId, scope: record.scope })),
    holdoutSplits: [],
  });
  if (!manifest.ok) {
    throw new Error(`bridge fixture manifest failed (${manifest.errors.map((entry) => entry.code).join(", ")})`);
  }
  const evaluation = evaluateExperiment({
    manifest: manifest.manifest,
    records,
    policy: experiment.experiment.policy,
  });
  if (!evaluation.ok) {
    throw new Error(`bridge fixture evaluation failed (${evaluation.errors.map((entry) => entry.code).join(", ")})`);
  }

  return {
    experiment: experiment.experiment,
    records,
    evaluation: evaluation.evaluation,
    agentBinding: bound.binding,
  };
}

/**
 * A REAL W037 trajectory that is VALID but disagrees with the fixture
 * binding pairwise — the `overrides` steer scope/world/mind for the
 * disagreement laws' tests.
 */
export function deviantTrajectory(
  base: BridgeFixture,
  overrides: { worldId?: string; tenantId?: string; substrateId?: string } = {},
): TrajectoryRecord {
  const commissioned = commissionedBodyFixture();
  const ctx = sessionContext(commissioned, {
    ...(overrides.worldId === undefined ? {} : { worldId: overrides.worldId }),
    ...(overrides.substrateId === undefined ? {} : { substrateId: overrides.substrateId }),
  });
  const scope = {
    tenantId: overrides.tenantId ?? SCOPE.tenantId,
    projectId: SCOPE.projectId,
    worldId: ctx.worldId,
    experimentId: String(base.experiment.experimentId),
    sessionId: `session-rl-deviant-${Object.keys(overrides).join("+") || "none"}`,
  };
  const captured = trajectoryRecordOf({
    scope,
    telemetry: telemetryOf(ctx, canonicalPasses(ctx)),
    resultingStates: canonicalResultingStates(ctx),
    policy: base.experiment.policy,
    determinism: {
      worldDefinitionDigest: RL_WORLD_DEFINITION_DIGEST,
      engineVersion: RL_ENGINE_VERSION,
      seed: "seed-rl-deviant",
    },
  });
  if (!captured.ok) {
    throw new Error(`deviant fixture failed (${captured.errors.map((entry) => entry.code).join(", ")})`);
  }
  return captured.record;
}

/** A literal BARE-P&L PolicyEvaluation (defensive-depth fixture, disclosed). */
export function barePnlEvaluationOf(record: TrajectoryRecord): TrajectoryRecord {
  return {
    ...record,
    evaluation: {
      ...record.evaluation,
      reward: {
        ...record.evaluation.reward,
        components: [
          {
            kind: "realized-pnl",
            rawValue: 1000,
            score: 1,
            weight: 1,
            contribution: 1,
            provenance: { capsuleIndices: [0], readings: ["literal-bare-pnl-fixture"] },
          },
        ],
        total: 1,
      },
    },
  };
}

/** The REAL W044 organization binding over the W044 fixtures' own plan. */
export function organizationBindingFixture(): OrganizationBinding {
  const commissioned = orgCommissionedBodyFixture();
  const bound = bindOrganization(
    bindingWorldDefinition(),
    compiledPlanFixture(commissioned),
    [commissioned],
    grantsFor(commissioned),
  );
  if (!bound.ok) {
    throw new Error(`organization fixture binding failed (${bound.errors.map((entry) => entry.code).join(", ")})`);
  }
  return bound.binding;
}

/** A REAL trajectory whose session mind is the ORGANIZATION's seat substrate. */
export function organizationSeatTrajectory(base: BridgeFixture): TrajectoryRecord {
  const binding = organizationBindingFixture();
  const seatSubstrate = String(binding.seats[0]!.substrateId);
  const ctx = sessionContext(orgCommissionedBodyFixture(), { substrateId: seatSubstrate });
  const scope = {
    tenantId: SCOPE.tenantId,
    projectId: SCOPE.projectId,
    worldId: String(SCOPE.worldId),
    experimentId: String(base.experiment.experimentId),
    sessionId: "session-rl-org-seat",
  };
  const captured = trajectoryRecordOf({
    scope,
    telemetry: telemetryOf(ctx, canonicalPasses(ctx)),
    resultingStates: canonicalResultingStates(ctx),
    policy: base.experiment.policy,
    determinism: {
      worldDefinitionDigest: RL_WORLD_DEFINITION_DIGEST,
      engineVersion: RL_ENGINE_VERSION,
      seed: "seed-rl-org-seat",
    },
  });
  if (!captured.ok) {
    throw new Error(`organization seat fixture failed (${captured.errors.map((entry) => entry.code).join(", ")})`);
  }
  return captured.record;
}
