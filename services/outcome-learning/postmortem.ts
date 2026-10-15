/**
 * The post-mortem record (W053) — the typed OUTCOME layer over completed
 * evaluations, as typed DATA.
 *
 * The chain: W038 evaluates experiments (the ExperimentEvaluation + its
 * verification FindingsReport — the outcome side); W051 proves search
 * integrity (the declared history of everything tried); W052 generates the
 * evaluation split families (the family that judges an outcome). THIS
 * module seals the POST-MORTEM: what was predicted vs what happened,
 * CARRIED from the evaluation's own holdout aggregations (the train side is
 * the predicted side, the held-out side is the happened side — never
 * re-scored, never recomputed), WHICH split family judged it (cited through
 * W052's own citation seam), the search history it came from (cited — the
 * integrity linkage), the explicit scope, the immutable lineage, the
 * deterministic provenance, and the content-addressed `pm-<digest>` id.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — evidence-linked truth: the record
 * cites its carried evidence; the predicted-vs-happened sides are carried
 * verbatim from W038's own aggregations.
 * Spec: spec/REQUIREMENTS.md R052 — outcome/post-mortem learning: the
 * post-mortem CARRIES the evaluation's own summaries; it never recomputes
 * an outcome (carry never re-score).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the post-mortem id is
 * the canonical content digest over the canonical record bytes (same
 * completed evaluation + family + history ⇒ deep-equal post-mortem, same
 * id); no clocks, no randomness, no env reads.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — composes typed records: this
 * module never trains, never improves anything (W055's job), never keeps a
 * firm brain (W054's job).
 *
 * FAIL-CLOSED at the gate (never silently repaired): an evaluation whose
 * own content-addressed id does not re-derive from its carried bytes, a
 * findings report whose digest does not re-derive through verification's
 * own machinery, a family that fails W052's whole-record re-validation, a
 * history that fails W051's (their own errors carried VERBATIM), a scope
 * disagreement across the three, an experiment disagreement, a family that
 * did not judge this evaluation, a lineage break — every one a loud typed
 * error naming the law.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex, canonicalString } from "trajectory";
import { EXPERIMENT_EVALUATION_ID_PREFIX } from "evaluation";
import { canonicalSummaryOrder } from "evaluation";
import { compareCodeUnits } from "evaluation-splits";
import type {
  ExperimentEvaluation,
  ExperimentEvaluationId,
  ExperimentReduction,
  HoldoutSplitAggregation,
  TrajectoryOutcomeSummary,
} from "evaluation";
import { findingsDigestOf } from "verification";
import type { FindingsReport } from "verification";
import { splitFamilyCitationOf, validateSplitFamily } from "evaluation-splits";
import type { SplitFamily, SplitFamilyCitation, SplitFamilyError } from "evaluation-splits";
import { SEARCH_HISTORY_INTEGRITY_LAW, validateSearchHistory } from "search-integrity";
import type { SearchHistory, SearchHistoryError, SearchHistoryId } from "search-integrity";
import type { ExperimentId } from "experiments";

// ---------------------------------------------------------------------------
// The laws, named (carried on every record's provenance)
// ---------------------------------------------------------------------------

/** The A6 evidence-linked-truth law, named. */
export const EVIDENCE_LINKED_TRUTH_LAW = "spec/ARCHITECTURE-LOCK.md A6" as const;

/** The R052 outcome/post-mortem learning requirement, named. */
export const OUTCOME_LEARNING_REQUIREMENT_LAW = "spec/REQUIREMENTS.md R052" as const;

/** The A9 deterministic-replay law, named. */
export const POST_MORTEM_DETERMINISM_LAW = "spec/ARCHITECTURE-LOCK.md A9" as const;

/** The A14 composition law, named. */
export const POST_MORTEM_COMPOSITION_LAW = "spec/ARCHITECTURE-LOCK.md A14" as const;

