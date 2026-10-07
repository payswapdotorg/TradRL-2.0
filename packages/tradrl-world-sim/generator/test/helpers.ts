/**
 * Shared test fixtures for the W017 generator module tests.
 *
 * Everything here is deterministic: fixed ids, fixed times, a synthetic
 * population (market makers, liquidity takers, noise traders, momentum
 * participants — the SIMULATION.md cast) with their own accounts, and a
 * trader participant so HUMAN orders can be interleaved with generated
 * flow (the parity the whole generator exists for).
 */

import type {
  Account,
  Instrument,
  Participant,
  RegimeScheduleEntry,
  SubmitOrderCommand,
  TimestampMs,
  Venue,
} from "tradrl-world-contracts";
import type { WorldDefinition } from "../../world/index.js";

export const TENANT = "tenant-alpha" as WorldDefinition["scope"]["tenantId"];
export const PROJECT = "project-one" as WorldDefinition["scope"]["projectId"];
export const WORLD = "world-w017-tests" as WorldDefinition["scope"]["worldId"];
export const INSTRUMENT = "instrument-es-fut" as Instrument["instrumentId"];
export const VENUE_ID = "venue-sim-gen" as Venue["venueId"];
export const TRADER = "participant-trader" as Participant["participantId"];
export const TRADER_ACCOUNT = "account-trader" as Account["accountId"];
export const MARKET_MAKER = "participant-mm-1" as Participant["participantId"];
export const MARKET_MAKER_2 = "participant-mm-2" as Participant["participantId"];
export const TAKER = "participant-taker-1" as Participant["participantId"];
export const NOISE = "participant-noise-1" as Participant["participantId"];
export const MOMENTUM = "participant-momentum-1" as Participant["participantId"];
export const MM_ACCOUNT = "account-mm" as Account["accountId"];
export const TAKER_ACCOUNT = "account-takers" as Account["accountId"];
export const START = 1_700_000_000_000;
export const WALL_START = 1_700_000_500_000;

/** A 0.25-tick / 1-lot ES-like future, tick 4800 area. */
export function testInstrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    instrumentId: INSTRUMENT,
    worldId: WORLD,
    venueId: VENUE_ID,
    symbol: "ES-GEN",
    assetClass: "future",
    quoteCurrency: "USD" as never,
    tickSize: "0.25" as never,
    lotSize: "1" as never,
    pricePrecision: 2,
    quantityPrecision: 0,
    tradingState: "open",
    tradable: true,
    ...overrides,
  };
}

/** The zero-fee / zero-latency default-policy venue (matching/policy.ts). */
export function noVenue(): undefined {
  return undefined;
}

function accountOf(accountId: Account["accountId"]): Account {
  return {
    accountId,
    worldId: WORLD,
    balances: { USD: { amount: "10000000.00", currency: "USD" } } as never,
    buyingPower: { amount: "10000000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "10000000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

/** A synthetic participant bound to an account. */
export function participant(
  participantId: Participant["participantId"],
  kind: Participant["kind"],
  accountId: Account["accountId"],
): Participant {
  return { participantId, worldId: WORLD, kind, accountId };
}

/** The full synthetic cast + a human trader. */
export function syntheticParticipants(): readonly Participant[] {
  return [
    participant(TRADER, "human", TRADER_ACCOUNT),
    participant(MARKET_MAKER, "passive-market-maker", MM_ACCOUNT),
    participant(MARKET_MAKER_2, "passive-market-maker", MM_ACCOUNT),
    participant(TAKER, "liquidity-taker", TAKER_ACCOUNT),
    participant(NOISE, "noise-trader", TAKER_ACCOUNT),
    participant(MOMENTUM, "momentum", TAKER_ACCOUNT),
  ];
}

/** A world definition with the synthetic population and a regime schedule. */
export function generatedDefinition(
  overrides: Partial<WorldDefinition> & {
    readonly regimeSchedule?: readonly RegimeScheduleEntry[];
  } = {},
): WorldDefinition {
  return {
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    mode: "reactive-replay",
    seed: "w017-test-seed",
    worldDefinitionVersion: "w017-test-def@1",
    inputDataSource: "synthetic://w017-tests",
    clock: {
      start: START as never,
      defaultStepMs: 1000,
      initialWallTime: WALL_START as never,
    },
    instruments: [testInstrument()],
    accounts: [accountOf(TRADER_ACCOUNT), accountOf(MM_ACCOUNT), accountOf(TAKER_ACCOUNT)],
    participants: [...syntheticParticipants()],
    ...(overrides.regimeSchedule === undefined
      ? {}
      : { regimeSchedule: overrides.regimeSchedule }),
    ...overrides,
  };
}

/** A simple contiguous two-regime schedule around a 4800 anchor. */
export function trendThenHaltSchedule(): readonly RegimeScheduleEntry[] {
  return [
    {
      regime: "trend",
      from: START as never,
      to: (START + 20_000) as never,
      parameters: { anchorPrice: 4800, direction: 1 },
    },
    {
      regime: "halt-reopen",
      from: (START + 20_000) as never,
      to: (START + 40_000) as never,
      parameters: { anchorPrice: 4800, reopenAfterMs: 4000 },
    },
  ];
}

/** A human order command (the parity fixture: humans trade on generated liquidity). */
export function humanOrder(
  overrides: Partial<SubmitOrderCommand> & {
    submission?: Partial<SubmitOrderCommand["submission"]>;
  } = {},
): SubmitOrderCommand {
  const { submission, ...rest } = overrides;
  return {
    kind: "submit-order",
    commandId: "cmd-human-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    accountId: TRADER_ACCOUNT,
    instrumentId: INSTRUMENT,
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "3" as never,
      limitPrice: "4800.25" as never,
      constraints: { timeInForce: "GTC" },
      ...(submission ?? {}),
    },
    ...rest,
  };
}

/** A fixed wall-clock source (deterministic readouts). */
export function fixedWallTimeSource(ms = WALL_START): () => number {
  return () => ms;
}

export function at(ms: number): TimestampMs {
  return ms as TimestampMs;
}
