/**
 * Shared deterministic fixtures for the time-machine service tests (W050).
 *
 * The information records are the REAL W027 tradrl-information test
 * fixtures (the W041 fixture lineage, imported directly — zero fixture
 * drift); the market events are W004 envelopes in the QuoteUpdatePayload
 * shape. Everything is hand-fixed: the same inputs always assemble the
 * same views (A9).
 */

import {
  MINUTE,
  SOURCE_DECLARATIONS,
  SYMBOL_MAP,
  T0,
  WORLD,
  aDescriptor,
  at,
  happyInformationRecords,
} from "../../../packages/tradrl-information/test/fixtures.js";
import type { InformationImportInput } from "tradrl-information";
import type {
  CausationId,
  CorrelationId,
  EventId,
  InstrumentId,
  Price,
  ProducerId,
  ProjectId,
  Quantity,
  SequenceNumber,
  TenantId,
  WorldEventEnvelope,
} from "tradrl-world-contracts";
import type { DatasetRange } from "tradrl-world-contracts/data";
import { asPointInTimeCutoff, buildPointInTimeQuery } from "tradrl-time-machine";
import type { PointInTimeQuery, TimeMachineRecordFamily } from "tradrl-time-machine";
import type { InformationRecordStream, MarketEventStream } from "../index.js";

export { MINUTE, T0, WORLD };

export const TENANT = "tenant-w050-engine" as TenantId;
export const PROJECT = "project-w050-engine" as ProjectId;

/** The families covering both fixture streams (market + all four kinds). */
export const ALL_FAMILIES: readonly TimeMachineRecordFamily[] = [
  "market-event",
  "research-report",
  "news",
  "event",
  "analyst-note",
];

export function cutoff(ms: number): ReturnType<typeof asPointInTimeCutoff> {
  return asPointInTimeCutoff(ms);
}

export function aQuery(
  families: readonly TimeMachineRecordFamily[],
  cutoffMs: number,
): PointInTimeQuery {
  const outcome = buildPointInTimeQuery({
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    cutoff: cutoff(cutoffMs),
    families,
  });
  if (!outcome.ok) {
    throw new Error(`fixture query failed to build: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.query;
}

let eventCounter = 0;

/** One W004 market event (quote update) with deterministic increasing ids. */
export function aMarketEvent(occurredAt: number, availableAt?: number): WorldEventEnvelope {
  eventCounter += 1;
  return {
    worldId: WORLD,
    sequence: eventCounter as SequenceNumber,
    eventId: `evt-fixture-${String(eventCounter)}` as EventId,
    eventType: "market.quote.updated",
    occurredAt: at(occurredAt),
    ...(availableAt === undefined ? {} : { availableAt: at(availableAt) }),
    causationId: "cause-fixture" as CausationId,
    correlationId: "corr-fixture" as CorrelationId,
    producer: "producer-fixture" as ProducerId,
    schemaVersion: "time-machine.fixture@1",
    payload: {
      type: "market.quote.updated",
      instrumentId: "instrument-btcusd" as InstrumentId,
      bid: "5200.05" as Price,
      ask: "5200.10" as Price,
      bidSize: "1.5" as Quantity,
      askSize: "0.75" as Quantity,
    },
  };
}

export function aRange(from: number, to: number): DatasetRange {
  return { from: at(from), to: at(to) };
}

export function aMarketStream(
  events: readonly WorldEventEnvelope[],
  declaredRange: DatasetRange = aRange(T0, T0 + 5 * MINUTE),
): MarketEventStream {
  return { kind: "market-events", worldId: WORLD, declaredRange, events: [...events] };
}

export function anInformationStream(
  records = happyInformationRecords(),
  descriptor = aDescriptor(),
): InformationRecordStream {
  const input: InformationImportInput = {
    worldId: WORLD,
    descriptor,
    records: [...records],
    sources: SOURCE_DECLARATIONS,
    symbolMap: SYMBOL_MAP,
  };
  return { kind: "information", input };
}

/** The happy assembly input: one market stream + one information stream. */
export function happyStreams(): readonly [MarketEventStream, InformationRecordStream] {
  return [
    aMarketStream([
      aMarketEvent(T0),
      aMarketEvent(T0 + 30_000),
      aMarketEvent(T0 + 2 * MINUTE + 30_000),
    ]),
    anInformationStream(),
  ];
}

/** The extended-range assembly input (cutoffs beyond T0+5m stay in range). */
export function extendedStreams(): readonly [MarketEventStream, InformationRecordStream] {
  return [
    aMarketStream(
      [
        aMarketEvent(T0),
        aMarketEvent(T0 + 30_000),
        aMarketEvent(T0 + 2 * MINUTE + 30_000, T0 + 4 * MINUTE),
      ],
      aRange(T0, T0 + 10 * MINUTE),
    ),
    anInformationStream(happyInformationRecords(), aDescriptor({ range: aRange(T0, T0 + 10 * MINUTE) })),
  ];
}
