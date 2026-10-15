/**
 * REAL trajectory-side builders for the W041 skills tests (the W037
 * fixture precedent: REAL W035 telemetry/pass shapes bound through the
 * REAL W036 policy constructors and the REAL W037 capture gate; only
 * opaque-id leaf values are cast).
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
import { extractSkills } from "../extract.js";
import type { ExtractionRun } from "../record.js";
import { SCOPE, SUBSTRATE_MOMENTUM, experimentFixture, registryFixture } from "./registry.js";

const WORLD = SCOPE.worldId as WorldId;
const ACCOUNT = "acct-skill-1" as AccountId;
const INSTRUMENT = "ins-EQ1" as InstrumentId;
const BODY = "body-execution-class" as BodyId;
const PARTICIPANT = "part-skill-1" as ParticipantId;
const POSSESSION = "possession-skill-1" as AgentSessionTelemetry["possessionId"];
const SUBSTRATE = String(SUBSTRATE_MOMENTUM) as SubstrateId;
const ts = (milliseconds: number): TimestampMs => milliseconds as TimestampMs;
// --- the account reads ---
const worldOf = (worldId?: string): WorldId => (worldId ?? String(WORLD)) as WorldId;
function money(amount: string, currency: CurrencyCode = "USD" as CurrencyCode): Money {
  return { amount: amount as DecimalString, currency };
}
function position(input: {
  quantity: string;
  markPrice?: string;
  realizedPnl?: string;
  worldId?: string;
}): Position {
  const world = worldOf(input.worldId);
  return {
    accountId: ACCOUNT,
    worldId: world,
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
function portfolio(input: {
  equity: string;
  realizedPnl?: string;
  positions?: readonly Position[];
  worldId?: string;
}): Portfolio {
  const world = worldOf(input.worldId);
  return {
    accountId: ACCOUNT,
    worldId: world,
    positions: input.positions ?? [],
    cash: money("1000000"),
    buyingPower: money("1000000"),
    realizedPnl: money(input.realizedPnl ?? "0"),
    unrealizedPnl: money("0"),
    equity: money(input.equity),
    asOf: ts(0),
  };
}
// --- the pass record (observation → decision → admission → action) ---
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
function buildDecision(
  input: DecisionInput,
  viewDigest: string,
  world: WorldId,
): AgentPassRecord["stream"]["decisions"][number] {
  return {
    decisionId: input.decisionId as DecisionId,
    viewDigest: viewDigest as ViewDigest,
    command: {
      commandId: `cmd-${input.decisionId}` as CommandId,
      worldId: world,
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
      explanation: "skills fixture decision rationale (test builder)",
    },
    confidence: 0.5,
  };
}
function buildOutcome(input: OutcomeInput, world: WorldId): AgentPassRecord["outcomes"][number] {
  const commandId = `cmd-${input.decisionId}` as CommandId;
  const result: CommandResult =
    input.status === "acked"
      ? {
          status: "acked",
          ack: {
            commandId,
            worldId: world,
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
            message: "skills fixture authorization denial",
          },
        };
  return {
    decisionId: input.decisionId as DecisionId,
    commandId,
    commandKind: "submit-order",
    result,
  };
}
interface PassInput {
  readonly pass: number;
  readonly observedAt: number;
  readonly decisions?: readonly DecisionInput[];
  readonly outcomes?: readonly OutcomeInput[];
  readonly worldId?: string;
}
function passRecord(input: PassInput): AgentPassRecord {
  const viewDigest = `view-${String(input.pass)}`;
  const world = (input.worldId ?? String(WORLD)) as WorldId;
  return {
    pass: input.pass,
    observedAt: ts(input.observedAt),
    observation: {
      asOf: ts(input.observedAt),
      grant: {
        bodyId: BODY,
        worldId: world,
        asOf: ts(input.observedAt),
        kinds: ["own-portfolio"],
        instruments: [INSTRUMENT],
        visibleArtifacts: [],
        withheldArtifacts: [],
        denials: [],
      },
      view: {
        bodyId: BODY,
        worldId: world,
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
      decisions: (input.decisions ?? []).map((entry) => buildDecision(entry, viewDigest, world)),
    },
    streamDigest: `stream-${String(input.pass)}`,
    admission: { ok: true, checked: [] },
    outcomes: (input.outcomes ?? []).map((entry) => buildOutcome(entry, world)),
  };
}
// --- the session telemetry (terminal, as capture consumes it) ---
interface TelemetryInput {
  readonly passes: readonly AgentPassRecord[];
  readonly status?: AgentSessionStatus;
  readonly worldId?: string;
}
function telemetryOf(input: TelemetryInput): AgentSessionTelemetry {
  const outcomes = input.passes.flatMap((record) => record.outcomes);
  const acked = outcomes.filter((outcome) => outcome.result.status === "acked").length;
  const world = (input.worldId ?? String(WORLD)) as WorldId;
  return {
    status: input.status ?? "detached",
    worldId: world,
    possessionId: POSSESSION,
    bodyId: BODY,
    substrateId: SUBSTRATE,
    attachment: {
      bodyId: BODY,
      worldId: world,
      state: "detached",
      detachReason: "world-closed",
    },
    possession: {
      possessionId: POSSESSION,
      bodyId: BODY,
      substrateId: SUBSTRATE,
      worldId: world,
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
function fixturePolicy(): EvaluationPolicy {
  const model = createRewardModel({
    modelId: "model-skill-fixture",
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
    programId: "cp-skill-fixture",
    constraints: [
      { constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.001, penalty: { shape: "linear", coefficient: 10 } },
      { constraintId: "tb-1", kind: "turnover-budget", maxCommandsPerView: 0, penalty: { shape: "linear", coefficient: 2 } },
      { constraintId: "de-1", kind: "drawdown-envelope", maxDrawdownFraction: 0.001, penalty: { shape: "linear", coefficient: 1 } },
    ],
  });
  if (!program.ok) {
    throw new Error("fixture constraint program failed construction");
  }
  const outcome = createEvaluationPolicy(
    {
      policyId: "pol-skill-fixture",
      rewardModelId: "model-skill-fixture",
      rewardModelVersion: "1",
      constraintProgramId: "cp-skill-fixture",
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
    throw new Error("fixture evaluation policy failed construction");
  }
  return outcome.policy;
}
// --- the trajectory capture fixtures ---
export const DETERMINISM: TrajectoryDeterminismMetadata = {
  worldDefinitionDigest: "defdigest-skill-fixture-1", engineVersion: "engine-1.0.0", seed: "seed-skill-fixture-1",
};
/** The canonical session: 3 passes, one acked market buy in pass 2. */
function canonicalPasses(worldId?: string): AgentPassRecord[] {
  return [
    passRecord({ pass: 1, observedAt: 1000, worldId }),
    passRecord({
      pass: 2,
      observedAt: 2000,
      worldId,
      decisions: [{ decisionId: "d-1", orderKind: "market", side: "buy", quantity: "10", issuedAt: 2000 }],
      outcomes: [{ decisionId: "d-1", status: "acked", issuedAt: 2000 }],
    }),
    passRecord({ pass: 3, observedAt: 3000, worldId }),
  ];
}
function resultingStates(equityPeak: string, realized: string, equityFinal: string, worldId?: string): ResultingState[] {
  return [
    { asOf: ts(1100), portfolio: portfolio({ equity: "100000", worldId }) },
    {
      asOf: ts(2100),
      portfolio: portfolio({
        equity: equityPeak,
        realizedPnl: realized,
        worldId,
        positions: [position({ quantity: "10", markPrice: "101", realizedPnl: realized, worldId })],
      }),
    },
    { asOf: ts(3100), portfolio: portfolio({ equity: equityFinal, realizedPnl: realized, worldId }) },
  ];
}
/**
 * One REAL trajectory record, captured through the W037 gate. The scope's
 * experiment member binds to the canonical id of the registry fixture's
 * experiment (the demonstrating binding's input), and the session's
 * substrate is the momentum substrate (the registry fixture's bearer).
 */
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
    throw new Error(`fixture trajectory capture failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.record;
}
/** A valid trajectory captured in ANOTHER world (the scope-mismatch fixture). */
export function foreignWorldTrajectory(sessionId: string): TrajectoryRecord {
  const scope: TrajectoryScope = {
    tenantId: SCOPE.tenantId,
    projectId: SCOPE.projectId,
    worldId: "world-skill-other",
    experimentId: String(experimentIdOf(experimentFixture())),
    sessionId,
  };
  const outcome = trajectoryRecordOf({
    scope,
    telemetry: telemetryOf({ passes: canonicalPasses("world-skill-other"), worldId: "world-skill-other" }),
    resultingStates: resultingStates("101000", "1000", "100500", "world-skill-other"),
    policy: fixturePolicy(),
    determinism: DETERMINISM,
  });
  if (!outcome.ok) {
    throw new Error(`fixture foreign trajectory capture failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.record;
}
/** The default batch: two sessions of the momentum substrate in the cited experiment. */
export function fixtureTrajectories(): TrajectoryRecord[] {
  return [trajectoryFixture("session-skill-1", 1), trajectoryFixture("session-skill-2", 2)];
}
/** The default extraction run over the fixture batch + the fixture registry. */
export function extractionFixture(
  trajectories: readonly TrajectoryRecord[] = fixtureTrajectories(),
): ExtractionRun {
  const outcome = extractSkills(trajectories, registryFixture());
  if (!outcome.ok) {
    throw new Error(`fixture extraction failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.run;
}
