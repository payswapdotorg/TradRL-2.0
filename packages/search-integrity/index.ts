/**
 * Public surface of the W051 `search-integrity` package — the
 * search-history CONTRACT.
 *
 * Modules (the package.json exports map is the authority):
 * - `./history.js` — the SearchHistory record as typed DATA (the scope,
 *   the candidate descriptor vocabulary, the trial, the selection
 *   decision, the immutable lineage, the content-addressed `search-<digest>`
 *   id, and the typed error family);
 * - `./build.js` — THE CONSTRUCTION GATE (`buildSearchHistory`): every law
 *   enforced at the seam, W050 view re-proof errors carried verbatim,
 *   R016 carried (nothing beyond a decision's as-of ever enters the
 *   record), canonicalized so declaration order never leaks (A9);
 * - `./integrity.js` — THE GATES (`checkSearchIntegrity`): the §13
 *   declaration audit — undeclared trials are loud typed violations,
 *   selection evidence is re-traced to declared trials, verdicts are
 *   W038-shaped findings fed through verification's own report machinery;
 * - `./overfit.js` — the carried-statistics surface (trial counts, the
 *   selection funnel, redundancy — deterministic projections of the
 *   record, never invented, never re-scored);
 * - `./validate.js` — whole-record re-validation (the record rebuilt from
 *   its own carried data must reproduce it exactly: same id, same
 *   canonical orders, same canonical bytes).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export {
  SEARCH_CANDIDATE_KINDS,
  SEARCH_HISTORY_ID_PREFIX,
  SEARCH_SCOPE_MEMBERS,
  blankSearchScopeMembers,
  isRecordLike,
  isSearchCandidateKind,
  searchHistoryIdOf,
  type SearchCandidateDescriptor,
  type SearchCandidateKind,
  type SearchHistory,
  type SearchHistoryError,
  type SearchHistoryErrorCode,
  type SearchHistoryId,
  type SearchHistoryLineage,
  type SearchHistoryLineageInput,
  type SearchParameter,
  type SearchScope,
  type SearchTrial,
  type SelectionDecision,
  type TrialOutcomeReference,
} from "./history.js";
export {
  buildSearchHistory,
  type SearchHistoryInput,
  type SearchHistoryOutcome,
} from "./build.js";
export {
  SEARCH_HISTORY_EVIDENCE_NEEDLES,
  SEARCH_HISTORY_INTEGRITY_LAW,
  checkSearchIntegrity,
  searchIntegrityClaimDescriptor,
  type SearchIntegrityClaim,
  type SearchIntegrityReport,
  type SearchIntegrityViolation,
  type SearchIntegrityViolationCode,
} from "./integrity.js";
export {
  SELECTION_FUNNEL_STAGE_KINDS,
  searchOverfitStatisticsOf,
  type SearchOverfitStatistics,
  type SearchOverfitStatisticsOutcome,
  type SearchRedundancy,
  type SelectionFunnelStage,
  type SelectionFunnelStageKind,
} from "./overfit.js";
export {
  validateSearchHistory,
  type SearchHistoryValidation,
} from "./validate.js";
