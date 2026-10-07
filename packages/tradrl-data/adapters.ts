/**
 * Historical-record → journal-draft event adapters (W020 `tradrl-data`).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" — every imported record maps
 * onto ONE journal event draft in the W004 envelope shape (`occurredAt`,
 * optional delayed `availableAt`, causation/correlation/producer/schema).
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — `occurredAt` is the record's
 * event-time basis (verbatim field), `availableAt` is carried verbatim from
 * the record or OMITTED entirely (never defaulted, never invented).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the mapping is pure: a pure function
 * of (record, position, context); no IO, no clock reads, no RNG.
 *
 * Event taxonomy (contracts/data): quotes and trades reuse the W004
 * canonical market-event payloads; bars are the W020 `market.bar.closed`
 * extension. The producer of every imported event is the historical-import
 * producer — honest provenance (these events came from a dataset, not from
 * a live matching engine).
 */

import type {
  CausationId,
  CorrelationId,
  InstrumentId,
  OrderSide,
  ProducerId,
  TradeId,
} from "tradrl-world-contracts";
import type {
  DatasetDescriptor,
  DatasetId,
  HistoricalRecord,
} from "tradrl-world-contracts/data";
import {
  HISTORICAL_IMPORT_PRODUCER,
  HISTORICAL_IMPORT_SCHEMA_VERSION,
} from "tradrl-world-contracts/data";
import type { PendingEventDraft } from "tradrl-world-sim/journal";
import { historicalRecordEventTime } from "./records.js";

/** Source symbol → instrument mapping; the importer declares it, never the adapter. */
export type RecordSymbolMap = Readonly<Record<string, InstrumentId>>;

/**
 * The deterministic mapping context of one dataset import: identities are
 * derived purely from the dataset id (same dataset ⇒ same ids — no wall
 * time, no randomness anywhere in the mapping).
 */
export interface ImportEventContext {
  readonly datasetId: DatasetId;
  /**
   * The causation identity of the import itself (`import:<datasetId>` — the
   * "logical command" that produced these events; there was no live command).
   */
  readonly causationId: CausationId;
  /** Correlation id shared by every event of one import (one logical flow). */
  readonly correlationId: CorrelationId;
  readonly producer: ProducerId;
  readonly schemaVersion: string;
  /** Resolve a source symbol to its instrument (undefined when unmapped). */
  readonly instrumentOf: (symbol: string) => InstrumentId | undefined;
  /** Deterministic derived trade id for feeds without source ids (`<datasetId>:t:<position>`). */
  readonly tradeIdAt: (position: number) => TradeId;
}

/** Build the mapping context of one import (pure in the descriptor + map). */
export function buildImportEventContext(
  descriptor: DatasetDescriptor,
  symbolMap: RecordSymbolMap,
): ImportEventContext {
  const importId = `import:${String(descriptor.datasetId)}`;
  return {
    datasetId: descriptor.datasetId,
    causationId: importId as CausationId,
    correlationId: importId as CorrelationId,
    producer: HISTORICAL_IMPORT_PRODUCER,
    schemaVersion: HISTORICAL_IMPORT_SCHEMA_VERSION,
    instrumentOf: (symbol) => symbolMap[symbol] as InstrumentId | undefined,
    tradeIdAt: (position) =>
      `${String(descriptor.datasetId)}:t:${String(position)}` as TradeId,
  };
}

function barDraft(
  record: HistoricalRecord & { readonly kind: "bar" },
  context: ImportEventContext,
): PendingEventDraft {
  // Validated upstream: the symbol mapping resolved (`validate.js`).
  const instrumentId = context.instrumentOf(record.symbol) as InstrumentId;
  return {
    eventType: "market.bar.closed",
    occurredAt: historicalRecordEventTime(record),
    ...(record.availableAt === undefined
      ? {}
      : { availableAt: record.availableAt }),
    causationId: context.causationId,
    correlationId: context.correlationId,
    producer: context.producer,
    schemaVersion: context.schemaVersion,
    payload: {
      type: "market.bar.closed",
      instrumentId,
      interval: { start: record.openTime, end: record.closeTime },
      open: record.open,
      high: record.high,
      low: record.low,
      close: record.close,
      volume: record.volume,
    },
  };
}

function tradeDraft(
  record: HistoricalRecord & { readonly kind: "trade" },
  position: number,
  context: ImportEventContext,
): PendingEventDraft {
  const trade = record;
  const instrumentId = context.instrumentOf(trade.symbol) as InstrumentId;
  return {
    eventType: "market.trade.printed",
    occurredAt: historicalRecordEventTime(record),
    ...(trade.availableAt === undefined ? {} : { availableAt: trade.availableAt }),
    causationId: context.causationId,
    correlationId: context.correlationId,
    producer: context.producer,
    schemaVersion: context.schemaVersion,
    payload: {
      type: "market.trade.printed",
      tradeId: trade.tradeId ?? context.tradeIdAt(position),
      instrumentId,
      price: trade.price,
      quantity: trade.quantity,
      // Required by the W004 payload; the validator rejects trades without
      // it (never fabricated here).
      aggressorSide: trade.aggressorSide as OrderSide,
    },
  };
}

function quoteDraft(
  record: HistoricalRecord & { readonly kind: "quote" },
  context: ImportEventContext,
): PendingEventDraft {
  const quote = record;
  const instrumentId = context.instrumentOf(quote.symbol) as InstrumentId;
  return {
    eventType: "market.quote.updated",
    occurredAt: historicalRecordEventTime(record),
    ...(quote.availableAt === undefined ? {} : { availableAt: quote.availableAt }),
    causationId: context.causationId,
    correlationId: context.correlationId,
    producer: context.producer,
    schemaVersion: context.schemaVersion,
    payload: {
      type: "market.quote.updated",
      instrumentId,
      ...(quote.bid === undefined ? {} : { bid: quote.bid }),
      ...(quote.bidSize === undefined ? {} : { bidSize: quote.bidSize }),
      ...(quote.ask === undefined ? {} : { ask: quote.ask }),
      ...(quote.askSize === undefined ? {} : { askSize: quote.askSize }),
      ...(quote.last === undefined ? {} : { last: quote.last }),
    },
  };
}

/**
 * Map one (validated) historical record at its 1-based position to a journal
 * event draft. Pure and deterministic: the same (record, position, context)
 * always yields the bit-identical draft. Callers MUST validate first
 * (`./validate.js`); the adapter never fabricates a field the record lacks —
 * an unavailable instrument mapping or aggressor side is a validation
 * violation, not an adapter default.
 */
export function historicalRecordToEventDraft(
  record: HistoricalRecord,
  position: number,
  context: ImportEventContext,
): PendingEventDraft {
  if (record.kind === "bar") {
    return barDraft(record, context);
  }
  if (record.kind === "trade") {
    return tradeDraft(record, position, context);
  }
  return quoteDraft(record, context);
}
