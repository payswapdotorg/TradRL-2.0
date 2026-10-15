/**
 * REAL record builders for the W038 evaluation tests (the no-shim law: every
 * builder constructs the REAL W035/W036/W037 shapes through the REAL
 * construction/capture/manifest seams — nothing stubs a package seam; only
 * opaque-id leaf values are cast). The builders follow the W037 test
 * precedent.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { AgentPassRecord, AgentSessionTelemetry } from "agent-world-protocol";
import type {
  DecimalString,
  Money,
  Portfolio,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type {
  AccountId,
  CommandId,
  CurrencyCode,
  InstrumentId,
  ParticipantId,
  Quantity,
  SequenceNumber,
} from "tradrl-world-contracts";
import type { BodyId } from "tradrl-world-contracts/agentBody";
import type { Decision, DecisionId, SubstrateId, ViewDigest } from "tradrl-world-contracts/cognitiveSubstrate";
import {
  createConstraintProgram,
  createEvaluationPolicy,
  createRewardModel,
} from "learning-objectives";
import type { EvaluationPolicy, ResultingState } from "learning-objectives";
import { experimentIdOf } from "experiments";
import { createExperiment, experimentManifestOf } from "experiments";
import type { ExperimentDescriptor, HoldoutSplitDescriptor } from "experiments";
import { trajectoryIdOf, trajectoryRecordOf } from "trajectory";
import type { TrajectoryRecord, TrajectoryScope } from "trajectory";

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

function portfolio(equity: string, realizedPnl = "0"): Portfolio {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    positions: [],
    cash: money("1000000"),
    buyingPower: money("1000000"),
    realizedPnl: money(realizedPnl),
    unrealizedPnl: money("0"),
    equity: money(equity),
    asOf: ts(0),
  };
}

function passRecord(spec: {
  readonly pass: number;
  readonly observedAt: number;
  /** Declare one command this pass (market/limit → the venue-policy lever). */
  readonly orderKind?: "market" | "limit";
  readonly instrumentId?: string;
}): AgentPassRecord {
  const viewDigest = `view-${String(spec.pass)}` as ViewDigest;
  const decisions: Decision[] =
    spec.orderKind === undefined
      ? []
      : [
          {
            decisionId: `d-${String(spec.pass)}` as DecisionId,
            viewDigest,
            command: {
              commandId: `cmd-${String(spec.pass)}` as CommandId, worldId: WORLD, issuedBy: PARTICIPANT,
              issuedAt: ts(spec.observedAt), kind: "submit-order", accountId: ACCOUNT,
              instrumentId: (spec.instrumentId ?? String(INSTRUMENT)) as InstrumentId,
              submission: {
                kind: spec.orderKind, side: "buy", quantity: "10" as Quantity,
                constraints: { timeInForce: "GTC" },
              },
            },
            rationale: {
              rule: "fixture-rule", signals: [{ name: "fixture-signal", value: 1 }],
              explanation: "fixture decision rationale (test builder)",
            },
            confidence: 0.5,
          },
        ];
  const outcomes =
    spec.orderKind === undefined
      ? []
      : [
          {
            decisionId: `d-${String(spec.pass)}` as DecisionId,
            commandId: `cmd-${String(spec.pass)}` as CommandId,
            commandKind: "submit-order" as const,
            result: {
              status: "acked" as const,
              ack: {
                commandId: `cmd-${String(spec.pass)}` as CommandId, worldId: WORLD,
                acceptedAt: ts(spec.observedAt + 1), resultingEventIds: [],
                journalCursor: 1 as SequenceNumber,
              },
            },
          },
        ];
  return {
    pass: spec.pass,
    observedAt: ts(spec.observedAt),
    observation: {
      asOf: ts(spec.observedAt),
      grant: {
        bodyId: BODY, worldId: WORLD, asOf: ts(spec.observedAt), kinds: ["own-portfolio"],
        instruments: [INSTRUMENT], visibleArtifacts: [], withheldArtifacts: [], denials: [],
      },
      view: {
        bodyId: BODY, worldId: WORLD, instruments: [INSTRUMENT], observations: ["own-portfolio"],
        accountId: ACCOUNT, participantId: PARTICIPANT, asOf: ts(spec.observedAt),
      },
      viewDigest,
    },
    stream: {
      substrateId: SUBSTRATE,
      seed: "fixture-seed",
      viewDigest,
      asOf: ts(spec.observedAt),
      decisions,
    },
    streamDigest: `stream-${String(spec.pass)}`,
    admission: { ok: true, checked: [] },
    outcomes,
  };
}

