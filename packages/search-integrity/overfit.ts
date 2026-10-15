/**
 * The carried-statistics surface (W051) — the overfit-risk numbers,
 * projected deterministically from the RECORD.
 *
 * Spec: spec/ARCHITECTURE.md §13 — search-history integrity is not just a
 * verdict: the SHAPE of the search (how many candidates were tried, how
 * many were selected, how redundant the attempts were) is the declared
 * overfit-risk surface. THIS module computes it as pure projections of the
 * carried record — trial counts, the selection funnel (trials →
 * evidence-cited → selected, monotone by construction), and redundancy
 * measures (duplicate candidates / views / outcome citations) — never
 * invented, never re-scored (A14: the statistics count CARRIED data; they
 * never re-run a trial, never consult an outcome's content).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — every number is a pure function of
 * the record; the statistics digest is the canonical content digest over
 * the projection, so the same record always yields the same statistics,
 * deep-equal, same digest.
 *
 * Fail-closed at every seam: statistics are never computed over a record
 * that fails whole-record re-validation — a malformed record's "shape" is
 * not data, it is a refusal.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import type {
  SearchCandidateDescriptor,
  SearchHistory,
  SearchHistoryError,
} from "./history.js";
import { isRecordLike } from "./history.js";
import { validateSearchHistory } from "./validate.js";

// ---------------------------------------------------------------------------
// The selection funnel (the shape of the search)
// ---------------------------------------------------------------------------

/**
 * The closed funnel-stage vocabulary, in SEMANTIC order (each stage a
 * subset of the previous): every trial carried → the trials whose sealed
 * view was consulted by at least one selection decision → the trials
 * chosen by at least one selection decision. Monotone non-increasing by
 * construction (the chosen trial's own view is always among the cited
 * evidence).
 */
export type SelectionFunnelStageKind = "trials" | "evidence-cited" | "selected";

/** The funnel-stage vocabulary in semantic (funnel) order. */
export const SELECTION_FUNNEL_STAGE_KINDS: readonly SelectionFunnelStageKind[] = [
  "trials",
  "evidence-cited",
  "selected",
];

/** ONE stage of the selection funnel: which stage, how many trials. */
export interface SelectionFunnelStage {
  readonly stage: SelectionFunnelStageKind;
  readonly count: number;
}

// ---------------------------------------------------------------------------
// The redundancy measures
// ---------------------------------------------------------------------------

/**
 * The redundancy of the search, as counts over distinct canonical keys:
 * how many DISTINCT candidates / sealed views / outcome citations the
 * record carries, and how many trials beyond the first cite each
 * duplicate (two candidates evaluated on the same sealed view is the
 * classic redundant-dataset-access smell; two trials citing the same
 * outcome episode is the classic reused-evidence smell).
 */
export interface SearchRedundancy {
  readonly distinctCandidates: number;
  readonly duplicateCandidates: number;
  readonly distinctViews: number;
  readonly duplicateViews: number;
  readonly distinctOutcomes: number;
  readonly duplicateOutcomes: number;
}

// ---------------------------------------------------------------------------
// The statistics (deterministic projections of the record)
// ---------------------------------------------------------------------------

/**
 * The carried overfit-risk statistics of one search history: the trial and
 * selection counts, the selection ratio (the share of trials that ended up
 * chosen — the multiple-comparisons surface), the trials-per-selection
 * ratio (null when the record carries no selection decision), the
 * selection funnel, the redundancy measures, and the content-addressed
 * digest over the whole projection (A9).
 */
export interface SearchOverfitStatistics {
  readonly historyId: string;
  readonly trialCount: number;
  readonly selectionCount: number;
  readonly selectedTrialCount: number;
  readonly evidenceCitedTrialCount: number;
  readonly selectionRatio: number;
  readonly trialsPerSelection: number | null;
  readonly funnel: readonly SelectionFunnelStage[];
  readonly redundancy: SearchRedundancy;
  readonly digest: string;
}

