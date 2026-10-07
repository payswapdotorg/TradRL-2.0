/**
 * Shared deterministic fixtures for the W028 `tradrl-evidence` tests.
 *
 * Everything runs through the REAL import surfaces: the W020 dataset is
 * loaded by `tradrl-data`'s loader, the W027 information dataset by
 * `tradrl-information`'s — so every citation the projection resolves comes
 * from genuinely imported events/artifacts, exactly as the program's
 * surfaces produce them (no hand-fabricated provenance anywhere in the
 * happy path). The two imports are time-ordered so they can share ONE
 * journal (the journal's time-monotonic law): market data first
 * (T0..T0+90s), information after (T0+2m..T0+4m30s).
 */

import type {
  Account,
  CommandId,
  Instrument,
  Participant,
  ParticipantId,
  Price,
  Quantity,
  SnapshotId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { SimulationTimeMs, WallTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, asWallTime } from "tradrl-world-contracts/time";
import type { DatasetDescriptor } from "tradrl-world-contracts/data";
import type {
  HistoricalBarRecord,
  HistoricalQuoteRecord,
  HistoricalRecord,
  HistoricalTradeRecord,
} from "tradrl-world-contracts/data";
import type {
  EventRecord,
  InformationDatasetDescriptor,
  InformationRecord,
  InformationSourceDeclaration,
  NewsItemRecord,
  ResearchReportRecord,
} from "tradrl-world-contracts/information-data";
import type { WorldDefinition } from "tradrl-world-sim/world";
import { createEventJournal, type EventJournal } from "tradrl-world-sim/journal";
import { loadHistoricalDataset, type RecordSymbolMap } from "tradrl-data";
import { loadInformationDataset, toDefinitionInformationArtifacts } from "tradrl-information";

export const WORLD = "world-w028-tests" as WorldId;
export const BTC_SYMBOL = "BTC-USD";
export const ETH_SYMBOL = "ETH-USD";
export const BTC_INSTRUMENT = "instrument-btcusd" as Instrument["instrumentId"];
export const ETH_INSTRUMENT = "instrument-ethusd" as Instrument["instrumentId"];

/** The W020 market-data dataset id. */
export const DATA_DATASET_ID = "ds-w028-market" as DatasetDescriptor["datasetId"];
/** The W027 information dataset id. */
export const INFO_DATASET_ID = "info-w028-research" as InformationDatasetDescriptor["datasetId"];

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

// --- the W020 historical market-data import (the REAL loader) --------------------

export function dataDescriptor(
  overrides: Partial<DatasetDescriptor> = {},
): DatasetDescriptor {
  return {
    datasetId: DATA_DATASET_ID,
    source: {
      provider: "fixture",
      name: "w028-market-sample",
      format: "mixed-feed",
      obtained: "hand-authored fixture (W028 tests)",
    },
    range: { from: at(T0), to: at(T0 + 2 * MINUTE) },
    recordKinds: ["bar", "trade", "quote"],
    granularity: "1m",
    knownGaps: [],
    limitations: ["fixture: hand-authored, not a real venue feed"],
    determinism: { kind: "deterministic" },
    ...overrides,
  };
}

/**
 * The market-data records, in event-time order: quote@T0, trade@T0+500,
 * bar closing@T0+1m, trade@T0+90s (derived id — no source trade id).
 */
export function dataRecords(): HistoricalRecord[] {
  const quote: HistoricalQuoteRecord = {
    kind: "quote",
    symbol: BTC_SYMBOL,
    timestamp: at(T0),
    bid: price("4800.25"),
    bidSize: qty("3"),
    ask: price("4800.50"),
    askSize: qty("5"),
  };
  const trade: HistoricalTradeRecord = {
    kind: "trade",
    symbol: BTC_SYMBOL,
    timestamp: at(T0 + 500),
    price: price("4800.25"),
    quantity: qty("0.5"),
    aggressorSide: "sell",
    tradeId: "fx-1",
  };
  const bar: HistoricalBarRecord = {
    kind: "bar",
    symbol: BTC_SYMBOL,
    openTime: at(T0 + 30_000),
    closeTime: at(T0 + MINUTE),
    open: price("4800.10"),
    high: price("4800.60"),
    low: price("4800.00"),
    close: price("4800.40"),
    volume: qty("12.5"),
  };
  const derivedTrade: HistoricalTradeRecord = {
    kind: "trade",
    symbol: ETH_SYMBOL,
    timestamp: at(T0 + 90_000),
    price: price("180.15"),
    quantity: qty("2"),
    aggressorSide: "buy",
  };
  return [quote, trade, bar, derivedTrade];
}

export function dataImport() {
  return loadHistoricalDataset({
    worldId: WORLD,
    descriptor: dataDescriptor(),
    records: dataRecords(),
    symbolMap: SYMBOL_MAP,
  });
}

// --- the W027 information import (the REAL loader) --------------------------------

export const SOURCE_DECLARATIONS: readonly InformationSourceDeclaration[] = [
  { source: "global-wire", credibility: "primary-media" },
  { source: "acme-research", credibility: "analyst", note: "sell-side research desk" },
  { source: "exchange-notices", credibility: "official" },
];

export function infoDescriptor(
  overrides: Partial<InformationDatasetDescriptor> = {},
): InformationDatasetDescriptor {
  return {
    datasetId: INFO_DATASET_ID,
    source: {
      provider: "fixture",
      name: "w028-research-sample",
      format: "mixed-information",
      obtained: "hand-authored fixture (W028 tests)",
    },
    range: { from: at(T0 + 2 * MINUTE), to: at(T0 + 5 * MINUTE) },
    recordKinds: ["news", "research-report", "event"],
    granularity: "event-driven",
    knownGaps: [],
    limitations: ["fixture: hand-authored, not a real research/wire feed"],
    determinism: { kind: "deterministic" },
    ...overrides,
  };
}

/**
 * The information records, in publication order: wire news@T0+2m,
 * research report@T0+3m (delayed to T0+4m), exchange event@T0+4m30s.
 */
export function infoRecords(): InformationRecord[] {
  const news: NewsItemRecord = {
    kind: "news",
    source: "global-wire",
    sourceId: "wire-A",
    publishedAt: at(T0 + 2 * MINUTE),
    headline: "Spot venue reports record session volume",
    summary: "Tuesday session printed the highest volume since launch.",
    symbols: [BTC_SYMBOL],
    confidence: "high",
  };
  const research: ResearchReportRecord = {
    kind: "research-report",
    source: "acme-research",
    sourceId: "note-alpha",
    publishedAt: at(T0 + 3 * MINUTE),
    headline: "Structural bid for digital gold",
    summary: "Flow analysis argues for sustained institutional accumulation.",
    symbols: [BTC_SYMBOL, ETH_SYMBOL],
    rating: "overweight",
    targetPrice: price("5200.50"),
    confidence: "medium",
    availableAt: at(T0 + 4 * MINUTE),
  };
  const event: EventRecord = {
    kind: "event",
    source: "exchange-notices",
    sourceId: "evt-B",
    publishedAt: at(T0 + 4 * MINUTE + 30_000),
    headline: "Quarterly earnings release scheduled",
    summary: "The issuer will report earnings this session.",
    symbols: [ETH_SYMBOL],
    eventType: "earnings-release",
    scheduledFor: at(T0 + 5 * MINUTE),
  };
  return [news, research, event];
}

export function infoImport() {
  return loadInformationDataset({
    worldId: WORLD,
    descriptor: infoDescriptor(),
    records: infoRecords(),
    sources: SOURCE_DECLARATIONS,
    symbolMap: SYMBOL_MAP,
  });
}

// --- one shared journal carrying BOTH imports (time-ordered) ----------------------

export interface CombinedJournal {
  readonly journal: EventJournal;
  readonly data: ReturnType<typeof dataImport>;
  readonly info: ReturnType<typeof infoImport>;
}

/** The 7 imported events: 4 market-data (seq 1-4) + 3 information (seq 5-7). */
export function combinedJournal(): CombinedJournal {
  const data = dataImport();
  const info = infoImport();
  const journal = createEventJournal(WORLD);
  journal.append([...data.drafts]);
  journal.append([...info.drafts]);
  return { journal, data, info };
}

// --- the world definition (W013 law shape) ----------------------------------------

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

export const W028_PARTICIPANT = "participant-w028-auditor" as ParticipantId;
export const W028_ACCOUNT = "account-w028-auditor" as Account["accountId"];

/** A minimal VALID world definition the imports target (W013 law shape). */
export function w028WorldDefinition(
  worldId: WorldId = WORLD,
  informationArtifacts: ReturnType<typeof infoImport>["artifacts"] = [],
): WorldDefinition {
  const account: Account = {
    accountId: W028_ACCOUNT,
    worldId,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as Account["balances"],
    buyingPower: { amount: "100000.00", currency: "USD" } as Account["buyingPower"],
    marginUsed: { amount: "0.00", currency: "USD" } as Account["marginUsed"],
    marginAvailable: { amount: "100000.00", currency: "USD" } as Account["marginAvailable"],
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
  const participant: Participant = {
    participantId: W028_PARTICIPANT,
    worldId,
    kind: "human",
    accountId: account.accountId,
  };
  return {
    scope: {
      tenantId: "tenant-w028" as never,
      projectId: "project-w028" as never,
      worldId,
    },
    mode: "reactive-replay",
    seed: "w028-test-seed",
    worldDefinitionVersion: "w028-test-def@1",
    inputDataSource: "mixed://w028-tests",
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
    ...(informationArtifacts.length === 0
      ? {}
      : { informationArtifacts: toDefinitionInformationArtifacts(informationArtifacts) }),
  };
}

/** A fixed wall-time source (deterministic engine creation — never the host clock). */
export function fixedWallTimeSource(): () => WallTimeMs {
  const fixed = asWallTime(T0 + 500_000);
  return () => fixed;
}

/** The annotation command the engine test issues (the command-caused event). */
export function anAnnotationCommand() {
  return {
    kind: "add-annotation" as const,
    commandId: "cmd-w028-annotation-1" as CommandId,
    worldId: WORLD,
    issuedBy: W028_PARTICIPANT,
    issuedAt: at(T0),
    at: at(T0),
    text: "w028 evidence projection audit marker",
  };
}

export function snapshotIdOf(count: number): SnapshotId {
  return `snap:${String(WORLD)}:${String(count)}` as SnapshotId;
}

export function sim(ms: number): SimulationTimeMs {
  return asSimulationTime(ms);
}
