/**
 * The generation-plan gate laws (W048) over a REAL W045 population: the
 * happy path (the sealed plan, the canonical shard partition, the
 * content-addressed ids, the frozen record) and every refusal law (the
 * W045 population re-proof carried verbatim, the W047 batch-policy
 * vocabulary, the closed-set sharding declarations).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePopulation } from "populations";
import { planGeneration } from "../plan.js";
import type { ShardingAxis } from "../plan.js";
import {
  COMPUTE_BATCH_POLICY,
  COMPUTE_SHARDING,
  canonicalMemberIds,
  canonicalPlan,
  canonicalPopulation,
  thaw,
} from "./fixtures.js";

test("the canonical plan seals over the real population", () => {
  const population = canonicalPopulation();
  const plan = canonicalPlan();
  assert.equal(String(plan.planId).startsWith("genplan-"), true);
  assert.equal(plan.kind, "generation-plan");
  assert.deepEqual(plan.scope, population.scope);
  assert.equal(plan.population, population);
  assert.deepEqual(plan.batchPolicy, COMPUTE_BATCH_POLICY);
  assert.deepEqual(plan.sharding, COMPUTE_SHARDING);
  assert.deepEqual(plan.lineage, {
    populationId: population.populationId,
    populationGeneration: population.lineage.generation,
  });
  assert.deepEqual(plan.provenance, {
    plannedSealedAt: population.provenance.sealedAt,
    memberCount: 3,
    unitCount: 2,
  });
});

test("the work units carry the canonical contiguous shard partition", () => {
  const plan = canonicalPlan();
  const ids = canonicalMemberIds();
  assert.equal(plan.units.length, 2);
  const [first, second] = plan.units;
  assert.ok(first !== undefined && second !== undefined);

  assert.deepEqual(first.shard, { axis: "member", shardIndex: 0, shardCount: 2, memberIds: ids.slice(0, 2) });
  assert.deepEqual(second.shard, { axis: "member", shardIndex: 1, shardCount: 2, memberIds: ids.slice(2, 3) });

  assert.deepEqual(first.populationSlice.map((member) => String(member.bindingId)), ids.slice(0, 2));
  assert.deepEqual(second.populationSlice.map((member) => String(member.bindingId)), ids.slice(2, 3));
  // the slices CARRY the population's own frozen member objects (carry, never re-score)
  assert.equal(first.populationSlice[0], canonicalPopulation().membership[0]);

  for (const unit of plan.units) {
    assert.equal(String(unit.unitId).startsWith("genunit-"), true);
    assert.equal(String(unit.batch.declaredBatchId).startsWith("gbatch-"), true);
    assert.deepEqual(unit.batch.selectionPolicy, COMPUTE_BATCH_POLICY);
    assert.equal(unit.batch.declaredEpisodeCount, COMPUTE_SHARDING.episodesPerUnit);
    assert.deepEqual(unit.scope, plan.scope);
  }
  assert.notEqual(String(first.unitId), String(second.unitId));
  assert.notEqual(String(first.batch.declaredBatchId), String(second.batch.declaredBatchId));
});

test("the sealed plan is deeply frozen (immutable data)", () => {
  const plan = canonicalPlan();
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.units), true);
  for (const unit of plan.units) {
    assert.equal(Object.isFrozen(unit), true);
    assert.equal(Object.isFrozen(unit.shard), true);
    assert.equal(Object.isFrozen(unit.batch), true);
  }
});

test("an invalid population is refused with W045's own errors carried verbatim", () => {
  const broken = thaw(canonicalPopulation());
  broken.scope = { ...broken.scope, worldId: "" };
  const expected = validatePopulation(broken);
  assert.equal(expected.ok, false);
  assert.ok(!expected.ok);

  const outcome = planGeneration(broken, COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  assert.equal(outcome.ok, false);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-population");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.populationErrors !== undefined);
  assert.deepEqual(refusal.populationErrors, expected.errors);
});

test("a batch policy outside W047's declared vocabulary is refused", () => {
  const blankId = planGeneration(canonicalPopulation(), { policyId: "   ", parameters: [] }, COMPUTE_SHARDING);
  assert.ok(!blankId.ok);
  assert.equal(blankId.errors.some((entry) => entry.code === "blank-policy-id"), true);

  const blankName = planGeneration(
    canonicalPopulation(),
    { policyId: "sel-x", parameters: [{ name: " ", value: 1 }] },
    COMPUTE_SHARDING,
  );
  assert.ok(!blankName.ok);
  assert.equal(blankName.errors.some((entry) => entry.code === "blank-parameter-name"), true);

  const duplicateName = planGeneration(
    canonicalPopulation(),
    { policyId: "sel-x", parameters: [{ name: "minSteps", value: 1 }, { name: "minSteps", value: 2 }] },
    COMPUTE_SHARDING,
  );
  assert.ok(!duplicateName.ok);
  assert.equal(duplicateName.errors.some((entry) => entry.code === "duplicate-parameter-name"), true);
});

test("a sharding axis outside the closed vocabulary is refused", () => {
  const outcome = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, {
    ...COMPUTE_SHARDING,
    axis: "session" as ShardingAxis,
  });
  assert.ok(!outcome.ok);
  assert.equal(outcome.errors.some((entry) => entry.code === "unknown-sharding-axis"), true);
});

test("an invalid shard count is refused (non-positive, non-integer, or exceeding the membership)", () => {
  for (const shardCount of [0, -1, 2.5, 4]) {
    const outcome = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, { ...COMPUTE_SHARDING, shardCount });
    assert.ok(!outcome.ok);
    assert.equal(outcome.errors.some((entry) => entry.code === "invalid-shard-count"), true);
  }
});

test("an invalid per-unit episode quota is refused", () => {
  for (const episodesPerUnit of [0, -2, 1.5]) {
    const outcome = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, { ...COMPUTE_SHARDING, episodesPerUnit });
    assert.ok(!outcome.ok);
    assert.equal(outcome.errors.some((entry) => entry.code === "invalid-episode-quota"), true);
  }
});

test("a single-shard plan carries the whole membership as one slice", () => {
  const outcome = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, {
    ...COMPUTE_SHARDING,
    shardCount: 1,
  });
  assert.ok(outcome.ok);
  assert.ok(outcome.ok);
  assert.equal(outcome.plan.units.length, 1);
  assert.deepEqual(outcome.plan.units[0]!.shard.memberIds, canonicalMemberIds());
});
