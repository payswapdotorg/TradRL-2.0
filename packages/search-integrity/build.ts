/**
 * THE CONSTRUCTION GATE of the SearchHistory (W051) — buildSearchHistory.
 *
 * Every construction law of `./history.ts` is enforced HERE, loudly and
 * collected (the W004/W050 pattern — the declarer sees all problems, never
 * just the first): the explicit scope; every trial's id, candidate
 * descriptor, SEALED view (re-proven through W050's own
 * `validatePointInTimeView` with the firewall errors carried verbatim —
 * fail-closed at every seam), scope coherence (every dataset access shares
 * the search's own tenant/project/world identity) and outcome citation
 * (the W047 episode id re-derived from its provenance); every selection
 * decision's identity, resolvable evidence, chosen-trial citation, and the
 * R016 carry (a selection consulting anything beyond its declared as-of
 * point is refused loudly naming R016 — nothing the firewall would withhold
 * at decision time ever enters the record).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — on success the record is
 * canonicalized (trials by trial id, selections by decision id, candidate
 * parameters by name, cited evidence by id) so declaration order NEVER
 * leaks into the content-addressed history id: a permuted declaration of
 * the same search yields the IDENTICAL record.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { PointInTimeView, TimeMachineScope } from "tradrl-time-machine";
import { isLegalCutoff, validatePointInTimeView } from "tradrl-time-machine";
import { blankEpisodeProvenanceMembers, episodeIdOf } from "rl-protocol";
import type { EpisodeProvenance } from "rl-protocol";
import type {
  SearchHistory,
  SearchHistoryError,
  SearchHistoryId,
  SearchHistoryLineage,
  SearchHistoryLineageInput,
  SearchScope,
  SearchTrial,
  SelectionDecision,
} from "./history.js";
import {
  blankSearchScopeMembers,
  isRecordLike,
  isSearchCandidateKind,
  searchHistoryIdOf,
} from "./history.js";

/** The construction input: the declared search, before sealing. */
export interface SearchHistoryInput {
  readonly scope: SearchScope;
  readonly trials: readonly SearchTrial[];
  readonly selections: readonly SelectionDecision[];
  readonly lineage?: SearchHistoryLineageInput;
}

/** The construction outcome: the lawful record, or every law violated. */
export type SearchHistoryOutcome =
  | { readonly ok: true; readonly history: SearchHistory }
  | { readonly ok: false; readonly errors: readonly SearchHistoryError[] };

function candidateErrors(
  candidate: unknown,
  trialId: string,
): SearchHistoryError[] {
  if (!isRecordLike(candidate)) {
    return [
      {
        code: "blank-candidate-id",
        message: `trial ${JSON.stringify(trialId)} carries no candidate descriptor — the candidate is typed data`,
      },
    ];
  }
  const errors: SearchHistoryError[] = [];
  if (String(candidate.candidateId ?? "").trim().length === 0) {
    errors.push({
      code: "blank-candidate-id",
      message: `trial ${JSON.stringify(trialId)} carries a blank candidate id — a candidate's identity is explicit data, never an anonymous default`,
    });
  }
  if (!isSearchCandidateKind(candidate.kind)) {
    errors.push({
      code: "unknown-candidate-kind",
      message: `trial ${JSON.stringify(trialId)} carries candidate kind ${JSON.stringify(String(candidate.kind))}, outside the closed vocabulary (hyperparameter | config)`,
    });
  }
  const parameters = candidate.parameters;
  if (!Array.isArray(parameters)) {
    errors.push({
      code: "malformed-candidate",
      message: `trial ${JSON.stringify(trialId)} carries a candidate whose parameters are not an array — parameters are named data`,
    });
    return errors;
  }
  const seen = new Set<string>();
  for (const parameter of parameters) {
    const name = String((parameter as { name?: unknown })?.name ?? "");
    if (name.trim().length === 0) {
      errors.push({
        code: "blank-parameter-name",
        message: `trial ${JSON.stringify(trialId)} carries a nameless candidate parameter — parameters are named data`,
      });
      continue;
    }
    if (seen.has(name)) {
      errors.push({
        code: "duplicate-parameter-name",
        message: `the candidate parameter ${JSON.stringify(name)} is declared twice — one name, one declaration, deterministic data (A9)`,
      });
    }
    seen.add(name);
  }
  return errors;
}

