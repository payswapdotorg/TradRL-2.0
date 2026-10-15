/**
 * The typed lesson derivation (W053) — the LEARNED surface of one
 * post-mortem, as typed DATA.
 *
 * A lesson is CARRIED STATISTICS: every number, verdict and statement
 * derives deterministically from the post-mortem's own carried data (the
 * evaluation's own outcome summaries, the findings verdict counts, the
 * search history's own trial/selection counts) — never invented, never
 * re-scored (A14: the lessons project the record; they never re-run a
 * trial, never recompute an outcome, never train anything — training and
 * improvement are W055's job; the firm brain is W054's).
 *
 * The closed LESSON KIND set: `failure-mode` (the closed failure taxonomy —
 * constraint violations on the happened side, held-out degradation,
 * verification failures, unassigned membership, selection pressure),
 * `capability-delta` (per judged axis: the carried per-side statistics and
 * their delta), and `divergence-signal` (per judged axis: the held-out-vs-
 * train divergence direction and magnitude). Lessons are canonical-id
 * ordered (the content-addressed `lesson-<digest>` id, code-unit order).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — evidence-linked truth: EVERY lesson
 * cites its carried evidence (deterministic, ordered, evidence-linked
 * lines, each naming its record); an uncited lesson is a loud typed
 * refusal, and a lesson set over a post-mortem that fails whole-record
 * re-validation is refused loudly naming A6 + R052.
 * Spec: spec/REQUIREMENTS.md R052 — the outcome/post-mortem learning
 * requirement: lessons are derived from CARRIED outcomes.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: same post-mortem ⇒
 * deep-equal lesson set, same digest; no clocks, no randomness, no env
 * reads.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import {
  EVIDENCE_LINKED_TRUTH_LAW,
  OUTCOME_LEARNING_REQUIREMENT_LAW,
} from "./postmortem.js";
import type { JudgedSplitComparison, PostMortem, PostMortemId } from "./postmortem.js";
import { validatePostMortem } from "./validate.js";
import { compareCodeUnits } from "evaluation-splits";

// ---------------------------------------------------------------------------
// The lesson vocabulary (closed sets)
// ---------------------------------------------------------------------------

/**
 * The closed failure-mode taxonomy (W053's own): what a completed outcome
 * can teach about FAILURE, derived only from carried data — hard
 * constraint violations or non-compliance on the happened side, held-out
 * degradation vs the train side, FAIL verdicts in the verification
 * findings, records the evaluation itself could not place on a side, and
 * selection pressure in the search that produced the outcome (more trials
 * tried than selected — the multiple-comparisons surface).
 */
export type FailureMode =
  | "constraint-violation"
  | "heldout-degradation"
  | "selection-pressure"
  | "unassigned-membership"
  | "verification-failure";

/** The failure-mode taxonomy in canonical code-unit order. */
export const FAILURE_MODES: readonly FailureMode[] = [
  "constraint-violation",
  "heldout-degradation",
  "selection-pressure",
  "unassigned-membership",
  "verification-failure",
];

/** The closed lesson-kind set. */
export type LessonKind = "failure-mode" | "capability-delta" | "divergence-signal";

/** The lesson-kind vocabulary in canonical code-unit order. */
export const LESSON_KINDS: readonly LessonKind[] = [
  "capability-delta",
  "divergence-signal",
  "failure-mode",
];

// ---------------------------------------------------------------------------
// The lesson + the lesson set (typed DATA)
// ---------------------------------------------------------------------------

declare const lessonIdBrand: unique symbol;

/**
 * An OPAQUE lesson id (a canonical digest rendering). Produced only by the
 * deriver; never parsed — the lesson's own content is carried on the
 * record.
 */
export type LessonId = string & {
  readonly [lessonIdBrand]: true;
};

/** The id prefix (a rendering convention, never a parse target). */
export const LESSON_ID_PREFIX = "lesson-";

/**
 * ONE typed lesson: its kind (the closed set), its failure mode (failure
 * lessons only), the judged axis it belongs to (axis-scoped lessons only),
 * the A6 evidence lines (every lesson cites its carried evidence — each
 * line names the record it came from), and the deterministic statement
 * (rendered from carried data, never prose).
 */
