/**
 * The progression gate (W046) — `advanceStage(curriculum, evidence)`:
 * THE GATE. The ACTIVE stage's evidence threshold is proven against the
 * CARRIED W038 evaluation summaries (+ findings reports): every requirement
 * of the closed gate vocabulary is proven over the cited experiment
 * evaluation's OWN carried reduction/integrity/findings — carry never
 * re-scores (re-deriving an outcome would be a new authority source, and
 * this package owns none). Constraint-aware by construction (§13 — the
 * compliance dimension; the bare-P&L refusal itself runs at founding and in
 * the whole-record re-validation). Then — and only then — the NEXT stage is
 * unsealed: a NEW curriculum generation (the lineage extended, never
 * rewritten; the active stage advanced by exactly one; the schedule carried
 * VERBATIM), with the digest over the gate-passing evidence sealed into the
 * provenance (deterministic DATA, A9 — no clocks). Fail-closed at every
 * seam: an unprovable curriculum, a missing/duplicated citation, a missing
 * findings report, an unmet requirement — all loud typed refusals.
 *
 * A14: progression composes typed plans — it never executes, never trains,
 * never steps a world. R054: method-neutral.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { stableDigest } from "skills";
import type { ExperimentEvaluation } from "evaluation";
import type { FindingsReport } from "verification";
import type { Curriculum, CurriculumStage, StageGateRequirement } from "./curriculum.js";
import { sealCurriculum } from "./curriculum.js";
import { validateCurriculum } from "./validate.js";
import type { CurriculumValidationError } from "./validate.js";

/**
 * The gate's evidence bundle: the carried W038 experiment evaluations
 * (required) and the carried W038 findings reports (required whenever a
 * stage threshold declares finding requirements). All carried DATA —
 * nothing here is re-scored, re-walked, or re-assembled.
 */
export interface StageEvidence {
  readonly evaluations: readonly ExperimentEvaluation[];
  readonly findings?: readonly FindingsReport[];
}

// ---------------------------------------------------------------------------
// The typed progression error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type ProgressionErrorCode =
  | "invalid-curriculum" // the whole-record re-validation refused (carried verbatim)
  | "curriculum-complete" // the active stage is the last — nothing to unseal
  | "duplicate-evidence" // the same evaluation id / findings digest carried twice
  | "missing-evidence" // the cited evaluation / findings report / finding is absent (R052)
  | "threshold-unmet"; // a requirement failed against the CARRIED data (never a re-score)

export interface ProgressionError {
  readonly code: ProgressionErrorCode;
  readonly message: string;
  /** The requirement that failed, on `threshold-unmet`. */
  readonly requirement?: StageGateRequirement;
  /** Present on `invalid-curriculum`: the re-validation errors, verbatim. */
  readonly validationErrors?: readonly CurriculumValidationError[];
}

export type ProgressionOutcome =
  | {
    readonly ok: true;
    readonly curriculum: Curriculum;
    /** What evidence passed the gate (the citation + the findings digests used). */
    readonly gate: { readonly evaluationId: string; readonly findingsDigests: readonly string[] };
  }
  | { readonly ok: false; readonly errors: readonly ProgressionError[] };

