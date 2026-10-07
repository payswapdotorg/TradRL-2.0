/**
 * Shared deterministic fixtures for the W027 `tradrl-information` tests.
 *
 * Everything is hand-authored and fixed: ids, times, sources — the same
 * inputs always yield the same imports (A9). The happy-path dataset covers
 * every record kind, all four declared sources, delayed availability
 * (strictly after, and exactly at, publication time), source-stable and
 * derived artifact ids, multi-symbol and absent symbol sets, the gap-end
 * boundary case and a past-scheduled event.
 */

import type {
  Account,
  Instrument,
  Participant,
  Price,
  SnapshotId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { SimulationTimeMs, WallTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, asWallTime } from "tradrl-world-contracts/time";
import type {
  AnalystNoteRecord,
  EventRecord,
  InformationDatasetDescriptor,
  InformationRecord,
  InformationSourceDeclaration,
  NewsItemRecord,
  ResearchReportRecord,
} from "tradrl-world-contracts/information-data";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type { RecordSymbolMap } from "../adapters.js";

export const WORLD = "world-w027-tests" as WorldId;
export const BTC_SYMBOL = "BTC-USD";
export const ETH_SYMBOL = "ETH-USD";
export const BTC_INSTRUMENT = "instrument-btcusd" as Instrument["instrumentId"];
export const ETH_INSTRUMENT = "instrument-ethusd" as Instrument["instrumentId"];
export const DATASET_ID = "info-fixture-1" as InformationDatasetDescriptor["datasetId"];

/** Fixed fixture base time (2023-11-20T00:00:00Z). */
export const T0 = 1_700_044_800_000;
export const MINUTE = 60_000;

export const SYMBOL_MAP: RecordSymbolMap = {
  [BTC_SYMBOL]: BTC_INSTRUMENT,
  [ETH_SYMBOL]: ETH_INSTRUMENT,
};

/** The four declared sources — the honesty surface (credibility declared, never fabricated). */
export const SOURCE_DECLARATIONS: readonly InformationSourceDeclaration[] = [
  { source: "global-wire", credibility: "primary-media" },
  { source: "acme-research", credibility: "analyst", note: "sell-side research desk" },
  { source: "exchange-notices", credibility: "official" },
  { source: "market-chatter", credibility: "unattributed" },
];

export function at(ms: number): TimestampMs {
  return ms as TimestampMs;
}

export function price(text: string): Price {
  return text as Price;
}

export function qty(text: string): Instrument["lotSize"] {
  return text as Instrument["lotSize"];
}

export function aDescriptor(
  overrides: Partial<InformationDatasetDescriptor> = {},
): InformationDatasetDescriptor {
  return {
    datasetId: DATASET_ID,
    source: {
      provider: "fixture",
      name: "research-news-sample",
      format: "mixed-information",
      obtained: "hand-authored fixture (W027 tests)",
    },
    range: { from: at(T0), to: at(T0 + 5 * MINUTE) },
    recordKinds: ["research-report", "news", "event", "analyst-note"],
    granularity: "event-driven",
    knownGaps: [{ from: at(T0 + 2 * MINUTE), to: at(T0 + 3 * MINUTE), reason: "feed outage" }],
    limitations: ["fixture: hand-authored, not a real research/wire feed"],
    determinism: { kind: "deterministic" },
    ...overrides,
  };
}

export function aResearchReport(
  overrides: Partial<ResearchReportRecord> = {},
): ResearchReportRecord {
  return {
    kind: "research-report",
    source: "acme-research",
    publishedAt: at(T0 + 30_000),
    headline: "Structural bid for digital gold",
    summary: "Flow analysis argues for sustained institutional accumulation.",
    symbols: [BTC_SYMBOL, ETH_SYMBOL],
    rating: "overweight",
    targetPrice: price("5200.50"),
    confidence: "medium",
    availableAt: at(T0 + 90_000),
    ...overrides,
  };
}

export function aNewsItem(overrides: Partial<NewsItemRecord> = {}): NewsItemRecord {
  return {
    kind: "news",
    source: "global-wire",
    sourceId: "wire-1",
    publishedAt: at(T0),
    headline: "Spot venue reports record session volume",
    summary: "Tuesday session printed the highest volume since launch.",
    symbols: [BTC_SYMBOL],
    confidence: "high",
    ...overrides,
  };
}

export function anEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    kind: "event",
    source: "exchange-notices",
    sourceId: "evt-1",
    publishedAt: at(T0 + MINUTE),
    headline: "Quarterly earnings release scheduled",
    summary: "The issuer will report earnings this session.",
    symbols: [ETH_SYMBOL],
    eventType: "earnings-release",
    scheduledFor: at(T0 + 5 * MINUTE),
    ...overrides,
  };
}

export function anAnalystNote(
  overrides: Partial<AnalystNoteRecord> = {},
): AnalystNoteRecord {
  return {
    kind: "analyst-note",
    source: "acme-research",
    sourceId: "note-1",
    publishedAt: at(T0 + 90_000),
    headline: "Desk trims near-term view",
    rating: "hold",
    ...overrides,
  };
}

/**
 * The happy-path fixture records, in publication-time order:
 * T0 (wire news), T0+30s (research report, delayed to T0+90s, derived id),
 * T0+1m (exchange event), T0+1m30s (analyst note, no symbols),
 * T0+3m EXACTLY (blog news at the gap-end boundary, availableAt == publishedAt),
 * T0+4m30s (macro event, past-scheduled, delayed to T0+5m).
 */
export function happyInformationRecords(): InformationRecord[] {
  return [
    aNewsItem(),
    aResearchReport(),
    anEvent(),
    anAnalystNote(),
    aNewsItem({
      source: "market-chatter",
      sourceId: "wire-2",
      publishedAt: at(T0 + 3 * MINUTE),
      headline: "Chatter: desks positioning for the print",
      symbols: undefined,
      confidence: undefined,
      availableAt: at(T0 + 3 * MINUTE),
    }),
    anEvent({
      sourceId: "evt-2",
      publishedAt: at(T0 + 4 * MINUTE + 30_000),
      headline: "CPI print lands in line",
      symbols: [BTC_SYMBOL],
      eventType: "macro-print",
      scheduledFor: at(T0 + 4 * MINUTE),
      availableAt: at(T0 + 5 * MINUTE),
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
export function informationWorldDefinition(
  worldId: WorldId = WORLD,
): WorldDefinition {
  const account: Account = {
    accountId: "account-w027-importer" as Account["accountId"],
    worldId,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as Account["balances"],
    buyingPower: { amount: "100000.00", currency: "USD" } as Account["buyingPower"],
    marginUsed: { amount: "0.00", currency: "USD" } as Account["marginUsed"],
    marginAvailable: { amount: "100000.00", currency: "USD" } as Account["marginAvailable"],
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
  const participant: Participant = {
    participantId: "participant-w027-importer" as Participant["participantId"],
    worldId,
    kind: "human",
    accountId: account.accountId,
  };
  return {
    scope: {
      tenantId: "tenant-w027" as never,
      projectId: "project-w027" as never,
      worldId,
    },
    mode: "reactive-replay",
    seed: "w027-test-seed",
    worldDefinitionVersion: "w027-test-def@1",
    inputDataSource: "information://w027-tests",
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

/** A fixed wall-time source (deterministic engine creation — never the host clock). */
export function fixedWallTimeSource(): () => WallTimeMs {
  const fixed = asWallTime(T0 + 500_000);
  return () => fixed;
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
