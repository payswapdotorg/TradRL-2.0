/**
 * Information record helpers (W027 `tradrl-information`).
 *
 * Pure functions over the `InformationRecord` contracts (W027
 * `contracts/information-data`): kind guards, the event-time basis law, the
 * canonical-decimal text law and the explicit deterministic sort helper.
 * No IO, no clock reads, no RNG (ARCHITECTURE-LOCK.md A9).
 */

import type { TimestampMs } from "tradrl-world-contracts";
import type {
  AnalystNoteRecord,
  EventRecord,
  InformationRecord,
  NewsItemRecord,
  ResearchReportRecord,
} from "tradrl-world-contracts/information-data";

/** Type guard: is this record a research report? */
export function isResearchReportRecord(
  record: InformationRecord,
): record is ResearchReportRecord {
  return record.kind === "research-report";
}

/** Type guard: is this record a news item? */
export function isNewsItemRecord(
  record: InformationRecord,
): record is NewsItemRecord {
  return record.kind === "news";
}

/** Type guard: is this record an event? */
export function isEventRecord(record: InformationRecord): record is EventRecord {
  return record.kind === "event";
}

/** Type guard: is this record an analyst note? */
export function isAnalystNoteRecord(
  record: InformationRecord,
): record is AnalystNoteRecord {
  return record.kind === "analyst-note";
}

/**
 * The event-time basis of a record — the timestamp that becomes both the
 * artifact's `createdAt` and the journal envelope's `occurredAt`: the
 * record's `publishedAt`, verbatim (never invented, never derived from wall
 * time). An information record IS a publication; its publication time is
 * the only honest event-time basis.
 */
export function informationRecordEventTime(record: InformationRecord): TimestampMs {
  return record.publishedAt;
}

/**
 * Canonical decimal text law (the W003 `primitives.ts` contract boundary):
 * no sign, no leading zeros, no exponent form, at most 12 fractional
 * digits. Mirrors the W020 `tradrl-data/records.ts` helper (which itself
 * mirrors the W014 kernel) — this local mirror keeps the import surface
 * from depending on another import package.
 */
export function isCanonicalDecimalText(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    return false;
  }
  const fraction = value.split(".")[1];
  return fraction === undefined || fraction.length <= 12;
}

/**
 * Deterministic stable sort of records by publication time. Ties keep input
 * order (a stable sort of a pure comparison — same input array ⇒ same
 * output array, always). NEVER applied implicitly by the loader:
 * out-of-order input is validated loudly there; this helper exists for
 * importers that must deterministically repair provider order BEFORE
 * importing (the W020 law).
 */
export function sortInformationRecords(
  records: readonly InformationRecord[],
): readonly InformationRecord[] {
  return [...records].sort((left, right) => {
    const delta = left.publishedAt - right.publishedAt;
    if (delta !== 0) {
      return delta < 0 ? -1 : 1;
    }
    return 0; // stable sort keeps input order on ties
  });
}
