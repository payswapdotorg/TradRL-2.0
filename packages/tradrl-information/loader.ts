/**
 * The deterministic information-dataset loader (W027 `tradrl-information`).
 *
 * Spec: spec/WORK-ITEMS.md W027 — "a loader that produces world information
 * artifacts + journal-ready event records deterministically": same input
 * records ⇒ same artifacts and events, bit-for-bit (ARCHITECTURE-LOCK.md
 * A9 — no IO, no clock reads, no RNG).
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" + ARCHITECTURE-LOCK.md A6 —
 * imported events are first-class journal events in the W004 envelope
 * shape. A8 (W016) — sealed records are frozen plain data.
 *
 * Two output channels per import (both proven by tests):
 * - `artifacts` — the world's information artifacts (W003
 *   `InformationArtifact`), directly placeable on a world definition's
 *   `informationArtifacts` surface (see `toDefinitionInformationArtifacts`)
 *   behind the A7 firewall;
 * - `drafts` + `records` — the journal-ready surfaces (the W020 law):
 *   engine-appendable `PendingEventDraft[]` and sealed `JournalRecord[]`
 *   with deterministic sequence/event/entry ids from (worldId, sequence),
 *   `recordedAt` = each record's own `publishedAt` (domain time, never wall
 *   time), directly restorable via `createEventJournalFromRecords`.
 *
 * Both channels share ONE payload object per record, carrying the W028
 * provenance identity — a citation resolves to the same content either way.
 */

import type {
  SequenceNumber,
  TimestampMs,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import type { EventStreamDigest } from "tradrl-world-contracts/time";
import { eventStreamDigest, validateEventStream } from "tradrl-world-contracts/time";
import type {
  ImportedInformationArtifact,
  InformationDatasetDescriptor,
} from "tradrl-world-contracts/information-data";
import {
  FIRST_EVENT_SEQUENCE,
  type JournalRecord,
  type PendingEventDraft,
  entryIdFor,
  eventIdFor,
} from "tradrl-world-sim/journal";
import {
  buildInformationImportContext,
  informationRecordToArtifactAndDraft,
} from "./adapters.js";
import { InformationImportError } from "./errors.js";
import {
  isAnalystNoteRecord,
  isEventRecord,
  isNewsItemRecord,
  isResearchReportRecord,
} from "./records.js";
import { validateInformationImport, type InformationImportInput } from "./validate.js";

/** Import summary: deterministic counts over the imported data. */
export interface InformationImportSummary {
  readonly researchReportCount: number;
  readonly newsCount: number;
  readonly eventCount: number;
  readonly analystNoteCount: number;
  /** Records with a declared delayed availability (availableAt > publishedAt). */
  readonly delayedCount: number;
  /** Source names present in the import (sorted, deduplicated). */
  readonly sources: readonly string[];
  /** Feed symbols referenced by the imported records (sorted, deduplicated). */
  readonly symbols: readonly string[];
  /** Publication time of the first imported record (undefined when empty). */
  readonly firstPublishedAt?: TimestampMs;
  /** Publication time of the last imported record (undefined when empty). */
  readonly lastPublishedAt?: TimestampMs;
}

/** The complete outcome of one deterministic information import. */
export interface InformationImportOutcome {
  readonly worldId: WorldId;
  /** The validated descriptor (echoed — the fidelity declaration of this data). */
  readonly descriptor: InformationDatasetDescriptor;
  /** The world's information artifacts, in import order (frozen plain data). */
  readonly artifacts: readonly ImportedInformationArtifact[];
  /** Engine-appendable drafts, in import order. */
  readonly drafts: readonly PendingEventDraft[];
  /** Sealed, frozen, restore-path-appendable journal records (sequences 1..N). */
  readonly records: readonly JournalRecord[];
  /** The W004 determinism digest of the sealed envelopes (A9 evidence). */
  readonly digest: EventStreamDigest;
  readonly summary: InformationImportSummary;
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
    payload: draft.payload,
  };
  return Object.freeze({
    entryId: entryIdFor(worldId, sequence),
    envelope: Object.freeze(envelope),
    // LAW: an information import journals each event as of its own domain
    // time (the record's publication time) — never from a clock (A9).
    recordedAt: draft.occurredAt,
  });
}

/**
 * Load one information dataset import deterministically.
 *
 * Validates the complete input first (throwing `InformationImportError`
 * with EVERY violation — never a partial import, never a silently dropped
 * record), then maps records to artifacts + drafts and seals the drafts
 * into journal-ready records. Pure: the same (worldId, descriptor, records,
 * sources, symbolMap) always yields the bit-identical outcome.
 */
export function loadInformationDataset(
  input: InformationImportInput,
): InformationImportOutcome {
  const validation = validateInformationImport(input);
  if (!validation.ok) {
    throw new InformationImportError(validation.violations);
  }
  const context = buildInformationImportContext(
    input.descriptor,
    input.sources,
    input.symbolMap,
  );
  const mapped = input.records.map((record, index) =>
    informationRecordToArtifactAndDraft(record, index + 1, context, input.worldId),
  );
  const artifacts = Object.freeze(mapped.map((entry) => entry.artifact));
  const drafts = Object.freeze(mapped.map((entry) => entry.draft));
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
  const symbols = [
    ...new Set(input.records.flatMap((record) => [...(record.symbols ?? [])])),
  ].sort();
  const summary: InformationImportSummary = Object.freeze({
    researchReportCount: input.records.filter(isResearchReportRecord).length,
    newsCount: input.records.filter(isNewsItemRecord).length,
    eventCount: input.records.filter(isEventRecord).length,
    analystNoteCount: input.records.filter(isAnalystNoteRecord).length,
    delayedCount: input.records.filter(
      (record) => record.availableAt !== undefined && record.availableAt > record.publishedAt,
    ).length,
    sources: [...new Set(input.records.map((record) => record.source))].sort(),
    symbols,
    ...(input.records.length === 0
      ? {}
      : {
          firstPublishedAt: input.records[0]!.publishedAt,
          lastPublishedAt: input.records[input.records.length - 1]!.publishedAt,
        }),
  });
  return Object.freeze({
    worldId: input.worldId,
    descriptor: input.descriptor,
    artifacts,
    drafts,
    records,
    digest: eventStreamDigest(envelopes),
    summary,
  });
}