/** The projection outcome: the statistics, or the refusal (fail-closed). */
export type SearchOverfitStatisticsOutcome =
  | { readonly ok: true; readonly statistics: SearchOverfitStatistics }
  | { readonly ok: false; readonly errors: readonly SearchHistoryError[] };

function candidateKey(candidate: SearchCandidateDescriptor): string {
  const parameters = [...candidate.parameters]
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .map(
      (parameter) =>
        `${parameter.name}=${typeof parameter.value === "string" ? JSON.stringify(parameter.value) : String(parameter.value)}`,
    )
    .join("&");
  return `${String(candidate.candidateId)}|${String(candidate.kind)}|${parameters}`;
}

function duplicatesOver(keys: readonly string[]): { distinct: number; duplicates: number } {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const key of keys) {
    if (seen.has(key)) {
      duplicates += 1;
    } else {
      seen.add(key);
    }
  }
  return { distinct: seen.size, duplicates };
}

/**
 * Project one search history's overfit-risk statistics. Pure and
 * deterministic (A9): every number is counted from the carried record —
 * trial counts, the funnel shape, the redundancy — never invented, never
 * re-scored. Fail-closed: a record that fails whole-record re-validation
 * is refused with its errors (statistics over malformed data are not
 * data).
 */
export function searchOverfitStatisticsOf(
  history: SearchHistory,
): SearchOverfitStatisticsOutcome {
  if (!isRecordLike(history)) {
    return {
      ok: false,
      errors: [
        {
          code: "history-id-mismatch",
          message: "history is not typed data — statistics project a sealed record, never a malformed value",
        },
      ],
    };
  }
  const validation = validateSearchHistory(history);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }
  const trials = Array.isArray(history.trials) ? history.trials : [];
  const selections = Array.isArray(history.selections) ? history.selections : [];
  const citedViewIds = new Set<string>();
  for (const selection of selections) {
    for (const evidence of selection.citedEvidence) {
      citedViewIds.add(String(evidence));
    }
  }
  const selectedTrialIds = new Set(selections.map((selection) => String(selection.chosenTrialId)));
  const evidenceCitedTrialCount = trials.filter((trial) =>
    citedViewIds.has(String(trial.view.viewId)),
  ).length;
  const selectedTrialCount = trials.filter((trial) =>
    selectedTrialIds.has(String(trial.trialId)),
  ).length;
  const trialCount = trials.length;
  const selectionCount = selections.length;
  const candidates = duplicatesOver(trials.map((trial) => candidateKey(trial.candidate)));
  const views = duplicatesOver(trials.map((trial) => String(trial.view.viewId)));
  const outcomes = duplicatesOver(trials.map((trial) => String(trial.outcome.episodeId)));
  const redundancy: SearchRedundancy = {
    distinctCandidates: candidates.distinct,
    duplicateCandidates: candidates.duplicates,
    distinctViews: views.distinct,
    duplicateViews: views.duplicates,
    distinctOutcomes: outcomes.distinct,
    duplicateOutcomes: outcomes.duplicates,
  };
  const funnel: readonly SelectionFunnelStage[] = [
    { stage: "trials", count: trialCount },
    { stage: "evidence-cited", count: evidenceCitedTrialCount },
    { stage: "selected", count: selectedTrialCount },
  ];
  const statistics: SearchOverfitStatistics = {
    historyId: String(history.historyId),
    trialCount,
    selectionCount,
    selectedTrialCount,
    evidenceCitedTrialCount,
    selectionRatio: trialCount === 0 ? 0 : selectedTrialCount / trialCount,
    trialsPerSelection: selectionCount === 0 ? null : trialCount / selectionCount,
    funnel,
    redundancy,
    digest: canonicalDigestHex({
      historyId: String(history.historyId),
      trialCount,
      selectionCount,
      selectedTrialCount,
      evidenceCitedTrialCount,
      funnel,
      redundancy,
    }),
  };
  return { ok: true, statistics: Object.freeze(statistics) };
}