/** The canonical post-mortem law list carried on the provenance. */
export const POST_MORTEM_PROVENANCE_LAWS: readonly string[] = [
  EVIDENCE_LINKED_TRUTH_LAW,
  OUTCOME_LEARNING_REQUIREMENT_LAW,
  SEARCH_HISTORY_INTEGRITY_LAW,
  POST_MORTEM_DETERMINISM_LAW,
  POST_MORTEM_COMPOSITION_LAW,
];

// ---------------------------------------------------------------------------
// The completed evaluation (the W038 outcome side, carried verbatim)
// ---------------------------------------------------------------------------

/**
 * The completed evaluation this post-mortem derives from: W038's own
 * `ExperimentEvaluation` (the walker's output — the carried outcome
 * summaries, the holdout aggregations, the reduction) plus its verification
 * `FindingsReport` (the harness's typed verdict record). BOTH carried
 * verbatim — the post-mortem never re-walks, never re-scores (A14).
 */
export interface CompletedEvaluation {
  readonly evaluation: ExperimentEvaluation;
  readonly findings: FindingsReport;
}

// ---------------------------------------------------------------------------
// The citations (opaque ids + carried counts — data, never re-derivations)
// ---------------------------------------------------------------------------

/** The evaluation citation: the outcome's own identity + verdict counts. */
export interface EvaluationCitation {
  readonly evaluationId: ExperimentEvaluationId;
  readonly experimentId: ExperimentId;
  readonly policyId: string;
  readonly findingsDigest: string;
  readonly passCount: number;
  readonly failCount: number;
  readonly partialCount: number;
  readonly undeclaredCount: number;
}

/**
 * The search-history citation (the W051 integrity linkage): the opaque
 * content-addressed history id plus the record's own carried SHAPE counts —
 * trials tried, selection decisions, distinct trials chosen (the
 * multiple-comparisons surface, carried as counts, never re-derived here).
 */
export interface SearchHistoryCitation {
  readonly historyId: SearchHistoryId;
  readonly trialCount: number;
  readonly selectionCount: number;
  readonly selectedTrialCount: number;
  readonly law: typeof SEARCH_HISTORY_INTEGRITY_LAW;
}

// ---------------------------------------------------------------------------
// The predicted-vs-happened comparison (CARRIED from W038's own data)
// ---------------------------------------------------------------------------

/** The split-kind vocabulary, carried from W038's own aggregation kind. */
export type JudgedSplitKind = HoldoutSplitAggregation["kind"];

/**
 * ONE judged split's predicted-vs-happened comparison: the axis, the kind,
 * and the three sides CARRIED VERBATIM from the evaluation's own holdout
 * aggregation — the train side (what the policy was fitted on: the
 * PREDICTED side), the held-out side (what actually happened out-of
 * sample: the HAPPENED side), and the unassigned side (records the
 * evaluation itself could not cleanly place — surfaced, never resolved).
 * Every summary is a W038 `TrajectoryOutcomeSummary`, carried byte for
 * byte; nothing here is recomputed (carry never re-score, R052/A6).
 */
export interface JudgedSplitComparison {
  readonly axisId: string;
  readonly kind: JudgedSplitKind;
  readonly predicted: readonly TrajectoryOutcomeSummary[];
  readonly happened: readonly TrajectoryOutcomeSummary[];
  readonly unassigned: readonly TrajectoryOutcomeSummary[];
}

/**
 * The whole comparison: one entry per family-judged split (the evaluation's
 * own canonical order, carried), plus the evaluation's own cross-trajectory
 * reduction carried VERBATIM — the post-mortem never re-folds a reduction.
 */
export interface PredictedVersusHappened {
  readonly splits: readonly JudgedSplitComparison[];
  readonly reduction: ExperimentReduction;
}

// ---------------------------------------------------------------------------
// The record: id, scope, lineage, provenance
// ---------------------------------------------------------------------------

