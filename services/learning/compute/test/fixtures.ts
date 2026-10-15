/**
 * Shared deterministic fixtures for the W048 compute tests — the
 * W045/W047 fixture lineage over REAL imports: the population is founded
 * through W045's own gate over W045's own test fixtures (REAL commissioned
 * bodies, REAL W044 bindings — the zero-drift cross-package relative
 * import W044/W045 themselves use, disclosed), and the canonical plan is
 * composed through THIS package's own gate. The `thaw` helper is W045's
 * own deep-writable clone (re-exported) — tampering a frozen record needs
 * one.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { foundPopulation, validatePopulation } from "populations";
import type { Population } from "populations";
import type { BatchSelectionPolicy } from "rl-protocol";
import { planGeneration } from "../plan.js";
import type { GenerationPlan, ShardingPolicy } from "../plan.js";
import { populationMembers, populationWorldDefinition, thaw } from "../../../populations/test/fixtures.js";
import type { Writable } from "../../../populations/test/fixtures.js";

export { thaw };
export type { Writable };

/** The declared batch policy fixture (W047's declared selection-policy vocabulary). */
export const COMPUTE_BATCH_POLICY: BatchSelectionPolicy = {
  policyId: "sel-compute-fixture",
  parameters: [
    { name: "minSteps", value: 3 },
    { name: "method", value: "offline-rl" },
  ],
};

/** The declared sharding fixture: 2 shards over the 3-member fixture population, 4 episodes per unit. */
export const COMPUTE_SHARDING: ShardingPolicy = {
  axis: "member",
  shardCount: 2,
  episodesPerUnit: 4,
};

let cachedPopulation: Population | undefined;

/** The canonical fixture population: W045's founding gate over W045's own fixtures (3 members). */
export function canonicalPopulation(): Population {
  cachedPopulation ??= (() => {
    const outcome = foundPopulation(populationWorldDefinition(), populationMembers());
    if (!outcome.ok) {
      throw new Error(`compute fixture population failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
    }
    return outcome.population;
  })();
  return cachedPopulation;
}

/** A freshly-founded population over the given (possibly permuted) members. */
export function populationOver(members: ReturnType<typeof populationMembers>): Population {
  const outcome = foundPopulation(populationWorldDefinition(), members);
  if (!outcome.ok) {
    throw new Error(`compute fixture population failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.population;
}

let cachedPlan: GenerationPlan | undefined;

/** The canonical fixture plan: this package's own gate over the canonical population. */
export function canonicalPlan(): GenerationPlan {
  cachedPlan ??= (() => {
    const outcome = planGeneration(canonicalPopulation(), COMPUTE_BATCH_POLICY, COMPUTE_SHARDING);
    if (!outcome.ok) {
      throw new Error(`compute fixture plan failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
    }
    return outcome.plan;
  })();
  return cachedPlan;
}

/** The canonical member binding ids (W045's own canonical order). */
export function canonicalMemberIds(): string[] {
  return canonicalPopulation().membership.map((member) => String(member.bindingId));
}

/** A deep, unfrozen, writable clone of the canonical plan (for the tamper laws). */
export function thawedPlan(): Writable<GenerationPlan> {
  return thaw(canonicalPlan());
}

/** Assert helper: the fixture population is W045-valid (the plan gate's precondition). */
export function assertCanonicalPopulationValid(): void {
  const proof = validatePopulation(canonicalPopulation());
  if (!proof.ok) {
    throw new Error(`compute fixture population is not W045-valid (${proof.errors.map((entry) => entry.code).join(", ")})`);
  }
}