export interface Lesson {
  readonly lessonId: LessonId;
  readonly postMortemId: PostMortemId;
  readonly kind: LessonKind;
  readonly failureMode?: FailureMode;
  readonly axisId?: string;
  readonly evidence: readonly string[];
  readonly statement: string;
}

/**
 * The lesson set of one post-mortem: every derived lesson in canonical
 * lesson-id order (code-unit — declaration order never leaks, A9), plus
 * the content-addressed digest over the ordered projection.
 */
export interface LessonSet {
  readonly postMortemId: PostMortemId;
  readonly lessons: readonly Lesson[];
  readonly digest: string;
}

/** Everything the lesson derivation can refuse. */
export type LessonErrorCode =
  | "invalid-post-mortem" // whole-record re-validation failed — no carried evidence linkage
  | "uncited-lesson"; // a lesson with no evidence lines (A6, defensive depth)

/** One typed lesson error (fail-closed; the law named in the message). */
export interface LessonError {
  readonly code: LessonErrorCode;
  readonly message: string;
  readonly entryId?: string;
}

/** The derivation outcome: the lesson set, or the refusal. */
export type LessonSetOutcome =
  | { readonly ok: true; readonly lessons: LessonSet }
  | { readonly ok: false; readonly errors: readonly LessonError[] };

// ---------------------------------------------------------------------------
// The carried statistics (pure projections of the record)
// ---------------------------------------------------------------------------

/** The mean of the carried combined scores, or null over an empty side. */
function meanCombinedScore(summaries: readonly { combinedScore: number }[]): number | null {
  if (summaries.length === 0) {
    return null;
  }
  let total = 0;
  for (const summary of summaries) {
    total += summary.combinedScore;
  }
  return total / summaries.length;
}

function render(value: number | null): string {
  return value === null ? "none" : String(value);
}

// ---------------------------------------------------------------------------
// The lesson builders (every lesson cites its carried evidence — A6)
// ---------------------------------------------------------------------------

function sealLesson(
  postMortemId: PostMortemId,
  kind: LessonKind,
  failureMode: FailureMode | undefined,
  axisId: string | undefined,
  evidence: readonly string[],
  statement: string,
): Lesson {
  const lessonId = `${LESSON_ID_PREFIX}${canonicalDigestHex({
    axisId: axisId ?? null,
    evidence: [...evidence],
    failureMode: failureMode ?? null,
    kind,
    postMortemId: String(postMortemId),
    statement,
  })}` as LessonId;
  return Object.freeze({
    lessonId,
    postMortemId,
    kind,
    ...(failureMode === undefined ? {} : { failureMode }),
    ...(axisId === undefined ? {} : { axisId }),
    evidence: Object.freeze([...evidence]),
    statement,
  });
}

function capabilityDeltaLesson(
  postMortem: PostMortem,
  split: JudgedSplitComparison,
): Lesson {
  const evaluationId = String(postMortem.evaluation.evaluationId);
  const trainMean = meanCombinedScore(split.predicted);
  const heldoutMean = meanCombinedScore(split.happened);
  const delta = trainMean === null || heldoutMean === null ? null : heldoutMean - trainMean;
  const evidence = [
    `evaluation '${evaluationId}' carries ${String(split.predicted.length)} train-side and ${String(split.happened.length)} held-out summaries on axis '${split.axisId}' (carried verbatim, never re-scored)`,
    `train-side mean combined score ${render(trainMean)}; held-out mean ${render(heldoutMean)} — carried statistics of evaluation '${evaluationId}'`,
    `train-side hard violations ${String(split.predicted.reduce((total, s) => total + s.hardViolationCount, 0))}; held-out hard violations ${String(split.happened.reduce((total, s) => total + s.hardViolationCount, 0))}`,
  ];
  const statement = `axis '${split.axisId}': predicted mean ${render(trainMean)}, happened mean ${render(heldoutMean)}, capability delta ${render(delta)} — carried from evaluation '${evaluationId}'`;
  return sealLesson(postMortem.postMortemId, "capability-delta", undefined, split.axisId, evidence, statement);
}

