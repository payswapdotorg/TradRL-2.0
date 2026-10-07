/**
 * Shared deterministic fixtures for the W032 agent-body tests.
 *
 * The fixture worlds are REAL, valid `WorldDefinition`s (pinned by a test
 * that runs the sim's own `assertValidWorldDefinition` on each) so the
 * binding/envelope laws are proven against honest world shapes, not
 * hand-wired stubs. The REAL alpha world definition
 * (`packages/ui/src/trading-world/runtime/engineAttachment.ts`) is
 * consumed by test/alphaWorld.test.ts through the same relative-seam
 * pattern the sim/UI tests use for cross-package sources.
 */

import type {
  Account,
  InformationArtifact,
  Instrument,
  Money,
  NewsPayload,
  Participant,
  RiskLimits,
  Venue,
} from "tradrl-world-contracts";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type {
  BodyDescriptor,
  BodyEmbodiment,
  BodyId,
  BodyView,
} from "../index.js";

export const TENANT = "tenant-body-tests" as BodyDescriptor["scope"]["tenantId"];
export const PROJECT = "project-body" as BodyDescriptor["scope"]["projectId"];
export const WORLD = "world-body-tests" as BodyDescriptor["scope"]["worldId"];

export const VENUE_ALL = "venue-all" as Instrument["venueId"];
export const VENUE_RESTRICTIVE = "venue-restrictive" as Instrument["venueId"];
export const INSTRUMENT_ES = "instrument-es" as Instrument["instrumentId"];
export const INSTRUMENT_NQ = "instrument-nq" as Instrument["instrumentId"];
export const ACCOUNT_TRADER = "account-trader" as Account["accountId"];
export const ACCOUNT_FROZEN = "account-frozen" as Account["accountId"];
export const PARTICIPANT_TRADER = "participant-trader" as Participant["participantId"];
export const PARTICIPANT_MM = "participant-mm" as Participant["participantId"];

/** A branded Money literal (the engineAttachment/helpers `as never` convention). */
export function money(amount: string, currency = "USD"): Money {
  return { amount: amount as never, currency: currency as never };
}

/** The world's declared limits for the trader account (the A13 shape). */
export const TRADER_WORLD_LIMITS: RiskLimits = {
  maxOrderQuantity: "50" as never,
  maxPositionQuantity: "200" as never,
  maxLeverage: 4,
  maxGrossExposure: money("500000"),
  maxDrawdown: money("10000"),
  minBuyingPowerAfterOrder: money("1000"),
};

const SIM_START = 1_700_000_000_000;

function account(accountId: Account["accountId"], canTrade: boolean): Account {
  return {
    accountId,
    worldId: WORLD,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
    buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade, canShort: true, liveExecutionAllowed: false },
  };
}

function venue(venueId: Venue["venueId"], kinds: readonly string[]): Venue {
  return {
    venueId,
    worldId: WORLD,
    name: String(venueId),
    matchingModel: "price-time-priority",
    allowedOrderKinds: kinds as never,
    feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
    latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
    calendar: {
      sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }],
    },
    haltPolicy: { haltOnShock: false },
  };
}

/**
 * The fixture world: one permissive venue (all four order kinds), one
 * restrictive venue (market + limit only), two instruments, a tradable
 * trader account with declared risk limits, and a frozen market-maker
 * account. `overrides` adapts it for specific binding cases.
 */