function outcomeErrors(
  outcome: unknown,
  trialId: string,
): SearchHistoryError[] {
  if (!isRecordLike(outcome) || !isRecordLike(outcome.provenance)) {
    return [
      {
        code: "blank-outcome-member",
        message: `trial ${JSON.stringify(trialId)} carries no outcome citation — the outcome is carried data (episode + batch + provenance), never invented`,
      },
    ];
  }
  const errors: SearchHistoryError[] = [];
  const provenance = outcome.provenance as unknown as EpisodeProvenance;
  if (
    String(outcome.episodeId ?? "").trim().length === 0 ||
    String(outcome.batchId ?? "").trim().length === 0 ||
    blankEpisodeProvenanceMembers(provenance).length > 0
  ) {
    errors.push({
      code: "blank-outcome-member",
      message: `trial ${JSON.stringify(trialId)} carries a blank outcome citation — episodes, batches and provenance members are cited by OPAQUE id, never blank`,
    });
  }
  if (
    String(outcome.episodeId ?? "").trim().length > 0 &&
    blankEpisodeProvenanceMembers(provenance).length === 0 &&
    episodeIdOf(provenance) !== outcome.episodeId
  ) {
    errors.push({
      code: "episode-id-mismatch",
      message: `trial ${JSON.stringify(trialId)} cites episode ${JSON.stringify(String(outcome.episodeId))} which does not re-derive from its provenance (the W047 content law — recorded data is re-proven, never trusted)`,
    });
  }
  return errors;
}

/**
 * Build one search history, fail-closed. Every law is checked and every
 * violation collected (the W004/W050 pattern — the declarer sees all
 * problems, never just the first): the explicit scope; every trial's id,
 * candidate descriptor, SEALED view (re-proven through W050's own
 * `validatePointInTimeView` with the firewall errors carried verbatim),
 * scope coherence (every dataset access is scoped to the search's own
 * identity) and outcome citation (the W047 episode id re-derived); every
 * selection decision's identity, resolvable evidence, chosen-trial
 * citation, and the R016 carry (nothing beyond the decision's as-of). On
 * success the record is canonicalized (trials by trial id, selections by
 * decision id, parameters and evidence by name/id) so declaration order
 * never leaks into the content-addressed history id (A9).
 */
