/**
 * THE KNOWLEDGE FIREWALL LAW (W050) — a typed gate, never a convention.
 *
 * Spec: spec/REQUIREMENTS.md R016 — "Runtime point-in-time information
 * firewall." A query result can reference NOTHING recorded after its
 * cutoff — enforced STRUCTURALLY: `sealView` proves every record ≤ cutoff
 * through the records' OWN timestamps (W004's `eventObservationTime` law
 * for market events; W027's publication-time mapping law — an undelayed
 * publication is observable exactly from its `publishedAt`, a delayed one
 * from its declared `availableAt`) and REFUSES any post-cutoff record
 * loudly, naming R016. The refusal is a typed value (`FirewallRefusal`),
 * never a silent drop, never a warning.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the sealed view is a
 * pure function of (query, records) — no clocks, no randomness, no env
 * reads; records are placed in CANONICAL order (observation time, then
 * record id, then family) so input order never leaks into the view. Same
 * inputs ⇒ same view, deep-equal, same canonical ids.
 * Spec: spec/DOMAIN-MODEL.md identity laws — record ids are OPAQUE (W004
 * `EventId` / W027 artifact id, cited never parsed); the sealed view's id
 * is content-addressed over the canonical encoding.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — the sealed view is DATA carrying
 * its own proof (which records, which timestamps, the firewall digest);
 * it never executes, never forecasts.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  EventId,
  InformationArtifactId,
  TimestampMs,
  WorldEventEnvelope,
} from "tradrl-world-contracts";
import type { AvailableAtMs, EventTimeMs } from "tradrl-world-contracts/time";
import { asAvailableAt, asEventTime, eventObservationTime } from "tradrl-world-contracts/time";
import type { InformationRecord, InformationRecordKind } from "tradrl-world-contracts/information-data";
import { canonicalDigestHex } from "trajectory";
import type { PointInTimeCutoff, PointInTimeQuery, TimeMachineRecordFamily } from "./query.js";
import { validatePointInTimeQuery } from "./validate.js";
import type { PointInTimeQueryError } from "./query.js";

/** The law this gate enforces (named in every refusal — R016). */
export const KNOWLEDGE_FIREWALL_LAW = "R016" as const;

// ---------------------------------------------------------------------------
// The records a view can seal (the W004/W027 record types, verbatim)
// ---------------------------------------------------------------------------

/**
 * ONE viewable record: either a W004 world-journal event (carried verbatim
 * in its envelope) or a W027 information record (carried verbatim — never
 * re-structured). `recordId` is the record's OPAQUE id (the W004
 * `eventId` / the W027 artifact id), cited never parsed.
 */
export type ViewRecord =
  | {
      readonly family: "market-event";
      readonly recordId: EventId;
      readonly event: WorldEventEnvelope;
    }
  | {
      readonly family: InformationRecordKind;
      readonly recordId: InformationArtifactId;
      readonly record: InformationRecord;
    };

/**
 * The record's occurrence time (when it happened in the world): W004's
 * `occurredAt` / W027's `publishedAt` (the event-time basis law — an
 * information record IS a publication). Carried verbatim, never invented.
 */
export function viewRecordOccurredAt(record: ViewRecord): EventTimeMs {
  if (record.family === "market-event") {
    return asEventTime(record.event.occurredAt);
  }
  return asEventTime(record.record.publishedAt);
}

/**
 * The record's observation threshold — the earliest legal observation
 * time: W004's own `eventObservationTime` law (`availableAt ?? occurredAt`)
 * for market events; W027's publication-time mapping law
 * (`availableAt ?? publishedAt` — an undelayed publication is observable
 * exactly from its publication time) for information records. The firewall
 * seals the record into a view with cutoff ≥ this threshold, exactly.
 */
export function viewRecordObservableAt(record: ViewRecord): AvailableAtMs {
  if (record.family === "market-event") {
    return asAvailableAt(eventObservationTime(record.event));
  }
  return asAvailableAt(record.record.availableAt ?? record.record.publishedAt);
}

// ---------------------------------------------------------------------------
// The proof (the sealed view carries its own evidence)
// ---------------------------------------------------------------------------

