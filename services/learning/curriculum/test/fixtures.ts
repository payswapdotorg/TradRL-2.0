/**
 * Shared deterministic fixtures for the W046 curriculum tests — REAL
 * imports only (the no-shim law): a REAL W045 population founded through
 * the populations package's own gate over its own test fixtures (the W045
 * fixture lineage), a REAL W038 experiment evaluation carried from the
 * learning-rl bridge fixture (built through createExperiment →
 * experimentManifestOf → evaluateExperiment — imported relative, the
 * W043/W044/W045 cross-package test-fixture precedent), and REAL W038
 * findings reports assembled through the verification package's own
 * assembleFindingsReport. The stage declarations are DERIVED from the
 * evaluation's own carried reduction (difficulty as measured DATA, R052 —
 * never hand-tuned numbers).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { foundPopulation } from "populations";
import type { Population } from "populations";
import { assembleFindingsReport } from "verification";
import type { Finding, FindingsReport, VerificationClaimDescriptor, Verdict } from "verification";
import type { ExperimentEvaluation } from "evaluation";
import type { StageDeclaration } from "../curriculum.js";
import { foundCurriculum } from "../curriculum.js";
import { populationMembers, populationWorldDefinition, thaw } from "../../../populations/test/fixtures.js";
import type { Writable } from "../../../populations/test/fixtures.js";
import { bridgeFixture } from "../../rl/test/fixtures.js";

export { thaw };
export type { Writable };

let cachedPopulation: Population | undefined;

/** The founding population: two agent members + one organization member (deterministic, REAL). */
export function curriculumPopulation(): Population {
  cachedPopulation ??= (() => {
    const outcome = foundPopulation(populationWorldDefinition(), populationMembers());
    if (!outcome.ok) {
      throw new Error(`curriculum fixture population failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
    }
    return outcome.population;
  })();
  return cachedPopulation;
}

let cachedEvaluation: ExperimentEvaluation | undefined;

/** A REAL W038 experiment evaluation (the learning-rl bridge fixture's own). */
export function curriculumEvaluation(): ExperimentEvaluation {
  cachedEvaluation ??= bridgeFixture(2).evaluation;
  return cachedEvaluation;
}

/** The W038 claim the findings fixture answers (§13's own always-declared claim). */
const CONSTRAINT_CLAIM: VerificationClaimDescriptor = {
  claimId: "constraint-dimension",
  kind: "constraint-dimension",
  declarationSource: "spec/ARCHITECTURE.md §13 — raw P&L is never the sole objective",
  evidenceNeedles: ["compliance", "components"],
};

/** One REAL declared finding over the constraint claim, through W038's own verdict vocabulary. */
function constraintFinding(verdict: Verdict): Finding {
  return {
    claimId: CONSTRAINT_CLAIM.claimId,
    claimKind: CONSTRAINT_CLAIM.kind,
    findingKind: "declared",
    verdict,
    evidence: ["the reduction's compliance dimension over the policy's reward components"],
  };
}

/** A REAL W038 findings report for the given evaluation subject (assembled through verification's own gate). */
export function findingsReportFor(evaluationId: string, verdict: Verdict = "PASS"): FindingsReport {
  return assembleFindingsReport(evaluationId, [CONSTRAINT_CLAIM], [constraintFinding(verdict)], []);
}

/** The canonical gate evidence: the REAL evaluation + its REAL findings report. */
export function canonicalEvidence(): { evaluations: readonly ExperimentEvaluation[]; findings: readonly FindingsReport[] } {
  const evaluation = curriculumEvaluation();
  return {
    evaluations: [evaluation],
    findings: [findingsReportFor(String(evaluation.evaluationId))],
  };
}

/** Difficulty atoms MEASURED from the evaluation's own carried reduction (R052 — data, never hand-tuned). */
function measuredDifficulty(evaluation: ExperimentEvaluation): StageDeclaration["difficulty"] {
  const citation = { evaluationId: String(evaluation.evaluationId) };
  return [
    { dimension: "combined-score-total", value: evaluation.reduction.combinedScoreTotal, measuredFrom: citation },
    { dimension: "hard-violation-count", value: evaluation.reduction.hardViolationCount, measuredFrom: citation },
    { dimension: "trajectory-count", value: evaluation.reduction.trajectoryCount, measuredFrom: citation },
  ];
}

/**
 * The canonical two-stage schedule over the population: stage 0 runs
 * against the population's own generation, stage 1 against the next; both
 * thresholds cite the REAL evaluation and are met by its OWN carried
 * values (constraint-aware — §13 — with a score floor riding WITH the
 * compliance requirement, never instead of it).
 */
export function canonicalStages(): StageDeclaration[] {
  const evaluation = curriculumEvaluation();
  const population = curriculumPopulation();
  const citation = { evaluationId: String(evaluation.evaluationId) };
  const stageZero: StageDeclaration = {
    populationGeneration: population.lineage.generation,
    difficulty: measuredDifficulty(evaluation),
    threshold: {
      citation,
      requirements: [
        { kind: "compliance" },
        { kind: "hard-violations", max: evaluation.reduction.hardViolationCount },
        { kind: "trajectory-count", min: evaluation.reduction.trajectoryCount },
        { kind: "integrity", requirement: String(evaluation.integrity[0] ?? "evidence-chain") },
        { kind: "finding", claimId: "constraint-dimension", verdict: "PASS" },
      ],
    },
  };
  const stageOne: StageDeclaration = {
    populationGeneration: population.lineage.generation + 1,
    difficulty: measuredDifficulty(evaluation),
    threshold: {
      citation,
      requirements: [
        { kind: "compliance" },
        { kind: "trajectory-count", min: 1 },
      ],
    },
  };
  return [stageZero, stageOne];
}

/** The canonical curriculum: the REAL population + the canonical schedule. */
export function canonicalCurriculum() {
  const population = curriculumPopulation();
  const outcome = foundCurriculum(population, canonicalStages());
  if (!outcome.ok) {
    throw new Error(`canonical curriculum fixture failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return { population, curriculum: outcome.curriculum };
}
