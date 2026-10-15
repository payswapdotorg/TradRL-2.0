/**
 * Whole-record re-validation (W053) — the post-mortem and lesson-set laws
 * re-proven from recorded data.
 *
 * The W047 episode / W050 view / W051 history / W052 family re-validation
 * pattern: nothing recorded is ever trusted — a post-mortem handed back to
 * the machine is re-proven through its own laws. The record's
 * content-addressed id is re-derived from its own carried bytes (A9), the
 * citations are re-proven against their own vocabularies (W038's
 * `expeval-` / W052's `fam-` / W051's `search-` prefixes, carried counts),
 * the carried comparison's canonical orders are re-proven (kind-adjacent,
 * axis-ascending, sides in trajectory-id order), the carried reduction's
 * coherence is re-proven, the lineage is re-proven coherent, and the
 * deterministic provenance re-derives from the citations. Lesson sets are
 * re-derived whole from the carried post-mortem and must reproduce the
 * carried set exactly — same lessons, same canonical order, same digest
 * (the A9 twin) — and every lesson must cite carried evidence (A6: an
 * uncited lesson is refused loudly).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the re-derivations are pure: same
 * recorded data ⇒ same verdicts, always.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — carry never re-score: the re-proof
 * consults only carried data; it never re-walks an evaluation, never
 * re-scores an outcome, never re-runs a trial.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex, canonicalString } from "trajectory";
import { EXPERIMENT_EVALUATION_ID_PREFIX } from "evaluation";
import { compareCodeUnits } from "evaluation-splits";
import type { TrajectoryOutcomeSummary } from "evaluation";
import { SPLIT_FAMILY_ID_PREFIX } from "evaluation-splits";
import { SEARCH_HISTORY_ID_PREFIX } from "search-integrity";
import {
  POST_MORTEM_PROVENANCE_LAWS,
  postMortemDigestOf,
} from "./postmortem.js";
import type { PostMortem } from "./postmortem.js";
import { EVIDENCE_LINKED_TRUTH_LAW, OUTCOME_LEARNING_REQUIREMENT_LAW } from "./postmortem.js";
import { deriveLessons } from "./lessons.js";
import type { LessonSet } from "./lessons.js";

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

/** Everything the whole-record re-validation can refuse. */
export type PostMortemValidationCode =
  | "malformed-record" // the record is not lawful typed data
  | "post-mortem-id-mismatch" // the id does not re-derive from carried bytes (A9)
  | "invalid-citation" // a citation outside its own vocabulary (W038/W052/W051)
  | "invalid-scope" // the carried scope is not explicit
  | "empty-comparison" // no judged split: nothing was compared
  | "comparison-order" // the carried comparison is not in canonical order
  | "reduction-incoherent" // the carried reduction breaks its own laws
  | "lineage-break" // the immutable lineage is incoherent
  | "provenance-mismatch" // the deterministic provenance does not re-derive
  | "post-mortem-mismatch" // the lesson set answers another post-mortem
  | "lessons-order" // the lessons are not in canonical lesson-id order
  | "lessons-mismatch" // the lessons do not re-derive (the A9 twin)
  | "uncited-lesson"; // a lesson without carried evidence (A6/R052)

/** One typed re-validation error (fail-closed; the law named in the message). */
export interface PostMortemValidationError {
  readonly code: PostMortemValidationCode;
  readonly message: string;
  readonly entryId?: string;
}

/** Result of re-validating one post-mortem. */
export type PostMortemValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly PostMortemValidationError[] };

/** Result of re-validating one lesson set against its post-mortem. */
export type LessonSetValidation = PostMortemValidation;

// ---------------------------------------------------------------------------
// Whole-record re-validation (from recorded data only)
// ---------------------------------------------------------------------------

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isCanonicalSummaryOrder(summaries: readonly TrajectoryOutcomeSummary[]): boolean {
  for (let index = 1; index < summaries.length; index += 1) {
    if (compareCodeUnits(String(summaries[index - 1]?.trajectoryId), String(summaries[index]?.trajectoryId)) > 0) {
      return false;
    }
  }
  return true;
}

