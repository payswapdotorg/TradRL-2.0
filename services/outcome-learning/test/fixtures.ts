/**
 * Shared deterministic fixtures for the outcome-learning tests (W053).
 *
 * Every builder constructs the REAL shapes through the REAL seams (the
 * no-shim law): the split family through W052's own `buildSplitFamily`
 * gate; the completed evaluation through W038's own `evaluateExperiment`
 * walker + `verifyExperimentEvaluation` harness over a REAL experiment
 * (W037 `createExperiment` + `experimentManifestOf`) whose manifest
 * carries the family's own generated splits and whose policy declares the
 * family's fold axes; the search history through W051's own
 * `buildSearchHistory` over the REAL W051 test fixtures (the W050 sealed
 * views); the post-mortem through THIS package's own gate. Zero fixture
 * drift; only opaque-id leaf values are cast.
 */

import { evaluateExperiment } from "evaluation";
import type { ExperimentEvaluation } from "evaluation";
import { verifyExperimentEvaluation } from "verification";
import type { FindingsReport } from "verification";
import { buildSplitFamily } from "evaluation-splits";
import type { SplitFamily, SplitTimestampMs } from "evaluation-splits";
import { buildSearchHistory } from "search-integrity";
import type { SearchHistory } from "search-integrity";
import { createExperiment, experimentManifestOf } from "experiments";
import type { ExperimentDescriptor } from "experiments";
import { trajectoryIdOf } from "trajectory";
import { recordOf } from "../../../packages/evaluation/test/fixtures.js";
import { TRIAL_A, TRIAL_B, SELECTION_MAIN } from "../../../packages/search-integrity/test/fixtures.js";
import { MINUTE, PROJECT, T0, TENANT, WORLD } from "../../../packages/tradrl-time-machine/test/fixtures.js";
import { deriveLessons, derivePostMortem } from "../index.js";
import type { LessonSet, PostMortem } from "../index.js";

/** The family/history scope (the W050 fixture identity — the views' own). */
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };

export const DAY = 24 * 60 * MINUTE;

/** A clean ten-day walk-forward range: 2-day train, 1-day evaluation → 8 folds. */
const WF_FROM = T0 as SplitTimestampMs;
const WF_TO = (T0 + 10 * DAY - 1) as SplitTimestampMs;

