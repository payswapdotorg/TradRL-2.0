/**
 * Shared deterministic fixtures for the W020 `tradrl-data` tests.
 *
 * Everything is hand-authored and fixed: ids, times, prices — the same
 * inputs always yield the same imports (A9). The happy-path dataset covers
 * every record kind, both mapping symbols, delayed availability (a record
 * `availableAt` strictly after, and exactly at, its event time), adjacent
 * bars, the gap-boundary cases (a bar ending exactly at gap start; a bar
 * starting exactly at gap end) and a derived trade id (a trade with no
 * source id).
 */

import type {
  Account,
  Instrument,
  Participant,
  Price,
  Quantity,
  SnapshotId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { SimulationTimeMs, WallTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, asWallTime } from "tradrl-world-contracts/time";
import type {
  DatasetDescriptor,
  HistoricalBarRecord,
  HistoricalQuoteRecord,
  HistoricalRecord,
  HistoricalTradeRecord,
} from "tradrl-world-contracts/data";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type { RecordSymbolMap } from "../adapters.js";

export const WORLD = "world-w020-tests" as WorldId;
export const BTC_SYMBOL = "BTC-USD";
export const ETH_SYMBOL = "ETH-USD";
export const BTC_INSTRUMENT = "instrument-btcusd" as Instrument["instrumentId"];
export const ETH_INSTRUMENT = "instrument-ethusd" as Instrument["instrumentId"];
export const DATASET_ID = "ds-fixture-1" as DatasetDescriptor["datasetId"];

/** Fixed fixture base time (2023-11-20T00:00:00Z). */
export const T0 = 1_700_044_800_000;
export const MINUTE = 60_000;

export const SYMBOL_MAP: RecordSymbolMap = {
  [BTC_SYMBOL]: BTC_INSTRUMENT,
  [ETH_SYMBOL]: ETH_INSTRUMENT,
};

export function at(ms: number): TimestampMs {
  return ms as TimestampMs;
}

export function price(text: string): Price {
  return text as Price;
}

export function qty(text: string): Quantity {
  return text as Quantity;
}

export function aDescriptor(overrides: Partial<DatasetDescriptor> = {}): DatasetDescriptor {
  return {
    datasetId: DATASET_ID,
    source: {
      provider: "fixture",
      name: "crypto-sample",
      format: "mixed-feed",
      obtained: "hand-authored fixture (W020 tests)",
    },
    range: { from: at(T0), to: at(T0 + 5 * MINUTE) },
    recordKinds: ["bar", "trade", "quote"],
    granularity: "1m",
    knownGaps: [{ from: at(T0 + 2 * MINUTE), to: at(T0 + 3 * MINUTE), reason: "maintenance" }],
    limitations: ["fixture: hand-authored, not a real venue feed"],
    determinism: { kind: "deterministic" },
    ...overrides,
  };
}

export function aBar(overrides: Partial<HistoricalBarRecord> = {}): HistoricalBarRecord {
  return {
    kind: "bar",
    symbol: BTC_SYMBOL,
    openTime: at(T0),
    closeTime: at(T0 + MINUTE),
    open: price("4800.10"),
    high: price("4800.60"),
    low: price("4800.00"),
    close: price("4800.40"),
    volume: qty("12.5"),
    ...overrides,
  };
}

export function aTrade(overrides: Partial<HistoricalTradeRecord> = {}): HistoricalTradeRecord {
  return {
    kind: "trade",
    symbol: BTC_SYMBOL,
    timestamp: at(T0 + 500),
    price: price("4800.25"),
    quantity: qty("0.5"),
    aggressorSide: "sell",
    tradeId: "fx-1",
    ...overrides,
  };
}

export function aQuote(overrides: Partial<HistoricalQuoteRecord> = {}): HistoricalQuoteRecord {
  return {
    kind: "quote",
    symbol: BTC_SYMBOL,
    timestamp: at(T0),
    bid: price("4800.25"),
    bidSize: qty("3"),
    ask: price("4800.50"),
    askSize: qty("5"),
    ...overrides,
  };
}

/**
 * The happy-path fixture records, in event-time-basis order:
 * T0 (BTC quote), T0+500 (BTC trade, delayed 1s), T0+1m (BTC bar close),
 * T0+1.5m (BTC trade, derived id), T0+1m50s (ETH quote), T0+2m (BTC bar
 * close with delayed availability — closes exactly at gap start), T0+4m
 * (ETH bar close — starts exactly at gap end), T0+4m0.5s (BTC quote),
 * T0+4m10s (BTC trade, availableAt == timestamp).
 */
export function happyImportRecords(): HistoricalRecord[] {
  return [
    aQuote(),
    aTrade({ availableAt: at(T0 + 1_500) }),
    aBar(),
    aTrade({
      timestamp: at(T0 + 90_000),
      price: price("4800.35"),
      quantity: qty("0.25"),
      aggressorSide: "buy",
      tradeId: undefined,
    }),
    aQuote({
      symbol: ETH_SYMBOL,
      timestamp: at(T0 + 110_000),
      bid: price("180.10"),
      bidSize: qty("10"),
      ask: price("180.20"),
      askSize: qty("8"),
      last: price("180.15"),
    }),
    aBar({
      openTime: at(T0 + MINUTE),
      closeTime: at(T0 + 2 * MINUTE),
      open: price("4800.40"),
      high: price("4800.55"),
      low: price("4800.20"),
      close: price("4800.45"),
      volume: qty("8.25"),
      availableAt: at(T0 + 2 * MINUTE + 1_000),
    }),
    aBar({
      symbol: ETH_SYMBOL,
      openTime: at(T0 + 3 * MINUTE),
      closeTime: at(T0 + 4 * MINUTE),
      open: price("180.20"),
      high: price("180.35"),
      low: price("180.05"),
      close: price("180.30"),
      volume: qty("42"),
    }),
    aQuote({
      timestamp: at(T0 + 4 * MINUTE + 500),
      bid: price("4801.00"),
      bidSize: qty("2"),
      ask: price("4801.25"),
      askSize: qty("3"),
    }),
    aTrade({
      timestamp: at(T0 + 4 * MINUTE + 10_000),
      price: price("4801.10"),
      quantity: qty("1"),
      aggressorSide: "buy",
      tradeId: "fx-2",
      availableAt: at(T0 + 4 * MINUTE + 10_000),
    }),
  ];
}

function fixtureInstrument(
  instrumentId: Instrument["instrumentId"],
  symbol: string,
): Instrument {
  return {
    instrumentId,
    worldId: WORLD,
    venueId: "venue-fixture" as Instrument["venueId"],
    symbol,
    assetClass: "crypto",
    quoteCurrency: "USD" as Instrument["quoteCurrency"],
    tickSize: price("0.05"),
    lotSize: qty("0.0001"),
    pricePrecision: 2,
    quantityPrecision: 4,
    tradingState: "open",
    tradable: true,
  };
}

/** A minimal VALID world definition the import can target (W013 law shape). */
export function snapshotTestDefinition(worldId: WorldId = WORLD): WorldDefinition {
  const account: Account = {
    accountId: "account-w020-importer" as Account["accountId"],
    worldId,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as Account["balances"],
    buyingPower: { amount: "100000.00", currency: "USD" } as Account["buyingPower"],
    marginUsed: { amount: "0.00", currency: "USD" } as Account["marginUsed"],
    marginAvailable: { amount: "100000.00", currency: "USD" } as Account["marginAvailable"],
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
  const participant: Participant = {
    participantId: "participant-w020-importer" as Participant["participantId"],
    worldId,
    kind: "human",
    accountId: account.accountId,
  };
  return {
    scope: {
      tenantId: "tenant-w020" as never,
      projectId: "project-w020" as never,
      worldId,
    },
    mode: "exact-replay",
    seed: "w020-test-seed",
    worldDefinitionVersion: "w020-test-def@1",
    inputDataSource: "historical://w020-tests",
    clock: {
      start: asSimulationTime(T0),
      end: asSimulationTime(T0 + 10 * MINUTE),
      defaultStepMs: 1000,
      initialWallTime: asWallTime(T0 + 500_000),
    },
    instruments: [
      fixtureInstrument(BTC_INSTRUMENT, BTC_SYMBOL),
      fixtureInstrument(ETH_INSTRUMENT, ETH_SYMBOL),
    ],
    accounts: [account],
    participants: [participant],
  };
}

export function snapshotIdOf(count: number): SnapshotId {
  return `snap:${String(WORLD)}:${String(count)}` as SnapshotId;
}

export function sim(ms: number): SimulationTimeMs {
  return asSimulationTime(ms);
}

export function wall(ms: number): WallTimeMs {
  return asWallTime(ms);
}
