/**
 * The parameterized W035 session builders for the W047 bridge tests (the
 * no-shim law: REAL record shapes, opaque-id leaf values only). These are
 * parameterized copies of the trajectory package's own test builders (the
 * W041 fixture lineage): the trajectory fixtures hardcode their
 * world/account ids, while the bridge demands the trajectory live in the
 * BINDING's world (the body-forge commissioning scope) — so the ids
 * parameterize here, reusing the W044 fixtures' commissioned material.
 * Disclosed in-header.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { AgentPassRecord, AgentSessionTelemetry } from "agent-world-protocol";
import type { CommissionedBody } from "body-forge/commissioning";
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
  ACCOUNT_SEAT,
  INSTRUMENT_CO,
  PARTICIPANT_SEAT,
  SCOPE,
} from "../../../world-agent-runtime/test/fixtures.js";

type AgentCommandOutcome = AgentPassRecord["outcomes"][number];

const ts = (milliseconds: number): TimestampMs => milliseconds as TimestampMs;

// --- the session context (the binding's world, seat, and commissioned mind) ---

export interface SessionContext {
  readonly worldId: string;
  readonly accountId: string;
  readonly participantId: string;
  readonly instrumentId: string;
  readonly bodyId: string;
  readonly substrateId: string;
  readonly possessionId: string;
}

export function sessionContext(
  commissioned: CommissionedBody,
  overrides: Partial<SessionContext> = {},
): SessionContext {
  return {
    worldId: String(SCOPE.worldId),
    accountId: ACCOUNT_SEAT,
    participantId: PARTICIPANT_SEAT,
    instrumentId: String(INSTRUMENT_CO),
    bodyId: String(commissioned.body.bodyId),
    substrateId: String(commissioned.substrate.substrateId),
    possessionId: String(commissioned.possession.possessionId),
    ...overrides,
  };
}

// --- the account reads (parameterized REAL shapes) --------------------------

function money(amount: string, currency: CurrencyCode = "USD" as CurrencyCode): Money {
  return { amount: amount as DecimalString, currency };
}

function position(ctx: SessionContext, input: { quantity: string; markPrice?: string; realizedPnl?: string }): Position {
  return {
    accountId: ctx.accountId as AccountId,
    worldId: ctx.worldId as WorldId,
    instrumentId: ctx.instrumentId as InstrumentId,
    quantity: input.quantity as Quantity,
    averageEntryPrice: "100" as Price,
    ...(input.markPrice === undefined ? {} : { markPrice: input.markPrice as Price }),
    realizedPnl: money(input.realizedPnl ?? "0"),
    unrealizedPnl: money("0"),
    openedAt: ts(0),
    updatedAt: ts(0),
  };
}

function portfolio(ctx: SessionContext, input: { equity: string; realizedPnl?: string; positions?: readonly Position[] }): Portfolio {
  return {
    accountId: ctx.accountId as AccountId,
    worldId: ctx.worldId as WorldId,
    positions: input.positions ?? [],
    cash: money("1000000"),
    buyingPower: money("1000000"),
    realizedPnl: money(input.realizedPnl ?? "0"),
    unrealizedPnl: money("0"),
    equity: money(input.equity),
    asOf: ts(0),
  };
}


// --- the pass record (observation → decision → admission → action) -----------

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

interface PassInput {
  readonly pass: number;
  readonly observedAt: number;
  readonly decisions?: readonly DecisionInput[];
  readonly outcomes?: readonly OutcomeInput[];
}

function passRecord(ctx: SessionContext, input: PassInput): AgentPassRecord {
  const viewDigest = `view-${String(input.pass)}` as ViewDigest;
  const decisionInputs = input.decisions ?? [];
  const outcomeInputs = input.outcomes ?? [];
  const outcomes: AgentCommandOutcome[] = outcomeInputs.map((entry) => {
    const commandId = `cmd-${entry.decisionId}` as CommandId;
    const result: CommandResult =
      entry.status === "acked"
        ? {
            status: "acked",
            ack: {
              commandId,
              worldId: ctx.worldId as WorldId,
              acceptedAt: ts(entry.issuedAt + 1),
              resultingEventIds: [],
              journalCursor: 1 as SequenceNumber,
            },
          }
        : {
            status: "rejected",
            rejection: { stage: "authorize", code: "permission-denied", message: "fixture authorization denial" },
          };
    return {
      decisionId: entry.decisionId as DecisionId,
      commandId,
      commandKind: "submit-order",
      result,
    };
  });
  return {
    pass: input.pass,
    observedAt: ts(input.observedAt),
    observation: {
      asOf: ts(input.observedAt),
      grant: {
        bodyId: ctx.bodyId as BodyId,
        worldId: ctx.worldId as WorldId,
        asOf: ts(input.observedAt),
        kinds: ["own-portfolio"],
        instruments: [ctx.instrumentId as InstrumentId],
        visibleArtifacts: [],
        withheldArtifacts: [],
        denials: [],
      },
      view: {
        bodyId: ctx.bodyId as BodyId,
        worldId: ctx.worldId as WorldId,
        instruments: [ctx.instrumentId as InstrumentId],
        observations: ["own-portfolio"],
        accountId: ctx.accountId as AccountId,
        participantId: ctx.participantId as ParticipantId,
        asOf: ts(input.observedAt),
      },
      viewDigest,
    },
    stream: {
      substrateId: ctx.substrateId as SubstrateId,
      seed: "fixture-seed",
      viewDigest,
      asOf: ts(input.observedAt),
      decisions: decisionInputs.map((entry) => ({
        decisionId: entry.decisionId as DecisionId,
        viewDigest,
        command: {
          commandId: `cmd-${entry.decisionId}` as CommandId,
          worldId: ctx.worldId as WorldId,
          issuedBy: ctx.participantId as ParticipantId,
          issuedAt: ts(entry.issuedAt),
          kind: "submit-order",
          accountId: ctx.accountId as AccountId,
          instrumentId: ctx.instrumentId as InstrumentId,
          submission: {
            kind: entry.orderKind,
            side: entry.side,
            quantity: entry.quantity as Quantity,
            constraints: { timeInForce: "GTC" },
          },
        },
        rationale: {
          rule: "fixture-rule",
          signals: [{ name: "fixture-signal", value: 1 }],
          explanation: "bridge fixture decision rationale (test builder)",
        },
        confidence: 0.5,
      })),
    },
    streamDigest: `stream-${String(input.pass)}`,
    admission: { ok: true, checked: [] },
    outcomes,
  };
}

export function telemetryOf(ctx: SessionContext, passes: readonly AgentPassRecord[]): AgentSessionTelemetry {
  const outcomes = passes.flatMap((record) => record.outcomes);
  const acked = outcomes.filter((outcome) => outcome.result.status === "acked").length;
  return {
    status: "detached",
    worldId: ctx.worldId as WorldId,
    possessionId: ctx.possessionId as AgentSessionTelemetry["possessionId"],
    bodyId: ctx.bodyId as BodyId,
    substrateId: ctx.substrateId as SubstrateId,
    attachment: {
      bodyId: ctx.bodyId as BodyId,
      worldId: ctx.worldId as WorldId,
      state: "detached",
      detachReason: "world-closed",
    },
    possession: {
      possessionId: ctx.possessionId as AgentSessionTelemetry["possessionId"],
      bodyId: ctx.bodyId as BodyId,
      substrateId: ctx.substrateId as SubstrateId,
      worldId: ctx.worldId as WorldId,
      state: "released",
      releaseReason: "body-detached",
    },
    passes: [...passes],
    viewsReceived: passes.length,
    observationsSkipped: 0,
    outcomes,
    acked,
    rejected: outcomes.length - acked,
    admissionRefused: passes.filter((record) => !record.admission.ok).length,
  };
}

// --- the canonical session (3 passes, equity 100000 → 101000 → 100500) -------

export function canonicalPasses(ctx: SessionContext): AgentPassRecord[] {
  return [
    passRecord(ctx, { pass: 1, observedAt: 1000 }),
    passRecord(ctx, {
      pass: 2,
      observedAt: 2000,
      decisions: [
        { decisionId: "d-1", orderKind: "market", side: "buy", quantity: "10", issuedAt: 2000 },
      ],
      outcomes: [{ decisionId: "d-1", status: "acked", issuedAt: 2000 }],
    }),
    passRecord(ctx, { pass: 3, observedAt: 3000 }),
  ];
}

export function canonicalResultingStates(ctx: SessionContext): { asOf: TimestampMs; portfolio: Portfolio }[] {
  return [
    { asOf: ts(1100), portfolio: portfolio(ctx, { equity: "100000" }) },
    {
      asOf: ts(2100),
      portfolio: portfolio(ctx, {
        equity: "101000",
        realizedPnl: "1000",
        positions: [position(ctx, { quantity: "10", markPrice: "101", realizedPnl: "1000" })],
      }),
    },
    { asOf: ts(3100), portfolio: portfolio(ctx, { equity: "100500", realizedPnl: "1000" }) },
  ];
}