function divergenceSignalLesson(
  postMortem: PostMortem,
  split: JudgedSplitComparison,
): Lesson | null {
  const trainMean = meanCombinedScore(split.predicted);
  const heldoutMean = meanCombinedScore(split.happened);
  if (trainMean === null || heldoutMean === null) {
    return null;
  }
  const delta = heldoutMean - trainMean;
  const direction = delta < 0 ? "degraded" : delta > 0 ? "improved" : "flat";
  const evaluationId = String(postMortem.evaluation.evaluationId);
  const evidence = [
    `axis '${split.axisId}': train-side mean combined score ${String(trainMean)} over ${String(split.predicted.length)} carried summaries of evaluation '${evaluationId}'`,
    `axis '${split.axisId}': held-out mean combined score ${String(heldoutMean)} over ${String(split.happened.length)} carried summaries of evaluation '${evaluationId}'`,
    `divergence ${String(delta)} (${direction}) — the held-out-vs-train signal, carried statistics (never re-scored)`,
  ];
  const statement = `axis '${split.axisId}' ${direction} out-of-sample: held-out mean ${String(heldoutMean)} vs train mean ${String(trainMean)} (delta ${String(delta)})`;
  return sealLesson(postMortem.postMortemId, "divergence-signal", undefined, split.axisId, evidence, statement);
}

function constraintViolationLesson(
  postMortem: PostMortem,
  split: JudgedSplitComparison,
): Lesson | null {
  const offenders = split.happened.filter(
    (summary) => summary.hardViolationCount > 0 || summary.compliance !== "compliant",
  );
  if (offenders.length === 0) {
    return null;
  }
  const evaluationId = String(postMortem.evaluation.evaluationId);
  const evidence = offenders.map(
    (summary) =>
      `happened-side trajectory '${String(summary.trajectoryId)}' carries ${String(summary.hardViolationCount)} hard violation(s), compliance '${String(summary.compliance)}' on axis '${split.axisId}' — carried from evaluation '${evaluationId}'`,
  );
  const statement = `constraint failure out-of-sample: ${String(offenders.length)} happened-side trajectory(ies) on axis '${split.axisId}' carry hard violations or non-compliance (§13: never a bare P&L)`;
  return sealLesson(postMortem.postMortemId, "failure-mode", "constraint-violation", split.axisId, evidence, statement);
}

function heldoutDegradationLesson(
  postMortem: PostMortem,
  split: JudgedSplitComparison,
): Lesson | null {
  const trainMean = meanCombinedScore(split.predicted);
  const heldoutMean = meanCombinedScore(split.happened);
  if (trainMean === null || heldoutMean === null || heldoutMean >= trainMean) {
    return null;
  }
  const evaluationId = String(postMortem.evaluation.evaluationId);
  const evidence = [
    `axis '${split.axisId}': held-out mean combined score ${String(heldoutMean)} is below train mean ${String(trainMean)} (delta ${String(heldoutMean - trainMean)}) — carried statistics of evaluation '${evaluationId}'`,
  ];
  const statement = `held-out degradation on axis '${split.axisId}': happened mean ${String(heldoutMean)} < predicted mean ${String(trainMean)}`;
  return sealLesson(postMortem.postMortemId, "failure-mode", "heldout-degradation", split.axisId, evidence, statement);
}

function unassignedMembershipLesson(
  postMortem: PostMortem,
  split: JudgedSplitComparison,
): Lesson | null {
  if (split.unassigned.length === 0) {
    return null;
  }
  const evaluationId = String(postMortem.evaluation.evaluationId);
  const evidence = split.unassigned.map(
    (summary) =>
      `trajectory '${String(summary.trajectoryId)}' is unassigned on axis '${split.axisId}' — surfaced by evaluation '${evaluationId}' (mixed/outside/both), never resolved here`,
  );
  const statement = `membership ambiguity on axis '${split.axisId}': ${String(split.unassigned.length)} carried trajectory(ies) the evaluation itself could not place on one side`;
  return sealLesson(postMortem.postMortemId, "failure-mode", "unassigned-membership", split.axisId, evidence, statement);
}

function verificationFailureLesson(postMortem: PostMortem): Lesson | null {
  if (postMortem.evaluation.failCount === 0) {
    return null;
  }
  const evaluationId = String(postMortem.evaluation.evaluationId);
  const evidence = [
    `the findings report over evaluation '${evaluationId}' carries ${String(postMortem.evaluation.failCount)} FAIL verdict(s) (digest '${postMortem.evaluation.findingsDigest}') — a FAIL is a valid outcome, carried verbatim`,
  ];
  const statement = `verification failure: ${String(postMortem.evaluation.failCount)} claim(s) over evaluation '${evaluationId}' failed their declared checks`;
  return sealLesson(postMortem.postMortemId, "failure-mode", "verification-failure", undefined, evidence, statement);
}