function citationErrors(record: PostMortem): PostMortemValidationError[] {
  const errors: PostMortemValidationError[] = [];
  const evaluation = record.evaluation;
  if (!String(evaluation.evaluationId).startsWith(EXPERIMENT_EVALUATION_ID_PREFIX)) {
    errors.push({ code: "invalid-citation", message: `the evaluation citation id '${String(evaluation.evaluationId)}' is not a '${EXPERIMENT_EVALUATION_ID_PREFIX}' rendering — W038's own id vocabulary is required` });
  }
  if (String(evaluation.experimentId).trim().length === 0 || String(evaluation.policyId).trim().length === 0 || String(evaluation.findingsDigest).trim().length === 0) {
    errors.push({ code: "invalid-citation", message: "the evaluation citation carries a blank experiment/policy id or findings digest — citations are explicit, never blank" });
  }
  for (const member of ["passCount", "failCount", "partialCount", "undeclaredCount"] as const) {
    if (!isNonNegativeInteger(evaluation[member])) {
      errors.push({ code: "invalid-citation", message: `the evaluation citation's ${member} is not a non-negative integer — carried verdict counts are explicit data` });
    }
  }
  if (!String(record.family.familyId).startsWith(SPLIT_FAMILY_ID_PREFIX)) {
    errors.push({ code: "invalid-citation", message: `the family citation id '${String(record.family.familyId)}' is not a '${SPLIT_FAMILY_ID_PREFIX}' rendering — W052's own id vocabulary is required` });
  }
  const history = record.history;
  if (!String(history.historyId).startsWith(SEARCH_HISTORY_ID_PREFIX)) {
    errors.push({ code: "invalid-citation", message: `the history citation id '${String(history.historyId)}' is not a '${SEARCH_HISTORY_ID_PREFIX}' rendering — W051's own id vocabulary is required` });
  }
  if (!isNonNegativeInteger(history.trialCount) || !isNonNegativeInteger(history.selectionCount) || !isNonNegativeInteger(history.selectedTrialCount) || history.selectedTrialCount > history.trialCount) {
    errors.push({ code: "invalid-citation", message: `the history citation counts (trials ${String(history.trialCount)}, selections ${String(history.selectionCount)}, selected ${String(history.selectedTrialCount)}) break their own laws — counts are non-negative and the chosen never exceed the tried` });
  }
  return errors;
}

function comparisonErrors(record: PostMortem): PostMortemValidationError[] {
  const errors: PostMortemValidationError[] = [];
  const splits = record.comparison.splits;
  if (splits.length === 0) {
    errors.push({ code: "empty-comparison", message: "the post-mortem carries no judged split — a post-mortem compares at least one family-judged outcome" });
    return errors;
  }
  for (let index = 0; index < splits.length; index += 1) {
    const split = splits[index]!;
    if (String(split.axisId).trim().length === 0) {
      errors.push({ code: "comparison-order", message: `the carried comparison split #${String(index)} declares a blank axis id — judged axes are explicit`, entryId: String(split.axisId) });
    }
    if (index > 0) {
      const previous = splits[index - 1]!;
      if (String(previous.kind) === String(split.kind) && compareCodeUnits(String(previous.axisId), String(split.axisId)) >= 0) {
        errors.push({ code: "comparison-order", message: `the carried comparison splits '${String(previous.axisId)}' and '${String(split.axisId)}' (kind ${String(split.kind)}) are not in canonical axis order — the record's own canonical order is re-proven (A9)`, entryId: String(split.axisId) });
      }
    }
    for (const side of ["predicted", "happened", "unassigned"] as const) {
      if (!isCanonicalSummaryOrder(split[side])) {
        errors.push({ code: "comparison-order", message: `the '${side}' side of axis '${String(split.axisId)}' is not in canonical trajectory-id order — carried sides keep the evaluation's own canonical order`, entryId: String(split.axisId) });
      }
    }
  }
  const reduction = record.comparison.reduction;
  if (
    !isNonNegativeInteger(reduction.trajectoryCount) ||
    !Number.isFinite(reduction.combinedScoreTotal) ||
    !Number.isFinite(reduction.appliedSoftPenaltyTotal) ||
    !isNonNegativeInteger(reduction.hardViolationCount) ||
    (reduction.compliance !== "compliant" && reduction.compliance !== "non-compliant") ||
    reduction.ranking.length !== reduction.trajectoryCount ||
    new Set(reduction.ranking.map((id) => String(id))).size !== reduction.trajectoryCount
  ) {
    errors.push({ code: "reduction-incoherent", message: `the carried reduction breaks its own laws (trajectories ${String(reduction.trajectoryCount)}, ranking ${String(reduction.ranking.length)}) — W038's reduction is carried verbatim and re-proven coherent` });
  }
  return errors;
}

