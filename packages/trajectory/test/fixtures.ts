/**
 * REAL record builders for the W037 trajectory tests (the no-shim law:
 * every builder constructs the REAL W035/W036/tradrl-world-contracts record
 * shapes the package consumes — nothing stubs a package seam; only opaque-id
 * leaf values are cast). The pass-record builders follow the W036 precedent.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { AgentPassRecord, AgentSessionStatus, AgentSessionTelemetry } from "agent-world-protocol";
import type {
  AccountId,
  CommandId,
  CommandResult,
  CurrencyCode,
  DecimalString,
  InstrumentId,
  Money,
  ParticipantId,
  Portfolio,
  Position,
  Price,
  Quantity,
  RiskState,
  SequenceNumber,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { BodyId } from "tradrl-world-contracts/agentBody";
import type {
  Decision,
  DecisionId,
  SubstrateId,
  ViewDigest,
} from "tradrl-world-contracts/cognitiveSubstrate";
import {
  createConstraintProgram,
  createEvaluationPolicy,
  createRewardModel,
} from "learning-objectives";
import type {
  EvaluationPolicy,
  ResultingState,
} from "learning-objectives";
import type { TrajectoryDeterminismMetadata } from "../record.js";
import type { TrajectoryScope } from "../identity.js";

type AgentCommandOutcome = AgentPassRecord["outcomes"][number];

const WORLD = "world-alpha" as WorldId;
const ACCOUNT = "acct-1" as AccountId;
const INSTRUMENT = "ins-EQ1" as InstrumentId;
const BODY = "body-1" as BodyId;
const PARTICIPANT = "part-1" as ParticipantId;
const POSSESSION = "possession-1" as AgentSessionTelemetry["possessionId"];
const SUBSTRATE = "substrate-fixture" as SubstrateId;

const ts = (milliseconds: number): TimestampMs => milliseconds as TimestampMs;

// --- the account reads (the fourth §10 link) ---
export function money(amount: string, currency: CurrencyCode = "USD" as CurrencyCode): Money {
  return { amount: amount as DecimalString, currency };
}

export function position(input: {
  quantity: string;
  averageEntryPrice?: string;
  markPrice?: string;
  realizedPnl?: string;
  unrealizedPnl?: string;
}): Position {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    instrumentId: INSTRUMENT,
    quantity: input.quantity as Quantity,
    averageEntryPrice: (input.averageEntryPrice ?? "100") as Price,
    ...(input.markPrice === undefined ? {} : { markPrice: input.markPrice as Price }),
    realizedPnl: money(input.realizedPnl ?? "0"),
    unrealizedPnl: money(input.unrealizedPnl ?? "0"),
    openedAt: ts(0),
    updatedAt: ts(0),
  };
}

export function portfolio(input: {
  equity: string;
  realizedPnl?: string;
  unrealizedPnl?: string;
  buyingPower?: string;
  cash?: string;
  positions?: readonly Position[];
}): Portfolio {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    positions: input.positions ?? [],
    cash: money(input.cash ?? "1000000"),
    buyingPower: money(input.buyingPower ?? "1000000"),
    realizedPnl: money(input.realizedPnl ?? "0"),
    unrealizedPnl: money(input.unrealizedPnl ?? "0"),
    equity: money(input.equity),
    asOf: ts(0),
  };
}

export function riskState(): RiskState {
  return { accountId: ACCOUNT, worldId: WORLD, limits: {}, breaches: [], asOf: ts(0) };
}

// --- the pass record (observation → decision → admission → action) ---
/** One declared decision (the test builder's input shape). */
export interface DecisionInput {
  readonly decisionId: string;
  readonly orderKind: "market" | "limit" | "stop" | "stop-limit";
  readonly side: "buy" | "sell";
  readonly quantity: string;
  readonly issuedAt: number;
}

/** One declared command outcome (the test builder's input shape). */
export interface OutcomeInput {
  readonly decisionId: string;
  readonly status: "acked" | "authorize-rejected";
  readonly issuedAt: number;
}

function buildDecision(input: DecisionInput, viewDigest: string): Decision {
  return {
    decisionId: input.decisionId as DecisionId,
    viewDigest: viewDigest as ViewDigest,
    command: {
      commandId: `cmd-${input.decisionId}` as CommandId,
      worldId: WORLD,
      issuedBy: PARTICIPANT,
      issuedAt: ts(input.issuedAt),
      kind: "submit-order",
      accountId: ACCOUNT,
      instrumentId: INSTRUMENT,
      submission: {
        kind: input.orderKind,
        side: input.side,
        quantity: input.quantity as Quantity,
        constraints: { timeInForce: "GTC" },
      },
    },
    rationale: {
      rule: "fixture-rule",
      signals: [{ name: "fixture-signal", value: 1 }],
      explanation: "fixture decision rationale (test builder)",
    },
    confidence: 0.5,
  };
}

function buildOutcome(input: OutcomeInput): AgentCommandOutcome {
  const commandId = `cmd-${input.decisionId}` as CommandId;
  const result: CommandResult =
    input.status === "acked"
      ? {
          status: "acked",
          ack: {
            commandId,
            worldId: WORLD,
            acceptedAt: ts(input.issuedAt + 1),
            resultingEventIds: [],
            journalCursor: 1 as SequenceNumber,
          },
        }
      : {
          status: "rejected",
          rejection: {
            stage: "authorize",
            code: "permission-denied",
            message: "fixture authorization denial",
          },
        };
  return {
    decisionId: input.decisionId as DecisionId,
    commandId,
    commandKind: "submit-order",
    result,
  };
}