export function fixtureWorld(
  overrides: Partial<WorldDefinition> = {},
): WorldDefinition {
  return {
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    mode: "reactive-replay",
    seed: "agent-body-fixtures",
    worldDefinitionVersion: "body-tests@1",
    inputDataSource: "synthetic://body-tests",
    clock: {
      start: SIM_START as never,
      defaultStepMs: 1000,
      initialWallTime: (SIM_START + 5000) as never,
    },
    instruments: [
      {
        instrumentId: INSTRUMENT_ES,
        worldId: WORLD,
        venueId: VENUE_ALL,
        symbol: "ES-BODY",
        assetClass: "future",
        quoteCurrency: "USD" as never,
        tickSize: "0.25" as never,
        lotSize: "1" as never,
        pricePrecision: 2,
        quantityPrecision: 0,
        tradingState: "open",
        tradable: true,
      },
      {
        instrumentId: INSTRUMENT_NQ,
        worldId: WORLD,
        venueId: VENUE_RESTRICTIVE,
        symbol: "NQ-BODY",
        assetClass: "future",
        quoteCurrency: "USD" as never,
        tickSize: "0.25" as never,
        lotSize: "1" as never,
        pricePrecision: 2,
        quantityPrecision: 0,
        tradingState: "open",
        tradable: true,
      },
    ],
    venues: [venue(VENUE_ALL, ["market", "limit", "stop", "stop-limit"]), venue(VENUE_RESTRICTIVE, ["market", "limit"])],
    accounts: [account(ACCOUNT_TRADER, true), account(ACCOUNT_FROZEN, false)],
    participants: [
      {
        participantId: PARTICIPANT_TRADER,
        worldId: WORLD,
        kind: "human",
        accountId: ACCOUNT_TRADER,
      },
      {
        participantId: PARTICIPANT_MM,
        worldId: WORLD,
        kind: "passive-market-maker",
        accountId: ACCOUNT_FROZEN,
      },
    ],
    riskLimits: { [String(ACCOUNT_TRADER)]: TRADER_WORLD_LIMITS },
    ...overrides,
  };
}

/** The default trader Body: a valid seat on the fixture world. */
export function traderBody(
  overrides: Partial<BodyDescriptor> = {},
): BodyDescriptor {
  return {
    bodyId: "body-trader-one" as BodyId,
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    participantId: PARTICIPANT_TRADER,
    accountId: ACCOUNT_TRADER,
    participantKind: "human",
    embodiment: traderEmbodiment(),
    riskEnvelope: traderEnvelope(),
    ...overrides,
  };
}

export function traderEmbodiment(
  overrides: Partial<BodyEmbodiment> = {},
): BodyEmbodiment {
  return {
    instruments: [INSTRUMENT_ES],
    venues: [VENUE_ALL],
    orderKinds: ["market", "limit"],
    timeInForce: ["GTC", "IOC"],
    commandKinds: ["submit-order", "cancel-order", "replace-order", "close-position"],
    ...overrides,
  };
}

/** The trader Body's envelope: strictly within the world's declared limits. */
export function traderEnvelope(overrides: Partial<RiskLimits> = {}): RiskLimits {
  return {
    maxOrderQuantity: "40" as never,
    maxPositionQuantity: "150" as never,
    maxLeverage: 3,
    maxGrossExposure: money("400000"),
    maxDrawdown: money("8000"),
    minBuyingPowerAfterOrder: money("2000"),
    ...overrides,
  };
}

export function traderView(overrides: Partial<BodyView> = {}): BodyView {
  return {
    bodyId: "body-trader-one" as BodyId,
    worldId: WORLD,
    instruments: [INSTRUMENT_ES],
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
    accountId: ACCOUNT_TRADER,
    ...overrides,
  };
}

export const START = SIM_START;
export const AT_START = SIM_START as never;
export const LATER = (SIM_START + 60_000) as never;
export const NEWS_EARLY = "artifact-news-early" as never;
export const NEWS_LATE = "artifact-news-late" as never;

/** Two news artifacts behind the A7 firewall: one available at START, one later. */
export function fixtureArtifacts(): readonly InformationArtifact<NewsPayload>[] {
  return [
    {
      artifactId: NEWS_EARLY,
      worldId: WORLD as never,
      source: "fixture-wire",
      createdAt: AT_START,
      availableAt: AT_START,
      scope: "news",
      provenance: { producer: "fixture-wire" as never, recordedAt: AT_START },
      version: "1",
      payload: { headline: "available from the start" },
    },
    {
      artifactId: NEWS_LATE,
      worldId: WORLD as never,
      source: "fixture-wire",
      createdAt: AT_START,
      availableAt: LATER,
      scope: "news",
      provenance: { producer: "fixture-wire" as never, recordedAt: AT_START },
      version: "1",
      payload: { headline: "not available yet" },
    },
  ];
}
