/**
 * The Time Machine pure query engine (W050) — `assembleView`: THE GATE.
 *
 * Every stream record is RE-PROVEN through W004's own
 * `validateEventStream` and W027's own `loadInformationDataset` validator
 * (errors carried VERBATIM); every stream's declared world, record
 * families and declared time range are proven against the query (every
 * seam fail-closed); the knowable-at-cutoff records are SELECTED through
 * W004's/W027's own observation laws (`isEventObservableAt`; the
 * publication-time mapping law); the selection is SEALED through the
 * contract package's knowledge firewall (`sealView`, R016 — a leak would
 * be refused loudly, defensive depth); the deterministic view is returned
 * with the per-stream summaries carried as data.
 *
 * Spec: spec/REQUIREMENTS.md R016 (the anti-lookahead-bias machine);
 * spec/ARCHITECTURE-LOCK.md A9 (a pure function of (query, streams) — no
 * clocks, no randomness, no env reads); A14 (the machine ASSEMBLES views;
 * it never executes, never forecasts, never re-scores).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { WorldEventEnvelope, WorldId } from "tradrl-world-contracts";
import type { DatasetRange } from "tradrl-world-contracts/data";
import type { EventStreamDigest, EventStreamViolation } from "tradrl-world-contracts/time";
import { eventStreamDigest, isEventObservableAt, validateEventStream } from "tradrl-world-contracts/time";
import type { InformationImportSummary, InformationViolation } from "tradrl-information";
import { InformationImportError, loadInformationDataset } from "tradrl-information";
import type { InformationImportInput } from "tradrl-information";
import type { PointInTimeQuery, PointInTimeQueryError, PointInTimeView, TimeMachineRecordFamily, ViewRecord } from "tradrl-time-machine";
import { sealView, validatePointInTimeQuery } from "tradrl-time-machine";
import type { FirewallRefusal } from "tradrl-time-machine";

// --- the recorded streams the machine views (W004/W027 surfaces) ---------------

/** One recorded W004 market-event stream (world + declared covered range + events). */
export interface MarketEventStream {
  readonly kind: "market-events";
  readonly worldId: WorldId;
  readonly declaredRange: DatasetRange;
  readonly events: readonly WorldEventEnvelope[];
}

/**
 * One recorded W027 information stream: the complete import input. The
 * descriptor's own `range` IS the declared time range — never a second one.
 */
export interface InformationRecordStream {
  readonly kind: "information";
  readonly input: InformationImportInput;
}

/** The streams one point-in-time view is assembled from. */
export type TimeMachineStream = MarketEventStream | InformationRecordStream;

// --- the carried summaries (data — never derived state) ----------------------

/**
 * The per-stream summary carried on the assembled view: declared families,
 * the honest counts (total / included / withheld-after-cutoff), and
 * W004/W027's own summary types carried verbatim.
 */
export interface ViewStreamSummary {
  readonly kind: "market-events" | "information";
  readonly streamIndex: number;
  readonly worldId: WorldId;
  readonly families: readonly TimeMachineRecordFamily[];
  readonly totalRecords: number;
  readonly includedRecords: number;
  readonly excludedPostCutoff: number;
  /** Market streams: W004's own digest over the FULL declared stream. */
  readonly digest?: EventStreamDigest;
  /** Information streams: W027's own import summary (carried verbatim). */
  readonly importSummary?: InformationImportSummary;
}

/** The assembled point-in-time view: the sealed view + the summaries. */
export interface AssembledPointInTimeView {
  readonly view: PointInTimeView;
  readonly summaries: readonly ViewStreamSummary[];
}

// --- the typed error family (closed set — every seam law named) --------------

/** Everything the assembly gate refuses. */
export type AssembleViewErrorCode =
  | "invalid-query" // the query failed whole-record re-proof (errors carried verbatim)
  | "unknown-stream-kind" // a stream that is neither a market-event nor an information stream
  | "world-mismatch" // a stream recorded for another world than the query's scope
  | "family-not-declared" // a stream carrying record families the query does not declare (R016 scope law)
  | "cutoff-outside-declared-range" // the cutoff lies outside a stream's declared time range
  | "invalid-event-stream" // W004 stream-law violations, carried verbatim
  | "invalid-information-import" // W027 import violations, carried verbatim
  | "duplicate-record-id" // the same opaque record id in one view (within or across streams)
  | "firewall-refusal"; // the contract gate's own refusal, carried verbatim (defensive depth)

