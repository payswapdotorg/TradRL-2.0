/**
 * REAL record builders for the W037 experiment tests (the no-shim law: every
 * builder constructs the REAL descriptor/manifest shapes over the W036
 * construction seams — nothing here stubs a package seam; only opaque-id
 * leaf values are cast).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { experimentIdOf } from "../descriptor.js";
import type { ExperimentDescriptor } from "../descriptor.js";
import type { HoldoutSplitDescriptor, SplitAtom, TrajectoryRef } from "../manifest.js";
import { createExperiment } from "../descriptor.js";
import { trajectoryIdOf } from "trajectory";
import type { TrajectoryScope } from "trajectory";
import type { TimestampMs } from "tradrl-world-contracts";

export function experimentDescriptor(
  overrides: Partial<ExperimentDescriptor> = {},
): ExperimentDescriptor {
  return {
    name: "exp-fixture",
    tenantId: "tenant-1",
    projectId: "project-1",
    world: { worldId: "world-alpha", definitionDigest: "defdigest-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: "substrate-fixture" },
    ],
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
    ...overrides,
  };
}

export function fixtureExperiment() {
  const outcome = createExperiment(experimentDescriptor());
  if (!outcome.ok) {
    throw new Error("fixture experiment failed construction");
  }
  return outcome.experiment;
}

// --- the trajectory membership refs -------------------------------------------

export function trajectoryScopeOf(overrides: Partial<TrajectoryScope> = {}): TrajectoryScope {
  return {
    tenantId: "tenant-1",
    projectId: "project-1",
    worldId: "world-alpha",
    experimentId: experimentIdOf(experimentDescriptor()),
    sessionId: "session-1",
    ...overrides,
  };
}

export function trajectoryRefOf(
  sessionId: string,
  scopeOverrides: Partial<TrajectoryScope> = {},
): TrajectoryRef {
  const scope = trajectoryScopeOf({ sessionId, ...scopeOverrides });
  return { trajectoryId: trajectoryIdOf(scope), scope };
}

// --- the holdout split descriptors (declarative data) --------------------------

export const PERIOD_TRAIN: SplitAtom = { kind: "period", from: 0 as TimestampMs, to: 1000 as TimestampMs };
export const PERIOD_HOLDOUT: SplitAtom = {
  kind: "period",
  from: 1000 as TimestampMs,
  to: 2000 as TimestampMs,
};

export function periodSplit(overrides: Partial<HoldoutSplitDescriptor> = {}): HoldoutSplitDescriptor {
  return {
    axisId: "h-1",
    kind: "unseen-period",
    train: [PERIOD_TRAIN],
    evaluation: [PERIOD_HOLDOUT],
    ...overrides,
  };
}

export function venueSplit(overrides: Partial<HoldoutSplitDescriptor> = {}): HoldoutSplitDescriptor {
  return {
    axisId: "h-2",
    kind: "venue",
    train: [{ kind: "venue", venueId: "venue-train" }],
    evaluation: [{ kind: "venue", venueId: "venue-holdout" }],
    ...overrides,
  };
}

export function manifestInput(overrides: Partial<{
  trajectories: readonly TrajectoryRef[];
  holdoutSplits: readonly HoldoutSplitDescriptor[];
}> = {}) {
  return {
    trajectories: [trajectoryRefOf("session-1"), trajectoryRefOf("session-2")],
    holdoutSplits: [periodSplit(), venueSplit()],
    ...overrides,
  };
}
