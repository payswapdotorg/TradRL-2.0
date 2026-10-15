/**
 * Shared deterministic fixtures for the search-integrity tests (W051).
 *
 * The sealed views are built through the REAL W050 contract
 * (`buildPointInTimeQuery` + `sealView`) over the REAL W050 test-fixture
 * record factories (the W041 fixture lineage, imported directly — zero
 * fixture drift), assembled ONCE at module load so every test sees the
 * same content-addressed views (A9). Trials cite those views; outcomes
 * cite W047 episode provenance with ids re-derived through W047's own
 * `episodeIdOf`.
 */

import { asPointInTimeCutoff, sealView } from "tradrl-time-machine";
import type { PointInTimeView, ViewRecord } from "tradrl-time-machine";
import { episodeIdOf } from "rl-protocol";
import type { EpisodeBatchId, EpisodeProvenance } from "rl-protocol";
import {
  MINUTE,
  PROJECT,
  T0,
  TENANT,
  WORLD,
  aMarketEvent,
  aQuery,
  aResearchRecord,
  infoViewRecord,
  marketViewRecord,
} from "../../tradrl-time-machine/test/fixtures.js";
import { buildSearchHistory } from "../index.js";
import type {
  SearchHistory,
  SearchIntegrityClaim,
  SearchTrial,
  SelectionDecision,
  TrialOutcomeReference,
} from "../index.js";
import type { ExperimentEvaluationId } from "evaluation";

export const SCOPE = {
  tenantId: TENANT,
  projectId: PROJECT,
  worldId: WORLD,
  experimentId: "exp-w051-search",
};

export { MINUTE, T0 } from "../../tradrl-time-machine/test/fixtures.js";

/** The selection decisions' shared as-of point (ten minutes past T0). */
export const AS_OF = T0 + 10 * MINUTE;

function mustSeal(
  families: readonly string[],
  cutoffMs: number,
  records: readonly ViewRecord[],
): PointInTimeView {
  const outcome = sealView(
    aQuery(families as Parameters<typeof aQuery>[0], cutoffMs),
    records,
  );
  if (!outcome.ok) {
    throw new Error(`fixture view failed to seal: ${outcome.refusal.message}`);
  }
  return outcome.view;
}

/** The early dataset view: cutoff five minutes past T0, two families. */
export const EARLY_VIEW: PointInTimeView = mustSeal(
  ["market-event", "research-report"],
  T0 + 5 * MINUTE,
  [
    marketViewRecord(aMarketEvent(T0)),
    infoViewRecord(aResearchRecord(T0 + 30_000, T0 + 90_000)),
    marketViewRecord(aMarketEvent(T0 + MINUTE)),
  ],
);

/** The late dataset view: cutoff exactly at AS_OF, market events only. */
export const LATE_VIEW: PointInTimeView = mustSeal(
  ["market-event"],
  AS_OF,
  [marketViewRecord(aMarketEvent(T0 + 7 * MINUTE))],
);

/**
 * The early view with its research record's publication/availability moved
 * AFTER the view's own cutoff — a post-cutoff record smuggled under stale
 * sealed-view ids (the tamper the W050 re-proof must catch verbatim). The
 * information record is located by shape (it carries `record`, not
 * `event`), never by index.
 */
export function tamperedEarlyView(lateMs: number): PointInTimeView {
  const records = [...(EARLY_VIEW.records as readonly unknown[])];
  const index = records.findIndex(
    (record) => (record as { record?: unknown }).record !== undefined,
  );
  if (index < 0) {
    throw new Error("fixture view carries no information record to tamper");
  }
  const original = records[index] as { record: Record<string, unknown> };
  records[index] = {
    ...original,
    record: { ...original.record, publishedAt: lateMs, availableAt: lateMs },
  };
  return { ...EARLY_VIEW, records: records as never } as unknown as PointInTimeView;
}

export function anOutcome(tag: string): TrialOutcomeReference {
  const provenance: EpisodeProvenance = {
    trajectoryId: `traj-w051-${tag}` as EpisodeProvenance["trajectoryId"],
    bindingId: `bind-w051-${tag}` as EpisodeProvenance["bindingId"],
    evaluationId: `expeval-w051-${tag}` as EpisodeProvenance["evaluationId"],
    experimentId: SCOPE.experimentId as EpisodeProvenance["experimentId"],
  };
  return {
    episodeId: episodeIdOf(provenance),
    batchId: `batch-w051-${tag}` as EpisodeBatchId,
    provenance,
  };
}

export function aTrial(
  trialId: string,
  candidateId: string,
  kind: "hyperparameter" | "config",
  parameters: readonly { name: string; value: string | number | boolean }[],
  view: PointInTimeView,
  outcomeTag: string,
): SearchTrial {
  return {
    trialId,
    candidate: { candidateId, kind, parameters },
    view,
    outcome: anOutcome(outcomeTag),
  };
}

export const TRIAL_A: SearchTrial = aTrial(
  "trial-a",
  "cand-alpha",
  "hyperparameter",
  [
    { name: "learning-rate", value: 0.001 },
    { name: "depth", value: 3 },
  ],
  EARLY_VIEW,
  "a",
);

export const TRIAL_B: SearchTrial = aTrial(
  "trial-b",
  "cand-beta",
  "config",
  [{ name: "window", value: 64 }],
  EARLY_VIEW,
  "b",
);

export const TRIAL_C: SearchTrial = aTrial(
  "trial-c",
  "cand-gamma",
  "hyperparameter",
  [
    { name: "depth", value: 3 },
    { name: "learning-rate", value: 0.01 },
  ],
  LATE_VIEW,
  "c",
);

export const SELECTION_MAIN: SelectionDecision = {
  decisionId: "decision-main",
  chosenTrialId: "trial-a",
  citedEvidence: [String(EARLY_VIEW.viewId)],
  decidedAsOf: asPointInTimeCutoff(AS_OF),
};

export const SELECTION_LATE: SelectionDecision = {
  decisionId: "decision-late",
  chosenTrialId: "trial-c",
  citedEvidence: [String(LATE_VIEW.viewId), String(EARLY_VIEW.viewId)],
  decidedAsOf: asPointInTimeCutoff(AS_OF),
};

export function aHistory(
  trials: readonly SearchTrial[] = [TRIAL_A, TRIAL_B, TRIAL_C],
  selections: readonly SelectionDecision[] = [SELECTION_MAIN, SELECTION_LATE],
): SearchHistory {
  const outcome = buildSearchHistory({
    scope: SCOPE,
    trials,
    selections,
  });
  if (!outcome.ok) {
    throw new Error(`fixture history failed to build: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.history;
}

export function aClaim(
  history: SearchHistory,
  declaredTrials: readonly string[] = ["trial-a", "trial-b", "trial-c"],
  citedEvidence: readonly string[] = [String(EARLY_VIEW.viewId)],
): SearchIntegrityClaim {
  return {
    claimId: "claim-w051-main",
    subjectEvaluationId: "expeval-w051-main" as ExperimentEvaluationId,
    historyId: history.historyId,
    declaredTrials,
    citedEvidence,
  };
}