function selectionPressureLesson(postMortem: PostMortem): Lesson | null {
  const { trialCount, selectedTrialCount } = postMortem.history;
  if (trialCount <= selectedTrialCount) {
    return null;
  }
  const historyId = String(postMortem.history.historyId);
  const evidence = [
    `search history '${historyId}' tried ${String(trialCount)} trial(s) and selected ${String(selectedTrialCount)} — the multiple-comparisons surface, carried counts (never re-derived here)`,
  ];
  const statement = `selection pressure: ${String(trialCount)} trials tried, ${String(selectedTrialCount)} selected — the outcome was chosen among ${String(trialCount - selectedTrialCount)} unchosen alternative(s)`;
  return sealLesson(postMortem.postMortemId, "failure-mode", "selection-pressure", undefined, evidence, statement);
}

// ---------------------------------------------------------------------------
// THE DERIVATION
// ---------------------------------------------------------------------------

/**
 * Derive the typed lesson set of one post-mortem. THE GATE: the record is
 * re-proven whole first (`./validate.js` — a post-mortem whose carried
 * evidence linkage is broken teaches nothing; the refusal names A6 +
 * R052), then every lesson is derived as CARRIED STATISTICS of the
 * record's own data, each citing its evidence lines (A6 — an uncited
 * lesson is a loud typed refusal, never a silent drop), and the set is
 * sealed in canonical lesson-id order with the content-addressed digest
 * (A9). Pure: same post-mortem ⇒ deep-equal lesson set, same digest.
 */
export function deriveLessons(postMortem: PostMortem): LessonSetOutcome {
  const reproof = validatePostMortem(postMortem);
  if (!reproof.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid-post-mortem",
          message: `[outcome-learning] the post-mortem '${String(postMortem.postMortemId)}' failed whole-record re-validation (${String(reproof.errors.length)} error(s)) — a lesson without carried evidence is refused (${EVIDENCE_LINKED_TRUTH_LAW} / ${OUTCOME_LEARNING_REQUIREMENT_LAW}); first error: ${reproof.errors[0]?.message ?? "unknown"}`,
        },
      ],
    };
  }
  const lessons: Lesson[] = [];
  for (const split of postMortem.comparison.splits) {
    lessons.push(capabilityDeltaLesson(postMortem, split));
    const divergence = divergenceSignalLesson(postMortem, split);
    if (divergence !== null) {
      lessons.push(divergence);
    }
    const constraint = constraintViolationLesson(postMortem, split);
    if (constraint !== null) {
      lessons.push(constraint);
    }
    const degradation = heldoutDegradationLesson(postMortem, split);
    if (degradation !== null) {
      lessons.push(degradation);
    }
    const unassigned = unassignedMembershipLesson(postMortem, split);
    if (unassigned !== null) {
      lessons.push(unassigned);
    }
  }
  const verification = verificationFailureLesson(postMortem);
  if (verification !== null) {
    lessons.push(verification);
  }
  const pressure = selectionPressureLesson(postMortem);
  if (pressure !== null) {
    lessons.push(pressure);
  }
  if (lessons.some((lesson) => lesson.evidence.length === 0)) {
    return {
      ok: false,
      errors: [
        {
          code: "uncited-lesson",
          message: `a derived lesson carries no evidence lines — every lesson cites its carried evidence (${EVIDENCE_LINKED_TRUTH_LAW} / ${OUTCOME_LEARNING_REQUIREMENT_LAW}); refused loudly, never silently dropped`,
        },
      ],
    };
  }
  const ordered = [...lessons].sort((left, right) => compareCodeUnits(left.lessonId, right.lessonId));
  const digest = canonicalDigestHex({
    lessons: ordered.map((lesson) => [
      String(lesson.lessonId),
      lesson.kind,
      lesson.failureMode ?? null,
      lesson.axisId ?? null,
      lesson.evidence,
      lesson.statement,
    ]),
    postMortemId: String(postMortem.postMortemId),
  });
  const set: LessonSet = {
    postMortemId: postMortem.postMortemId,
    lessons: Object.freeze(ordered),
    digest,
  };
  return { ok: true, lessons: Object.freeze(set) };
}