function error(code: ProgressionErrorCode, message: string, extras: Omit<ProgressionError, "code" | "message"> = {}): ProgressionError {
  return { code, message, ...extras };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// ---------------------------------------------------------------------------
// The requirement proofs (over the CARRIED evaluation — never re-scored)
// ---------------------------------------------------------------------------

/** Prove one requirement against the cited evaluation's own carried data. */
function requirementUnmet(requirement: StageGateRequirement, evaluation: ExperimentEvaluation): ProgressionError | null {
  switch (requirement.kind) {
    case "compliance":
      return evaluation.reduction.compliance === "compliant"
        ? null
        : error("threshold-unmet", `the carried reduction is '${String(evaluation.reduction.compliance)}', not compliant — the constraint dimension is the gate (§13: constraint-aware progression; carry never re-scores)`, { requirement });
    case "hard-violations":
      return evaluation.reduction.hardViolationCount <= requirement.max
        ? null
        : error("threshold-unmet", `the carried reduction counts ${String(evaluation.reduction.hardViolationCount)} hard violation(s) against a ceiling of ${String(requirement.max)} — hard violations are counted, never priced (§13)`, { requirement });
    case "trajectory-count":
      return evaluation.reduction.trajectoryCount >= requirement.min
        ? null
        : error("threshold-unmet", `the carried evaluation walks ${String(evaluation.reduction.trajectoryCount)} trajectory(ies) against a floor of ${String(requirement.min)} — a gate over thin evidence gates nothing`, { requirement });
    case "combined-score":
      return evaluation.reduction.combinedScoreTotal >= requirement.min
        ? null
        : error("threshold-unmet", `the carried combined-score total ${String(evaluation.reduction.combinedScoreTotal)} is below the declared floor ${String(requirement.min)} — the score dimension rides WITH the constraint dimensions (§13), never instead of them`, { requirement });
    case "integrity":
      return evaluation.integrity.some((carried) => String(carried) === requirement.requirement)
        ? null
        : error("threshold-unmet", `the carried evaluation's integrity requirements do not include '${requirement.requirement}' (${evaluation.integrity.map(String).join(", ") || "none"} carried) — integrity is carried from the W038 policy, never invented here`, { requirement });
    case "finding":
      return null; // proven against the findings reports below (needs the reports)
  }
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

/**
 * THE PROGRESSION GATE: prove the active stage's threshold against the
 * CARRIED evidence, then unseal the NEXT stage as a new curriculum
 * generation. Deterministic (A9): same curriculum + same evidence ⇒
 * deep-equal advanced curriculum, same canonical id — evidence input order
 * never matters.
 */
export function advanceStage(
  curriculum: Curriculum,
  evidence: StageEvidence,
): ProgressionOutcome {
  const errors: ProgressionError[] = [];
  const proof = validateCurriculum(curriculum);
  if (!proof.ok) {
    return { ok: false, errors: [error(
      "invalid-curriculum",
      `curriculum '${String(curriculum.curriculumId)}' failed its own whole-record re-validation (${String(proof.errors.length)} error(s), carried verbatim) — nothing advances on an unprovable curriculum`,
      { validationErrors: proof.errors },
    )] };
  }
  const evaluationIds = evidence.evaluations.map((evaluation) => String(evaluation.evaluationId));
  if (new Set(evaluationIds).size !== evaluationIds.length) {
    errors.push(error("duplicate-evidence", "the carried evidence includes the same experiment evaluation twice — one evaluation, one carry"));
  }
  const findings = evidence.findings ?? [];
  const findingDigests = findings.map((report) => String(report.digest));
  if (new Set(findingDigests).size !== findingDigests.length) {
    errors.push(error("duplicate-evidence", "the carried evidence includes the same findings report twice — one report, one carry"));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const activeIndex = curriculum.activeStage;
  const stage: CurriculumStage = curriculum.stages[activeIndex]!;
  if (activeIndex === curriculum.stages.length - 1) {
    return { ok: false, errors: [error(
      "curriculum-complete",
      `the active stage ${String(activeIndex)} is the LAST stage of curriculum '${String(curriculum.curriculumId)}' — there is no next stage to unseal (a completed curriculum is re-founded, never extended past its declared schedule)`,
    )] };
  }
  const citedId = String(stage.threshold.citation.evaluationId);
  const evaluation = evidence.evaluations.find((candidate) => String(candidate.evaluationId) === citedId);
  if (evaluation === undefined) {
    return { ok: false, errors: [error(
      "missing-evidence",
      `the active stage's threshold cites experiment evaluation '${citedId}', which the carried evidence does not include — an evidence-less gate is refused loudly (R052: no evidence-free measurement; the threshold is CARRIED from W038 evaluations)`,
    )] };
  }
  const citedReports = findings
    .filter((report) => String(report.subject) === citedId)
    .sort((left, right) => compareStrings(String(left.digest), String(right.digest)));
  for (const requirement of stage.threshold.requirements) {
    if (requirement.kind === "finding") {
      if (citedReports.length === 0) {
        errors.push(error(
          "missing-evidence",
          `the stage threshold requires finding '${requirement.claimId}' but no findings report for evaluation '${citedId}' is carried — the W038 verification verdict is evidence, and a requirement without its evidence is refused loudly (R052)`,
          { requirement },
        ));
        continue;
      }
      const finding = citedReports.flatMap((report) => report.findings).find((entry) => String(entry.claimId) === requirement.claimId);
      if (finding === undefined) {
        errors.push(error(
          "missing-evidence",
          `the carried findings report(s) for evaluation '${citedId}' declare no finding for claim '${requirement.claimId}' — the claim is declared before it is checked (W038), and an undeclared claim is missing evidence (R052)`,
          { requirement },
        ));
        continue;
      }
      if (String(finding.verdict) !== requirement.verdict) {
        errors.push(error(
          "threshold-unmet",
          `finding '${requirement.claimId}' carried verdict ${String(finding.verdict)} against the required ${requirement.verdict} — the W038 verdict is CARRIED, never re-scored`,
          { requirement },
        ));
      }
      continue;
    }
    const unmet = requirementUnmet(requirement, evaluation);
    if (unmet !== null) {
      errors.push(unmet);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const gateEvidenceDigest = stableDigest({
    evaluationId: citedId,
    evaluation,
    findings: citedReports.map((report) => report.digest),
  });
  const advanced = sealCurriculum({
    scope: curriculum.scope,
    populationId: curriculum.populationId,
    foundingGeneration: curriculum.foundingGeneration,
    stages: curriculum.stages,
    activeStage: activeIndex + 1,
    lineage: {
      parentCurriculumId: curriculum.curriculumId,
      generation: curriculum.lineage.generation + 1,
      origin: { kind: "stage-advance", fromStage: activeIndex, toStage: activeIndex + 1 },
    },
    foundedAt: curriculum.provenance.foundedAt,
    gateEvidenceDigest,
  });
  return {
    ok: true,
    curriculum: advanced,
    gate: { evaluationId: citedId, findingsDigests: citedReports.map((report) => String(report.digest)) },
  };
}
