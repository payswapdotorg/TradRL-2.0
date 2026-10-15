/**
 * Whole-plan re-validation (W048) — re-proving a sealed generation plan
 * from its own recorded data alone (the W044 `validateAgentBinding` /
 * W045 `validatePopulation` / W047 `validateEpisode` precedents): the
 * content-addressed identity re-derivation (plan id, every unit id, every
 * declared batch id), the population re-proof through W045's own
 * whole-record validator (errors carried verbatim), the scope/world
 * agreement laws (plan ⇔ population ⇔ every unit), the closed-set sharding
 * and batch-policy vocabulary laws, the canonical shard-partition law (the
 * recorded slices must BE the canonical contiguous re-derivation — every
 * member exactly once, no duplicates, no foreigners), the declared batch
 * descriptor laws (policy + episode count), the immutable lineage laws,
 * and the deterministic provenance laws. Pure, deterministic, fail-closed
 * — every violation collected, every law named.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validatePopulation } from "populations";
import type { PopulationValidationError } from "populations";
import { canonicalString } from "trajectory";
import {
  batchPolicyViolations,
  canonicalShardSlices,
  declaredBatchIdOf,
  generationPlanIdOf,
  generationUnitIdOf,
  shardingViolations,
} from "./plan.js";
import type { GenerationPlan, PopulationMember } from "./plan.js";

export interface GenerationPlanValidationError {
  readonly code: GenerationPlanValidationErrorCode;
  readonly message: string;
  /** Present on `invalid-population`: W045's own validation errors, verbatim. */
  readonly populationErrors?: readonly PopulationValidationError[];
}

export type GenerationPlanValidationErrorCode =
  | "identity-mismatch" // the plan id is not the content address of the recorded data
  | "invalid-population" // W045's own validator refused the carried population (carried verbatim)
  | "invalid-scope" // the plan scope carries a blank member
  | "scope-mismatch" // the plan/unit scope disagrees with the population's (scope/world disagreement)
  | "invalid-sharding" // the sharding declaration laws (axis / shard count / quota)
  | "invalid-batch-policy" // the batch policy vocabulary laws
  | "unit-count-mismatch" // the recorded units are not the declared shard count
  | "shard-order" // the units are not in canonical shard order
  | "duplicate-shard-assignment" // the same shard index / member twice
  | "slice-mismatch" // the recorded slices are not the canonical partition
  | "batch-policy-mismatch" // a unit's declared policy is not the plan's
  | "declared-count-mismatch" // a unit's declared episode count is not the plan's quota
  | "unit-identity-mismatch" // a unit id is not the content address of its data
  | "batch-identity-mismatch" // a declared batch id is not the content address of its data
  | "lineage-invalid" // the lineage is not the carried population's citation
  | "invalid-provenance"; // the deterministic provenance drifted

export type GenerationPlanValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly GenerationPlanValidationError[] };

