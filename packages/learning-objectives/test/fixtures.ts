/**
 * REAL record builders for the W036 tests (the no-shim law: every builder
 * constructs the REAL W035 agent-world / tradrl-world-contracts record
 * shapes the package consumes — nothing here stubs, mocks, or replaces a
 * package seam; only opaque-id leaf values are cast).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { AgentPassRecord } from "agent-world-protocol";
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
  RiskBreach,
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
import { evidenceCapsuleOf, evidenceStreamOf } from "../evidence.js";
import type {
  EvidenceCapsule,
  EvidencePossessionId,
  EvidenceStream,
  ResultingState,
} from "../evidence.js";

/** One issued command's typed outcome, as the pass record carries it. */
type AgentCommandOutcome = AgentPassRecord["outcomes"][number];

const WORLD = "world-alpha" as WorldId;
const ACCOUNT = "acct-1" as AccountId;
const INSTRUMENT = "ins-EQ1" as InstrumentId;
const BODY = "body-1" as BodyId;
const PARTICIPANT = "part-1" as ParticipantId;
const POSSESSION = "possession-1" as EvidencePossessionId;
export const CURRENCY = "USD" as CurrencyCode;

const ts = (milliseconds: number): TimestampMs => milliseconds as TimestampMs;

export function money(amount: string, currency: CurrencyCode = CURRENCY): Money {
  return { amount: amount as DecimalString, currency };
}

export interface PositionInput {
  readonly quantity: string;
  readonly averageEntryPrice?: string;
  readonly markPrice?: string;
  readonly realizedPnl?: string;
  readonly unrealizedPnl?: string;
}

export function position(input: PositionInput): Position {
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

export interface PortfolioInput {
  readonly equity: string;
  readonly realizedPnl?: string;
  readonly unrealizedPnl?: string;
  readonly buyingPower?: string;
  readonly cash?: string;
  readonly positions?: readonly Position[];
  /** Account override, for the account-mismatch law. */
  readonly accountId?: AccountId;
  /** World override, for the world-mismatch law. */
  readonly worldId?: WorldId;
}

export function portfolio(input: PortfolioInput): Portfolio {
  return {
    accountId: input.accountId ?? ACCOUNT,
    worldId: input.worldId ?? WORLD,
    positions: input.positions ?? [],
    cash: money(input.cash ?? "1000000"),
    buyingPower: money(input.buyingPower ?? "1000000"),
    realizedPnl: money(input.realizedPnl ?? "0"),
    unrealizedPnl: money(input.unrealizedPnl ?? "0"),
    equity: money(input.equity),
    asOf: ts(0),
  };
}

export function breach(gate: RiskBreach["gate"], occurredAt: number): RiskBreach {
  return { gate, detail: "fixture runtime risk-gate breach", occurredAt: ts(occurredAt) };
}

export function riskState(breaches: readonly RiskBreach[] = []): RiskState {
  return { accountId: ACCOUNT, worldId: WORLD, limits: {}, breaches, asOf: ts(0) };
}

// --- the pass record (observation → decision → admission → action) ----------

export interface DecisionInput {
  readonly decisionId: string;
  readonly orderKind: "market" | "limit" | "stop" | "stop-limit";
  readonly side: "buy" | "sell";
  readonly quantity: string;
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

export interface OutcomeInput {
  readonly decisionId: string;
  readonly status: "acked" | "authorize-rejected";
  readonly issuedAt: number;
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
      substrateId: "substrate-fixture" as SubstrateId,
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

// --- the capsule + stream (the fourth §10 link: the settled state read) ------

export interface SettledStateInput {
  readonly asOf: number;
  readonly portfolio?: Portfolio;
  readonly riskState?: RiskState;
}

export function settledCapsule(input: PassInput, state: SettledStateInput): EvidenceCapsule {
  const resultingState: ResultingState = {
    asOf: ts(state.asOf),
    ...(state.portfolio === undefined ? {} : { portfolio: state.portfolio }),
    ...(state.riskState === undefined ? {} : { riskState: state.riskState }),
  };
  return evidenceCapsuleOf(passRecord(input), resultingState);
}

export function streamOf(capsules: readonly EvidenceCapsule[]): EvidenceStream {
  return evidenceStreamOf(String(WORLD), POSSESSION, capsules);
}

/**
 * The canonical test stream — 3 passes, equity 100000 → 101000 → 100500, one
 * acked market buy of 10 @ mark 101 at pass 2 (realized 1000, position 10).
 * Every number is chosen so the component/checker arithmetic is exact and
 * re-derivable in the tests (A9 discipline, test-side).
 */
export function canonicalStream(): EvidenceStream {
  return streamOf([
    settledCapsule(
      { pass: 1, observedAt: 1000 },
      { asOf: 1100, portfolio: portfolio({ equity: "100000" }) },
    ),
    settledCapsule(
      {
        pass: 2,
        observedAt: 2000,
        decisions: [
          { decisionId: "d-1", orderKind: "market", side: "buy", quantity: "10", issuedAt: 2000 },
        ],
        outcomes: [{ decisionId: "d-1", status: "acked", issuedAt: 2000 }],
      },
      {
        asOf: 2100,
        portfolio: portfolio({
          equity: "101000",
          realizedPnl: "1000",
          positions: [position({ quantity: "10", markPrice: "101", realizedPnl: "1000" })],
        }),
      },
    ),
    settledCapsule(
      { pass: 3, observedAt: 3000 },
      { asOf: 3100, portfolio: portfolio({ equity: "100500", realizedPnl: "1000" }) },
    ),
  ]);
}
