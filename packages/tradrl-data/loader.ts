/**
 * The deterministic historical-dataset loader (W020 `tradrl-data`).
 *
 * Spec: spec/WORK-ITEMS.md W020 — "a loader that produces journal-ready
 * event records deterministically": same input records ⇒ same events,
 * bit-for-bit (ARCHITECTURE-LOCK.md A9 — no IO, no clock reads, no RNG).
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" + spec/ARCHITECTURE-LOCK.md
 * A6 — imported events are first-class journal events in the W004 envelope
 * shape. Spec: spec/ARCHITECTURE-LOCK.md A8 (W016) — sealed records are
 * frozen plain data: a record that entered any journal/snapshot prefix can
 * never be mutated in place.
 *
 * Two journal-ready surfaces per import (both proven by tests):
 * - `drafts` — `PendingEventDraft[]`, the engine-appendable input: a world
 *   appends them through its journal (sequences continue from the cursor);
 * - `records` — sealed `JournalRecord[]` with deterministic sequence/event/
 *   entry ids from (worldId, sequence), `recordedAt` = each record's own
 *   `occurredAt` (domain time, never wall time), directly restorable via
 *   `createEventJournalFromRecords` and storable as a snapshot prefix.
 *
 * The engine-boundary honesty law: `tradrl-world-sim`'s reducers verify
 * producers per their own laws (matching/generator facts fail closed on
 * foreign producers by design), so ENGINE-level replay of imported events is
 * the W021 adapter surface — this loader delivers journal-level readiness,
 * which is what W020 owns.
 */

import type {
  SequenceNumber,
  TimestampMs,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import type { EventStreamDigest } from "tradrl-world-contracts/time";
import { eventStreamDigest, validateEventStream } from "tradrl-world-contracts/time";
import type { DatasetDescriptor } from "tradrl-world-contracts/data";
import {
  FIRST_EVENT_SEQUENCE,
  type JournalRecord,
  type PendingEventDraft,
  entryIdFor,
  eventIdFor,
} from "tradrl-world-sim/journal";
import { buildImportEventContext, historicalRecordToEventDraft } from "./adapters.js";
import { DatasetImportError } from "./errors.js";
import {
  historicalRecordEventTime,
  isHistoricalBarRecord,
  isHistoricalQuoteRecord,
  isHistoricalTradeRecord,
} from "./records.js";
import { validateHistoricalImport, type HistoricalImportInput } from "./validate.js";

/** Import summary: deterministic counts over the imported data. */
export interface HistoricalImportSummary {
  readonly barCount: number;
  readonly tradeCount: number;
  readonly quoteCount: number;
  /** Mapped source symbols present in the import (sorted, deduplicated). */
  readonly symbols: readonly string[];
  /** Domain time of the first imported event (undefined for an empty import). */
  readonly firstEventTime?: TimestampMs;
  /** Domain time of the last imported event (undefined for an empty import). */
  readonly lastEventTime?: TimestampMs;
}

/** The complete outcome of one deterministic dataset import. */
export interface HistoricalImportOutcome {
  readonly worldId: WorldId;
  /** The validated descriptor (echoed — the fidelity declaration of this data). */
  readonly descriptor: DatasetDescriptor;
  /** Engine-appendable drafts, in import order. */
  readonly drafts: readonly PendingEventDraft[];
  /** Sealed, frozen, restore-path-appendable journal records (sequences 1..N). */
  readonly records: readonly JournalRecord[];
  /** The W004 determinism digest of the sealed envelopes (A9 evidence). */
  readonly digest: EventStreamDigest;
  readonly summary: HistoricalImportSummary;
}

/** Deep-freeze the plain payloads the adapter constructs (depth ≤ 2 by construction). */
function freezePlain<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(freezePlain)) as unknown as T;
  }
  if (typeof value === "object" && value !== null) {
    const frozen: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      frozen[key] = entry === undefined ? undefined : freezePlain(entry);
    }
    return Object.freeze(frozen) as unknown as T;
  }
  return value;
}

/** Seal one draft into a journal record at a deterministic sequence position. */
function sealRecord(
  worldId: WorldId,
  sequence: SequenceNumber,
  draft: PendingEventDraft,
): JournalRecord {
  const envelope: WorldEventEnvelope = {
    worldId,
    sequence,
    eventId: eventIdFor(worldId, sequence),
    eventType: draft.eventType,
    occurredAt: draft.occurredAt,
    ...(draft.availableAt === undefined ? {} : { availableAt: draft.availableAt }),
    causationId: draft.causationId,
    correlationId: draft.correlationId,
    producer: draft.producer,
    schemaVersion: draft.schemaVersion,
    payload: freezePlain(draft.payload),
  };
  return Object.freeze({
    entryId: entryIdFor(worldId, sequence),
    envelope: Object.freeze(envelope),
    // LAW: a historical import journals each event as of its own domain
    // time — from the record, never from a clock (A9).
    recordedAt: draft.occurredAt,
  });
}

/**
 * Load one historical dataset import deterministically.
 *
 * Validates the complete input first (throwing `DatasetImportError` with
 * EVERY violation — never a partial import, never a silently dropped
 * record), then maps records to drafts and seals them into journal-ready
 * records. Pure: the same (worldId, descriptor, records, symbolMap) always
 * yields the bit-identical outcome.
 */
export function loadHistoricalDataset(input: HistoricalImportInput): HistoricalImportOutcome {
  const validation = validateHistoricalImport(input);
  if (!validation.ok) {
    throw new DatasetImportError(validation.violations);
  }
  const context = buildImportEventContext(input.descriptor, input.symbolMap);
  const drafts = Object.freeze(
    input.records.map((record, index) =>
      historicalRecordToEventDraft(record, index + 1, context),
    ),
  );
  const records = Object.freeze(
    drafts.map((draft, index) =>
      sealRecord(
        input.worldId,
        (FIRST_EVENT_SEQUENCE + index) as SequenceNumber,
        draft,
      ),
    ),
  );
  const envelopes = records.map((record) => record.envelope);
  // Belt and braces: the validator already enforces the ordered-stream laws;
  // a sealing that broke them would be an internal bug — fail loudly here.
  const streamCheck = validateEventStream(envelopes);
  if (!streamCheck.ok) {
    const first = streamCheck.violations[0]!;
    throw new Error(
      `internal invariant: sealed import stream violates the W004 laws ` +
        `(${String(first.kind)} at index ${String(first.index)}: ${first.detail})`,
    );
  }
  const symbols = [...new Set(input.records.map((record) => record.symbol))].sort();
  const summary: HistoricalImportSummary = {
    barCount: input.records.filter(isHistoricalBarRecord).length,
    tradeCount: input.records.filter(isHistoricalTradeRecord).length,
    quoteCount: input.records.filter(isHistoricalQuoteRecord).length,
    symbols,
    ...(input.records.length === 0
      ? {}
      : {
          firstEventTime: historicalRecordEventTime(input.records[0]!),
          lastEventTime: historicalRecordEventTime(
            input.records[input.records.length - 1]!,
          ),
        }),
  };
  return Object.freeze({
    worldId: input.worldId,
    descriptor: input.descriptor,
    drafts,
    records,
    digest: eventStreamDigest(envelopes),
    summary: Object.freeze(summary),
  });
}