/** One proof entry: which record, which timestamps. */
export interface FirewallProofEntry {
  /** The record's opaque id (W004 eventId / W027 artifact id). */
  readonly recordId: string;
  readonly family: TimeMachineRecordFamily;
  readonly occurredAt: TimestampMs;
  readonly observableAt: TimestampMs;
}

/** The sealed view's proof that the firewall held. */
export interface FirewallProof {
  /** The law enforced (named — R016, the point-in-time firewall). */
  readonly law: typeof KNOWLEDGE_FIREWALL_LAW;
  readonly cutoff: PointInTimeCutoff;
  /** One entry per sealed record, in the view's canonical order. */
  readonly entries: readonly FirewallProofEntry[];
  /**
   * The firewall digest: the canonical content digest over the proof —
   * same sealed knowledge ⇒ same digest, always (A9).
   */
  readonly firewallDigest: string;
}

/**
 * The canonical order law: by observation threshold, then record id, then
 * family — a total order over the sealed set (ids are unique within a
 * view), so input order never leaks into the sealed view (A9).
 */
export function compareViewRecords(left: ViewRecord, right: ViewRecord): number {
  const leftAt = viewRecordObservableAt(left);
  const rightAt = viewRecordObservableAt(right);
  if (leftAt !== rightAt) {
    return leftAt < rightAt ? -1 : 1;
  }
  const leftId = String(left.recordId);
  const rightId = String(right.recordId);
  if (leftId !== rightId) {
    return leftId < rightId ? -1 : 1;
  }
  const leftFamily = String(left.family);
  const rightFamily = String(right.family);
  return leftFamily === rightFamily ? 0 : leftFamily < rightFamily ? -1 : 1;
}

/** The firewall digest: the canonical content digest over the proof. */
export function firewallDigestOf(
  cutoff: PointInTimeCutoff,
  entries: readonly FirewallProofEntry[],
): string {
  return canonicalDigestHex({ cutoff, entries, law: KNOWLEDGE_FIREWALL_LAW });
}

// ---------------------------------------------------------------------------
// The sealed view (typed DATA + its proof)
// ---------------------------------------------------------------------------

declare const pointInViewIdBrand: unique symbol;

/**
 * An OPAQUE point-in-time view id (a canonical digest rendering). Produced
 * only by {@link pointInViewIdOf}; never parsed — the query, records and
 * proof are carried on the view itself.
 */