function lineageErrors(record: PostMortem): PostMortemValidationError[] {
  const lineage = record.lineage;
  const id = String(record.postMortemId);
  if (lineage.parent === undefined) {
    if (String(lineage.root) !== id) {
      return [{ code: "lineage-break", message: `a root post-mortem's lineage must cite its own id ('${id}') — it carries '${String(lineage.root)}' (the immutable lineage law)` }];
    }
    if (lineage.ordinal !== 0) {
      return [{ code: "lineage-break", message: `a root post-mortem's lineage ordinal is 0 — it carries ${String(lineage.ordinal)} (the immutable lineage law)` }];
    }
    return [];
  }
  if (String(lineage.parent).trim().length === 0 || String(lineage.root).trim().length === 0) {
    return [{ code: "lineage-break", message: "a continuation's lineage carries a blank parent or root — the lineage is explicit, never defaulted" }];
  }
  if (!Number.isInteger(lineage.ordinal) || lineage.ordinal < 1) {
    return [{ code: "lineage-break", message: `a continuation's lineage ordinal is a positive integer — it carries ${String(lineage.ordinal)} (the immutable lineage law)` }];
  }
  return [];
}

function provenanceErrors(record: PostMortem): PostMortemValidationError[] {
  const errors: PostMortemValidationError[] = [];
  const provenance = record.provenance;
  if (provenance.deriver !== "derive-post-mortem") {
    errors.push({ code: "provenance-mismatch", message: `the provenance names deriver '${String(provenance.deriver)}' — the closed deriver vocabulary is 'derive-post-mortem'` });
  }
  if (canonicalString([...provenance.laws]) !== canonicalString([...POST_MORTEM_PROVENANCE_LAWS])) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's law list does not match the canonical post-mortem law list — the laws are carried verbatim" });
  }
  const inputDigest = canonicalDigestHex({
    evaluation: { evaluationId: String(record.evaluation.evaluationId), findingsDigest: String(record.evaluation.findingsDigest) },
    family: { familyId: String(record.family.familyId) },
    history: { historyId: String(record.history.historyId) },
  });
  if (String(provenance.inputDigest) !== inputDigest) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's input digest does not re-derive from the carried citations — deterministic provenance is re-proven (A9)" });
  }
  return errors;
}

/**
 * Re-validate one post-mortem whole, from its own recorded data. The
 * content-addressed id must re-derive from the carried bytes (A9), every
 * citation must obey its own vocabulary, the scope must be explicit, the
 * carried comparison must keep the evaluation's own canonical orders, the
 * carried reduction must be coherent, the lineage coherent, the
 * provenance re-derivable. Never re-scores anything (A14).
 */
