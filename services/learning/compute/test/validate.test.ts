/**
 * The whole-plan re-validation laws (W048): the canonical plan re-proves
 * from its own recorded data alone, and every tampered record is refused
 * with the named law — identity, population carry, scope/world agreement,
 * sharding declarations, batch-policy vocabulary, the canonical shard
 * partition, the declared batch descriptors, the lineage, the provenance.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePopulation } from "populations";
import { validateGenerationPlan } from "../validate.js";
import type { DeclaredBatchId, GenerationUnitId } from "../plan.js";
import { canonicalPlan, thaw, thawedPlan } from "./fixtures.js";

test("the canonical plan re-proves from its own recorded data alone", () => {
  const outcome = validateGenerationPlan(canonicalPlan());
  assert.ok(outcome.ok);
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.checked, [
    "identity",
    "population",
    "scope",
    "sharding",
    "batch-policy",
    "units",
    "shard-partition",
    "unit-identities",
    "lineage",
    "provenance",
  ]);
});

test("a drifted plan id is refused (identity-mismatch)", () => {
  const plan = thawedPlan();
  plan.planId = `genplan-deadbeef${String(plan.planId).slice(9)}` as typeof plan.planId;
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "identity-mismatch"), true);
});

test("a drifted scope is refused (invalid-scope + scope-mismatch)", () => {
  const blank = thawedPlan();
  blank.scope = { ...blank.scope, worldId: " " };
  const blankOutcome = validateGenerationPlan(blank);
  assert.ok(!blankOutcome.ok);
  assert.equal(blankOutcome.errors.some((entry) => entry.code === "invalid-scope"), true);

  const foreign = thawedPlan();
  foreign.scope = { ...foreign.scope, worldId: "world-elsewhere" };
  const foreignOutcome = validateGenerationPlan(foreign);
  assert.ok(!foreignOutcome.ok);
  assert.equal(foreignOutcome.errors.some((entry) => entry.code === "scope-mismatch"), true);
  assert.equal(foreignOutcome.errors.some((entry) => entry.code === "identity-mismatch"), true);
});

test("a unit scope that disagrees with the plan is refused (scope-mismatch)", () => {
  const plan = thawedPlan();
  plan.units[0]!.scope = { ...plan.units[0]!.scope, projectId: "project-elsewhere" };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "scope-mismatch"), true);
});

test("a drifted carried population is refused with W045's errors carried verbatim (invalid-population)", () => {
  const plan = thawedPlan();
  plan.population = thaw(plan.population);
  plan.population.view = { ...plan.population.view, census: { ...plan.population.view.census, memberCount: 99 } };
  const expected = validatePopulation(plan.population);
  assert.ok(!expected.ok);
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-population");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.populationErrors !== undefined);
  assert.deepEqual(refusal.populationErrors, expected.errors);
});

test("a drifted sharding declaration is refused (invalid-sharding)", () => {
  const plan = thawedPlan();
  plan.sharding = { ...plan.sharding, episodesPerUnit: 0 };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-sharding"), true);
});

test("a drifted batch policy is refused (invalid-batch-policy)", () => {
  const plan = thawedPlan();
  plan.batchPolicy = { policyId: "", parameters: [] };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-batch-policy"), true);
  assert.equal(outcome.errors.some((entry) => entry.code === "batch-policy-mismatch"), true);
});

test("a dropped work unit is refused (unit-count-mismatch + identity drift)", () => {
  const plan = thawedPlan();
  plan.units = plan.units.slice(0, 1);
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "unit-count-mismatch"), true);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-provenance"), true);
});

test("a duplicated shard assignment is refused (duplicate-shard-assignment + shard-order)", () => {
  const plan = thawedPlan();
  plan.units[1]!.shard = { ...plan.units[1]!.shard, shardIndex: 0 };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "duplicate-shard-assignment"), true);
  assert.equal(outcome.errors.some((entry) => entry.code === "shard-order"), true);
});

test("a member assigned to two shards is refused (duplicate-shard-assignment)", () => {
  const plan = thawedPlan();
  const duplicated = [...plan.units[0]!.populationSlice, ...plan.units[1]!.populationSlice];
  plan.units[1]!.populationSlice = duplicated;
  plan.units[1]!.shard = {
    ...plan.units[1]!.shard,
    memberIds: duplicated.map((member) => String(member.bindingId)),
  };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "duplicate-shard-assignment"), true);
  assert.equal(outcome.errors.some((entry) => entry.code === "slice-mismatch"), true);
});

test("swapped population slices are refused (slice-mismatch)", () => {
  const plan = thawedPlan();
  const first = plan.units[0]!.populationSlice;
  plan.units[0]!.populationSlice = plan.units[1]!.populationSlice;
  plan.units[1]!.populationSlice = first;
  plan.units[0]!.shard = { ...plan.units[0]!.shard, memberIds: first.map((member) => String(member.bindingId)).slice(0, 1) };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "slice-mismatch"), true);
});

test("a drifted unit id is refused (unit-identity-mismatch)", () => {
  const plan = thawedPlan();
  plan.units[0]!.unitId = `genunit-deadbeef${String(plan.units[0]!.unitId).slice(8)}` as GenerationUnitId;
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "unit-identity-mismatch"), true);
  assert.equal(outcome.errors.some((entry) => entry.code === "batch-identity-mismatch"), true);
});

test("a drifted declared batch id is refused (batch-identity-mismatch)", () => {
  const plan = thawedPlan();
  plan.units[1]!.batch = { ...plan.units[1]!.batch, declaredBatchId: `gbatch-deadbeef${String(plan.units[1]!.batch.declaredBatchId).slice(8)}` as DeclaredBatchId };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "batch-identity-mismatch"), true);
});

test("a unit policy that is not the plan's is refused (batch-policy-mismatch)", () => {
  const plan = thawedPlan();
  plan.units[0]!.batch = {
    ...plan.units[0]!.batch,
    selectionPolicy: { policyId: "sel-elsewhere", parameters: [] },
  };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "batch-policy-mismatch"), true);
});

test("a drifted declared episode count is refused (declared-count-mismatch)", () => {
  const plan = thawedPlan();
  plan.units[0]!.batch = { ...plan.units[0]!.batch, declaredEpisodeCount: 7 };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "declared-count-mismatch"), true);
});

test("a drifted lineage is refused (lineage-invalid)", () => {
  const plan = thawedPlan();
  plan.lineage = { ...plan.lineage, populationGeneration: 3 };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "lineage-invalid"), true);
});

test("a drifted provenance is refused (invalid-provenance)", () => {
  const plan = thawedPlan();
  plan.provenance = { ...plan.provenance, memberCount: 42 };
  const outcome = validateGenerationPlan(plan);
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "invalid-provenance"), true);
});
