/**
 * REAL record builders for the W038 verification tests (the no-shim law:
 * every builder constructs the REAL W035/W036/W037/W038 shapes through the
 * REAL construction/capture/manifest/walker seams — nothing stubs a package
 * seam; only opaque-id leaf values are cast). Follows the W037 test
 * precedent.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { AgentPassRecord, AgentSessionTelemetry } from "agent-world-protocol";
import type {
  AccountId,
  CommandId,
  CurrencyCode,
  DecimalString,
  InstrumentId,
  Money,
  ParticipantId,
  Portfolio,
  Quantity,
  SequenceNumber,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { BodyId } from "tradrl-world-contracts/agentBody";
import type { Decision, DecisionId, SubstrateId, ViewDigest } from "tradrl-world-contracts/cognitiveSubstrate";
import type { EvaluationPolicy, ResultingState } from "learning-objectives";
import { createExperiment, experimentIdOf, experimentManifestOf } from "experiments";
import type { ExperimentDescriptor, ExperimentManifest, HoldoutSplitDescriptor } from "experiments";
import { trajectoryIdOf, trajectoryRecordOf } from "trajectory";
import type { TrajectoryRecord, TrajectoryScope } from "trajectory";
import { evaluateExperiment } from "evaluation";
import type { ExperimentEvaluation } from "evaluation";

const WORLD = "world-alpha" as WorldId;
const ACCOUNT = "acct-1" as AccountId;
const INSTRUMENT = "ins-EQ1" as InstrumentId;
const BODY = "body-1" as BodyId;
const PARTICIPANT = "part-1" as ParticipantId;
const POSSESSION = "possession-1" as AgentSessionTelemetry["possessionId"];
const SUBSTRATE = "substrate-fixture" as SubstrateId;
const ts = (milliseconds: number): TimestampMs => milliseconds as TimestampMs;

function money(amount: string): Money {
  return { amount: amount as DecimalString, currency: "USD" as CurrencyCode };
}

function portfolio(equity: string): Portfolio {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    positions: [],
    cash: money("1000000"),
    buyingPower: money("1000000"),
    realizedPnl: money("0"),
    unrealizedPnl: money("0"),
    equity: money(equity),
    asOf: ts(0),
  };
}

function passRecord(pass: number, observedAt: number, order?: "market" | "limit"): AgentPassRecord {
  const viewDigest = `view-${String(pass)}` as ViewDigest;
  const decisions: Decision[] =
    order === undefined
      ? []
      : [
          {
            decisionId: `d-${String(pass)}` as DecisionId,
            viewDigest,
            command: {
              commandId: `cmd-${String(pass)}` as CommandId,
              worldId: WORLD,
              issuedBy: PARTICIPANT,
              issuedAt: ts(observedAt),
              kind: "submit-order",
              accountId: ACCOUNT,
              instrumentId: INSTRUMENT,
              submission: {
                kind: order,
                side: "buy",
                quantity: "10" as Quantity,
                constraints: { timeInForce: "GTC" },
              },
            },
            rationale: {
              rule: "fixture-rule",
              signals: [{ name: "fixture-signal", value: 1 }],
              explanation: "fixture decision rationale (test builder)",
            },
            confidence: 0.5,
          },
        ];
  const outcomes =
    order === undefined
      ? []
      : [
          {
            decisionId: `d-${String(pass)}` as DecisionId,
            commandId: `cmd-${String(pass)}` as CommandId,
            commandKind: "submit-order" as const,
            result: {
              status: "acked" as const,
              ack: {
                commandId: `cmd-${String(pass)}` as CommandId,
                worldId: WORLD,
                acceptedAt: ts(observedAt + 1),
                resultingEventIds: [],
                journalCursor: 1 as SequenceNumber,
              },
            },
          },
        ];
  return {
    pass,
    observedAt: ts(observedAt),
    observation: {
      asOf: ts(observedAt),
      grant: {
        bodyId: BODY,
        worldId: WORLD,
        asOf: ts(observedAt),
        kinds: ["own-portfolio"],
        instruments: [INSTRUMENT],
        visibleArtifacts: [],
        withheldArtifacts: [],
        denials: [],
      },
      view: {
        bodyId: BODY,
        worldId: WORLD,
        instruments: [INSTRUMENT],
        observations: ["own-portfolio"],
        accountId: ACCOUNT,
        participantId: PARTICIPANT,
        asOf: ts(observedAt),
      },
      viewDigest,
    },
    stream: {
      substrateId: SUBSTRATE,
      seed: "fixture-seed",
      viewDigest,
      asOf: ts(observedAt),
      decisions,
    },
    streamDigest: `stream-${String(pass)}`,
    admission: { ok: true, checked: [] },
    outcomes,
  };
}

function telemetryOf(passes: readonly AgentPassRecord[]): AgentSessionTelemetry {
  const outcomes = passes.flatMap((record) => record.outcomes);
  const acked = outcomes.filter((outcome) => outcome.result.status === "acked").length;
  return {
    status: "detached",
    worldId: String(WORLD),
    possessionId: POSSESSION,
    bodyId: BODY,
    substrateId: SUBSTRATE,
    attachment: { bodyId: BODY, worldId: WORLD, state: "detached", detachReason: "world-closed" },
    possession: {
      possessionId: POSSESSION,
      bodyId: BODY,
      substrateId: SUBSTRATE,
      worldId: WORLD,
      state: "released",
      releaseReason: "body-detached",
    },
    passes: [...passes],
    viewsReceived: passes.length,
    observationsSkipped: 0,
    outcomes,
    acked,
    rejected: outcomes.length - acked,
    admissionRefused: 0,
  };
}

// --- the fixture family (parameterized integrity for the search-history lever) ---

function programSpec(): object {
  return {
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
    ],
  };
}

function descriptorOf(integrity: readonly string[]): ExperimentDescriptor {
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
      ],
    },
    constraints: programSpec() as never,
    policy: {
      policyId: "pol-fixture",
      rewardModelId: "model-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-soft",
      penalizedConstraintIds: ["eb-1"],
      penaltyWeight: 0.5,
      axes: {
        holdouts: [
          { axisId: "h-1", kind: "unseen-period" },
          { axisId: "h-2", kind: "venue" },
        ],
        stresses: [{ axisId: "s-1", kind: "execution" }],
        ablations: [],
        integrity,
      },
    } as never,
  };
}

export function fixturePolicy(integrity: readonly string[] = ["evidence-chain", "deterministic-replay"]): EvaluationPolicy {
  const descriptor = descriptorOf(integrity);
  const experiment = createExperiment(descriptor);
  if (!experiment.ok) {
    throw new Error("fixture experiment failed construction");
  }
  return experiment.experiment.policy;
}

export const SPLIT_H1: HoldoutSplitDescriptor = {
  axisId: "h-1",
  kind: "unseen-period",
  train: [{ kind: "period", from: ts(0), to: ts(999) }],
  evaluation: [{ kind: "period", from: ts(1000), to: ts(2000) }],
};

export const SPLIT_H2: HoldoutSplitDescriptor = {
  axisId: "h-2",
  kind: "venue",
  train: [{ kind: "venue", venueId: "venue-train" }],
  evaluation: [{ kind: "venue", venueId: "venue-holdout" }],
};

export interface Bundle {
  readonly manifest: ExperimentManifest;
  readonly records: readonly TrajectoryRecord[];
  readonly policy: EvaluationPolicy;
  readonly evaluation: ExperimentEvaluation;
}

export function bundleOf(integrity: readonly string[] = ["evidence-chain", "deterministic-replay"]): Bundle {
  const descriptor = descriptorOf(integrity);
  const experiment = createExperiment(descriptor);
  if (!experiment.ok) {
    throw new Error("fixture experiment failed construction");
  }
  const policy = experiment.experiment.policy;
  const scopeOf = (sessionId: string): TrajectoryScope => ({
    tenantId: "tenant-1",
    projectId: "project-1",
    worldId: "world-alpha",
    experimentId: experimentIdOf(descriptor),
    sessionId,
  });
  const manifest = experimentManifestOf(experiment.experiment, {
    trajectories: ["session-1", "session-2"].map((sessionId) => {
      const scope = scopeOf(sessionId);
      return { trajectoryId: trajectoryIdOf(scope), scope };
    }),
    holdoutSplits: [SPLIT_H1, SPLIT_H2],
  });
  if (!manifest.ok) {
    throw new Error("fixture manifest failed construction");
  }
  const recordOf = (sessionId: string, instants: readonly number[]): TrajectoryRecord => {
    const passes = instants.map((instant, index) => passRecord(index + 1, instant));
    const states: ResultingState[] = instants.map((instant) => ({
      asOf: ts(instant + 100),
      portfolio: portfolio("100000"),
    }));
    const outcome = trajectoryRecordOf({
      scope: scopeOf(sessionId),
      telemetry: telemetryOf(passes),
      resultingStates: states,
      policy,
      determinism: {
        worldDefinitionDigest: "defdigest-fixture-1",
        engineVersion: "engine-1.0.0",
        seed: `seed-${sessionId}`,
      },
    });
    if (!outcome.ok) {
      throw new Error(`fixture record failed capture: ${JSON.stringify(outcome.errors)}`);
    }
    return outcome.record;
  };
  const records = [recordOf("session-1", [100, 200]), recordOf("session-2", [1100, 1500])];
  const evaluation = evaluateExperiment({ manifest: manifest.manifest, records, policy });
  if (!evaluation.ok) {
    throw new Error(`fixture evaluation failed the walk: ${JSON.stringify(evaluation.errors)}`);
  }
  return { manifest: manifest.manifest, records, policy, evaluation: evaluation.evaluation };
}
