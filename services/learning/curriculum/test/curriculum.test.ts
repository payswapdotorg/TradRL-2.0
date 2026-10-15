/**
 * The founding-gate laws (W046) — REAL imports only: the REAL W045
 * population fixture lineage and the REAL W038 evaluation carried from the
 * learning-rl bridge fixture. Every founding law gets its own probe.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { foundCurriculum } from "../curriculum.js";
import type { CurriculumError, CurriculumOutcome } from "../curriculum.js";
import { canonicalCurriculum, canonicalStages, curriculumEvaluation, curriculumPopulation, thaw } from "./fixtures.js";

function refusalsOf(outcome: CurriculumOutcome): readonly CurriculumError[] {
  if (outcome.ok) {
    assert.fail(`expected a refusal, got ${String(outcome.curriculum.curriculumId)}`);
  }
  return outcome.errors;
}

test("a curriculum is founded over a REAL population with a content-addressed curr- id", () => {
  const { curriculum, population } = canonicalCurriculum();
  assert.equal(curriculum.kind, "curriculum");
  assert.match(String(curriculum.curriculumId), /^curr-/);
  assert.equal(curriculum.populationId, population.populationId);
  assert.equal(curriculum.foundingGeneration, population.lineage.generation);
  assert.equal(curriculum.activeStage, 0);
  assert.equal(curriculum.stages.length, 2);
  assert.equal(curriculum.stages[0]!.populationGeneration, population.lineage.generation);
  assert.equal(curriculum.stages[1]!.populationGeneration, population.lineage.generation + 1);
  assert.deepEqual(curriculum.lineage, { parentCurriculumId: null, generation: 0, origin: { kind: "founding" } });
  assert.equal(curriculum.provenance.foundedAt, population.provenance.sealedAt);
  assert.equal(curriculum.provenance.gateEvidenceDigest, null);
  assert.deepEqual(curriculum.scope, {
    tenantId: population.scope.tenantId,
    projectId: population.scope.projectId,
    worldId: population.scope.worldId,
  });
});

test("the founding population is re-proven through W045's own validator, errors carried verbatim", () => {
  const tampered = thaw(curriculumPopulation());
  tampered.provenance.sealedAt = tampered.provenance.sealedAt + 1;
  const outcome = foundCurriculum(tampered, canonicalStages());
  assert.ok(!outcome.ok);
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "invalid-population");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.populationErrors !== undefined && refusal.populationErrors.length > 0);
  assert.ok(refusal.populationErrors.some((carried) => carried.code === "invalid-provenance" || carried.code === "identity-mismatch"));
});

test("an empty schedule is refused loudly", () => {
  const outcome = foundCurriculum(curriculumPopulation(), []);
  assert.ok(!outcome.ok);
  assert.ok(refusalsOf(outcome).some((entry) => entry.code === "empty-stages"));
});

test("a first stage that misses the population's own generation is refused", () => {
  const stages = thaw(canonicalStages());
  stages[0]!.populationGeneration = curriculumPopulation().lineage.generation + 1;
  stages[1]!.populationGeneration = curriculumPopulation().lineage.generation + 2;
  const outcome = foundCurriculum(curriculumPopulation(), stages);
  assert.ok(!outcome.ok);
  assert.ok(refusalsOf(outcome).some((entry) => entry.code === "stage-generation" && entry.message.includes("OWN generation")));
});

test("a stage that skips a population generation is refused — every advance is exactly one new generation", () => {
  const stages = thaw(canonicalStages());
  stages[1]!.populationGeneration = stages[1]!.populationGeneration + 1;
  const outcome = foundCurriculum(curriculumPopulation(), stages);
  assert.ok(!outcome.ok);
  assert.ok(refusalsOf(outcome).some((entry) => entry.code === "stage-generation" && entry.message.includes("EXACTLY one new population generation")));
});

test("an evidence-less stage threshold is refused loudly, naming R052", () => {
  const stages = thaw(canonicalStages());
  stages[0]!.threshold.citation.evaluationId = "";
  const outcome = foundCurriculum(curriculumPopulation(), stages);
  assert.ok(!outcome.ok);
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "threshold-evidence-less");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /R052/);
});

test("a hand-tuned difficulty atom without a measurement citation is refused loudly, naming R052", () => {
  const stages = thaw(canonicalStages());
  stages[0]!.difficulty[0]!.measuredFrom.evaluationId = "";
  const outcome = foundCurriculum(curriculumPopulation(), stages);
  assert.ok(!outcome.ok);
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "threshold-evidence-less" && entry.message.includes("difficulty atom"));
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /R052/);
  assert.match(refusal.message, /never hand-tuned/);
});

test("a bare-P&L gate is refused loudly, naming the §13 sole-P&L law", () => {
  const stages = thaw(canonicalStages());
  const evaluation = curriculumEvaluation();
  stages[0]!.threshold.requirements = [
    { kind: "combined-score", min: evaluation.reduction.combinedScoreTotal - 1 },
  ];
  const outcome = foundCurriculum(curriculumPopulation(), stages);
  assert.ok(!outcome.ok);
  const refusal = refusalsOf(outcome).find((entry) => entry.code === "bare-pnl-gate");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /Raw P&L is never the sole objective/);
  assert.match(refusal.message, /§13/);
});

test("a constraint-aware score floor rides WITH the compliance requirement and founds", () => {
  const stages = thaw(canonicalStages());
  const evaluation = curriculumEvaluation();
  stages[0]!.threshold.requirements = [
    { kind: "compliance" },
    { kind: "combined-score", min: evaluation.reduction.combinedScoreTotal },
  ];
  const outcome = foundCurriculum(curriculumPopulation(), stages);
  assert.equal(outcome.ok, true);
});

test("malformed gate requirements are refused (min below one, negative ceiling, bad verdict)", () => {
  const cases: [string, unknown[]][] = [
    ["trajectory-count", [{ kind: "trajectory-count", min: 0 }]],
    ["hard-violations", [{ kind: "hard-violations", max: -1 }]],
    ["finding", [{ kind: "finding", claimId: "constraint-dimension", verdict: "MAYBE" as never }]],
    ["no requirements", []],
  ];
  for (const [label, requirements] of cases) {
    const stages = thaw(canonicalStages());
    stages[0]!.threshold.requirements = requirements as never;
    const outcome = foundCurriculum(curriculumPopulation(), stages);
    assert.ok(!outcome.ok, label);
    assert.ok(refusalsOf(outcome).some((entry) => entry.code === "requirement-invalid"), label);
  }
});

test("difficulty atoms are law-bound: blank dimension, duplicate dimension, non-finite value", () => {
  const blank = thaw(canonicalStages());
  blank[0]!.difficulty[0]!.dimension = "";
  const duplicate = thaw(canonicalStages());
  duplicate[0]!.difficulty[1]!.dimension = duplicate[0]!.difficulty[0]!.dimension;
  const nonFinite = thaw(canonicalStages());
  nonFinite[0]!.difficulty[0]!.value = Number.NaN;
  for (const stages of [blank, duplicate, nonFinite]) {
    const outcome = foundCurriculum(curriculumPopulation(), stages);
    assert.ok(!outcome.ok);
    assert.ok(refusalsOf(outcome).some((entry) => entry.code === "difficulty-invalid"));
  }
});

test("stage input order never leaks: permuted stages found the deep-equal curriculum with the same id", () => {
  const population = curriculumPopulation();
  const first = foundCurriculum(population, canonicalStages());
  const second = foundCurriculum(population, [...canonicalStages()].reverse());
  if (!first.ok || !second.ok) {
    assert.fail("expected both to found");
  }
  assert.deepEqual(first.curriculum, second.curriculum);
  assert.equal(String(first.curriculum.curriculumId), String(second.curriculum.curriculumId));
});

test("difficulty atoms and requirements are sealed in canonical order regardless of declaration order", () => {
  const population = curriculumPopulation();
  const stages = thaw(canonicalStages());
  stages[0]!.difficulty.reverse();
  stages[0]!.threshold.requirements.reverse();
  const outcome = foundCurriculum(population, stages);
  if (!outcome.ok) {
    assert.fail(`expected a founded curriculum, got ${refusalsOf(outcome).map((entry) => entry.code).join(", ")}`);
  }
  const canonical = foundCurriculum(population, canonicalStages());
  if (!canonical.ok) {
    assert.fail("expected the canonical founding to succeed");
  }
  assert.deepEqual(outcome.curriculum, canonical.curriculum);
});

test("the founding population and the founding membership are the REAL W045 fixtures", () => {
  const population = curriculumPopulation();
  assert.equal(population.membership.length, 3);
  assert.equal(population.view.census.memberCount, 3);
});

test("the sealed curriculum is deeply frozen", () => {
  const { curriculum } = canonicalCurriculum();
  assert.ok(Object.isFrozen(curriculum));
  assert.ok(Object.isFrozen(curriculum.stages));
  assert.ok(Object.isFrozen(curriculum.stages[0]!.threshold));
  assert.ok(Object.isFrozen(curriculum.stages[0]!.difficulty));
});
