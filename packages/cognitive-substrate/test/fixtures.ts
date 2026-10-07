/**
 * Shared deterministic fixtures for the W033 cognitive-substrate tests.
 *
 * The views here are hand-built for the LAWS (fail-closed firewall, mind
 * rules, stream validation). The REAL alpha world — the real definition,
 * the real generated engine, the real W032 body/view — is consumed by
 * test/alphaWorld.test.ts through the relative cross-package seam the
 * agent-body/ui tests use.
 */

import type {
  OrderBookSnapshot,
  Portfolio,
  Position,
  Quote,
  RiskState,
  Trade,
} from "tradrl-world-contracts";
import type { BodyDescriptor, BodyId } from "tradrl-world-contracts/agentBody";
import type { InstrumentId, ParticipantId, AccountId, VenueId } from "tradrl-world-contracts";
import type { ObservedBodyView } from "../index.js";

export const WORLD = "world-substrate-tests" as BodyDescriptor["scope"]["worldId"];
export const TENANT = "tenant-substrate-tests" as BodyDescriptor["scope"]["tenantId"];
export const PROJECT = "project-substrate" as BodyDescriptor["scope"]["projectId"];
export const BODY_ID = "body-sub-one" as BodyId;
export const SEAT = "participant-sub-one" as ParticipantId;
export const ACCOUNT = "account-sub-one" as AccountId;
export const INSTRUMENT = "instrument-es-sub" as InstrumentId;
export const OTHER_INSTRUMENT = "instrument-nq-sub" as InstrumentId;
export const VENUE = "venue-sub" as VenueId;
export const START = 1_700_000_000_000;
export const AT_START = START as never;
export const LATER = (START + 60_000) as never;

/** A branded Money literal (the engineAttachment/helpers `as never` convention). */
export function money(amount: string): { amount: never; currency: never } {
  return { amount: amount as never, currency: "USD" as never };
}

/** A two-sided quote at `asOf` (the minds' mid source). */
export function quote(bid: string, ask: string, asOf: number = START, instrumentId: InstrumentId = INSTRUMENT): Quote {
  return {
    instrumentId,
    bid: bid as never,
    ask: ask as never,
    asOf: asOf as never,
  };
}

/** One public tape print. */
export function trade(price: string, at: number = START, sequence = 1, instrumentId: InstrumentId = INSTRUMENT): Trade {
  return {
    tradeId: `trade-${String(sequence)}` as never,
    worldId: WORLD,
    instrumentId,
    price: price as never,
    quantity: "1" as never,
    aggressorSide: "buy",
    occurredAt: at as never,
    sequence: sequence as never,
  };
}

/** A position of `quantity` (signed decimal text). */
export function position(quantity: string, at: number = START, instrumentId: InstrumentId = INSTRUMENT): Position {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    instrumentId,
    quantity: quantity as never,
    averageEntryPrice: "4800" as never,
    markPrice: "4800" as never,
    realizedPnl: money("0"),
    unrealizedPnl: money("0"),
    openedAt: at as never,
    updatedAt: at as never,
  };
}

/** A portfolio projection for the view's own account. */
export function portfolio(at: number = START): Portfolio {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    positions: [],
    cash: money("100000"),
    buyingPower: money("100000"),
    realizedPnl: money("0"),
    unrealizedPnl: money("-12.50"),
    equity: money("99987.50"),
    asOf: at as never,
  };
}

/** A risk-state projection for the view's own account. */
export function riskState(at: number = START): RiskState {
  return {
    accountId: ACCOUNT,
    worldId: WORLD,
    limits: {
      maxOrderQuantity: "10" as never,
      maxLeverage: 2,
      maxGrossExposure: money("150000"),
    },
    breaches: [],
    asOf: at as never,
  };
}

/** A book snapshot (one level each side). */
export function book(bid: string, ask: string, at: number = START): OrderBookSnapshot {
  return {
    instrumentId: INSTRUMENT,
    asOf: at as never,
    sequence: 1 as never,
    bids: [{ price: bid as never, quantity: "5" as never }],
    asks: [{ price: ask as never, quantity: "5" as never }],
  };
}

/**
 * The default observed view: the full grant (all observation kinds), one
 * instrument, a two-sided quote, a three-print tape and a flat position —
 * exactly what the reference minds need to have opinions.
 */
export function observedView(overrides: Partial<ObservedBodyView> = {}): ObservedBodyView {
  return {
    bodyId: BODY_ID,
    worldId: WORLD,
    participantId: SEAT,
    accountId: ACCOUNT,
    asOf: AT_START,
    instruments: [INSTRUMENT],
    observations: [
      "market-quote",
      "market-book",
      "market-trades",
      "own-orders",
      "own-positions",
      "own-portfolio",
      "own-risk",
      "information-artifacts",
    ],
    quotes: [quote("4799.75", "4800.25")],
    trades: [trade("4799.75", START, 1), trade("4800", START, 2), trade("4800.25", START, 3)],
    ownOrders: [],
    ownPositions: [position("0")],
    ...overrides,
  };
}

/** The default body the streams are validated against (the W032 shape). */
export function substrateBody(overrides: Partial<BodyDescriptor> = {}): BodyDescriptor {
  return {
    bodyId: BODY_ID,
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    participantId: SEAT,
    accountId: ACCOUNT,
    participantKind: "human",
    embodiment: {
      instruments: [INSTRUMENT],
      venues: [VENUE],
      orderKinds: ["market", "limit"],
      timeInForce: ["GTC", "IOC"],
      commandKinds: ["submit-order", "cancel-order", "replace-order", "close-position"],
    },
    riskEnvelope: {
      maxOrderQuantity: "10" as never,
      maxPositionQuantity: "40" as never,
      maxLeverage: 2,
      maxGrossExposure: money("150000"),
    },
    ...overrides,
  };
}
