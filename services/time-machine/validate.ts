/**
 * Whole-record re-validation of the ASSEMBLED point-in-time view (W050).
 *
 * The W048 whole-plan re-validation pattern: an assembled view handed back
 * to the machine is re-proven through its own laws — the sealed view
 * through the contract package's whole-record validator (errors carried
 * VERBATIM), and the carried per-stream summaries against the view's own
 * recorded data: the counts must add up (included + withheld === total;
 * the summed inclusions === the sealed record count), the worlds and
 * families must agree with the query, and the W004/W027's own summary
 * shapes must be coherent. Every violation is collected and named.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — pure: the same recorded view ⇒ the
 * same verdicts, always.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { PointInViewError, TimeMachineRecordFamily } from "tradrl-time-machine";
import { validatePointInTimeView } from "tradrl-time-machine";
import type { AssembledPointInTimeView, ViewStreamSummary } from "./engine.js";

/** Everything that can be wrong with an assembled point-in-time view. */
export type AssembledViewErrorCode =
  | "invalid-view" // the sealed view failed re-proof (errors carried verbatim)
  | "invalid-summary" // a summary is not structurally a ViewStreamSummary
  | "summary-count-mismatch" // a summary's counts do not add up / do not match its own digest
  | "summary-world-mismatch" // a summary cites a world other than the query's
  | "summary-family-not-declared" // a summary cites an undeclared record family
  | "summary-view-count-mismatch"; // the summed inclusions do not equal the sealed record count

/** One typed re-validation error (fail-closed). */
export interface AssembledViewError {
  readonly code: AssembledViewErrorCode;
  readonly message: string;
  /** The offending summary's stream index, when summary-scoped. */
  readonly streamIndex?: number;
  /** `invalid-view` only: the contract's view re-proof errors, verbatim. */
  readonly viewErrors?: readonly PointInViewError[];
}

/** Result of re-validating one assembled point-in-time view. */
export type AssembledViewValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly AssembledViewError[] };

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function summaryViolations(
  summary: ViewStreamSummary,
  declared: ReadonlySet<TimeMachineRecordFamily>,
  worldId: string,
): AssembledViewError[] {
  const errors: AssembledViewError[] = [];
  const streamIndex = summary?.streamIndex;
  if (
    typeof summary !== "object" ||
    summary === null ||
    (summary.kind !== "market-events" && summary.kind !== "information")
  ) {
    return [
      {
        code: "invalid-summary",
        streamIndex,
        message: "summary is not structurally a ViewStreamSummary (typed data)",
      },
    ];
  }
  if (String(summary.worldId) !== worldId) {
    errors.push({
      code: "summary-world-mismatch",
      streamIndex,
      message:
        `summary cites world ${JSON.stringify(String(summary.worldId))}, not the query's ` +
        `world ${JSON.stringify(worldId)}`,
    });
  }
  if (!Array.isArray(summary.families) || summary.families.length === 0) {
    errors.push({
      code: "invalid-summary",
      streamIndex,
      message: "summary carries no declared record families",
    });
  } else {
    for (const family of summary.families) {
      if (!declared.has(family)) {
        errors.push({
          code: "summary-family-not-declared",
          streamIndex,
          message:
            `summary cites record family ${JSON.stringify(String(family))}, which the query ` +
            `does not declare (R016)`,
        });
      }
    }
  }
  if (
    !isNonNegativeInteger(summary.totalRecords) ||
    !isNonNegativeInteger(summary.includedRecords) ||
    !isNonNegativeInteger(summary.excludedPostCutoff) ||
    summary.includedRecords + summary.excludedPostCutoff !== summary.totalRecords
  ) {
    errors.push({
      code: "summary-count-mismatch",
      streamIndex,
      message:
        `summary counts do not add up: total ${String(summary.totalRecords)}, included ` +
        `${String(summary.includedRecords)}, withheld ${String(summary.excludedPostCutoff)}`,
    });
  }
  if (summary.kind === "market-events") {
    if (summary.digest === undefined || summary.digest.eventCount !== summary.totalRecords) {
      errors.push({
        code: "summary-count-mismatch",
        streamIndex,
        message:
          `market-event summary digest eventCount ${String(summary.digest?.eventCount)} does not ` +
          `match totalRecords ${String(summary.totalRecords)} (W004 digest carried verbatim)`,
      });
    }
  } else if (summary.importSummary === undefined) {
    errors.push({
      code: "invalid-summary",
      streamIndex,
      message: "information summary carries no W027 InformationImportSummary",
    });
  } else {
    const imported =
      summary.importSummary.researchReportCount +
      summary.importSummary.newsCount +
      summary.importSummary.eventCount +
      summary.importSummary.analystNoteCount;
    if (imported !== summary.totalRecords) {
      errors.push({
        code: "summary-count-mismatch",
        streamIndex,
        message:
          `information summary import counts (${String(imported)}) do not match totalRecords ` +
          `${String(summary.totalRecords)} (W027 summary carried verbatim)`,
      });
    }
  }
  return errors;
}

/**
 * Re-validate one assembled point-in-time view completely: the sealed view
 * through the contract's whole-record validator (its errors carried
 * VERBATIM), and every carried summary against the view's own data — the
 * counts, the worlds, the families, and the W004/W027 summary coherence.
 * Pure and total: malformed input is refused with named errors.
 */
export function validateAssembledPointInTimeView(
  assembled: AssembledPointInTimeView,
): AssembledViewValidation {
  const errors: AssembledViewError[] = [];
  if (
    typeof assembled !== "object" ||
    assembled === null ||
    typeof assembled.view !== "object" ||
    assembled.view === null
  ) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid-view",
          message: "assembled view is not structurally an AssembledPointInTimeView (typed data)",
        },
      ],
    };
  }
  const viewValidation = validatePointInTimeView(assembled.view);
  if (!viewValidation.ok) {
    errors.push({
      code: "invalid-view",
      message:
        `the sealed view failed whole-record re-proof ` +
        `(${String(viewValidation.errors.length)} error(s), first: ` +
        `${String(viewValidation.errors[0]?.code ?? "none")})`,
      viewErrors: viewValidation.errors,
    });
    return { ok: false, errors };
  }
  const query = assembled.view.query;
  const declared = new Set<TimeMachineRecordFamily>(query.families);
  const summaries = Array.isArray(assembled.summaries) ? assembled.summaries : [];
  let includedTotal = 0;
  for (const summary of summaries as readonly ViewStreamSummary[]) {
    errors.push(...summaryViolations(summary, declared, String(query.scope.worldId)));
    if (typeof summary === "object" && summary !== null) {
      includedTotal += isNonNegativeInteger(summary.includedRecords) ? summary.includedRecords : 0;
    }
  }
  if (includedTotal !== assembled.view.records.length) {
    errors.push({
      code: "summary-view-count-mismatch",
      message:
        `the summaries claim ${String(includedTotal)} included records, but the sealed view ` +
        `carries ${String(assembled.view.records.length)} — the summaries must match the view`,
    });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