/** One typed assembly error (fail-closed). */
export interface AssembleViewError {
  readonly code: AssembleViewErrorCode;
  readonly message: string;
  /** The offending stream's index, when stream-scoped. */
  readonly streamIndex?: number;
  /** `invalid-event-stream` only: W004's violations, verbatim. */
  readonly eventStreamViolations?: readonly EventStreamViolation[];
  /** `invalid-information-import` only: W027's violations, verbatim. */
  readonly informationViolations?: readonly InformationViolation[];
  /** `invalid-query` only: the query re-proof errors, verbatim. */
  readonly queryErrors?: readonly PointInTimeQueryError[];
  /** `firewall-refusal` only: the contract gate's refusal, verbatim. */
  readonly refusal?: FirewallRefusal;
}

/** The assembly outcome: the assembled view, or every law violated. */
export type AssembleViewOutcome =
  | { readonly ok: true; readonly assembled: AssembledPointInTimeView }
  | { readonly ok: false; readonly errors: readonly AssembleViewError[] };

// --- the seam laws ------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The declared-range law: the cutoff must lie INSIDE the stream's declared
 * `[from, to)` range (open-ended bounds are honored). Viewing at a cutoff
 * the stream does not cover would silently miss records — fail-closed.
 */
export function cutoffWithinDeclaredRange(range: DatasetRange, cutoff: number): boolean {
  if (range === null || typeof range !== "object") {
    return false;
  }
  const from = (range as { readonly from?: unknown }).from;
  const to = (range as { readonly to?: unknown }).to;
  if (typeof from === "number" && cutoff < from) {
    return false;
  }
  if (typeof to === "number" && cutoff >= to) {
    return false;
  }
  return true;
}

// --- THE GATE ------------------------------------------------------------------

/**
 * Assemble one point-in-time view — the Time Machine. Every seam is
 * fail-closed and every violation collected (the W004 pattern): W004/
 * W027's own validators re-prove the stream records (errors carried
 * VERBATIM), the declarations are proven against the query, the
 * knowable-at-cutoff records are selected, and the selection is sealed
 * through the knowledge firewall (R016). Pure and deterministic (A9).
 */
