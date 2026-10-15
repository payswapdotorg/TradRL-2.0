/**
 * The A9 determinism twins (W048): same inputs ⇒ deep-equal plan with the
 * identical content-addressed ids; input order NEVER leaks (a permuted
 * founding declaration yields the identical population — W045's own twin
 * law — and therefore the identical plan); any differing declared input ⇒
 * a different plan id.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { planGeneration } from "../plan.js";
import {
  COMPUTE_BATCH_POLICY,
  COMPUTE_SHARDING,
  canonicalPlan,
  canonicalPopulation,
  populationOver,
} from "./fixtures.js";
import { additionMember, populationMembers } from "../../../populations/test/fixtures.js";

test("the A9 twin: identical inputs yield the deep-equal plan with the identical id", () => {
  const first = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  const second = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  assert.ok(first.ok && second.ok);
  assert.equal(String(first.plan.planId), String(second.plan.planId));
  assert.deepEqual(first.plan, second.plan);
  assert.equal(String(first.plan.planId), String(canonicalPlan().planId));
});

test("input order never leaks: a permuted founding declaration yields the identical plan", () => {
  const straight = populationOver(populationMembers());
  const permuted = populationOver([...populationMembers()].reverse());
  assert.deepEqual(straight, permuted);

  const first = planGeneration(straight, COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  const second = planGeneration(permuted, COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  assert.ok(first.ok && second.ok);
  assert.equal(String(first.plan.planId), String(second.plan.planId));
  assert.deepEqual(first.plan, second.plan);
  // and the shard assignment is identical: canonical member order, not input order
  const ids = canonicalPopulation().membership.map((member) => String(member.bindingId));
  assert.deepEqual(first.plan.units[0]!.shard.memberIds, ids.slice(0, 2));
  assert.deepEqual(second.plan.units[0]!.shard.memberIds, ids.slice(0, 2));
});

test("any differing declared input yields a different plan id", () => {
  const base = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  const otherSharding = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, {
    ...COMPUTE_SHARDING,
    shardCount: 3,
  });
  const otherPolicy = planGeneration(canonicalPopulation(), { ...COMPUTE_BATCH_POLICY, policyId: "sel-other" }, COMPUTE_SHARDING);
  const otherQuota = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, {
    ...COMPUTE_SHARDING,
    episodesPerUnit: 5,
  });
  assert.ok(base.ok && otherSharding.ok && otherPolicy.ok && otherQuota.ok);
  assert.notEqual(String(base.plan.planId), String(otherSharding.plan.planId));
  assert.notEqual(String(base.plan.planId), String(otherPolicy.plan.planId));
  assert.notEqual(String(base.plan.planId), String(otherQuota.plan.planId));
  // a differing population (a different membership ⇒ a different content-addressed
  // population id) takes a different plan, and the same population re-founded
  // (deep-equal record) takes the identical plan
  const sameMembers = planGeneration(populationOver([...populationMembers()]), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
  const grown = planGeneration(populationOver([...populationMembers(), additionMember()]), COMPUTE_BATCH_POLICY, {
    ...COMPUTE_SHARDING,
    shardCount: 2,
  });
  assert.ok(sameMembers.ok && grown.ok);
  assert.equal(String(sameMembers.plan.planId), String(base.plan.planId));
  assert.notEqual(String(grown.plan.planId), String(base.plan.planId));
});
