/**
 * REAL trajectory-side builders for the W043 commissioning tests —
 * ADAPTED from the W041 body-forge test fixtures (the W037 fixture
 * precedent: REAL W035 telemetry/pass shapes bound through the REAL W036
 * policy constructors and the REAL W037 capture gate; only opaque-id leaf
 * values are cast), re-bound to THIS module's own experiment fixture so
 * the extracted skills cite the commissioning registry's own evidence.
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
  SequenceNumber,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { BodyId } from "tradrl-world-contracts/agentBody";
import type { DecisionId, SubstrateId, ViewDigest } from "tradrl-world-contracts/cognitiveSubstrate";
import {
  createConstraintProgram,
  createEvaluationPolicy,
  createRewardModel,
} from "learning-objectives";
import type { EvaluationPolicy, ResultingState } from "learning-objectives";
import { experimentIdOf } from "experiments";
import { trajectoryRecordOf } from "trajectory";
import type { TrajectoryDeterminismMetadata, TrajectoryRecord, TrajectoryScope } from "trajectory";
import { SCOPE, SUBSTRATE_MOMENTUM, experimentFixture } from "./evidence.js";

const WORLD = SCOPE.worldId as WorldId;
const ACCOUNT = "acct-forge-1" as AccountId;
const INSTRUMENT = "ins-FE1" as InstrumentId;
const BODY = "body-execution-class" as BodyId;
const PARTICIPANT = "part-forge-1" as ParticipantId;
const POSSESSION = "possession-commissioning-1" as AgentSessionTelemetry["possessionId"];
const SUBSTRATE = String(SUBSTRATE_MOMENTUM) as SubstrateId;
const ts = (milliseconds: number): TimestampMs => milliseconds as TimestampMs;

function money(amount: string, currency: CurrencyCode = "USD" as CurrencyCode): Money {
  return { amount: amount as DecimalString, currency };
}
function position(input: { quantity: string; markPrice?: string; realizedPnl?: string }): Position {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    instrumentId: INSTRUMENT,
    quantity: input.quantity as Quantity,
    averageEntryPrice: "100" as Price,
    markPrice: (input.markPrice ?? "100") as Price,
    realizedPnl: money(input.realizedPnl ?? "0"),
    unrealizedPnl: money("0"),
    openedAt: ts(0),
    updatedAt: ts(0),
  };
}
function portfolio(input: { equity: string; realizedPnl?: string; positions?: readonly Position[] }): Portfolio {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    positions: input.positions ?? [],
    cash: money("1000000"),
    buyingPower: money("1000000"),
    realizedPnl: money(input.realizedPnl ?? "0"),
    unrealizedPnl: money("0"),
    equity: money(input.equity),
    asOf: ts(0),
  };
}

interface DecisionInput {
  readonly decisionId: string;
  readonly orderKind: "market" | "limit" | "stop" | "stop-limit";
  readonly side: "buy" | "sell";
  readonly quantity: string;
  readonly issuedAt: number;
}
interface OutcomeInput {
  readonly decisionId: string;
  readonly status: "acked" | "authorize-rejected";
  readonly issuedAt: number;
}

function buildDecision(input: DecisionInput, viewDigest: string): AgentPassRecord["stream"]["decisions"][number] {
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
      explanation: "commissioning fixture decision rationale (test builder)",
    },
    confidence: 0.5,
  };
}

function buildOutcome(input: OutcomeInput): AgentPassRecord["outcomes"][number] {
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
          rejection: { stage: "authorize", code: "permission-denied", message: "commissioning fixture authorization denial" },
        };
  return { decisionId: input.decisionId as DecisionId, commandId, commandKind: "submit-order", result };
}

interface PassInput {
  readonly pass: number;
  readonly observedAt: number;
  readonly decisions?: readonly DecisionInput[];
  readonly outcomes?: readonly OutcomeInput[];
}
function passRecord(input: PassInput): AgentPassRecord {
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
    admission: { ok: true, checked: [] },
    outcomes: (input.outcomes ?? []).map((entry) => buildOutcome(entry)),
  };
}

function telemetryOf(input: {
  readonly passes: readonly AgentPassRecord[];
  readonly status?: AgentSessionStatus;
}): AgentSessionTelemetry {
  const outcomes = input.passes.flatMap((record) => record.outcomes);
  const acked = outcomes.filter((outcome) => outcome.result.status === "acked").length;
  return {
    status: input.status ?? "detached",
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
    passes: [...input.passes],
    viewsReceived: input.passes.length,
    observationsSkipped: 0,
    outcomes,
    acked,
    rejected: outcomes.length - acked,
    admissionRefused: input.passes.filter((record) => !record.admission.ok).length,
  };
}

function fixturePolicy(): EvaluationPolicy {
  const model = createRewardModel({
    modelId: "model-forge-fixture",
    version: "1",
    components: [
      { kind: "realized-pnl", weight: 1, scale: 1000 },
      { kind: "drawdown-control", weight: 1, scale: 1000 },
      { kind: "execution-quality", weight: 0.5, scale: 1 },
    ],
  });
  if (!model.ok) {
    throw new Error("commissioning fixture reward model failed construction");
  }
  const program = createConstraintProgram({
    programId: "cp-forge-fixture",
    constraints: [
      { constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.001, penalty: { shape: "linear", coefficient: 10 } },
      { constraintId: "tb-1", kind: "turnover-budget", maxCommandsPerView: 0, penalty: { shape: "linear", coefficient: 2 } },
      { constraintId: "de-1", kind: "drawdown-envelope", maxDrawdownFraction: 0.001, penalty: { shape: "linear", coefficient: 1 } },
    ],
  });
  if (!program.ok) {
    throw new Error("commissioning fixture constraint program failed construction");
  }
  const outcome = createEvaluationPolicy(
    {
      policyId: "pol-forge-fixture",
      rewardModelId: "model-forge-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-forge-fixture",
      penalizedConstraintIds: ["eb-1", "tb-1"],
      penaltyWeight: 0.5,
      axes: {
        holdouts: [{ axisId: "h-1", kind: "unseen-period" }, { axisId: "h-2", kind: "venue" }],
        stresses: [{ axisId: "s-1", kind: "execution" }],
        ablations: [],
        integrity: ["evidence-chain", "deterministic-replay"],
      },
    },
    model.model,
    program.program,
  );
  if (!outcome.ok) {
    throw new Error("commissioning fixture evaluation policy failed construction");
  }
  return outcome.policy;
}

export const DETERMINISM: TrajectoryDeterminismMetadata = {
  worldDefinitionDigest: "defdigest-forge-fixture-1",
  engineVersion: "engine-1.0.0",
  seed: "seed-forge-fixture-1",
};

function canonicalPasses(): AgentPassRecord[] {
  return [
    passRecord({ pass: 1, observedAt: 1000 }),
    passRecord({
      pass: 2,
      observedAt: 2000,
      decisions: [{ decisionId: "d-1", orderKind: "market", side: "buy", quantity: "10", issuedAt: 2000 }],
      outcomes: [{ decisionId: "d-1", status: "acked", issuedAt: 2000 }],
    }),
    passRecord({ pass: 3, observedAt: 3000 }),
  ];
}

function resultingStates(equityPeak: string, realized: string, equityFinal: string): ResultingState[] {
  return [
    { asOf: ts(1100), portfolio: portfolio({ equity: "100000" }) },
    {
      asOf: ts(2100),
      portfolio: portfolio({
        equity: equityPeak,
        realizedPnl: realized,
        positions: [position({ quantity: "10", markPrice: "101", realizedPnl: realized })],
      }),
    },
    { asOf: ts(3100), portfolio: portfolio({ equity: equityFinal, realizedPnl: realized }) },
  ];
}

/** One REAL trajectory record, captured through the W037 gate (the momentum substrate, the cited experiment). */
export function trajectoryFixture(sessionId: string, variant: 1 | 2 = 1): TrajectoryRecord {
  const scope: TrajectoryScope = {
    tenantId: SCOPE.tenantId,
    projectId: SCOPE.projectId,
    worldId: SCOPE.worldId,
    experimentId: String(experimentIdOf(experimentFixture())),
    sessionId,
  };
  const states =
    variant === 1
      ? resultingStates("101000", "1000", "100500")
      : resultingStates("100800", "800", "100400");
  const outcome = trajectoryRecordOf({
    scope,
    telemetry: telemetryOf({ passes: canonicalPasses() }),
    resultingStates: states,
    policy: fixturePolicy(),
    determinism: DETERMINISM,
  });
  if (!outcome.ok) {
    throw new Error(`commissioning fixture trajectory capture failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.record;
}

/** The default batch: two sessions of the momentum substrate in the cited experiment. */
export function fixtureTrajectories(): TrajectoryRecord[] {
  return [trajectoryFixture("session-commissioning-1", 1), trajectoryFixture("session-commissioning-2", 2)];
}