export type PointInViewId = string & { readonly [pointInViewIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const POINT_IN_TIME_VIEW_ID_PREFIX = "pitv-";

/**
 * The view id: the canonical content digest over the query, the sealed
 * records and the proof — fully content-addressed. Same sealed knowledge ⇒
 * same view id, always (A9).
 */
export function pointInViewIdOf(
  query: PointInTimeQuery,
  records: readonly ViewRecord[],
  proof: FirewallProof,
): PointInViewId {
  const digest = canonicalDigestHex({
    proof: { entries: proof.entries, firewallDigest: proof.firewallDigest, law: proof.law },
    query: {
      cutoff: query.cutoff,
      families: [...query.families],
      scope: {
        projectId: query.scope.projectId,
        tenantId: query.scope.tenantId,
        worldId: query.scope.worldId,
      },
    },
    records,
  });
  return `${POINT_IN_TIME_VIEW_ID_PREFIX}${digest}` as PointInViewId;
}

/**
 * ONE sealed point-in-time view: the content-addressed id, the query
 * verbatim, the records in canonical order, and the proof that nothing in
 * the view references anything recorded after the cutoff (R016).
 */
export interface PointInTimeView {
  readonly viewId: PointInViewId;
  readonly query: PointInTimeQuery;
  readonly records: readonly ViewRecord[];
  readonly proof: FirewallProof;
}

// ---------------------------------------------------------------------------
// The typed refusal (fail-closed — every law named)
// ---------------------------------------------------------------------------

/** Everything the firewall gate refuses. */
export type FirewallErrorCode =
  | "invalid-query" // the query itself failed whole-record re-proof
  | "family-not-declared" // a record of a family the query did not declare (R016 scope law)
  | "duplicate-record-id" // two records cite the same opaque id in one view
  | "post-cutoff-record"; // THE R016 LAW: a record observable only after the cutoff

/** The loud typed refusal naming R016. */
export interface FirewallRefusal {
  readonly law: typeof KNOWLEDGE_FIREWALL_LAW;
  readonly code: FirewallErrorCode;
  readonly message: string;
  /** `invalid-query` only: the query re-proof errors, carried verbatim. */
  readonly queryErrors?: readonly PointInTimeQueryError[];
}

/** The gate's outcome: the sealed view, or the refusal naming the law. */
export type SealViewOutcome =
  | { readonly ok: true; readonly view: PointInTimeView }
  | { readonly ok: false; readonly refusal: FirewallRefusal };

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

/**
 * Seal one point-in-time view — THE KNOWLEDGE FIREWALL.
 *
 * Every record is proven ≤ cutoff through its OWN timestamps
 * ({@link viewRecordObservableAt} — W004's/W027's own observation laws);
 * any post-cutoff record in the input is a LOUD typed refusal naming R016.
 * Records of families the query did not declare are refused (the scope
 * law); duplicate record ids are refused; a malformed query is refused
 * with its re-proof errors carried verbatim. On success the view is
 * assembled deterministically (A9): records in canonical order, the proof
 * with one entry per record, the firewall digest, and the content-
 * addressed view id. Pure: no clocks, no randomness, no env reads.
 */
export function sealView(
  query: PointInTimeQuery,
  records: readonly ViewRecord[],
): SealViewOutcome {
  const queryValidation = validatePointInTimeQuery(query);
  if (!queryValidation.ok) {
    return {
      ok: false,
      refusal: {
        law: KNOWLEDGE_FIREWALL_LAW,
        code: "invalid-query",
        message:
          `point-in-time view refused: the query failed whole-record re-proof ` +
          `(${String(queryValidation.errors.length)} error(s), first: ` +
          `${String(queryValidation.errors[0]?.code ?? "none")}) — the firewall never seals over an unlawful query`,
        queryErrors: queryValidation.errors,
      },
    };
  }
  const declared = new Set<TimeMachineRecordFamily>(query.families);
  const seenIds = new Set<string>();
  for (const record of records) {
    const recordId = String(record.recordId);
    if (!declared.has(record.family)) {
      return {
        ok: false,
        refusal: {
          law: KNOWLEDGE_FIREWALL_LAW,
          code: "family-not-declared",
          message:
            `record ${JSON.stringify(recordId)} is of family ` +
            `${JSON.stringify(String(record.family))}, which the query does not declare — ` +
            `the point-in-time firewall (R016) seals only declared families`,
        },
      };
    }
    if (seenIds.has(recordId)) {
      return {
        ok: false,
        refusal: {
          law: KNOWLEDGE_FIREWALL_LAW,
          code: "duplicate-record-id",
          message:
            `record id ${JSON.stringify(recordId)} appears twice in one view — ` +
            `sealed point-in-time views never duplicate records`,
        },
      };
    }
    seenIds.add(recordId);
    const observableAt = viewRecordObservableAt(record);
    if (observableAt > query.cutoff) {
      return {
        ok: false,
        refusal: {
          law: KNOWLEDGE_FIREWALL_LAW,
          code: "post-cutoff-record",
          message:
            `record ${JSON.stringify(recordId)} is observable at ` +
            `${String(observableAt)}, after the declared cutoff ` +
            `${String(query.cutoff)} — a query result can reference NOTHING recorded ` +
            `after its cutoff (R016, the runtime point-in-time information firewall)`,
        },
      };
    }
  }
  const ordered = [...records].sort(compareViewRecords);
  const entries: FirewallProofEntry[] = ordered.map((record) => ({
    recordId: String(record.recordId),
    family: record.family,
    occurredAt: viewRecordOccurredAt(record),
    observableAt: viewRecordObservableAt(record),
  }));
  const proof: FirewallProof = Object.freeze({
    law: KNOWLEDGE_FIREWALL_LAW,
    cutoff: query.cutoff,
    entries: Object.freeze(entries),
    firewallDigest: firewallDigestOf(query.cutoff, entries),
  });
  const view: PointInTimeView = Object.freeze({
    viewId: pointInViewIdOf(query, ordered, proof),
    query,
    records: Object.freeze(ordered),
    proof,
  });
  return { ok: true, view };
}