export function buildSearchHistory(input: SearchHistoryInput): SearchHistoryOutcome {
  const errors: SearchHistoryError[] = [];
  if (!isRecordLike(input) || !isRecordLike(input.scope)) {
    return {
      ok: false,
      errors: [
        {
          code: "blank-scope-member",
          message: "the search scope is not typed data — tenantId, projectId, worldId, experimentId are required",
        },
      ],
    };
  }
  const scope = input.scope as unknown as SearchScope;
  for (const member of blankSearchScopeMembers(scope)) {
    errors.push({
      code: "blank-scope-member",
      message: `scope member ${String(member)} is blank — the scope must be explicit`,
    });
  }
  if (!Array.isArray(input.trials)) {
    return {
      ok: false,
      errors: [
        ...errors,
        {
          code: "empty-trial-set",
          message: "trials is not an array — the declared trials are required data",
        },
      ],
    };
  }
  if (input.trials.length === 0) {
    errors.push({
      code: "empty-trial-set",
      message: "no declared trials — a search history over nothing is never silently built (§13 search-history integrity)",
    });
  }
  const seenTrialIds = new Set<string>();
  for (const trial of input.trials) {
    const trialId = String((trial as { trialId?: unknown })?.trialId ?? "");
    if (trialId.trim().length === 0) {
      errors.push({
        code: "blank-trial-id",
        message: "a trial carries a blank id — every trial's identity is explicit data",
      });
      continue;
    }
    if (seenTrialIds.has(trialId)) {
      errors.push({
        code: "duplicate-trial-id",
        message: `trial ${JSON.stringify(trialId)} is declared twice — one trial, one id (deterministic records, A9)`,
      });
      continue;
    }
    seenTrialIds.add(trialId);
    errors.push(...candidateErrors((trial as { candidate?: unknown })?.candidate, trialId));
    errors.push(...outcomeErrors((trial as { outcome?: unknown })?.outcome, trialId));
    const view = (trial as { view?: unknown })?.view;
    if (!isRecordLike(view)) {
      errors.push({
        code: "invalid-view",
        message: `trial ${JSON.stringify(trialId)} carries no sealed point-in-time view — every dataset access in a search history cites a sealed view (R016)`,
      });
      continue;
    }
    const viewValidation = validatePointInTimeView(view as unknown as PointInTimeView);
    if (!viewValidation.ok) {
      errors.push({
        code: "invalid-view",
        message: `trial ${JSON.stringify(trialId)} carries a sealed view that failed the W050 firewall re-proof (${String(viewValidation.errors.length)} error(s), first: ${String(viewValidation.errors[0]?.code ?? "none")}) — the search record never carries an unlawful view (R016)`,
        viewErrors: viewValidation.errors,
      });
    } else {
      const viewScope = (view as unknown as { query?: { scope?: TimeMachineScope } }).query?.scope;
      if (
        !isRecordLike(viewScope) ||
        String(viewScope.tenantId) !== String(scope.tenantId) ||
        String(viewScope.projectId) !== String(scope.projectId) ||
        String(viewScope.worldId) !== String(scope.worldId)
      ) {
        errors.push({
          code: "scope-view-mismatch",
          message: `trial ${JSON.stringify(trialId)} consults a view scoped outside the search's own tenant/project/world — every dataset access in the record shares the search's identity`,
        });
      }
    }
  }
  const trialsById = new Map(
    input.trials.map((trial) => [
      String((trial as { trialId?: unknown }).trialId ?? ""),
      trial,
    ] as const),
  );
  const viewIdByTrialId = new Map(
    input.trials.map((trial) => [
      String((trial as { trialId?: unknown }).trialId ?? ""),
      String(((trial as { view?: unknown }).view as { viewId?: unknown } | undefined)?.viewId ?? ""),
    ] as const),
  );
  const resolvedViewIds = new Set(
    input.trials.map(
      (trial) =>
        String(
          ((trial as { view?: unknown }).view as { viewId?: unknown } | undefined)?.viewId ?? "",
        ),
    ),
  );
  const selections = Array.isArray(input.selections) ? input.selections : [];
  if (!Array.isArray(input.selections)) {
    errors.push({
      code: "malformed-decision",
      message: "selections is not an array — the selection decisions are required data",
    });
  }
  const seenDecisionIds = new Set<string>();
  for (const selection of selections) {
    if (!isRecordLike(selection)) {
      errors.push({
        code: "malformed-decision",
        message: "a selection decision is not typed data — decisions are declared, never defaulted",
      });
      continue;
    }
    const decisionId = String(selection.decisionId ?? "");
    if (decisionId.trim().length === 0) {
      errors.push({
        code: "blank-decision-id",
        message: "a selection decision carries a blank id — every decision's identity is explicit data",
      });
      continue;
    }
    if (seenDecisionIds.has(decisionId)) {
      errors.push({
        code: "duplicate-decision-id",
        message: `selection decision ${JSON.stringify(decisionId)} is declared twice — one decision, one id (deterministic records, A9)`,
      });
      continue;
    }
    seenDecisionIds.add(decisionId);
    const chosenTrialId = String(selection.chosenTrialId ?? "");
    if (!trialsById.has(chosenTrialId)) {
      errors.push({
        code: "unknown-chosen-trial",
        message: `selection decision ${JSON.stringify(decisionId)} chooses trial ${JSON.stringify(chosenTrialId)}, which the record does not carry — a selection chooses among the declared trials`,
      });
    }
    const asOf = selection.decidedAsOf as unknown as number;
    if (!isLegalCutoff(asOf)) {
      errors.push({
        code: "illegal-as-of",
        message: `selection decision ${JSON.stringify(decisionId)} declares an as-of point ${String(selection.decidedAsOf)} that is not a finite non-negative integer (simulation axis)`,
      });
    }
    const cited = selection.citedEvidence;
    if (!Array.isArray(cited) || cited.length === 0) {
      errors.push({
        code: "uncited-selection",
        message: `selection decision ${JSON.stringify(decisionId)} cites no evidence — WHICH sealed view the selection consulted is the record's whole point (§13 search-history integrity)`,
      });
      continue;
    }
    const citedSet = new Set(cited.map((id) => String(id)));
    for (const evidence of cited) {
      if (!resolvedViewIds.has(String(evidence))) {
        errors.push({
          code: "unresolved-evidence",
          message: `selection decision ${JSON.stringify(decisionId)} cites evidence ${JSON.stringify(String(evidence))}, which resolves to no trial's sealed view in the record — selection evidence must trace to the trials it selected among (§13)`,
        });
      }
    }
    const chosenViewId = viewIdByTrialId.get(chosenTrialId) ?? "";
    if (chosenViewId !== "" && !citedSet.has(chosenViewId)) {
      errors.push({
        code: "chosen-trial-not-cited",
        message: `selection decision ${JSON.stringify(decisionId)} chooses trial ${JSON.stringify(chosenTrialId)} whose sealed view is not among the cited evidence — a selection never chooses a candidate whose own evaluation it did not consult (§13)`,
      });
    }
    if (isLegalCutoff(asOf)) {
      for (const trial of input.trials) {
        const view = (trial as { view?: unknown }).view as
          | { viewId?: unknown; query?: { cutoff?: unknown } }
          | undefined;
        if (
          view !== undefined &&
          citedSet.has(String(view.viewId)) &&
          Number(view.query?.cutoff) > asOf
        ) {
          errors.push({
            code: "post-cutoff-consult",
            message: `selection decision ${JSON.stringify(decisionId)} cites sealed view ${JSON.stringify(String(view.viewId))} whose cutoff ${String(view.query?.cutoff)} is after the decision's declared as-of ${String(asOf)} — a selection consulting anything the R016 firewall would withhold at its own point in time is refused (R016, the runtime point-in-time information firewall)`,
          });
        }
      }
    }
  }
  const lineageInput = input.lineage;
  if (lineageInput !== undefined && !isRecordLike(lineageInput)) {
    errors.push({
      code: "invalid-lineage",
      message: "the declared lineage is not typed data — lineage is immutable data",
    });
  }
  if (
    isRecordLike(lineageInput) &&
    lineageInput.parent !== undefined &&
    (String(lineageInput.root ?? "").trim().length === 0 ||
      !Number.isInteger(lineageInput.ordinal) ||
      (lineageInput.ordinal as number) < 1)
  ) {
    errors.push({
      code: "invalid-lineage",
      message: "the branch lineage is invalid (blank root, or ordinal < 1) — search lineage is immutable",
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const canonicalTrials = [...input.trials]
    .map((trial) => ({
      ...trial,
      candidate: {
        ...trial.candidate,
        parameters: [...trial.candidate.parameters].sort(
          (left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
        ),
      },
    }))
    .sort((left, right) => (left.trialId < right.trialId ? -1 : left.trialId > right.trialId ? 1 : 0));
  const canonicalSelections = [...selections]
    .map((selection) => ({
      ...selection,
      citedEvidence: [...selection.citedEvidence].sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    }))
    .sort((left, right) =>
      left.decisionId < right.decisionId ? -1 : left.decisionId > right.decisionId ? 1 : 0,
    );
  const historyId = searchHistoryIdOf(scope, canonicalTrials, canonicalSelections);
  const declaredParent = isRecordLike(lineageInput)
    ? (lineageInput.parent as SearchHistoryId | undefined)
    : undefined;
  const lineage: SearchHistoryLineage = isRecordLike(lineageInput)
    ? {
        parent: declaredParent,
        root: (declaredParent === undefined
          ? historyId
          : (lineageInput.root as SearchHistoryId)) as SearchHistoryId,
        ordinal: declaredParent === undefined ? 0 : (lineageInput.ordinal as number),
      }
    : { parent: undefined, root: historyId, ordinal: 0 };
  if (lineage.parent === historyId) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid-lineage",
          message: "a search history's parent is never itself — lineage is immutable",
        },
      ],
    };
  }
  const history: SearchHistory = Object.freeze({
    historyId,
    scope: Object.freeze({ ...scope }),
    trials: Object.freeze(canonicalTrials),
    selections: Object.freeze(canonicalSelections),
    lineage: Object.freeze({ ...lineage }),
  });
  return { ok: true, history };
}
