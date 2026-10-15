/**
 * Shared deterministic fixtures for the tradrl-time-machine tests (W050).
 *
 * Hand-authored and fixed: ids, times, sources — the same inputs always
 * yield the same sealed views (A9). The market events use W004's own
 * `QuoteUpdatePayload` shape; the information records are W027 contract
 * records, hand-authored in this package (the service tests import the
 * REAL W027 test fixtures — the W041 fixture lineage).
 */

import type {
  CausationId,
  CorrelationId,
  EventId,
  InformationArtifactId,
  InstrumentId,
  Price,
  ProducerId,
  ProjectId,
  Quantity,
  SequenceNumber,
  TenantId,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import type {
  InformationRecord,
  ResearchReportRecord,
} from "tradrl-world-contracts/information-data";
import { asPointInTimeCutoff, buildPointInTimeQuery } from "../index.js";
import type { PointInTimeQuery, TimeMachineRecordFamily, ViewRecord } from "../index.js";

export const TENANT = "tenant-w050" as TenantId;
export const PROJECT = "project-w050" as ProjectId;
export const WORLD = "world-w050-tests" as WorldId;

/** Fixed fixture base time (2023-11-20T00:00:00Z — the W027 fixture clock). */
export const T0 = 1_700_044_800_000;
export const MINUTE = 60_000;

export function at(ms: number): SimulationTimeMs {
  return ms as SimulationTimeMs;
}

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

/** One W004 market event (quote update) with deterministic ids. */
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
    schemaVersion: "tradrl-time-machine.fixture@1",
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

let artifactCounter = 0;

/** One W027 research-report record (delayed availability when given). */
export function aResearchRecord(
  publishedAt: number,
  availableAt?: number,
): ResearchReportRecord {
  artifactCounter += 1;
  return {
    kind: "research-report",
    source: "acme-research",
    sourceId: `info-fixture-${String(artifactCounter)}`,
    publishedAt: at(publishedAt),
    headline: "Structural bid for digital gold",
    summary: "Flow analysis argues for sustained institutional accumulation.",
    symbols: ["BTC-USD"],
    rating: "overweight",
    targetPrice: "5200.50" as Price,
    confidence: "medium",
    ...(availableAt === undefined ? {} : { availableAt: at(availableAt) }),
  };
}

export function infoViewRecord(record: InformationRecord): ViewRecord {
  artifactCounter += 1;
  return {
    family: record.kind,
    recordId: `artifact-${String(artifactCounter)}` as InformationArtifactId,
    record,
  };
}

export function marketViewRecord(event: WorldEventEnvelope): ViewRecord {
  return { family: "market-event", recordId: event.eventId, event };
}
