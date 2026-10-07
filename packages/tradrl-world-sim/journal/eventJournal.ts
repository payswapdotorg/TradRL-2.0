/**
 * The append-only ordered event journal — the W013 engine's `journal` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine └─ journal`).
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" (worldId, sequence, eventId,
 * eventType, occurredAt, availableAt when applicable, causationId,
 * correlationId, producer, schemaVersion, payload; "Sequence is monotonic
 * within a world").
 * Spec: spec/ARCHITECTURE-LOCK.md A6 (commands mutate state, emit ordered
 * events and append journal records — the journal is the authoritative
 * history) and A9 (determinism: the journal digest via W004's
 * `eventStreamDigest` makes a run machine-verifiable).
 * Spec: spec/DOMAIN-MODEL.md "Ownership" — Journal → authoritative history.
 *
 * Envelope shape is W003's contract; the ordered-stream laws and the
 * determinism digest are W004's contracts (`validateEventStream`,
 * `eventStreamDigest`). This module owns the in-memory store, sequencing,
 * the query surface and the law enforcement at append time.
 *
 * W016 boundary (journal/snapshot/branch): the snapshot/branch ENGINE is
 * W016's surface. This module stores exactly the records branch reads will
 * need — the ordered envelopes plus per-record journaling metadata — and
 * offers the digest/cursor a snapshot descriptor references.
 *
 * Determinism: event ids, entry ids and sequences are pure functions of
 * (worldId, sequence position). No wall time, randomness or insertion order
 * beyond the append order enters a record.
 */