declare const postMortemIdBrand: unique symbol;

/**
 * An OPAQUE post-mortem id (a canonical digest rendering). Produced only by
 * the gate / {@link postMortemDigestOf}; never parsed — the citations,
 * scope and comparison are carried on the record, never recovered by
 * splitting the id.
 */
export type PostMortemId = string & {
  readonly [postMortemIdBrand]: true;
};

/** The id prefix (a rendering convention, never a parse target). */
export const POST_MORTEM_ID_PREFIX = "pm-";

/** The explicit scope, carried from W052's own family scope vocabulary. */
export type PostMortemScope = SplitFamily["scope"];

/**
 * The immutable lineage (the W037/W051/W052 branch-lineage pattern): a
 * post-mortem never branches on its own — a CONTINUATION declares its
 * parent, and the chain's root + ordinal are carried verbatim.
 */
export interface PostMortemLineage {
  readonly parent: PostMortemId | undefined;
  readonly root: PostMortemId;
  readonly ordinal: number;
}

/** The declared lineage at derivation (a root post-mortem omits it). */
export interface PostMortemLineageInput {
  readonly parent?: PostMortemId;
  readonly root?: PostMortemId;
  readonly ordinal?: number;
}

/** The deterministic provenance record (carried as data, re-derivable). */
export interface PostMortemProvenance {
  readonly deriver: "derive-post-mortem";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/**
 * ONE post-mortem: the opaque content-addressed id, the explicit scope, the
 * evaluation/family/history citations, the CARRIED predicted-vs-happened
 * comparison, the immutable lineage, the deterministic provenance. Typed
 * DATA — never trained on, never applied (W054/W055's job).
 */
export interface PostMortem {
  readonly postMortemId: PostMortemId;
  readonly scope: PostMortemScope;
  readonly evaluation: EvaluationCitation;
  readonly family: SplitFamilyCitation;
  readonly history: SearchHistoryCitation;
  readonly comparison: PredictedVersusHappened;
  readonly lineage: PostMortemLineage;
  readonly provenance: PostMortemProvenance;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

/** Everything the post-mortem gate can refuse. */
export type PostMortemErrorCode =
  | "malformed-input" // the input is not lawful typed data
  | "invalid-evaluation" // W038 carried: the evaluation id does not re-derive (A9)
  | "invalid-findings" // W038 carried: the findings digest/subject does not re-prove
  | "invalid-family" // W052 whole-record re-validation failed (errors carried verbatim)
  | "invalid-history" // W051 whole-record re-validation failed (errors carried verbatim)
  | "scope-mismatch" // family.scope ≢ history.scope (tenant/project/world)
  | "experiment-mismatch" // history.experimentId ≢ evaluation.experimentId
  | "family-did-not-judge" // a family split the evaluation never carried
  | "lineage-break"; // the immutable lineage is incoherent

/** One typed post-mortem error (fail-closed; the law named in the message). */
export interface PostMortemError {
  readonly code: PostMortemErrorCode;
  readonly message: string;
  /** The offending axis/evaluation id, when the error belongs to one entry. */
  readonly entryId?: string;
  /** `invalid-family` only: W052's own errors, carried VERBATIM. */
  readonly familyErrors?: readonly SplitFamilyError[];
  /** `invalid-history` only: W051's own errors, carried VERBATIM. */
  readonly historyErrors?: readonly SearchHistoryError[];
}

// ---------------------------------------------------------------------------
// The canonical content + the id (A9)
// ---------------------------------------------------------------------------

function summaryTuple(summary: TrajectoryOutcomeSummary): unknown[] {
  return [
    String(summary.trajectoryId),
    summary.policyId,
    summary.combinedScore,
    summary.appliedSoftPenaltyTotal,
    summary.hardViolationCount,
    summary.compliance,
  ];
}

/** The canonical bytes the post-mortem id addresses (A9: order never leaks). */
function postMortemCanonicalContent(
  scope: PostMortemScope,
  evaluation: EvaluationCitation,
  family: SplitFamilyCitation,
  history: SearchHistoryCitation,
  comparison: PredictedVersusHappened,
): unknown {
  return {
    comparison: {
      reduction: comparison.reduction,
      splits: comparison.splits.map((split) => [
        split.axisId,
        String(split.kind),
        split.predicted.map(summaryTuple),
        split.happened.map(summaryTuple),
        split.unassigned.map(summaryTuple),
      ]),
    },
    evaluation: {
      experimentId: String(evaluation.experimentId),
      evaluationId: String(evaluation.evaluationId),
      findings: [
        evaluation.passCount,
        evaluation.failCount,
        evaluation.partialCount,
        evaluation.undeclaredCount,
      ],
      findingsDigest: evaluation.findingsDigest,
      policyId: evaluation.policyId,
    },
    family: { familyId: String(family.familyId), kind: family.kind },
    history: {
      counts: [history.trialCount, history.selectionCount, history.selectedTrialCount],
      historyId: String(history.historyId),
    },
    scope: { projectId: scope.projectId, tenantId: scope.tenantId, worldId: scope.worldId },
  };
}

/**
 * The post-mortem id: `pm-<digest>` over the canonical record bytes. Pure
 * and deterministic (A9); the lineage rides BESIDE the id, never inside it.
 */
export function postMortemDigestOf(record: PostMortem): PostMortemId {
  const digest = canonicalDigestHex(
    postMortemCanonicalContent(
      record.scope,
      record.evaluation,
      record.family,
      record.history,
      record.comparison,
    ),
  );
  return `${POST_MORTEM_ID_PREFIX}${digest}` as PostMortemId;
}

// ---------------------------------------------------------------------------
// W038's own re-proofs (the evaluation record re-proven from carried data)
// ---------------------------------------------------------------------------

/**
 * Re-derive the evaluation's content-addressed id from its OWN carried
 * bytes — the same canonical content W038's walker digests (A9: recorded
 * data is re-proven, never trusted). Never re-scores: it re-digests the
 * carried summaries, it never recomputes one.
 */
function rederivedEvaluationId(evaluation: ExperimentEvaluation): string {
  return `${EXPERIMENT_EVALUATION_ID_PREFIX}${canonicalDigestHex({
    experimentId: String(evaluation.experimentId),
    integrity: [...evaluation.integrity],
    holdoutSplits: evaluation.holdoutSplits.map((aggregation) => [
      aggregation.axisId,
      String(aggregation.kind),
      aggregation.derivation,
      aggregation.train.map((summary) => String(summary.trajectoryId)),
      aggregation.evaluation.map((summary) => String(summary.trajectoryId)),
      aggregation.unassigned.map((summary) => String(summary.trajectoryId)),
    ]),
    policyId: evaluation.policyId,
    reduction: evaluation.reduction,
    trajectories: evaluation.trajectories.map(summaryTuple),
  })}`;
}

/** Is one list of summaries already in canonical trajectory-id order? */
function isCanonicalSummaryOrder(summaries: readonly TrajectoryOutcomeSummary[]): boolean {
  for (let index = 1; index < summaries.length; index += 1) {
    const left = String(summaries[index - 1]?.trajectoryId);
    const right = String(summaries[index]?.trajectoryId);
    if (compareCodeUnits(left, right) > 0) {
      return false;
    }
  }
  return true;
}

/** The W038 outcome-side re-proofs (evaluation + findings, from carried data). */
function completedEvaluationErrors(completed: CompletedEvaluation): PostMortemError[] {
  const errors: PostMortemError[] = [];
  const { evaluation, findings } = completed;
  const evaluationId = String(evaluation.evaluationId);
  if (!evaluationId.startsWith(EXPERIMENT_EVALUATION_ID_PREFIX)) {
    errors.push({ code: "invalid-evaluation", message: `the evaluation id '${evaluationId}' is not a '${EXPERIMENT_EVALUATION_ID_PREFIX}' rendering — W038's own id vocabulary is required` });
  }
  if (rederivedEvaluationId(evaluation) !== evaluationId) {
    errors.push({ code: "invalid-evaluation", message: `the evaluation id '${evaluationId}' does not re-derive from its own carried bytes (${POST_MORTEM_DETERMINISM_LAW} — recorded data is re-proven, never trusted)` });
  }
  if (!isCanonicalSummaryOrder(evaluation.trajectories)) {
    errors.push({ code: "invalid-evaluation", message: "the evaluation's carried outcome summaries are not in canonical trajectory-id order — the record's own canonical order is re-proven" });
  }
  for (const aggregation of evaluation.holdoutSplits) {
    if (!isCanonicalSummaryOrder(aggregation.train) || !isCanonicalSummaryOrder(aggregation.evaluation) || !isCanonicalSummaryOrder(aggregation.unassigned)) {
      errors.push({ code: "invalid-evaluation", message: `the holdout aggregation for axis '${aggregation.axisId}' carries sides out of canonical trajectory-id order — the record's own canonical order is re-proven`, entryId: aggregation.axisId });
    }
  }
  if (String(findings.subject) !== evaluationId) {
    errors.push({ code: "invalid-findings", message: `the findings report answers subject '${String(findings.subject)}' but the evaluation is '${evaluationId}' — the verdict record must answer the evaluation it judges` });
  }
  if (findingsDigestOf(findings.subject, findings.findings) !== String(findings.digest)) {
    errors.push({ code: "invalid-findings", message: `the findings digest '${String(findings.digest)}' does not re-derive from its own carried findings through W038's own digest machinery (${POST_MORTEM_DETERMINISM_LAW})` });
  }
  const carried = findings.findings.length;
  if (findings.passCount + findings.failCount + findings.partialCount + findings.undeclaredCount !== carried) {
    errors.push({ code: "invalid-findings", message: `the findings report's verdict counts (pass ${String(findings.passCount)}, fail ${String(findings.failCount)}, partial ${String(findings.partialCount)}, undeclared ${String(findings.undeclaredCount)}) do not add up to its ${String(carried)} carried findings — incoherent verdict records are refused` });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

/** The derivation input: the completed evaluation, the family, the history. */
export interface PostMortemInput {
  readonly evaluation: CompletedEvaluation;
  readonly family: SplitFamily;
  readonly history: SearchHistory;
  readonly lineage?: PostMortemLineageInput;
}

/** The derivation outcome: the sealed post-mortem, or every law violated. */
export type PostMortemOutcome =
  | { readonly ok: true; readonly postMortem: PostMortem }
  | { readonly ok: false; readonly errors: readonly PostMortemError[] };

/** Resolve the declared lineage against the record's own id (fail-closed). */
function resolveLineage(
  input: PostMortemLineageInput | undefined,
  postMortemId: PostMortemId,
): { readonly ok: true; readonly lineage: PostMortemLineage } | { readonly ok: false; readonly errors: readonly PostMortemError[] } {
  const parent = input?.parent;
  if (parent === undefined) {
    const declaredRoot = input?.root;
    if (declaredRoot !== undefined && declaredRoot !== postMortemId) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root post-mortem's lineage must cite its own id ('${postMortemId}') — it declares '${declaredRoot}' (the immutable lineage law)` }] };
    }
    const ordinal = input?.ordinal ?? 0;
    if (ordinal !== 0) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root post-mortem's lineage ordinal is 0 — it declares ${String(ordinal)} (the immutable lineage law)` }] };
    }
    return { ok: true, lineage: { parent: undefined, root: postMortemId, ordinal: 0 } };
  }
  if (String(parent).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: "the post-mortem declares a blank parent id — the lineage is explicit, never defaulted" }] };
  }
  const root = input?.root;
  if (root === undefined || String(root).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: `the continuation of '${parent}' declares no chain root — a continuation carries the chain's root verbatim (the immutable lineage law)` }] };
  }
  const ordinal = input?.ordinal;
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1) {
    return { ok: false, errors: [{ code: "lineage-break", message: `a continuation's lineage ordinal is a positive integer — it declares ${String(ordinal)} (the immutable lineage law)` }] };
  }
  return { ok: true, lineage: { parent, root, ordinal } };
}

