/**
 * The progression-gate laws (W046) — THE GATE: the active stage's threshold
 * proven against the CARRIED W038 evaluation summaries + findings reports
 * (never re-scored), then the NEXT stage unsealed as a new curriculum
 * generation. Every refusal law gets its own probe.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { advanceStage } from "../progression.js";
import type { ProgressionError, ProgressionOutcome, StageEvidence } from "../progression.js";
import { validateCurriculum } from "../validate.js";
import { canonicalCurriculum, canonicalEvidence, canonicalStages, curriculumEvaluation, curriculumPopulation, findingsReportFor, thaw } from "./fixtures.js";
import { foundCurriculum } from "../curriculum.js";

function refusalsOf(outcome: ProgressionOutcome): readonly ProgressionError[] {
  if (outcome.ok) {
    assert.fail(`expected a refusal, got ${String(outcome.curriculum.curriculumId)}`);
  }
  return outcome.errors;
}

function sealedOf(outcome: ProgressionOutcome): { curriculum: import("../curriculum.js").Curriculum; gate: { evaluationId: string; findingsDigests: readonly string[] } } {
  if (!outcome.ok) {
    assert.fail(`expected an unsealed stage, got ${refusalsOf(outcome).map((entry) => entry.code).join(", ")}`);
  }
  return outcome;
}

test("the gate unseals the next stage: a new generation, lineage extended, schedule carried verbatim", () => {
  const { curriculum } = canonicalCurriculum();
  const outcome = sealedOf(advanceStage(curriculum, canonicalEvidence()));
  const advanced = outcome.curriculum;
  assert.equal(advanced.activeStage, 1);
  assert.equal(advanced.lineage.parentCurriculumId, curriculum.curriculumId);
  assert.equal(advanced.lineage.generation, curriculum.lineage.generation + 1);
  assert.deepEqual(advanced.lineage.origin, { kind: "stage-advance", fromStage: 0, toStage: 1 });
  assert.deepEqual(advanced.stages, curriculum.stages);
  assert.equal(advanced.populationId, curriculum.populationId);
  assert.equal(advanced.foundingGeneration, curriculum.foundingGeneration);
  assert.equal(advanced.provenance.foundedAt, curriculum.provenance.foundedAt);
  assert.ok(advanced.provenance.gateEvidenceDigest !== null && advanced.provenance.gateEvidenceDigest.length > 0);
  assert.notEqual(String(advanced.curriculumId), String(curriculum.curriculumId));
  assert.equal(outcome.gate.evaluationId, String(curriculumEvaluation().evaluationId));
  assert.equal(outcome.gate.findingsDigests.length, 1);
  const proof = validateCurriculum(advanced);
  assert.equal(proof.ok, true);
});

test("the second advance gates the SECOND stage's threshold — and a completed curriculum refuses loudly", () => {
  const { curriculum } = canonicalCurriculum();
  const first = sealedOf(advanceStage(curriculum, canonicalEvidence()));
  const second = advanceStage(first.curriculum, canonicalEvidence());
  const refusal = refusalsOf(second).find((entry) => entry.code === "curriculum-complete");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /LAST stage/);
});

test("an unmet trajectory-count floor refuses the advance (carry, never re-score)", () => {
  const population = curriculumPopulation();
  const stages = thaw(canonicalStages());
  stages[0]!.threshold.requirements = [
    { kind: "compliance" },
    { kind: "trajectory-count", min: curriculumEvaluation().reduction.trajectoryCount + 1 },
  ];
  const founded = foundCurriculum(population, stages);
  assert.ok(founded.ok);
  const outcome = advanceStage(founded.curriculum, canonicalEvidence());
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "threshold-unmet");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /trajectory-count|trajectory\(ies\)/);
  assert.ok(refusal.requirement !== undefined);
});

test("an unmet combined-score floor refuses the advance — the score rides WITH the constraints", () => {
  const population = curriculumPopulation();
  const stages = thaw(canonicalStages());
  stages[0]!.threshold.requirements = [
    { kind: "compliance" },
    { kind: "combined-score", min: curriculumEvaluation().reduction.combinedScoreTotal + 1 },
  ];
  const founded = foundCurriculum(population, stages);
  assert.ok(founded.ok);
  const outcome = advanceStage(founded.curriculum, canonicalEvidence());
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "threshold-unmet");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /§13/);
});

test("an unmet hard-violation ceiling refuses the advance", () => {
  const population = curriculumPopulation();
  const evaluation = curriculumEvaluation();
  const stages = thaw(canonicalStages());
  stages[0]!.threshold.requirements = [
    { kind: "compliance" },
    { kind: "hard-violations", max: Math.max(0, evaluation.reduction.hardViolationCount - 1) },
  ];
  const founded = foundCurriculum(population, stages);
  assert.ok(founded.ok);
  const outcome = advanceStage(founded.curriculum, canonicalEvidence());
  if (evaluation.reduction.hardViolationCount > 0) {
    const refusal = refusalsOf(outcome).find((entry) => entry.code === "threshold-unmet" && entry.message.includes("hard violation"));
    assert.ok(refusal !== undefined);
  } else {
    // a zero-violation carry meets every ceiling ≥ 0 — the gate unseals
    assert.ok(outcome.ok);
  }
});

test("an integrity requirement the evaluation does not carry refuses the advance", () => {
  const population = curriculumPopulation();
  const stages = thaw(canonicalStages());
  stages[0]!.threshold.requirements = [
    { kind: "compliance" },
    { kind: "integrity", requirement: "not-a-carried-integrity-kind" },
  ];
  const founded = foundCurriculum(population, stages);
  assert.ok(founded.ok);
  const outcome = advanceStage(founded.curriculum, canonicalEvidence());
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "threshold-unmet" && entry.message.includes("integrity"));
  assert.ok(refusal !== undefined);
});

test("a required finding verdict that disagrees with the carried report refuses the advance", () => {
  const population = curriculumPopulation();
  const stages = thaw(canonicalStages());
  stages[0]!.threshold.requirements = [
    { kind: "compliance" },
    { kind: "finding", claimId: "constraint-dimension", verdict: "FAIL" },
  ];
  const founded = foundCurriculum(population, stages);
  assert.ok(founded.ok);
  const outcome = advanceStage(founded.curriculum, canonicalEvidence());
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "threshold-unmet" && entry.message.includes("constraint-dimension"));
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /never re-scored/);
});

test("a required finding whose report is absent is missing evidence (R052)", () => {
  const { curriculum } = canonicalCurriculum();
  const evaluation = curriculumEvaluation();
  const outcome = advanceStage(curriculum, { evaluations: [evaluation] });
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "missing-evidence" && entry.message.includes("no findings report"));
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /R052/);
});

test("a findings report for the WRONG subject does not satisfy the requirement", () => {
  const { curriculum } = canonicalCurriculum();
  const evaluation = curriculumEvaluation();
  const outcome = advanceStage(curriculum, {
    evaluations: [evaluation],
    findings: [findingsReportFor("expeval-not-the-cited-one")],
  } satisfies StageEvidence);
  assert.ok(refusalsOf(outcome).some((entry) => entry.code === "missing-evidence"));
});

test("the cited evaluation absent from the carried evidence is missing evidence (R052)", () => {
  const { curriculum } = canonicalCurriculum();
  const outcome = advanceStage(curriculum, { evaluations: [], findings: [] });
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "missing-evidence" && entry.message.includes("cites experiment evaluation"));
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /R052/);
});

test("duplicate carried evidence is refused (one evaluation, one carry)", () => {
  const { curriculum } = canonicalCurriculum();
  const evidence = canonicalEvidence();
  const outcome = advanceStage(curriculum, { evaluations: [...evidence.evaluations, ...evidence.evaluations], findings: evidence.findings });
  assert.ok(refusalsOf(outcome).some((entry) => entry.code === "duplicate-evidence"));
});

test("an unprovable curriculum refuses to advance, validation errors carried verbatim", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.activeStage = 7;
  const outcome = advanceStage(tampered, canonicalEvidence());
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "invalid-curriculum");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.validationErrors !== undefined && refusal.validationErrors.some((carried) => carried.code === "active-stage-invalid"));
});

test("the gate is deterministic: the same evidence always unseals the deep-equal next generation", () => {
  const { curriculum } = canonicalCurriculum();
  const first = sealedOf(advanceStage(curriculum, canonicalEvidence()));
  const second = sealedOf(advanceStage(curriculum, canonicalEvidence()));
  assert.deepEqual(first.curriculum, second.curriculum);
  assert.equal(String(first.curriculum.curriculumId), String(second.curriculum.curriculumId));
  assert.equal(first.gate.evaluationId, second.gate.evaluationId);
});