export function telemetryOf(passes: readonly AgentPassRecord[]): AgentSessionTelemetry {
  const outcomes = passes.flatMap((record) => record.outcomes);
  const acked = outcomes.filter((outcome) => outcome.result.status === "acked").length;
  return {
    status: "detached",
    worldId: String(WORLD),
    possessionId: POSSESSION,
    bodyId: BODY,
    substrateId: SUBSTRATE,
    attachment: { bodyId: BODY, worldId: WORLD, state: "detached", detachReason: "world-closed" },
    possession: { possessionId: POSSESSION, bodyId: BODY, substrateId: SUBSTRATE, worldId: WORLD, state: "released", releaseReason: "body-detached" },
    passes: [...passes],
    viewsReceived: passes.length,
    observationsSkipped: 0,
    outcomes,
    acked,
    rejected: outcomes.length - acked,
    admissionRefused: 0,
  };
}

// --- the fixture policy / experiment / manifest family ------------------------

const REWARD_MODEL = {
  modelId: "model-fixture",
  version: "1",
  components: [
    { kind: "realized-pnl", weight: 1, scale: 1000 },
    { kind: "drawdown-control", weight: 1, scale: 1000 },
    { kind: "execution-quality", weight: 0.5, scale: 1 },
  ],
} as const;

const SOFT_PROGRAM = {
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
} as const;

/** The hard-violation program: venue-policy admits ONLY limit orders. */
const HARD_PROGRAM = {
  programId: "cp-hard",
  constraints: [
    ...SOFT_PROGRAM.constraints,
    { constraintId: "vp-1", kind: "venue-policy", allowedOrderKinds: ["limit"] },
  ],
} as const;

function policySpec(programId: string): object {
  return {
    policyId: "pol-fixture",
    rewardModelId: "model-fixture",
    rewardModelVersion: "1",
    constraintProgramId: programId,
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
  };
}

function build(programId: string, program: object): EvaluationPolicy {
  const model = createRewardModel(REWARD_MODEL);
  if (!model.ok) {
    throw new Error("fixture reward model failed construction");
  }
  const built = createConstraintProgram(program as never);
  if (!built.ok) {
    throw new Error("fixture constraint program failed construction");
  }
  const outcome = createEvaluationPolicy(
    policySpec(programId) as never,
    model.model,
    built.program,
  );
  if (!outcome.ok) {
    throw new Error("fixture evaluation policy failed construction");
  }
  return outcome.policy;
}

export function fixturePolicy(): EvaluationPolicy {
  return build(SOFT_PROGRAM.programId, SOFT_PROGRAM);
}

export function fixtureHardPolicy(): EvaluationPolicy {
  return build(HARD_PROGRAM.programId, HARD_PROGRAM);
}

function descriptorOf(program: object): ExperimentDescriptor {
  return {
    name: "exp-fixture",
    tenantId: "tenant-1",
    projectId: "project-1",
    world: { worldId: "world-alpha", definitionDigest: "defdigest-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: "substrate-fixture" },
    ],
    rewardModel: REWARD_MODEL,
    constraints: program as never,
    policy: policySpec((program as { programId: string }).programId) as never,
  };
}

export const EXPERIMENT_ID = experimentIdOf(descriptorOf(SOFT_PROGRAM));
export const HARD_EXPERIMENT_ID = experimentIdOf(descriptorOf(HARD_PROGRAM));

export function fixtureScope(sessionId: string, experimentId: string = EXPERIMENT_ID): TrajectoryScope {
  return {
    tenantId: "tenant-1",
    projectId: "project-1",
    worldId: "world-alpha",
    experimentId: experimentId as TrajectoryScope["experimentId"],
    sessionId,
  };
}

export const PERIOD_TRAIN = { kind: "period", from: ts(0), to: ts(999) } as const;
export const PERIOD_EVAL = { kind: "period", from: ts(1000), to: ts(2000) } as const;

