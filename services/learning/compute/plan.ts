/**
 * planGeneration (W048) — THE GENERATION-PLAN GATE.
 *
 * W047 shipped the RL bridge (the TrainerPort contract); W045 shipped
 * populations. THIS module ships the COMPUTE ORCHESTRATION CONTRACT for
 * generating episodes AT SCALE: a typed generation PLAN composed from ONE
 * population × ONE declared batch policy × ONE declared sharding policy,
 * partitioned into WORK UNITS as DATA. A14: COMPOSES plans — never executes
 * generation, never steps a world, never networks, never spawns. W049 (the
 * JAX-LOB training adapter) consumes these plans.
 *
 * A9 — determinism: the plan id, every unit id, and every declared batch id
 * are canonical content digests (no clocks, no randomness, no env reads, no
 * node ids). Distribution is DECLARED as data, never discovered: shard
 * count, axis, and per-unit episode quota are closed-set declarations;
 * shard assignment is the canonical member-order contiguous partition —
 * identical inputs yield the deep-equal plan with identical ids.
 *
 * Fail-closed at every seam: a population failing W045's own re-validation
 * is refused with W045's errors carried VERBATIM; a batch policy outside
 * W047's vocabulary, an axis outside the closed set, a non-positive shard
 * count, a shard count exceeding the membership (an empty slice is
 * meaningless work), or a non-positive episode quota is refused by name.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { freezePopulation, validatePopulation } from "populations";
import type { Population, PopulationId, PopulationScope, PopulationValidationError } from "populations";
import { canonicalDigestHex } from "trajectory";
import type { BatchSelectionPolicy } from "rl-protocol";

/** One population member binding, as carried inside a population (opaque-cited, never parsed). */
export type PopulationMember = Population["membership"][number];

// ---------------------------------------------------------------------------
// The sharding policy (DECLARED closed-set data — never discovered)
// ---------------------------------------------------------------------------

/** The closed sharding-axis vocabulary ("member": each unit generates for its slice of the canonical membership). Closed: any other axis is the loud refusal `unknown-sharding-axis` (A14). */
export type ShardingAxis = "member";

/** The closed axis set (the ABLATION_KINDS-style closed-table precedent). */
export const SHARDING_AXES: readonly ShardingAxis[] = ["member"];

/** The declared sharding policy — DATA: the closed-set axis, the shard count (every shard non-empty), and the per-unit episode quota (the planned output volume per work unit). */
export interface ShardingPolicy {
  readonly axis: ShardingAxis;
  readonly shardCount: number;
  readonly episodesPerUnit: number;
}

// ---------------------------------------------------------------------------
// The opaque ids (content-addressed renderings, never parsed)
// ---------------------------------------------------------------------------

declare const generationPlanIdBrand: unique symbol;