import type {
  CausationId,
  CorrelationId,
  EventId,
  EventQuery,
  JournalEntryId,
  ProducerId,
  SequenceNumber,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { eventStreamDigest, validateEventStream } from "tradrl-world-contracts/time";
import type { EventStreamDigest } from "tradrl-world-contracts/time";

/** A journal position with no events yet (before the first sequence). */
export const EMPTY_JOURNAL_CURSOR = 0 as SequenceNumber;

/** The first sequence assigned to the first journaled event. */
export const FIRST_EVENT_SEQUENCE = 1 as SequenceNumber;

/**
 * An event awaiting sequencing. The engine's command lifecycle emits these
 * (in order); the journal is the single writer of `sequence` and `eventId`.
 * `correlationId` is required (the envelope contract has no optional slot):
 * the lifecycle defaults an uncorrelated command to its own command id.
 */
export interface PendingEventDraft {
  readonly eventType: string;
  readonly occurredAt: TimestampMs;
  readonly availableAt?: TimestampMs;
  readonly causationId: CausationId;
  readonly correlationId: CorrelationId;
  readonly producer: ProducerId;
  readonly schemaVersion: string;
  readonly payload: unknown;
}

/**
 * One authoritative journal record: the event envelope plus the journaling
 * metadata a snapshot/branch (W016) or evidence projection needs.
 */
export interface JournalRecord {
  readonly entryId: JournalEntryId;
  readonly envelope: WorldEventEnvelope;
  /** Domain time at which the engine journaled the record. */
  readonly recordedAt: TimestampMs;
}

/** Violation kinds enforced by the journal at append/load time. */
export type JournalViolationKind =
  | W004ViolationKind
  | "malformed-draft"
  | "sequence-not-contiguous"
  | "entry-id-mismatch";
type W004ViolationKind = "world-mismatch" | "sequence-not-monotonic" | "time-not-monotonic" | "available-before-occurred";

/** Thrown when a draft or record set violates the journal laws. */
export class JournalLawViolationError extends Error {
  constructor(
    readonly kind: JournalViolationKind,
    message: string,
  ) {
    super(`journal law violation [${kind}]: ${message}`);
    this.name = "JournalLawViolationError";
  }
}

/** Options for `EventJournal.append`. */
export interface AppendOptions {
  /** Domain time of the journaling itself; defaults to the last draft's occurredAt. */
  readonly recordedAt?: TimestampMs;
}

/** The append-only ordered event journal for ONE world. */
export interface EventJournal {
  readonly worldId: WorldId;
  /**
   * Append ordered drafts. The journal assigns strictly increasing
   * sequences and deterministic event ids, enforces the ordered-stream laws
   * (throwing `JournalLawViolationError`) and returns the sealed envelopes.
   */
  append(drafts: readonly PendingEventDraft[], options?: AppendOptions): readonly WorldEventEnvelope[];
  /** Sequence of the last journaled event; `EMPTY_JOURNAL_CURSOR` when empty. */
  getCursor(): SequenceNumber;
  /** Number of journaled records. */
  size(): number;
  /** All records in sequence order (authoritative history — raw, no firewall). */
  records(): readonly JournalRecord[];
  /** Query envelopes in sequence order (see `EventQuery` semantics below). */
  read(query?: EventQuery): readonly WorldEventEnvelope[];
  /** The record for an event id, if journaled. */
  getRecordByEventId(eventId: EventId): JournalRecord | undefined;
  /** The envelope for an event id or world sequence, if journaled. */
  findEvent(target: EventId | SequenceNumber): WorldEventEnvelope | undefined;
  /** The W004 determinism digest of the whole ordered stream (A9). */
  digest(): EventStreamDigest;
}

/** EventQuery semantics (W003's shape): `from`/`to` filter `occurredAt` (inclusive), `types` filters eventType, `limit` keeps the first N in sequence order. */
export function matchesEventQuery(envelope: WorldEventEnvelope, query: EventQuery = {}): boolean {
  if (query.from !== undefined && envelope.occurredAt < query.from) return false;
  if (query.to !== undefined && envelope.occurredAt > query.to) return false;
  if (query.types !== undefined && !query.types.includes(envelope.eventType)) return false;
  return true;
}

/** Canonical deterministic event id for a world sequence position. */
export function eventIdFor(worldId: WorldId, sequence: SequenceNumber): EventId {
  return `evt:${String(worldId)}:${String(sequence)}` as EventId;
}

/** Canonical deterministic journal entry id for a world sequence position. */
export function entryIdFor(worldId: WorldId, sequence: SequenceNumber): JournalEntryId {
  return `jrn:${String(worldId)}:${String(sequence)}` as JournalEntryId;
}

function assertDraftShape(draft: PendingEventDraft, index: number): void {
  if (typeof draft.eventType !== "string" || draft.eventType.length === 0) {
    throw new JournalLawViolationError(
      "malformed-draft",
      `draft ${index}: eventType must be a non-empty string`,
    );
  }
  if (!Number.isFinite(draft.occurredAt)) {
    throw new JournalLawViolationError(
      "malformed-draft",
      `draft ${index} (${draft.eventType}): occurredAt must be finite`,
    );
  }
  if (draft.causationId === undefined || draft.producer === undefined) {
    throw new JournalLawViolationError(
      "malformed-draft",
      `draft ${index} (${draft.eventType}): causationId and producer are required`,
    );
  }
  if (typeof draft.schemaVersion !== "string" || draft.schemaVersion.length === 0) {
    throw new JournalLawViolationError(
      "malformed-draft",
      `draft ${index} (${draft.eventType}): schemaVersion must be a non-empty string`,
    );
  }
}

function seal(
  worldId: WorldId,
  sequence: SequenceNumber,
  draft: PendingEventDraft,
): WorldEventEnvelope {
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
    payload: draft.payload,
  };
  return envelope;
}

/** Pairwise ordered-stream law between one new envelope and the journal tail. */
function assertStreamLaws(previous: WorldEventEnvelope | undefined, next: WorldEventEnvelope): void {
  if (previous !== undefined) {
    if (next.sequence <= previous.sequence) {
      throw new JournalLawViolationError(
        "sequence-not-monotonic",
        `sequence ${String(next.sequence)} does not follow ${String(previous.sequence)}`,
      );
    }
    if (next.occurredAt < previous.occurredAt) {
      throw new JournalLawViolationError(
        "time-not-monotonic",
        `occurredAt ${String(next.occurredAt)} precedes ${String(previous.occurredAt)}`,
      );
    }
  }
  if (next.availableAt !== undefined && next.availableAt < next.occurredAt) {
    throw new JournalLawViolationError(
      "available-before-occurred",
      `availableAt ${String(next.availableAt)} precedes occurredAt ${String(next.occurredAt)}`,
    );
  }
}

