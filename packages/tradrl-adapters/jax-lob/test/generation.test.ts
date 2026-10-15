/**
 * The GenerationWorkerPort-facing projection laws (W049): how a W048
 * generation plan/work unit projects to LOB-style environment
 * declarations — the happy paths over the REAL W048 compute fixture
 * plan, W048's OWN whole-plan errors carried VERBATIM on a tampered
 * plan, the vocabulary and scope refusals.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateGenerationPlan } from "learning-compute";
import { lobEnvironmentDeclarationsOf } from "../lob-generation.js";
import { lobEpisodeStepShapeOf } from "../lob-vocabulary.js";
import type { LobEpisodeStepShape } from "../lob-vocabulary.js";
import {
  LOB_SHAPE,
  MINIMAL_SHAPE,
  canonicalDeclarations,
  canonicalGenerationPlan,
  thaw,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// The happy paths over the REAL W048 plan
// ---------------------------------------------------------------------------

test("a REAL W048 plan projects to one environment per work unit in canonical shard order", () => {
  const plan = canonicalGenerationPlan();
  const outcome = lobEnvironmentDeclarationsOf(plan, LOB_SHAPE);
  assert.ok(outcome.ok);
  assert.ok(outcome.ok);
  const declarations = outcome.declarations;
  assert.equal(String(declarations.mappingId).startsWith("lobgen-"), true);
  assert.equal(declarations.planId, plan.planId);
  assert.equal(declarations.unitCount, plan.units.length);
  assert.equal(declarations.unitCount, plan.sharding.shardCount);
  declarations.environments.forEach((environment, index) => {
    const unit = plan.units[index]!;
    assert.equal(String(environment.environmentId).startsWith("lobenv-"), true);
    assert.equal(environment.planId, plan.planId);
    assert.equal(environment.unitId, unit.unitId);
    assert.equal(environment.shardIndex, unit.shard.shardIndex);
    assert.equal(environment.shardIndex, index);
    assert.equal(environment.memberCount, unit.populationSlice.length);
    assert.equal(environment.declaredEpisodeCount, unit.batch.declaredEpisodeCount);
    assert.equal(environment.declaredEpisodeCount, plan.sharding.episodesPerUnit);
    assert.deepEqual(environment.shape.stepKinds, LOB_SHAPE.stepKinds);
  });
  // every environment cites a DISTINCT unit (the units' own opaque ids)
  const unitIds = declarations.environments.map((environment) => String(environment.unitId));
  assert.equal(new Set(unitIds).size, unitIds.length);
  assert.equal(Object.isFrozen(declarations), true);
});

test("a different declared shape yields different environment and mapping ids", () => {
  const plan = canonicalGenerationPlan();
  const full = lobEnvironmentDeclarationsOf(plan, LOB_SHAPE);
  const minimal = lobEnvironmentDeclarationsOf(plan, MINIMAL_SHAPE);
  assert.ok(full.ok && minimal.ok);
  assert.notEqual(String(full.declarations.mappingId), String(minimal.declarations.mappingId));
  assert.notEqual(
    String(full.declarations.environments[0]!.environmentId),
    String(minimal.declarations.environments[0]!.environmentId),
  );
});

// ---------------------------------------------------------------------------
// The refusal laws
// ---------------------------------------------------------------------------

test("a tampered plan is refused with W048's own whole-plan errors carried verbatim (invalid-plan)", () => {
  const tampered = thaw(canonicalGenerationPlan());
  tampered.scope = { ...tampered.scope, worldId: "world-drifted" };
  const direct = validateGenerationPlan(tampered);
  assert.ok(!direct.ok);

  const outcome = lobEnvironmentDeclarationsOf(tampered, LOB_SHAPE);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-plan");
  assert.ok(refusal !== undefined);
  assert.deepEqual(refusal!.planErrors, direct.errors);
});

test("a malformed shape is refused with the venue vocabulary's errors carried verbatim (invalid-step-shape)", () => {
  const malformed: LobEpisodeStepShape = { stepKinds: ["reward-signal", "order-action"] };
  const direct = lobEpisodeStepShapeOf(malformed);
  assert.ok(!direct.ok);

  const outcome = lobEnvironmentDeclarationsOf(canonicalGenerationPlan(), malformed);
  assert.ok(!outcome.ok);
  const refusal = outcome.errors.find((entry) => entry.code === "invalid-step-shape");
  assert.ok(refusal !== undefined);
  assert.deepEqual(refusal!.vocabularyErrors, direct.errors);
});

test("a declared expected scope that disagrees with the plan's is refused (scope-mismatch)", () => {
  const plan = canonicalGenerationPlan();
  const outcome = lobEnvironmentDeclarationsOf(plan, LOB_SHAPE, {
    tenantId: String(plan.scope.tenantId),
    projectId: String(plan.scope.projectId),
    worldId: "world-elsewhere",
  });
  assert.ok(!outcome.ok);
  assert.deepEqual(outcome.errors.map((entry) => entry.code), ["scope-mismatch"]);
});

test("a declared expected scope that agrees with the plan's is accepted", () => {
  const plan = canonicalGenerationPlan();
  const outcome = lobEnvironmentDeclarationsOf(plan, LOB_SHAPE, {
    tenantId: String(plan.scope.tenantId),
    projectId: String(plan.scope.projectId),
    worldId: String(plan.scope.worldId),
  });
  assert.ok(outcome.ok);
  assert.ok(outcome.ok);
});

test("every environment declaration cites a unit of the plan it descends from", () => {
  const plan = canonicalGenerationPlan();
  const declarations = canonicalDeclarations();
  const unitIds = new Set(plan.units.map((unit) => String(unit.unitId)));
  for (const environment of declarations.environments) {
    assert.equal(unitIds.has(String(environment.unitId)), true);
    assert.equal(String(environment.planId), String(plan.planId));
  }
});