export const SPLIT_H1: HoldoutSplitDescriptor = {
  axisId: "h-1",
  kind: "unseen-period",
  train: [PERIOD_TRAIN],
  evaluation: [PERIOD_EVAL],
};

export const SPLIT_H2: HoldoutSplitDescriptor = {
  axisId: "h-2",
  kind: "venue",
  train: [{ kind: "venue", venueId: "venue-train" }],
  evaluation: [{ kind: "venue", venueId: "venue-holdout" }],
};

export interface RecordSpec {
  readonly sessionId: string;
  /** The capsule observation instants (also the period-membership lever). */
  readonly instants: readonly number[];
  readonly orderKind?: "market" | "limit";
  readonly instrumentId?: string;
  /** Position equity path (default: flat 100000). */
  readonly equities?: readonly string[];
  /** The owning experiment's id (default: the soft-program fixture). */
  readonly experimentId?: string;
}

export function recordOf(
  spec: RecordSpec,
  policy: EvaluationPolicy = fixturePolicy(),
): TrajectoryRecord {
  const passes = spec.instants.map((instant, index) =>
    passRecord({
      pass: index + 1,
      observedAt: instant,
      orderKind: index === 0 ? spec.orderKind : undefined,
      instrumentId: spec.instrumentId,
    }),
  );
  const states: ResultingState[] = spec.instants.map((instant, index) => ({
    asOf: ts(instant + 100),
    portfolio: portfolio(spec.equities?.[index] ?? "100000"),
  }));
  const outcome = trajectoryRecordOf({
    scope: fixtureScope(spec.sessionId, spec.experimentId ?? (policy.descriptor.constraintProgramId === "cp-hard" ? HARD_EXPERIMENT_ID : EXPERIMENT_ID)),
    telemetry: telemetryOf(passes),
    resultingStates: states,
    policy,
    determinism: {
      worldDefinitionDigest: "defdigest-fixture-1",
      engineVersion: "engine-1.0.0",
      seed: `seed-${spec.sessionId}`,
    },
  });
  if (!outcome.ok) {
    throw new Error(`fixture record failed capture: ${JSON.stringify(outcome.errors)}`);
  }
  return outcome.record;
}

export interface FixtureBundle {
  readonly manifest: ReturnType<typeof manifestOf>;
  readonly records: readonly TrajectoryRecord[];
  readonly policy: EvaluationPolicy;
}

function manifestOf(sessionIds: readonly string[], policy: EvaluationPolicy) {
  const descriptor = descriptorOf(
    policy.descriptor.constraintProgramId === "cp-hard" ? HARD_PROGRAM : SOFT_PROGRAM,
  );
  const experiment = createExperiment(descriptor);
  if (!experiment.ok) {
    throw new Error("fixture experiment failed construction");
  }
  const refs = sessionIds.map((sessionId) => {
    const scope = fixtureScope(sessionId, String(experiment.experiment.experimentId));
    return { trajectoryId: trajectoryIdOf(scope), scope };
  });
  const outcome = experimentManifestOf(experiment.experiment, {
    trajectories: refs,
    holdoutSplits: [SPLIT_H1, SPLIT_H2],
  });
  if (!outcome.ok) {
    throw new Error("fixture manifest failed construction");
  }
  return outcome.manifest;
}

/** The canonical bundle: two train-side + one evaluation-side trajectory. */
export function fixtureBundle(): FixtureBundle {
  const policy = fixturePolicy();
  const manifest = manifestOf(["session-1", "session-2", "session-3"], policy);
  const records = [
    recordOf({ sessionId: "session-1", instants: [100, 200] }),
    recordOf({ sessionId: "session-2", instants: [1100, 1500] }),
    recordOf({ sessionId: "session-3", instants: [100, 200], orderKind: "market" }),
  ];
  return { manifest, records, policy };
}

/** The hard-violation bundle: a market order under a limit-only venue policy. */
export function hardFixtureBundle(): FixtureBundle {
  const policy = fixtureHardPolicy();
  const manifest = manifestOf(["session-1"], policy);
  const records = [recordOf({ sessionId: "session-1", instants: [100, 200], orderKind: "market" }, policy)];
  return { manifest, records, policy };
}
