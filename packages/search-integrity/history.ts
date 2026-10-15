/**
 * The SearchHistory contract (W051) — the DECLARED record of everything
 * tried during a search, as typed DATA.
 *
 * The chain: W038 ships the evaluation/verification claims (§13 names the
 * search-history integrity requirement; the claim kinds + findings
 * vocabulary live in `verification`); W047 ships the episode/batch
 * provenance vocabulary; W050 ships the Time Machine (the PointInTimeQuery/
 * View + the R016 knowledge firewall). THIS package types the SEARCH RECORD
 * itself: every trial (the candidate descriptor as data + the SEALED
 * point-in-time view it consulted + the outcome citation — carried through
 * W047's vocabulary, never re-scored), the selection decisions (which
 * candidate was chosen, citing WHICH sealed evidence, as of WHEN), the
 * explicit scope, and the immutable lineage.
 *
 * Spec: spec/ARCHITECTURE.md §13 — "search-history integrity": a backtest
 * claim must cite its COMPLETE search history; an undeclared trial is a
 * LOUD typed violation (checked by ./integrity.ts against the claim's
 * declaration — the record itself declares every trial it carries).
 * Spec: spec/REQUIREMENTS.md R016 — every dataset access in a search
 * history cites a SEALED W050 view; a selection consulting anything beyond
 * its declared as-of point is refused loudly naming R016 (fail-closed HERE
 * at construction, re-proven by ./validate.ts, carried by ./integrity.ts).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the history id is the canonical
 * content digest over the scope + the trials + the selection decisions (no
 * clocks, no randomness, no env reads); declaration order NEVER leaks —
 * trials, selection decisions, candidate parameters and cited evidence are
 * canonicalized before the digest is taken, so a permuted declaration of
 * the same search yields the IDENTICAL history id.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — typed DATA only: this module never
 * executes a backtest, never scores an outcome (outcomes are citations to
 * W047 episodes, carried verbatim — carry never re-score).
 * Spec: spec/DOMAIN-MODEL.md identity laws — ids are OPAQUE (cited never
 * parsed); the scope is EXPLICIT; composite ids use CANONICAL ENCODERS.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  PointInTimeCutoff,
  PointInTimeView,
  PointInViewError,
  TimeMachineScope,
} from "tradrl-time-machine";
import type { EpisodeBatchId, EpisodeId, EpisodeProvenance } from "rl-protocol";
import { canonicalDigestHex } from "trajectory";

// ---------------------------------------------------------------------------
// The scope (explicit identity — DOMAIN-MODEL identity laws)
// ---------------------------------------------------------------------------

/**
 * The explicit identity scope every search history carries: W050's own
 * `TimeMachineScope` (tenant/project/world — every sealed view a trial
 * consults is scoped to exactly this identity) plus the experiment the
 * search ran under.
 */
export interface SearchScope extends TimeMachineScope {
  readonly experimentId: string;
}

/** The scope members, in canonical order (validation + rendering order). */
export const SEARCH_SCOPE_MEMBERS: readonly (keyof SearchScope)[] = [
  "tenantId",
  "projectId",
  "worldId",
  "experimentId",
];

/** The blank scope members (the fail-closed identity gate's offender list). */
export function blankSearchScopeMembers(
  scope: SearchScope,
): readonly (keyof SearchScope)[] {
  return SEARCH_SCOPE_MEMBERS.filter((member) => String(scope[member]).trim().length === 0);
}

// ---------------------------------------------------------------------------
// The candidate descriptor (DATA, never prose)
// ---------------------------------------------------------------------------

/**
 * The closed candidate-kind vocabulary: what kind of thing the search
 * varied — a hyperparameter candidate or a configuration candidate. One
 * closed set; additions go through a contract change.
 */
export type SearchCandidateKind = "hyperparameter" | "config";

/** The candidate-kind vocabulary in canonical (lexicographic) order. */
export const SEARCH_CANDIDATE_KINDS: readonly SearchCandidateKind[] = [
  "config",
  "hyperparameter",
];

/** Type guard: is this value one of the closed candidate kinds? */
export function isSearchCandidateKind(value: unknown): value is SearchCandidateKind {
  return (
    typeof value === "string" &&
    SEARCH_CANDIDATE_KINDS.includes(value as SearchCandidateKind)
  );
}

/** ONE named candidate parameter (deterministic DATA — the W047 pattern). */
export interface SearchParameter {
  readonly name: string;
  readonly value: string | number | boolean;
}