/**
 * Derive one post-mortem — THE GATE. The completed evaluation is re-proven
 * through W038's own laws (its content-addressed id re-derived from its
 * carried bytes; its findings digest re-derived through verification's own
 * machinery; its canonical orders re-proven), the family through W052's
 * own whole-record re-validation, the history through W051's own — their
 * errors carried VERBATIM. Scope agreement is proven across all three
 * (family ≡ history on tenant/project/world; history.experimentId ≡
 * evaluation.experimentId), and the family is proven to have actually
 * JUDGED this evaluation (every family split carried by the evaluation's
 * own aggregations). Only then is the post-mortem sealed with the carried
 * comparison, the citations, the resolved lineage and the deterministic
 * provenance. Pure and deterministic (A9): the same inputs ⇒ the
 * deep-equal record, the same `pm-<digest>` id.
 */
export function derivePostMortem(input: PostMortemInput): PostMortemOutcome {
  if (input === null || typeof input !== "object") {
    return { ok: false, errors: [{ code: "malformed-input", message: "the post-mortem derivation input is not an object — a completed evaluation, a split family and a search history are required" }] };
  }
  const completed = input.evaluation;
  if (
    completed === null || typeof completed !== "object" ||
    completed.evaluation === null || typeof completed.evaluation !== "object" ||
    completed.findings === null || typeof completed.findings !== "object"
  ) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the completed evaluation is not typed data — a W038 ExperimentEvaluation plus its FindingsReport are required (carried, never re-scored)" }] };
  }
  if (input.family === null || typeof input.family !== "object") {
    return { ok: false, errors: [{ code: "malformed-input", message: "the split family is not typed data — the W052 SplitFamily record is required (cited by the post-mortem)" }] };
  }
  if (input.history === null || typeof input.history !== "object") {
    return { ok: false, errors: [{ code: "malformed-input", message: "the search history is not typed data — the W051 SearchHistory record is required (the integrity linkage)" }] };
  }

  const errors: PostMortemError[] = [];
  errors.push(...completedEvaluationErrors(completed));

  const familyReproof = validateSplitFamily(input.family);
  if (!familyReproof.ok) {
    errors.push({
      code: "invalid-family",
      message: `[outcome-learning] the split family '${String(input.family.familyId)}' failed W052's whole-record re-validation (${String(familyReproof.errors.length)} error(s)) — a post-mortem cites only a lawful family (errors carried verbatim)`,
      familyErrors: familyReproof.errors,
    });
  }

  const historyReproof = validateSearchHistory(input.history);
  if (!historyReproof.ok) {
    errors.push({
      code: "invalid-history",
      message: `[outcome-learning] the search history '${String(input.history.historyId)}' failed W051's whole-record re-validation (${String(historyReproof.errors.length)} error(s)) — the integrity linkage cites only a lawful history (errors carried verbatim)`,
      historyErrors: historyReproof.errors,
    });
  }

  const familyScope = input.family.scope;
  const historyScope = input.history.scope;
  for (const member of ["tenantId", "projectId", "worldId"] as const) {
    if (String(familyScope[member]) !== String(historyScope[member])) {
      errors.push({
        code: "scope-mismatch",
        message: `the split family declares scope.${member} '${String(familyScope[member])}' but the search history declares '${String(historyScope[member])}' — a post-mortem's family, history and evaluation share one explicit scope`,
      });
    }
  }
  const experimentId = String(completed.evaluation.experimentId);
  if (String(historyScope.experimentId) !== experimentId) {
    errors.push({
      code: "experiment-mismatch",
      message: `the search history ran under experiment '${String(historyScope.experimentId)}' but the evaluation walked '${experimentId}' — the integrity linkage never crosses experiments`,
    });
  }

  // The family-judged linkage: every split the family declares is carried
  // verbatim by the evaluation's own aggregations (it judged this outcome).
  const judged = new Map<string, HoldoutSplitAggregation>();
  for (const aggregation of completed.evaluation.holdoutSplits) {
    judged.set(canonicalString(aggregation.split), aggregation);
  }
  for (const split of input.family.splits) {
    const matching = judged.get(canonicalString(split));
    if (matching === undefined) {
      errors.push({
        code: "family-did-not-judge",
        message: `the family split for axis '${split.axisId}' is not carried by evaluation '${experimentId}' — the post-mortem's family is the family that JUDGED this outcome (cited, never assumed)`,
        entryId: split.axisId,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // --- the seal: the carried comparison, the citations, the id (A9) ---

  const comparison: PredictedVersusHappened = {
    splits: input.family.splits
      .map((split) => judged.get(canonicalString(split)))
      .filter((aggregation): aggregation is HoldoutSplitAggregation => aggregation !== undefined)
      .map((aggregation) => ({
        axisId: aggregation.axisId,
        kind: aggregation.kind,
        predicted: canonicalSummaryOrder([...aggregation.train]),
        happened: canonicalSummaryOrder([...aggregation.evaluation]),
        unassigned: canonicalSummaryOrder([...aggregation.unassigned]),
      })),
    reduction: completed.evaluation.reduction,
  };

  const selectedTrialIds = new Set(input.history.selections.map((decision) => String(decision.chosenTrialId)));
  const evaluationCitation: EvaluationCitation = {
    evaluationId: completed.evaluation.evaluationId,
    experimentId: completed.evaluation.experimentId,
    policyId: completed.evaluation.policyId,
    findingsDigest: String(completed.findings.digest),
    passCount: completed.findings.passCount,
    failCount: completed.findings.failCount,
    partialCount: completed.findings.partialCount,
    undeclaredCount: completed.findings.undeclaredCount,
  };
  const historyCitation: SearchHistoryCitation = {
    historyId: input.history.historyId,
    trialCount: input.history.trials.length,
    selectionCount: input.history.selections.length,
    selectedTrialCount: selectedTrialIds.size,
    law: SEARCH_HISTORY_INTEGRITY_LAW,
  };
  const familyCitation = splitFamilyCitationOf(input.family);

  const scope: PostMortemScope = { tenantId: familyScope.tenantId, projectId: familyScope.projectId, worldId: familyScope.worldId };
  const postMortemId = `${POST_MORTEM_ID_PREFIX}${canonicalDigestHex(
    postMortemCanonicalContent(scope, evaluationCitation, familyCitation, historyCitation, comparison),
  )}` as PostMortemId;
  const lineage = resolveLineage(input.lineage, postMortemId);
  if (!lineage.ok) {
    return { ok: false, errors: lineage.errors };
  }
  const record: PostMortem = {
    postMortemId,
    scope,
    evaluation: evaluationCitation,
    family: familyCitation,
    history: historyCitation,
    comparison,
    lineage: lineage.lineage,
    provenance: {
      deriver: "derive-post-mortem",
      inputDigest: canonicalDigestHex({
        evaluation: { evaluationId: String(evaluationCitation.evaluationId), findingsDigest: evaluationCitation.findingsDigest },
        family: { familyId: String(familyCitation.familyId) },
        history: { historyId: String(historyCitation.historyId) },
      }),
      laws: POST_MORTEM_PROVENANCE_LAWS,
    },
  };
  return { ok: true, postMortem: Object.freeze(record) };
}