function violation(
  code: GenerationPlanValidationErrorCode,
  message: string,
  populationErrors?: readonly PopulationValidationError[],
): GenerationPlanValidationError {
  return populationErrors === undefined ? { code, message } : { code, message, populationErrors };
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameScope(
  left: { readonly tenantId: unknown; readonly projectId: unknown; readonly worldId: unknown },
  right: { readonly tenantId: unknown; readonly projectId: unknown; readonly worldId: unknown },
): boolean {
  return (
    String(left.tenantId) === String(right.tenantId) &&
    String(left.projectId) === String(right.projectId) &&
    String(left.worldId) === String(right.worldId)
  );
}

/**
 * Re-prove a sealed generation plan from its own recorded data alone.
 * Every gate law is re-run against the RECORD (never re-scored, never
 * re-planned): the population re-proof, the vocabulary laws, the canonical
 * shard partition, the identity re-derivations, the lineage and the
 * provenance. A plan whose recorded data drifted from any of its own
 * content addresses is refused loudly.
 */
export function validateGenerationPlan(plan: GenerationPlan): GenerationPlanValidationOutcome {
  const errors: GenerationPlanValidationError[] = [];

  // --- the population re-proof (W045's own gate, errors carried verbatim) ---
  const populationProof = validatePopulation(plan.population);
  if (!populationProof.ok) {
    errors.push(violation(
      "invalid-population",
      `the carried population failed W045's own whole-record re-validation (${String(populationProof.errors.length)} error(s), carried verbatim) — a plan over an unproven population is refused`,
      populationProof.errors,
    ));
  }

  // --- the scope laws (explicit identity + scope/world agreement) ---
  if (!nonBlank(String(plan.scope.tenantId)) || !nonBlank(String(plan.scope.projectId)) || !nonBlank(String(plan.scope.worldId))) {
    errors.push(violation("invalid-scope", "the plan scope carries a blank member — the explicit tenant/project/world identity law"));
  }
  if (!sameScope(plan.scope, plan.population.scope)) {
    errors.push(violation("scope-mismatch", "the plan scope disagrees with the carried population's scope — one world, one scope (fail-closed)"));
  }

  // --- the declaration vocabulary laws ---
  const memberCount = Array.isArray(plan.population.membership) ? plan.population.membership.length : 0;
  for (const entry of shardingViolations(plan.sharding, memberCount)) {
    errors.push(violation("invalid-sharding", `[sharding] ${entry.message}`));
  }
  for (const entry of batchPolicyViolations(plan.batchPolicy)) {
    errors.push(violation("invalid-batch-policy", `[batch-policy] ${entry.message}`));
  }

  // --- the canonical shard partition + the unit laws ---
  const units = Array.isArray(plan.units) ? plan.units : [];
  if (units.length !== plan.sharding.shardCount) {
    errors.push(violation("unit-count-mismatch", `the plan records ${String(units.length)} work unit(s) but declares ${String(plan.sharding.shardCount)} shard(s) — one unit per shard, exactly`));
  }
  const slices = canonicalShardSlices(plan.population.membership, plan.sharding.shardCount);
  const seenShards = new Set<number>();
  const seenMembers = new Set<string>();
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!;
    if (unit.shard.shardIndex !== index) {
      errors.push(violation("shard-order", `the unit at position ${String(index)} carries shard index ${String(unit.shard.shardIndex)} — the units are sealed in canonical shard order (A9)`));
    }
    if (seenShards.has(unit.shard.shardIndex)) {
      errors.push(violation("duplicate-shard-assignment", `shard index ${String(unit.shard.shardIndex)} is assigned twice — one shard, one unit (deterministic assignment, A9)`));
    }
    seenShards.add(unit.shard.shardIndex);

    const slice = index < slices.length ? slices[index] : undefined;
    const sliceIds = slice === undefined ? undefined : slice.map((member) => String(member.bindingId));
    const recordedIds = unit.populationSlice.map((member: PopulationMember) => String(member.bindingId));
    const declaredIds = unit.shard.memberIds.map(String);
    if (sliceIds === undefined || declaredIds.join(",") !== sliceIds.join(",") || recordedIds.join(",") !== sliceIds.join(",")) {
      errors.push(violation("slice-mismatch", `the population slice of the unit at position ${String(index)} is not the canonical contiguous partition of the membership — shards CARRY the canonical assignment, they never re-derive it (A9)`));
    }
    for (const memberId of recordedIds) {
      if (seenMembers.has(memberId)) {
        errors.push(violation("duplicate-shard-assignment", `the member binding '${memberId}' is assigned to two shards — one member, one shard (deterministic assignment, A9)`));
      }
      seenMembers.add(memberId);
    }

    if (!sameScope(unit.scope, plan.scope)) {
      errors.push(violation("scope-mismatch", `the unit at position ${String(index)} declares scope (${String(unit.scope.tenantId)}, ${String(unit.scope.projectId)}, ${String(unit.scope.worldId)}) but the plan declares (${String(plan.scope.tenantId)}, ${String(plan.scope.projectId)}, ${String(plan.scope.worldId)}) — one world, one scope (fail-closed)`));
    }

    if (canonicalString(unit.batch.selectionPolicy) !== canonicalString(plan.batchPolicy)) {
      errors.push(violation("batch-policy-mismatch", `the unit at position ${String(index)} declares a selection policy that is not the plan's declared batch policy — a unit's declared output contract IS the plan's vocabulary (fail-closed)`));
    }
    if (unit.batch.declaredEpisodeCount !== plan.sharding.episodesPerUnit) {
      errors.push(violation("declared-count-mismatch", `the unit at position ${String(index)} declares ${String(unit.batch.declaredEpisodeCount)} episode(s) but the plan's quota is ${String(plan.sharding.episodesPerUnit)} — the declared output volume is plan data, never unit-local drift`));
    }

    const expectedUnitId = generationUnitIdOf({
      planId: plan.planId,
      shardIndex: unit.shard.shardIndex,
      memberIds: declaredIds,
    });
    if (String(expectedUnitId) !== String(unit.unitId)) {
      errors.push(violation("unit-identity-mismatch", `the unit id at position ${String(index)} is not the content address of its recorded data — opaque ids are content-addressed, never free strings (A9)`));
    }

    const expectedBatchId = declaredBatchIdOf({
      unitId: unit.unitId,
      selectionPolicy: unit.batch.selectionPolicy,
      declaredEpisodeCount: unit.batch.declaredEpisodeCount,
    });
    if (String(expectedBatchId) !== String(unit.batch.declaredBatchId)) {
      errors.push(violation("batch-identity-mismatch", `the declared batch id at position ${String(index)} is not the content address of its recorded data — the declared output contract is content-addressed, never free strings (A9)`));
    }
  }
  const canonicalMemberIds = plan.population.membership.map((member) => String(member.bindingId)).sort(compareStrings);
  if (seenMembers.size !== canonicalMemberIds.length && units.length > 0) {
    errors.push(violation("slice-mismatch", `the shards cover ${String(seenMembers.size)} distinct member(s) but the population carries ${String(canonicalMemberIds.length)} — the partition covers every member exactly once (fail-closed)`));
  }

  // --- the lineage + provenance laws ---
  if (String(plan.lineage.populationId) !== String(plan.population.populationId) || plan.lineage.populationGeneration !== plan.population.lineage.generation) {
    errors.push(violation("lineage-invalid", "the plan lineage is not the carried population's own citation (population id + generation) — lineage is immutable, carried verbatim, never edited"));
  }
  if (plan.provenance.plannedSealedAt !== plan.population.provenance.sealedAt) {
    errors.push(violation("invalid-provenance", `the declared plan time ${String(plan.provenance.plannedSealedAt)} is not the population's own declared seal time ${String(plan.population.provenance.sealedAt)} — declared DATA, never a clock read (A9)`));
  }
  if (plan.provenance.memberCount !== memberCount || plan.provenance.unitCount !== units.length) {
    errors.push(violation("invalid-provenance", `the declared provenance counts (members ${String(plan.provenance.memberCount)}, units ${String(plan.provenance.unitCount)}) do not match the record (${String(memberCount)} members, ${String(units.length)} units) — deterministic summary data, never drift`));
  }

  // --- the plan identity (the content address over all declared inputs) ---
  const expectedPlanId = generationPlanIdOf({
    scope: plan.scope,
    populationId: plan.population.populationId,
    populationGeneration: plan.population.lineage.generation,
    batchPolicy: plan.batchPolicy,
    sharding: plan.sharding,
  });
  if (String(expectedPlanId) !== String(plan.planId)) {
    errors.push(violation("identity-mismatch", `the plan id is not the content address of the recorded inputs (expected ${String(expectedPlanId).slice(0, 20)}…, recorded ${String(plan.planId).slice(0, 20)}…)`));
  }

  return errors.length === 0
    ? { ok: true, checked: ["identity", "population", "scope", "sharding", "batch-policy", "units", "shard-partition", "unit-identities", "lineage", "provenance"] }
    : { ok: false, errors };
}

// Carried for the plan-time twin: the population errors a refused plan carries verbatim.
export type { PopulationValidationError };