/**
 * The candidate descriptor of one trial: its opaque candidate id, its kind
 * (the closed vocabulary above), and its named parameters — DATA, never
 * prose, never a function. Construction canonicalizes the parameter order
 * (by name) so declaration order never leaks into the history id (A9).
 */
export interface SearchCandidateDescriptor {
  readonly candidateId: string;
  readonly kind: SearchCandidateKind;
  readonly parameters: readonly SearchParameter[];
}

// ---------------------------------------------------------------------------
// The outcome citation (carried verbatim — never re-scored)
// ---------------------------------------------------------------------------

/**
 * The outcome of one trial, CARRIED as a citation through W047's own
 * vocabulary: the episode that evaluated the candidate, the batch it
 * joined, and the full episode provenance (trajectory/binding/evaluation/
 * experiment — the W047 triple plus the experiment). A citation is OPAQUE:
 * the search record never re-opens, re-runs, or re-scores the outcome
 * (A14: carry never re-score). The episode id MUST re-derive from the
 * provenance through W047's own `episodeIdOf` (the W047 content law,
 * re-proven at every seam here).
 */
export interface TrialOutcomeReference {
  readonly episodeId: EpisodeId;
  readonly batchId: EpisodeBatchId;
  readonly provenance: EpisodeProvenance;
}

// ---------------------------------------------------------------------------
// The trial + the selection decision (typed DATA)
// ---------------------------------------------------------------------------

/**
 * ONE thing tried during the search: the candidate descriptor (what was
 * varied, as data), the SEALED W050 point-in-time view the trial consulted
 * (the dataset access — structurally unable to reference anything recorded
 * after its cutoff, R016), and the outcome citation (carried, never
 * re-scored).
 */
export interface SearchTrial {
  readonly trialId: string;
  readonly candidate: SearchCandidateDescriptor;
  readonly view: PointInTimeView;
  readonly outcome: TrialOutcomeReference;
}

/**
 * ONE selection decision: which trial's candidate was chosen, citing WHICH
 * sealed evidence (the view ids consulted at decision time — opaque W050
 * view ids), as of WHEN (the decision's own declared cutoff, the point in
 * world time at which the selection was made). The cited views must be
 * sealed with cutoffs ≤ `decidedAsOf`: a selection consulting anything the
 * R016 firewall would withhold at its own point in time is refused loudly
 * (naming R016). The chosen trial's own view must be among the cited
 * evidence — a selection never chooses a candidate whose own evaluation it
 * did not consult.
 */
export interface SelectionDecision {
  readonly decisionId: string;
  readonly chosenTrialId: string;
  readonly citedEvidence: readonly string[];
  readonly decidedAsOf: PointInTimeCutoff;
}

// ---------------------------------------------------------------------------
// The immutable lineage + the history id (content-addressed — A9)
// ---------------------------------------------------------------------------

declare const searchHistoryIdBrand: unique symbol;

/**
 * An OPAQUE search-history id (a canonical digest rendering). Produced only
 * by {@link searchHistoryIdOf}; never parsed — the scope, trials and
 * selections are carried on the record itself, never recovered by splitting
 * the id.
 */
export type SearchHistoryId = string & {
  readonly [searchHistoryIdBrand]: true;
};

/** The id prefix (a rendering convention, never a parse target). */
export const SEARCH_HISTORY_ID_PREFIX = "search-";

/**
 * The immutable search lineage (the W037 branch-lineage pattern): a search
 * history never branches on its own — a CONTINUATION declares its parent,
 * and the chain's root + ordinal are carried verbatim.
 */
export interface SearchHistoryLineage {
  readonly parent: SearchHistoryId | undefined;
  readonly root: SearchHistoryId;
  readonly ordinal: number;
}

/** The declared lineage at construction (a root search omits it entirely). */
export interface SearchHistoryLineageInput {
  readonly parent?: SearchHistoryId;
  readonly root?: SearchHistoryId;
  readonly ordinal?: number;
}

/**
 * The history id: the canonical content digest over the scope, the trials
 * (candidate + the W050 view id — W050's own content address of the whole
 * sealed view, so citing it cites the view's full content — + the outcome
 * citation) and the selection decisions. Pure and deterministic (A9): the
 * same declared search always yields the same id, and any byte of declared
 * content flips it. The lineage rides BESIDE the id (the W037 precedent:
 * the trajectory id addresses the scope; the lineage records the chain
 * position), so a root's lineage can cite its own id without circularity.
 */