/** Create an empty journal for one world. */
export function createEventJournal(worldId: WorldId): EventJournal {
  const records: JournalRecord[] = [];

  const journal: EventJournal = {
    worldId,
    append(drafts, options) {
      if (drafts.length === 0) {
        throw new JournalLawViolationError("malformed-draft", "append requires at least one draft");
      }
      let previous: WorldEventEnvelope | undefined = records[records.length - 1]?.envelope;
      const sealed: WorldEventEnvelope[] = [];
      const recordedAt =
        options?.recordedAt ?? drafts[drafts.length - 1]!.occurredAt;
      for (let i = 0; i < drafts.length; i += 1) {
        const draft = drafts[i]!;
        assertDraftShape(draft, i);
        const sequence = (records.length + i + 1) as SequenceNumber;
        const envelope = seal(worldId, sequence, draft);
        assertStreamLaws(previous, envelope);
        sealed.push(envelope);
        previous = envelope;
      }
      for (const envelope of sealed) {
        records.push({
          entryId: entryIdFor(worldId, envelope.sequence),
          envelope,
          recordedAt,
        });
      }
      return sealed;
    },
    getCursor(): SequenceNumber {
      const last = records[records.length - 1];
      return last === undefined ? EMPTY_JOURNAL_CURSOR : last.envelope.sequence;
    },
    size(): number {
      return records.length;
    },
    records(): readonly JournalRecord[] {
      return [...records];
    },
    read(query?: EventQuery): readonly WorldEventEnvelope[] {
      const matched = records.map((record) => record.envelope).filter((envelope) =>
        matchesEventQuery(envelope, query),
      );
      return query?.limit === undefined ? matched : matched.slice(0, query.limit);
    },
    getRecordByEventId(eventId: EventId): JournalRecord | undefined {
      return records.find((record) => record.envelope.eventId === eventId);
    },
    findEvent(target: EventId | SequenceNumber): WorldEventEnvelope | undefined {
      if (typeof target === "number") {
        const record = records[(target as number) - 1];
        // Sequence positions are dense (1-based) in this store; a record at
        // that index must also carry the exact sequence.
        return record !== undefined && record.envelope.sequence === target
          ? record.envelope
          : undefined;
      }
      return this.getRecordByEventId(target)?.envelope;
    },
    digest(): EventStreamDigest {
      return eventStreamDigest(records.map((record) => record.envelope));
    },
  };
  return journal;
}

/**
 * Recreate a journal from an existing record set (the deterministic-replay
 * restore path). The full stream is validated with W004's
 * `validateEventStream`, plus per-record world/entry-id/sequence-contiguity
 * checks; a record set that would not have been appendable is rejected.
 */
export function createEventJournalFromRecords(input: {
  readonly worldId: WorldId;
  readonly records: readonly JournalRecord[];
}): EventJournal {
  const { worldId, records } = input;
  const validation = validateEventStream(records.map((record) => record.envelope));
  if (!validation.ok) {
    const first = validation.violations[0]!;
    throw new JournalLawViolationError(
      first.kind,
      `record set rejected by the W004 stream laws at index ${String(first.index)}: ${first.detail}`,
    );
  }
  let expectedSequence = FIRST_EVENT_SEQUENCE;
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i]!;
    if (record.envelope.worldId !== worldId) {
      throw new JournalLawViolationError(
        "world-mismatch",
        `record ${String(i)} belongs to ${String(record.envelope.worldId)}`,
      );
    }
    if (record.envelope.sequence !== expectedSequence) {
      throw new JournalLawViolationError(
        "sequence-not-contiguous",
        `record ${String(i)} has sequence ${String(record.envelope.sequence)}, expected ${String(expectedSequence)}`,
      );
    }
    if (record.entryId !== entryIdFor(worldId, record.envelope.sequence)) {
      throw new JournalLawViolationError(
        "entry-id-mismatch",
        `record ${String(i)} entry id ${String(record.entryId)} does not match its sequence`,
      );
    }
    expectedSequence = (expectedSequence + 1) as SequenceNumber;
  }

  const journal = createEventJournal(worldId);
  // Re-append through the append path so the restored journal enforces the
  // exact same laws as a live one (belt and braces on top of the checks
  // above); drafts carry the sealed envelope fields verbatim.
  for (const record of records) {
    const envelope = record.envelope;
    journal.append(
      [
        {
          eventType: envelope.eventType,
          occurredAt: envelope.occurredAt,
          ...(envelope.availableAt === undefined ? {} : { availableAt: envelope.availableAt }),
          causationId: envelope.causationId,
          correlationId: envelope.correlationId,
          producer: envelope.producer,
          schemaVersion: envelope.schemaVersion,
          payload: envelope.payload,
        },
      ],
      { recordedAt: record.recordedAt },
    );
  }
  return journal;
}
