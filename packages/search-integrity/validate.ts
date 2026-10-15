/**
 * Whole-record re-validation (W051) — the search-history laws re-proven
 * from recorded data.
 *
 * The W047 episode / W050 view re-validation pattern: nothing recorded is
 * ever trusted — a search history handed back to the machine is re-proven
 * through its own laws. The record is REBUILT from its own carried data
 * (every construction law re-enforced: every trial's sealed view re-proven
 * through W050's `validatePointInTimeView` with the firewall errors carried
 * VERBATIM, every outcome citation re-derived through W047's own episode
 * id law, every selection decision's evidence re-resolved, R016 re-proven
 * per cited view) and the rebuilt record must reproduce the carried record
 * exactly: the same content-addressed history id, the canonical trial and
 * selection orders, the coherent lineage (a root's lineage IS its own id),
 * and the same canonical bytes end to end.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the re-derivations are pure: same
 * recorded data ⇒ same verdicts, always.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — carry never re-score: the re-proof
 * consults only carried data (candidate descriptors, sealed views, outcome
 * citations); it never re-runs a trial, never re-scores an outcome.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalString } from "trajectory";
import type {
  SearchHistory,
  SearchHistoryError,
  SearchHistoryId,
  SearchHistoryLineage,
  SearchTrial,
  SelectionDecision,
} from "./history.js";
import { blankSearchScopeMembers, isRecordLike } from "./history.js";
import { buildSearchHistory } from "./build.js";

/** Result of re-validating one search history. */
export type SearchHistoryValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SearchHistoryError[] };

function trialIdOf(trial: SearchTrial): string {
  return String((trial as unknown as { trialId?: unknown }).trialId ?? "");
}

function decisionIdOf(selection: SelectionDecision): string {
  return String(
    (selection as unknown as { decisionId?: unknown }).decisionId ?? "",
  );
}

function canonicalOrderErrors(
  trials: readonly SearchTrial[],
  selections: readonly SelectionDecision[],
): SearchHistoryError[] {
  const errors: SearchHistoryError[] = [];
  for (let index = 1; index < trials.length; index += 1) {
    if (trialIdOf(trials[index - 1]!) > trialIdOf(trials[index]!)) {
      errors.push({
        code: "trials-not-canonical",
        message: `trials at indexes ${String(index - 1)}/${String(index)} are not in canonical (trial id) order — declaration order never leaks into a sealed record (A9)`,
      });
      break;
    }
  }
  for (let index = 1; index < selections.length; index += 1) {
    if (decisionIdOf(selections[index - 1]!) > decisionIdOf(selections[index]!)) {
      errors.push({
        code: "selections-not-canonical",
        message: `selection decisions at indexes ${String(index - 1)}/${String(index)} are not in canonical (decision id) order — declaration order never leaks into a sealed record (A9)`,
      });
      break;
    }
  }
  return errors;
}

function lineageErrors(
  lineage: unknown,
  historyId: SearchHistoryId,
): SearchHistoryError[] {
  if (!isRecordLike(lineage)) {
    return [
      {
        code: "invalid-lineage",
        message: "the carried lineage is not typed data — lineage is immutable data",
      },
    ];
  }
  const parent = lineage.parent;
  if (parent === undefined || parent === null) {
    if (String(lineage.root ?? "") !== String(historyId) || lineage.ordinal !== 0) {
      return [
        {
          code: "invalid-lineage",
          message:
            "a root search history's lineage must be (root = own id, ordinal 0) — lineage is carried verbatim, never edited",
        },
      ];
    }
    return [];
  }
  if (
    String(parent) === String(historyId) ||
    String(lineage.root ?? "").trim().length === 0 ||
    !Number.isInteger(lineage.ordinal) ||
    (lineage.ordinal as number) < 1
  ) {
    return [
      {
        code: "invalid-lineage",
        message:
          "the branch lineage is invalid (self-parent, blank root, or ordinal < 1) — search lineage is immutable",
      },
    ];
  }
  return [];
}

/**
 * Re-validate one search history completely: every construction law
 * re-enforced over the carried data (the sealed views re-proven through
 * W050's own firewall validator with its errors carried verbatim; the
 * outcome citations re-derived through W047's episode id law; the R016
 * carry re-proven per cited view), the canonical orders re-derived, the
 * lineage proven coherent against the RE-DERIVED history id, and the
 * whole record re-derived to the same canonical bytes. Pure and total:
 * malformed input is refused with named errors, never thrown at.
 */
export function validateSearchHistory(
  history: SearchHistory,
): SearchHistoryValidation {
  if (!isRecordLike(history)) {
    return {
      ok: false,
      errors: [
        {
          code: "history-id-mismatch",
          message:
            "history is not typed data — a search history is a sealed record (scope, trials, selections, lineage)",
        },
      ],
    };
  }
  const structural: SearchHistoryError[] = [];
  if (!isRecordLike(history.scope)) {
    structural.push({
      code: "blank-scope-member",
      message: "the carried scope is not typed data — tenantId, projectId, worldId, experimentId are required",
    });
  } else {
    for (const member of blankSearchScopeMembers(history.scope)) {
      structural.push({
        code: "blank-scope-member",
        message: `scope member ${String(member)} is blank — the scope must be explicit`,
      });
    }
  }
  if (!Array.isArray(history.trials) || history.trials.length === 0) {
    structural.push({
      code: "empty-trial-set",
      message: "the record carries no trials — a search history over nothing is never valid (§13 search-history integrity)",
    });
  }
  if (history.selections !== undefined && !Array.isArray(history.selections)) {
    structural.push({
      code: "malformed-decision",
      message: "selections is not an array — the selection decisions are required data",
    });
  }
  if (structural.length > 0) {
    return { ok: false, errors: structural };
  }
  const carriedLineage = history.lineage as SearchHistoryLineage;
  const rebuilt = buildSearchHistory({
    scope: history.scope,
    trials: history.trials,
    selections: Array.isArray(history.selections) ? history.selections : [],
    lineage: {
      parent: carriedLineage?.parent,
      root: carriedLineage?.root,
      ordinal: carriedLineage?.ordinal,
    },
  });
  if (!rebuilt.ok) {
    return { ok: false, errors: rebuilt.errors };
  }
  const errors: SearchHistoryError[] = canonicalOrderErrors(
    history.trials,
    Array.isArray(history.selections) ? history.selections : [],
  );
  errors.push(...lineageErrors(history.lineage, rebuilt.history.historyId));
  if (rebuilt.history.historyId !== history.historyId) {
    errors.push({
      code: "history-id-mismatch",
      message:
        `historyId ${JSON.stringify(String(history.historyId))} does not re-derive from the carried scope/trials/selections (expected ${JSON.stringify(String(rebuilt.history.historyId))}) — the record's own content address is its identity (A9)`,
    });
  }
  if (
    errors.length === 0 &&
    canonicalString(rebuilt.history) !== canonicalString(history)
  ) {
    errors.push({
      code: "history-id-mismatch",
      message:
        "the record does not re-derive from its own carried data (canonical bytes differ from the rebuilt record) — recorded data is re-proven, never trusted",
    });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