export function searchHistoryIdOf(
  scope: SearchScope,
  trials: readonly SearchTrial[],
  selections: readonly SelectionDecision[],
): SearchHistoryId {
  const digest = canonicalDigestHex({
    scope: {
      experimentId: scope.experimentId,
      projectId: scope.projectId,
      tenantId: scope.tenantId,
      worldId: scope.worldId,
    },
    trials: trials.map((trial) => ({
      trialId: trial.trialId,
      candidate: {
        candidateId: trial.candidate.candidateId,
        kind: trial.candidate.kind,
        parameters: trial.candidate.parameters.map((parameter) => [
          parameter.name,
          parameter.value,
        ]),
      },
      viewId: String(trial.view.viewId),
      outcome: {
        episodeId: String(trial.outcome.episodeId),
        batchId: String(trial.outcome.batchId),
        provenance: {
          trajectoryId: String(trial.outcome.provenance.trajectoryId),
          bindingId: String(trial.outcome.provenance.bindingId),
          evaluationId: String(trial.outcome.provenance.evaluationId),
          experimentId: String(trial.outcome.provenance.experimentId),
        },
      },
    })),
    selections: selections.map((selection) => ({
      decisionId: selection.decisionId,
      chosenTrialId: selection.chosenTrialId,
      citedEvidence: [...selection.citedEvidence],
      decidedAsOf: selection.decidedAsOf,
    })),
  });
  return `${SEARCH_HISTORY_ID_PREFIX}${digest}` as SearchHistoryId;
}

// ---------------------------------------------------------------------------
// The search history (typed DATA)
// ---------------------------------------------------------------------------

/**
 * The DECLARED record of everything tried during one search: the
 * content-addressed id, the explicit scope, EVERY trial (canonical order:
 * trial id, lexicographic — declaration order never leaks), the selection
 * decisions (canonical order: decision id), and the immutable lineage.
 */
export interface SearchHistory {
  readonly historyId: SearchHistoryId;
  readonly scope: SearchScope;
  readonly trials: readonly SearchTrial[];
  readonly selections: readonly SelectionDecision[];
  readonly lineage: SearchHistoryLineage;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

/** Everything that can be wrong with a search history declaration. */
export type SearchHistoryErrorCode =
  | "blank-scope-member" // the identity scope is not explicit
  | "empty-trial-set" // no trials: a search over nothing is never silently built
  | "blank-trial-id" // a trial carries a blank id
  | "duplicate-trial-id" // one trial, one id (deterministic records, A9)
  | "blank-candidate-id" // a candidate descriptor has no identity
  | "malformed-candidate" // a candidate descriptor is not typed data
  | "unknown-candidate-kind" // a candidate kind outside the closed vocabulary
  | "blank-parameter-name" // a candidate parameter is nameless
  | "duplicate-parameter-name" // one parameter name, one declaration
  | "invalid-view" // the trial's view failed the W050 firewall re-proof (errors verbatim)
  | "scope-view-mismatch" // the view's scope is not the search's scope
  | "blank-outcome-member" // an outcome citation is blank / malformed
  | "episode-id-mismatch" // the episode id does not re-derive from the provenance (W047 law)
  | "malformed-decision" // a selection decision is not typed data
  | "blank-decision-id" // a selection decision has no identity
  | "duplicate-decision-id" // one decision, one id
  | "unknown-chosen-trial" // the chosen trial is not carried by the record
  | "uncited-selection" // a selection citing no evidence (§13 — never silently built)
  | "unresolved-evidence" // cited evidence resolves to no trial's sealed view
  | "chosen-trial-not-cited" // the chosen trial's own view is not among the cited evidence
  | "post-cutoff-consult" // THE R016 CARRY: evidence consulted beyond the decision's as-of
  | "illegal-as-of" // the decision's as-of is not a legal simulation-axis cutoff
  | "trials-not-canonical" // the trials are not in canonical (trial id) order
  | "selections-not-canonical" // the selection decisions are not in canonical (decision id) order
  | "invalid-lineage" // a branch-lineage law was violated (named in the message)
  | "history-id-mismatch"; // whole-record re-proof: the id does not re-derive

/** One typed search-history error (fail-closed). */
export interface SearchHistoryError {
  readonly code: SearchHistoryErrorCode;
  readonly message: string;
  /** `invalid-view` only: the W050 re-proof errors, carried VERBATIM. */
  readonly viewErrors?: readonly PointInViewError[];
}

/**
 * Structural probe shared by the construction gate (`./build.ts`) and the
 * whole-record re-validation (`./validate.ts`): is this value an object a
 * typed record could be carried in? (Arrays are records' containers, never
 * records themselves.)
 */
export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