export interface PassInput {
  readonly pass: number;
  readonly observedAt: number;
  readonly decisions?: readonly DecisionInput[];
  readonly outcomes?: readonly OutcomeInput[];
  readonly admissionOk?: boolean;
}

export function passRecord(input: PassInput): AgentPassRecord {
  const viewDigest = `view-${String(input.pass)}`;
  return {
    pass: input.pass,
    observedAt: ts(input.observedAt),
    observation: {
      asOf: ts(input.observedAt),
      grant: {
        bodyId: BODY,
        worldId: WORLD,
        asOf: ts(input.observedAt),
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
        asOf: ts(input.observedAt),
      },
      viewDigest: viewDigest as ViewDigest,
    },
    stream: {
      substrateId: SUBSTRATE,
      seed: "fixture-seed",
      viewDigest: viewDigest as ViewDigest,
      asOf: ts(input.observedAt),
      decisions: (input.decisions ?? []).map((entry) => buildDecision(entry, viewDigest)),
    },
    streamDigest: `stream-${String(input.pass)}`,
    admission:
      input.admissionOk === false
        ? { ok: false, incompatibilities: [] }
        : { ok: true, checked: [] },
    outcomes: (input.outcomes ?? []).map((entry) => buildOutcome(entry)),
  };
}

// --- the session telemetry (terminal, as capture consumes it) ---

export interface TelemetryInput {
  readonly passes: readonly AgentPassRecord[];
  readonly status?: AgentSessionStatus;
  readonly worldId?: string;
}

export function telemetryOf(input: TelemetryInput): AgentSessionTelemetry {
  const outcomes = input.passes.flatMap((record) => record.outcomes);
  const acked = outcomes.filter((outcome) => outcome.result.status === "acked").length;
  return {
    status: input.status ?? "detached",
    worldId: input.worldId ?? String(WORLD),
    possessionId: POSSESSION,
    bodyId: BODY,
    substrateId: SUBSTRATE,
    attachment: {
      bodyId: BODY,
      worldId: WORLD,
      state: "detached",
      detachReason: "world-closed",
    },
    possession: {
      possessionId: POSSESSION,
      bodyId: BODY,
      substrateId: SUBSTRATE,
      worldId: WORLD,
      state: "released",
      releaseReason: "body-detached",
    },
    passes: [...input.passes],
    viewsReceived: input.passes.length,
    observationsSkipped: 0,
    outcomes,
    acked,
    rejected: outcomes.length - acked,
    admissionRefused: input.passes.filter((record) => !record.admission.ok).length,
  };
}

// --- the W036 evaluation policy (constructed through the real gates) ---

export function fixturePolicy(): EvaluationPolicy {
  const model = createRewardModel({
    modelId: "model-fixture",
    version: "1",
    components: [
      { kind: "realized-pnl", weight: 1, scale: 1000 },
      { kind: "drawdown-control", weight: 1, scale: 1000 },
      { kind: "execution-quality", weight: 0.5, scale: 1 },
    ],
  });
  if (!model.ok) {
    throw new Error("fixture reward model failed construction");
  }
  const program = createConstraintProgram({
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
  if (!program.ok) {
    throw new Error("fixture constraint program failed construction");
  }
  const outcome = createEvaluationPolicy(
    {
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
    model.model,
    program.program,
  );
  if (!outcome.ok) {
    throw new Error("fixture evaluation policy failed construction");
  }
  return outcome.policy;
}

// --- the trajectory capture inputs ---

export const SCOPE: TrajectoryScope = {
  tenantId: "tenant-1",
  projectId: "project-1",
  worldId: "world-alpha",
  experimentId: "exp-fixture",
  sessionId: "session-1",
};

export function scopeOf(overrides: Partial<TrajectoryScope> = {}): TrajectoryScope {
  return { ...SCOPE, ...overrides };
}

export const DETERMINISM: TrajectoryDeterminismMetadata = {
  worldDefinitionDigest: "defdigest-fixture-1",
  engineVersion: "engine-1.0.0",
  seed: "seed-fixture-1",
};

/** The canonical session: 3 passes, equity 100000 → 101000 → 100500. */
export function canonicalPasses(): AgentPassRecord[] {
  return [
    passRecord({ pass: 1, observedAt: 1000 }),
    passRecord({
      pass: 2,
      observedAt: 2000,
      decisions: [
        { decisionId: "d-1", orderKind: "market", side: "buy", quantity: "10", issuedAt: 2000 },
      ],
      outcomes: [{ decisionId: "d-1", status: "acked", issuedAt: 2000 }],
    }),
    passRecord({ pass: 3, observedAt: 3000 }),
  ];
}

export function canonicalResultingStates(): ResultingState[] {
  return [
    { asOf: ts(1100), portfolio: portfolio({ equity: "100000" }) },
    {
      asOf: ts(2100),
      portfolio: portfolio({
        equity: "101000",
        realizedPnl: "1000",
        positions: [position({ quantity: "10", markPrice: "101", realizedPnl: "1000" })],
      }),
    },
    { asOf: ts(3100), portfolio: portfolio({ equity: "100500", realizedPnl: "1000" }) },
  ];
}

export function canonicalTelemetry(): AgentSessionTelemetry {
  return telemetryOf({ passes: canonicalPasses() });
}