function aFamilyOrThrow(): SplitFamily {
  const outcome = buildSplitFamily({
    scope: SCOPE,
    kind: "walk-forward",
    range: { from: WF_FROM, to: WF_TO },
    policy: {
      kind: "walk-forward",
      axisId: "axis-wf",
      trainWindowMs: 2 * DAY,
      evaluationWindowMs: DAY,
    },
  });
  if (!outcome.ok) {
    throw new Error(`fixture family failed to build: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.family;
}

export function aFamily(): SplitFamily {
  return aFamilyOrThrow();
}

const SOFT_CONSTRAINTS = {
  programId: "cp-soft",
  constraints: [
    { constraintId: "eb-1", kind: "exposure-budget", maxGrossExposureFraction: 0.001, penalty: { shape: "linear", coefficient: 10 } },
    { constraintId: "tb-1", kind: "turnover-budget", maxCommandsPerView: 0, penalty: { shape: "linear", coefficient: 2 } },
    { constraintId: "de-1", kind: "drawdown-envelope", maxDrawdownFraction: 0.001, penalty: { shape: "linear", coefficient: 1 } },
  ],
} as const;

const REWARD_MODEL = {
  modelId: "model-fixture",
  version: "1",
  components: [
    { kind: "realized-pnl", weight: 1, scale: 1000 },
    { kind: "drawdown-control", weight: 1, scale: 1000 },
  ],
} as const;

function descriptorOf(family: SplitFamily, hard: boolean): ExperimentDescriptor {
  return {
    name: "exp-w053-post-mortem",
    tenantId: "tenant-1",
    projectId: "project-1",
    world: { worldId: "world-alpha", definitionDigest: "defdigest-fixture-1" },
    participants: [
      { possessionId: "possession-1", bodyId: "body-1", substrateId: "substrate-fixture" },
    ],
    rewardModel: REWARD_MODEL,
    constraints: hard
      ? {
          programId: "cp-hard",
          constraints: [
            ...SOFT_CONSTRAINTS.constraints,
            { constraintId: "vp-1", kind: "venue-policy", allowedOrderKinds: ["limit"] },
          ],
        }
      : SOFT_CONSTRAINTS,
    policy: {
      policyId: hard ? "pol-w053-hard" : "pol-w053-soft",
      rewardModelId: "model-fixture",
      rewardModelVersion: "1",
      constraintProgramId: hard ? "cp-hard" : "cp-soft",
      penalizedConstraintIds: ["eb-1"],
      penaltyWeight: 0.5,
      axes: {
        holdouts: family.splits.map((split) => ({ axisId: split.axisId, kind: split.kind })),
        stresses: [{ axisId: "s-1", kind: "execution" }],
        ablations: [],
        integrity: ["evidence-chain", "deterministic-replay"],
      },
    } as never,
  };
}

/** The completed-outcome fixture: family + evaluation + findings + history. */
export interface OutcomeFixture {
  readonly family: SplitFamily;
  readonly evaluation: ExperimentEvaluation;
  readonly findings: FindingsReport;
  readonly history: SearchHistory;
}

function anOutcome(hard: boolean): OutcomeFixture {
  const family = aFamily();
  const experiment = createExperiment(descriptorOf(family, hard));
  if (!experiment.ok) {
    throw new Error(`fixture experiment failed construction: ${experiment.errors.map((error) => error.message).join("; ")}`);
  }
  const policy = experiment.experiment.policy;
  const experimentId = String(experiment.experiment.experimentId);
  const scopeOf = (sessionId: string) => ({
    tenantId: "tenant-1",
    projectId: "project-1",
    worldId: "world-alpha",
    experimentId,
    sessionId,
  });
  const manifest = experimentManifestOf(experiment.experiment, {
    trajectories: ["session-1", "session-2", "session-3"].map((sessionId) => {
      const scope = scopeOf(sessionId);
      return { trajectoryId: trajectoryIdOf(scope), scope };
    }),
    holdoutSplits: family.splits,
  });
  if (!manifest.ok) {
    throw new Error(`fixture manifest failed construction: ${manifest.errors.map((error) => error.message).join("; ")}`);
  }
  const records = [
    recordOf({ sessionId: "session-1", experimentId, instants: [T0 + 100, T0 + 200] }, policy),
    recordOf(
      {
        sessionId: "session-2",
        experimentId,
        instants: [T0 + 2 * DAY + 100, T0 + 2 * DAY + 500],
        ...(hard ? { orderKind: "market" as const } : {}),
      },
      policy,
    ),
    recordOf({ sessionId: "session-3", experimentId, instants: [T0 + 3 * DAY + 100] }, policy),
  ];
  const walked = evaluateExperiment({ manifest: manifest.manifest, records, policy });
  if (!walked.ok) {
    throw new Error(`fixture evaluation failed the walk: ${walked.errors.map((error) => error.message).join("; ")}`);
  }
  const findings = verifyExperimentEvaluation({
    manifest: manifest.manifest,
    records,
    policy,
    evaluation: walked.evaluation,
  });
  const history = buildSearchHistory({
    scope: { ...SCOPE, experimentId },
    trials: [TRIAL_A, TRIAL_B],
    selections: [SELECTION_MAIN],
  });
  if (!history.ok) {
    throw new Error(`fixture history failed construction: ${history.errors.map((error) => error.message).join("; ")}`);
  }
  return { family, evaluation: walked.evaluation, findings, history: history.history };
}

/** The soft bundle: three compliant trajectories across the folds. */
export function aSoftOutcome(): OutcomeFixture {
  return anOutcome(false);
}

/** The hard bundle: a market order under a limit-only venue policy on the held-out side. */
export function aHardOutcome(): OutcomeFixture {
  return anOutcome(true);
}

/** A LAWFUL family whose folds never judged this evaluation (a stranger axis). */
export function aStrangerFamily(): SplitFamily {
  const outcome = buildSplitFamily({
    scope: SCOPE,
    kind: "walk-forward",
    range: { from: WF_FROM, to: WF_TO },
    policy: {
      kind: "walk-forward",
      axisId: "axis-stranger",
      trainWindowMs: 2 * DAY,
      evaluationWindowMs: DAY,
    },
  });
  if (!outcome.ok) {
    throw new Error(`fixture stranger family failed to build: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.family;
}

/** A LAWFUL family scoped to another world (scope disagreement, legally). */
export function aForeignScopeFamily(): SplitFamily {
  const outcome = buildSplitFamily({
    scope: { ...SCOPE, worldId: "world-somewhere-else" as never },
    kind: "walk-forward",
    range: { from: WF_FROM, to: WF_TO },
    policy: {
      kind: "walk-forward",
      axisId: "axis-wf",
      trainWindowMs: 2 * DAY,
      evaluationWindowMs: DAY,
    },
  });
  if (!outcome.ok) {
    throw new Error(`fixture foreign-scope family failed to build: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.family;
}

/** A LAWFUL search history scoped to another experiment. */
export function aForeignExperimentHistory(experimentId: string): SearchHistory {
  const outcome = buildSearchHistory({
    scope: { ...SCOPE, experimentId },
    trials: [TRIAL_A, TRIAL_B],
    selections: [SELECTION_MAIN],
  });
  if (!outcome.ok) {
    throw new Error(`fixture foreign history failed to build: ${outcome.errors.map((error) => error.message).join("; ")}`);
  }
  return outcome.history;
}

export function aPostMortem(outcome: OutcomeFixture = aSoftOutcome()): PostMortem {
  const derived = derivePostMortem({
    evaluation: { evaluation: outcome.evaluation, findings: outcome.findings },
    family: outcome.family,
    history: outcome.history,
  });
  if (!derived.ok) {
    throw new Error(`fixture post-mortem failed derivation: ${derived.errors.map((error) => error.message).join("; ")}`);
  }
  return derived.postMortem;
}

export function aLessonSet(postMortem: PostMortem = aPostMortem()): LessonSet {
  const derived = deriveLessons(postMortem);
  if (!derived.ok) {
    throw new Error(`fixture lesson set failed derivation: ${derived.errors.map((error) => error.message).join("; ")}`);
  }
  return derived.lessons;
}

/** The error codes of a fail-closed outcome, for pinning refusal laws. */
export function codes(outcome: { ok: boolean; errors?: readonly { code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((error) => error.code);
}