/** An OPAQUE generation-plan id (a canonical digest rendering, produced only by {@link generationPlanIdOf}; never parsed). */
export type GenerationPlanId = string & { readonly [generationPlanIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const GENERATION_PLAN_ID_PREFIX = "genplan-";

declare const generationUnitIdBrand: unique symbol;

/** An OPAQUE generation-unit id (a canonical digest rendering, never parsed). */
export type GenerationUnitId = string & { readonly [generationUnitIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const GENERATION_UNIT_ID_PREFIX = "genunit-";

declare const declaredBatchIdBrand: unique symbol;

/** An OPAQUE declared-batch id: the plan-time content address of ONE unit's declared output contract — the DECLARED twin of W047's `EpisodeBatchId`, realized at run time by the worker's emitted batch reference (W047 `assembleBatch` under the unit's declared policy). */
export type DeclaredBatchId = string & { readonly [declaredBatchIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const DECLARED_BATCH_ID_PREFIX = "gbatch-";

// ---------------------------------------------------------------------------
// The work unit (typed DATA — the unit of distributed generation work)
// ---------------------------------------------------------------------------

/** ONE shard assignment, as data: the declared axis, the shard's index in the canonical shard order, the declared shard count, and the member binding ids assigned to this shard (canonical member order). */
export interface ShardAssignment {
  readonly axis: ShardingAxis;
  readonly shardIndex: number;
  readonly shardCount: number;
  readonly memberIds: readonly string[];
}

/** The declared batch descriptor of one work unit — the DECLARED form of W047's `EpisodeBatchDescriptor`: the proven selection policy + the declared episode count. The episodes do not exist at plan time; the descriptor is the output contract the worker's emitted reference realizes. */
export interface DeclaredBatchDescriptor {
  readonly declaredBatchId: DeclaredBatchId;
  readonly selectionPolicy: BatchSelectionPolicy;
  readonly declaredEpisodeCount: number;
}

/** ONE work unit: its shard assignment, its population slice (the member bindings, carried VERBATIM — carry, never re-score), its declared batch descriptor, and its declared world/scope. ALL a worker needs to know what to generate — DATA: no execution, no addresses, no node ids. */
export interface GenerationUnit {
  readonly unitId: GenerationUnitId;
  readonly shard: ShardAssignment;
  readonly populationSlice: readonly PopulationMember[];
  readonly batch: DeclaredBatchDescriptor;
  readonly scope: PopulationScope;
}

// ---------------------------------------------------------------------------
// The lineage + the provenance (immutable, deterministic)
// ---------------------------------------------------------------------------

/** The immutable plan lineage: the population generation this plan descends from (opaque id + generation, cited verbatim). A plan never rewrites its lineage — a new population generation takes a NEW plan. */
export interface GenerationPlanLineage {
  readonly populationId: PopulationId;
  readonly populationGeneration: number;
}

/** The deterministic plan provenance — DATA, never a clock read (A9): the population's own declared seal time (carried verbatim), the member count, and the sealed unit count. */
export interface GenerationPlanProvenance {
  readonly plannedSealedAt: number;
  readonly memberCount: number;
  readonly unitCount: number;
}

/** The generation plan: typed DATA (A14) — the content-addressed id, the explicit scope, the CARRIED population (re-proven at the gate, carried verbatim for whole-record re-validation), the proven policies, the units in canonical shard order, the immutable lineage, the deterministic provenance. */
export interface GenerationPlan {
  readonly planId: GenerationPlanId;
  readonly kind: "generation-plan";
  readonly scope: PopulationScope;
  readonly population: Population;
  readonly batchPolicy: BatchSelectionPolicy;
  readonly sharding: ShardingPolicy;
  readonly units: readonly GenerationUnit[];
  readonly lineage: GenerationPlanLineage;
  readonly provenance: GenerationPlanProvenance;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type GenerationPlanErrorCode =
  | "invalid-population" // W045's own validator refused the population (carried verbatim)
  | "blank-policy-id" // W047's batch-policy vocabulary law (mirrored)
  | "blank-parameter-name" // W047's batch-policy vocabulary law (mirrored)
  | "duplicate-parameter-name" // W047's batch-policy vocabulary law (mirrored)
  | "unknown-sharding-axis" // the axis is outside the closed SHARDING_AXES set
  | "invalid-shard-count" // non-positive/non-integer, or exceeding the membership
  | "invalid-episode-quota"; // the per-unit episode quota is not a positive integer

/** One typed generation-plan error (fail-closed). */
export interface GenerationPlanError {
  readonly code: GenerationPlanErrorCode;
  readonly message: string;
  /** Present on `invalid-population`: W045's own validation errors, verbatim. */
  readonly populationErrors?: readonly PopulationValidationError[];
}

export type GenerationPlanOutcome =
  | { readonly ok: true; readonly plan: GenerationPlan }
  | { readonly ok: false; readonly errors: readonly GenerationPlanError[] };

// ---------------------------------------------------------------------------
// The gate helpers (pure, deterministic — shared with ./validate.ts)
// ---------------------------------------------------------------------------

/** The batch-policy vocabulary laws, mirrored from W047's `EpisodeBatchErrorCode` set — the protocol does not export the law checks separately from batch construction, and inventing episodes to probe it would invent data; the closed-set mirror is the W045 AblationOperation structural-mirror precedent. */
export function batchPolicyViolations(policy: BatchSelectionPolicy): GenerationPlanError[] {
  const errors: GenerationPlanError[] = [];
  if (policy.policyId.trim().length === 0) {
    errors.push({
      code: "blank-policy-id",
      message:
        "the declared selection policy id is blank — a plan's batch policy is explicit data in W047's declared selection-policy vocabulary (DOMAIN-MODEL identity law), never an anonymous default",
    });
  }
  const seen = new Set<string>();
  for (const parameter of policy.parameters) {
    if (parameter.name.trim().length === 0) {
      errors.push({
        code: "blank-parameter-name",
        message:
          "a declared selection-policy parameter carries a blank name — parameters are named data (W047 vocabulary law)",
      });
      continue;
    }
    if (seen.has(parameter.name)) {
      errors.push({
        code: "duplicate-parameter-name",
        message: `the selection-policy parameter '${parameter.name}' is declared twice — one name, one declaration, deterministic data (A9; W047 vocabulary law)`,
      });
    }
    seen.add(parameter.name);
  }
  return errors;
}

/** The sharding-declaration laws (closed sets, positive integers, no empty slices). */
export function shardingViolations(sharding: ShardingPolicy, memberCount: number): GenerationPlanError[] {
  const errors: GenerationPlanError[] = [];
  if (!SHARDING_AXES.includes(sharding.axis)) {
    errors.push({
      code: "unknown-sharding-axis",
      message: `the sharding axis '${String(sharding.axis)}' is outside the closed vocabulary (${SHARDING_AXES.join(", ")}) — distribution is DECLARED as data over a closed set, never discovered (A14)`,
    });
  }
  if (!Number.isInteger(sharding.shardCount) || sharding.shardCount < 1) {
    errors.push({
      code: "invalid-shard-count",
      message: `the declared shard count '${String(sharding.shardCount)}' is not a positive integer — a closed set of shards is explicit declaration data (A9)`,
    });
  } else if (sharding.shardCount > memberCount) {
    errors.push({
      code: "invalid-shard-count",
      message: `the declared shard count ${String(sharding.shardCount)} exceeds the membership (${String(memberCount)} member(s)) — every shard carries at least one member; a work unit over an empty population slice is never silently planned (fail-closed)`,
    });
  }
  if (!Number.isInteger(sharding.episodesPerUnit) || sharding.episodesPerUnit < 1) {
    errors.push({
      code: "invalid-episode-quota",
      message: `the declared per-unit episode quota '${String(sharding.episodesPerUnit)}' is not a positive integer — the planned generation volume is explicit declaration data (A9)`,
    });
  }
  return errors;
}

/**
 * The canonical shard partition: the membership (canonical binding-id order — W045's law) split into `shardCount` CONTIGUOUS slices in canonical member order, the leading `membership % shardCount` shards taking the extra member. Pure, deterministic, input-order-blind (A9). Shared by the gate and the whole-plan re-validation.
 */
export function canonicalShardSlices(
  members: readonly PopulationMember[],
  shardCount: number,
): readonly (readonly PopulationMember[])[] {
  const base = Math.floor(members.length / shardCount);
  const remainder = members.length % shardCount;
  const slices: (readonly PopulationMember[])[] = [];
  let cursor = 0;
  for (let index = 0; index < shardCount; index += 1) {
    const size = base + (index < remainder ? 1 : 0);
    slices.push(members.slice(cursor, cursor + size));
    cursor += size;
  }
  return slices;
}

/** The plan id: the canonical content digest over the declared inputs — scope, the population citation (id + generation; the membership's content rides inside the population's own content address), the batch policy, the sharding policy (A9). */
export function generationPlanIdOf(input: {
  readonly scope: PopulationScope;
  readonly populationId: PopulationId;
  readonly populationGeneration: number;
  readonly batchPolicy: BatchSelectionPolicy;
  readonly sharding: ShardingPolicy;
}): GenerationPlanId {
  return `${GENERATION_PLAN_ID_PREFIX}${canonicalDigestHex({
    kind: "generation-plan",
    scope: {
      tenantId: String(input.scope.tenantId),
      projectId: String(input.scope.projectId),
      worldId: String(input.scope.worldId),
    },
    populationId: String(input.populationId),
    populationGeneration: input.populationGeneration,
    batchPolicy: input.batchPolicy,
    sharding: input.sharding,
  })}` as GenerationPlanId;
}

/** The unit id: the canonical content digest over the owning plan id, the shard index, and the shard's member binding ids (A9). */
export function generationUnitIdOf(input: {
  readonly planId: GenerationPlanId;
  readonly shardIndex: number;
  readonly memberIds: readonly string[];
}): GenerationUnitId {
  return `${GENERATION_UNIT_ID_PREFIX}${canonicalDigestHex({
    kind: "generation-unit",
    planId: String(input.planId),
    shardIndex: input.shardIndex,
    memberIds: input.memberIds.map(String),
  })}` as GenerationUnitId;
}

/** The declared-batch id: the canonical content digest over the owning unit id, the declared selection policy, and the declared episode count (A9). */
export function declaredBatchIdOf(input: {
  readonly unitId: GenerationUnitId;
  readonly selectionPolicy: BatchSelectionPolicy;
  readonly declaredEpisodeCount: number;
}): DeclaredBatchId {
  return `${DECLARED_BATCH_ID_PREFIX}${canonicalDigestHex({
    kind: "declared-batch",
    unitId: String(input.unitId),
    selectionPolicy: input.selectionPolicy,
    declaredEpisodeCount: input.declaredEpisodeCount,
  })}` as DeclaredBatchId;
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

/**
 * Compose one generation plan — THE GATE. Laws (all errors at once, fail-closed): the population re-proven through W045's own whole-record validator (errors carried VERBATIM); the batch policy proven against W047's vocabulary; the sharding policy proven as closed-set declaration data (axis, shard count with no empty slices, episode quota). Then the plan is sealed: the `genplan-<digest>` id, the units in canonical shard order, the immutable population lineage, the deterministic provenance. Pure and deterministic (A9); A14: composes DATA only — never executes, never spawns, never networks.
 */
export function planGeneration(
  population: Population,
  batchPolicy: BatchSelectionPolicy,
  sharding: ShardingPolicy,
): GenerationPlanOutcome {
  const errors: GenerationPlanError[] = [];

  const populationProof = validatePopulation(population);
  if (!populationProof.ok) {
    errors.push({
      code: "invalid-population",
      message: `[learning-compute] the population failed W045's own whole-record re-validation (${String(populationProof.errors.length)} error(s), carried verbatim) — a generation plan is never composed over an unproven population (fail-closed at every seam)`,
      populationErrors: populationProof.errors,
    });
  }

  errors.push(...batchPolicyViolations(batchPolicy));

  const memberCount = Array.isArray(population.membership) ? population.membership.length : 0;
  errors.push(...shardingViolations(sharding, memberCount));

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const members = population.membership;
  const slices = canonicalShardSlices(members, sharding.shardCount);
  const scope: PopulationScope = {
    tenantId: String(population.scope.tenantId),
    projectId: String(population.scope.projectId),
    worldId: String(population.scope.worldId),
  };
  const policy: BatchSelectionPolicy = {
    policyId: batchPolicy.policyId,
    parameters: batchPolicy.parameters.map((parameter) => ({ ...parameter })),
  };
  const planId = generationPlanIdOf({
    scope,
    populationId: population.populationId,
    populationGeneration: population.lineage.generation,
    batchPolicy: policy,
    sharding,
  });

  const units: GenerationUnit[] = slices.map((slice, index) => {
    const memberIds = slice.map((member) => String(member.bindingId));
    const unitId = generationUnitIdOf({ planId, shardIndex: index, memberIds });
    const batch: DeclaredBatchDescriptor = {
      declaredBatchId: declaredBatchIdOf({
        unitId,
        selectionPolicy: policy,
        declaredEpisodeCount: sharding.episodesPerUnit,
      }),
      selectionPolicy: policy,
      declaredEpisodeCount: sharding.episodesPerUnit,
    };
    return {
      unitId,
      shard: { axis: sharding.axis, shardIndex: index, shardCount: sharding.shardCount, memberIds },
      populationSlice: slice,
      batch,
      scope,
    };
  });

  const plan: GenerationPlan = {
    planId,
    kind: "generation-plan",
    scope,
    population,
    batchPolicy: policy,
    sharding: { ...sharding },
    units,
    lineage: {
      populationId: population.populationId,
      populationGeneration: population.lineage.generation,
    },
    provenance: {
      plannedSealedAt: population.provenance.sealedAt,
      memberCount: members.length,
      unitCount: units.length,
    },
  };
  freezePopulation(plan);
  return { ok: true, plan };
}
