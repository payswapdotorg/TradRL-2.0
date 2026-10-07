/**
 * Shared test fixtures for the W013 world module tests.
 *
 * Everything here is deterministic: fixed ids, fixed times, a seeded PRNG
 * (mulberry32) for the golden determinism test's seeded command stream.
 */

import type {
  Account,
  AddAnnotationCommand,
  ClosePositionCommand,
  InformationArtifact,
  Instrument,
  NewsPayload,
  Participant,
  SetScenarioCommand,
  SubmitOrderCommand,
  TimestampMs,
  WorldScope,
} from "tradrl-world-contracts";
import type { SimulationTimeMs, WallTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, asWallTime } from "tradrl-world-contracts/time";
import type { WorldDefinition } from "../index.js";

export const TENANT = "tenant-alpha" as WorldScope["tenantId"];
export const PROJECT = "project-one" as WorldScope["projectId"];
export const WORLD = "world-w013-tests" as WorldScope["worldId"];
export const TRADER = "participant-trader" as Participant["participantId"];
export const TRADER_ACCOUNT = "account-trader" as Account["accountId"];
export const OTHER_ACCOUNT = "account-other" as Account["accountId"];
export const INSTRUMENT = "instrument-es-fut" as Instrument["instrumentId"];
export const START = 1_700_000_000_000;
export const WALL_START = 1_700_000_500_000;

export function at(ms: number): TimestampMs {
  return ms as TimestampMs;
}

export function sim(ms: number): SimulationTimeMs {
  return asSimulationTime(ms);
}

export function wall(ms: number): WallTimeMs {
  return asWallTime(ms);
}

/** A fixed, deterministic wall-clock source for engine tests. */
export function fixedWallTimeSource(ms = WALL_START): () => WallTimeMs {
  return () => asWallTime(ms);
}

export function testInstrument(): Instrument {
  return {
    instrumentId: INSTRUMENT,
    worldId: WORLD,
    venueId: "venue-sim" as Instrument["venueId"],
    symbol: "ES-TEST",
    assetClass: "future",
    quoteCurrency: "USD" as never,
    tickSize: "0.25" as never,
    lotSize: "1" as never,
    pricePrecision: 2,
    quantityPrecision: 0,
    tradingState: "open",
    tradable: true,
  };
}

export function testAccount(
  overrides: Partial<Account> = {},
): Account {
  return {
    accountId: TRADER_ACCOUNT,
    worldId: WORLD,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
    buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
    ...overrides,
  };
}

export function testParticipant(
  overrides: Partial<Participant> = {},
): Participant {
  return {
    participantId: TRADER,
    worldId: WORLD,
    kind: "human",
    accountId: TRADER_ACCOUNT,
    ...overrides,
  };
}

export function testNewsArtifact(
  artifactId: string,
  availableAt: number,
  headline = "scheduled news",
): InformationArtifact<NewsPayload> {
  return {
    artifactId: artifactId as never,
    worldId: WORLD,
    source: "test-wire",
    createdAt: at(START),
    availableAt: at(availableAt),
    scope: "news",
    provenance: { producer: "test-wire" as never, recordedAt: at(START) },
    version: "1",
    payload: { headline },
  };
}

export function testDefinition(
  overrides: Partial<WorldDefinition> = {},
): WorldDefinition {
  return {
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    mode: "reactive-replay",
    seed: "w013-test-seed",
    worldDefinitionVersion: "w013-test-def@1",
    inputDataSource: "synthetic://w013-tests",
    clock: {
      start: sim(START),
      ...(overrides.clock?.end !== undefined ? { end: overrides.clock.end } : {}),
      defaultStepMs: 1000,
      initialWallTime: wall(WALL_START),
      ...(overrides.clock?.speed !== undefined ? { speed: overrides.clock.speed } : {}),
    },
    instruments: [testInstrument()],
    accounts: [testAccount(), testAccount({ accountId: OTHER_ACCOUNT, permissions: { canTrade: false, canShort: false, liveExecutionAllowed: false } })],
    participants: [testParticipant()],
    informationArtifacts: [
      testNewsArtifact("news-visible", START),
      testNewsArtifact("news-future", START + 60_000, "delayed news"),
    ],
    ...overrides,
  };
}

export function addAnnotationCommand(
  overrides: Partial<AddAnnotationCommand> = {},
): AddAnnotationCommand {
  return {
    kind: "add-annotation",
    commandId: "cmd-annotation-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: at(START),
    at: at(START + 500),
    text: "golden region start",
    ...overrides,
  };
}

export function setScenarioCommand(
  overrides: Partial<SetScenarioCommand> = {},
): SetScenarioCommand {
  return {
    kind: "set-scenario",
    commandId: "cmd-scenario-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: at(START),
    scenario: {
      label: "stress test",
      entries: [{ regime: "high-volatility", from: at(START), to: at(START + 3_600_000) }],
    },
    ...overrides,
  };
}

export function closePositionCommand(
  overrides: Partial<ClosePositionCommand> = {},
): ClosePositionCommand {
  return {
    kind: "close-position",
    commandId: "cmd-close-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: at(START),
    accountId: TRADER_ACCOUNT,
    instrumentId: INSTRUMENT,
    ...overrides,
  };
}

export function submitOrderCommand(
  overrides: Partial<SubmitOrderCommand> = {},
): SubmitOrderCommand {
  return {
    kind: "submit-order",
    commandId: "cmd-order-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: at(START),
    accountId: TRADER_ACCOUNT,
    instrumentId: INSTRUMENT,
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "10" as never,
      limitPrice: "4800.25" as never,
      constraints: { timeInForce: "GTC" },
    },
    ...overrides,
  };
}

/**
 * mulberry32 — a tiny deterministic PRNG for the seeded command stream of
 * the determinism golden test (pure function of the 32-bit seed).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