export function assembleView(
  query: PointInTimeQuery,
  streams: readonly TimeMachineStream[],
): AssembleViewOutcome {
  const queryValidation = validatePointInTimeQuery(query);
  if (!queryValidation.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid-query",
          message:
            `the point-in-time query failed whole-record re-proof ` +
            `(${String(queryValidation.errors.length)} error(s), first: ` +
            `${String(queryValidation.errors[0]?.code ?? "none")}) — views are never assembled over an unlawful query`,
          queryErrors: queryValidation.errors,
        },
      ],
    };
  }
  const declared = new Set<TimeMachineRecordFamily>(query.families);
  const errors: AssembleViewError[] = [];
  const included: ViewRecord[] = [];
  const seenIds = new Map<string, number>();
  const summaries: ViewStreamSummary[] = [];

  const noteDuplicate = (recordId: string, streamIndex: number, firstStreamIndex: number): void => {
    errors.push({
      code: "duplicate-record-id",
      streamIndex,
      message:
        `record id ${JSON.stringify(recordId)} appears in stream ${String(firstStreamIndex)} ` +
        `and again in stream ${String(streamIndex)} — one view never cites a record twice`,
    });
  };

  for (let streamIndex = 0; streamIndex < streams.length; streamIndex += 1) {
    const stream = streams[streamIndex];
    if (!isRecordLike(stream)) {
      errors.push({
        code: "unknown-stream-kind",
        streamIndex,
        message: "stream is not an object — a TimeMachineStream is typed data",
      });
      continue;
    }
    if (stream.kind === "market-events") {
      const market = stream as unknown as MarketEventStream;
      if (market.worldId !== query.scope.worldId) {
        errors.push({
          code: "world-mismatch",
          streamIndex,
          message:
            `market-event stream belongs to ${JSON.stringify(String(market.worldId))}, ` +
            `not the query's world ${JSON.stringify(String(query.scope.worldId))}`,
        });
      }
      if (!declared.has("market-event")) {
        errors.push({
          code: "family-not-declared",
          streamIndex,
          message:
            "market-event stream carries family \"market-event\", which the query does not " +
            "declare — the point-in-time firewall (R016) views only declared families",
        });
      }
      if (!cutoffWithinDeclaredRange(market.declaredRange, query.cutoff)) {
        errors.push({
          code: "cutoff-outside-declared-range",
          streamIndex,
          message:
            `cutoff ${String(query.cutoff)} lies outside the market-event stream's declared ` +
            `range [${String(market.declaredRange?.from)}, ${String(market.declaredRange?.to)})`,
        });
      }
      const events = Array.isArray(market.events) ? market.events : [];
      const streamCheck = validateEventStream(events);
      if (!streamCheck.ok) {
        errors.push({
          code: "invalid-event-stream",
          streamIndex,
          message:
            `W004 market-event stream violations (${String(streamCheck.violations.length)}, ` +
            `first: ${String(streamCheck.violations[0]?.kind ?? "none")}) — carried verbatim`,
          eventStreamViolations: streamCheck.violations,
        });
      }
      let includedCount = 0;
      for (const event of events) {
        const recordId = String(event.eventId);
        const firstStreamIndex = seenIds.get(recordId);
        if (firstStreamIndex === undefined) {
          seenIds.set(recordId, streamIndex);
        } else {
          noteDuplicate(recordId, streamIndex, firstStreamIndex);
        }
        if (isEventObservableAt(event, query.cutoff)) {
          included.push({ family: "market-event", recordId: event.eventId, event });
          includedCount += 1;
        }
      }
      summaries.push({
        kind: "market-events",
        streamIndex,
        worldId: market.worldId,
        families: ["market-event"],
        totalRecords: events.length,
        includedRecords: includedCount,
        excludedPostCutoff: events.length - includedCount,
        digest: eventStreamDigest(events),
      });
      continue;
    }
    if (stream.kind === "information") {
      const information = stream as unknown as InformationRecordStream;
      const input = information.input;
      if (!isRecordLike(input) || input.worldId !== query.scope.worldId) {
        errors.push({
          code: "world-mismatch",
          streamIndex,
          message:
            `information stream belongs to ${JSON.stringify(String(input?.worldId))}, ` +
            `not the query's world ${JSON.stringify(String(query.scope.worldId))}`,
        });
      }
      const descriptor = isRecordLike(input) ? input.descriptor : undefined;
      const kinds = isRecordLike(descriptor) && Array.isArray(descriptor.recordKinds)
        ? (descriptor.recordKinds as readonly TimeMachineRecordFamily[])
        : [];
      const undeclared = kinds.filter((family) => !declared.has(family));
      if (undeclared.length > 0) {
        errors.push({
          code: "family-not-declared",
          streamIndex,
          message:
            `information stream carries record families ` +
            `${JSON.stringify(undeclared.map((family) => String(family)))}, which the query ` +
            `does not declare — the point-in-time firewall (R016) views only declared families`,
        });
      }
      const range = isRecordLike(descriptor) ? (descriptor.range as DatasetRange | undefined) : undefined;
      if (!cutoffWithinDeclaredRange(range ?? {}, query.cutoff)) {
        errors.push({
          code: "cutoff-outside-declared-range",
          streamIndex,
          message:
            `cutoff ${String(query.cutoff)} lies outside the information dataset's declared ` +
            `range [${String(range?.from)}, ${String(range?.to)})`,
        });
      }
      let outcome: ReturnType<typeof loadInformationDataset> | undefined;
      try {
        outcome = loadInformationDataset(input as InformationImportInput);
      } catch (thrown) {
        if (thrown instanceof InformationImportError) {
          errors.push({
            code: "invalid-information-import",
            streamIndex,
            message:
              `W027 information import violations (${String(thrown.violations.length)}, ` +
              `first: ${String(thrown.violations[0]?.kind ?? "none")}) — carried verbatim`,
            informationViolations: thrown.violations,
          });
        } else {
          errors.push({
            code: "invalid-information-import",
            streamIndex,
            message:
              `W027 information import was refused (${String(thrown)}) — carried verbatim`,
          });
        }
        continue;
      }
      const records = Array.isArray(input.records) ? input.records : [];
      let includedCount = 0;
      for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
        const record = records[recordIndex]!;
        const artifact = outcome.artifacts[recordIndex];
        const recordId = String(artifact?.artifactId ?? "");
        const firstStreamIndex = seenIds.get(recordId);
        if (firstStreamIndex === undefined) {
          seenIds.set(recordId, streamIndex);
        } else {
          noteDuplicate(recordId, streamIndex, firstStreamIndex);
        }
        const observableAt = record.availableAt ?? record.publishedAt;
        if (observableAt <= query.cutoff) {
          included.push({
            family: record.kind,
            recordId: artifact?.artifactId ?? (recordId as never),
            record,
          });
          includedCount += 1;
        }
      }
      summaries.push({
        kind: "information",
        streamIndex,
        worldId: (input.worldId as WorldId | undefined) ?? query.scope.worldId,
        families: kinds,
        totalRecords: records.length,
        includedRecords: includedCount,
        excludedPostCutoff: records.length - includedCount,
        importSummary: outcome.summary,
      });
      continue;
    }
    errors.push({
      code: "unknown-stream-kind",
      streamIndex,
      message: `unknown stream kind ${JSON.stringify(String(stream.kind))}`,
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const sealed = sealView(query, included);
  if (!sealed.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "firewall-refusal",
          message:
            `the knowledge firewall refused the assembled selection — ` +
            `${sealed.refusal.message}`,
          refusal: sealed.refusal,
        },
      ],
    };
  }
  return {
    ok: true,
    assembled: Object.freeze({
      view: sealed.view,
      summaries: Object.freeze(summaries),
    }),
  };
}