export function validatePostMortem(record: PostMortem): PostMortemValidation {
  if (record === null || typeof record !== "object") {
    return { ok: false, errors: [{ code: "malformed-record", message: "the post-mortem is not typed data — a record object is required" }] };
  }
  const errors: PostMortemValidationError[] = [];
  const withId = record as PostMortem;
  if (String(withId.postMortemId).trim().length === 0) {
    return { ok: false, errors: [{ code: "malformed-record", message: "the post-mortem carries a blank id — ids are explicit, never blank" }] };
  }
  if (postMortemDigestOf(withId) !== String(withId.postMortemId)) {
    errors.push({ code: "post-mortem-id-mismatch", message: `the post-mortem id '${String(withId.postMortemId)}' does not re-derive from its own carried bytes — recorded data is re-proven, never trusted (A9)` });
  }
  for (const member of ["tenantId", "projectId", "worldId"] as const) {
    if (String(withId.scope?.[member]).trim().length === 0) {
      errors.push({ code: "invalid-scope", message: `the carried scope member '${member}' is blank — the scope is explicit` });
    }
  }
  errors.push(...citationErrors(withId));
  errors.push(...comparisonErrors(withId));
  errors.push(...lineageErrors(withId));
  errors.push(...provenanceErrors(withId));
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Re-validate one lesson set against its post-mortem: the set must answer
 * THIS post-mortem, keep the canonical lesson-id order, cite carried
 * evidence on every lesson (A6 — an uncited lesson is refused loudly,
 * naming A6 + R052), and re-derive EXACTLY from the carried post-mortem —
 * same lessons, same order, same digest (the A9 twin). Never re-scores,
 * never trains (A14).
 */
export function validateLessonSet(set: LessonSet, record: PostMortem): LessonSetValidation {
  if (set === null || typeof set !== "object") {
    return { ok: false, errors: [{ code: "malformed-record", message: "the lesson set is not typed data — a record object is required" }] };
  }
  const errors: PostMortemValidationError[] = [];
  if (String(set.postMortemId) !== String(record.postMortemId)) {
    errors.push({ code: "post-mortem-mismatch", message: `the lesson set answers post-mortem '${String(set.postMortemId)}' but is validated against '${String(record.postMortemId)}' — a lesson set belongs to exactly one post-mortem` });
  }
  const lessons = [...set.lessons];
  for (let index = 1; index < lessons.length; index += 1) {
    if (compareCodeUnits(String(lessons[index - 1]?.lessonId), String(lessons[index]?.lessonId)) >= 0) {
      errors.push({ code: "lessons-order", message: `the lessons '${String(lessons[index - 1]?.lessonId)}' and '${String(lessons[index]?.lessonId)}' are not in canonical lesson-id order — declaration order never leaks (A9)` });
    }
  }
  for (const lesson of lessons) {
    if (lesson.evidence.length === 0) {
      errors.push({ code: "uncited-lesson", message: `the lesson '${String(lesson.lessonId)}' carries no evidence — every lesson cites its carried evidence (${EVIDENCE_LINKED_TRUTH_LAW} / ${OUTCOME_LEARNING_REQUIREMENT_LAW})`, entryId: String(lesson.lessonId) });
    }
    if (String(lesson.postMortemId) !== String(record.postMortemId)) {
      errors.push({ code: "post-mortem-mismatch", message: `the lesson '${String(lesson.lessonId)}' cites post-mortem '${String(lesson.postMortemId)}' — lessons never cross post-mortems`, entryId: String(lesson.lessonId) });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const rederived = deriveLessons(record);
  if (!rederived.ok) {
    return { ok: false, errors: [{ code: "lessons-mismatch", message: `the post-mortem no longer re-derives its own lessons — first refusal: ${rederived.errors[0]?.message ?? "unknown"}` }] };
  }
  const carried = lessons.map((lesson) => canonicalString(lesson)).join("\n");
  const expected = rederived.lessons.lessons.map((lesson) => canonicalString(lesson)).join("\n");
  if (carried !== expected || String(set.digest) !== String(rederived.lessons.digest)) {
    return { ok: false, errors: [{ code: "lessons-mismatch", message: "the carried lesson set does not re-derive from the post-mortem's own data — the A9 twin is broken (same post-mortem ⇒ same lessons, same digest)" }] };
  }
  return { ok: true };
}
