/**
 * The population transition gates (W045) — `addMembers`, `retireMembers`
 * and `ablateMembers` (citing the W039 axis vocabulary): every transition GATES
 * first, then seals a NEW generation. The gates:
 * the parent generation re-validated whole-record (lineage breaks refused,
 * errors carried verbatim); the W040 registry re-proven through its own
 * validator and scope-checked against the population; every new member
 * re-proven through W044's own validator (errors carried verbatim) + scope
 * agreement + duplicate refusal; retirements cited by id with reasons as
 * DATA (unknown ids, duplicates and blank reasons refused); dead endowment
 * capabilities refused LOUDLY with the W040 lifecycle carried verbatim;
 * then the new generation is sealed citing its parent — NEVER mutated in place
 * (the immutable lineage). A9: same parent + same inputs ⇒ deep-equal generation, same id. A14: no execution.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateCapabilityRegistry } from "capability-registry";
import type { CapabilityRegistry } from "capability-registry";
import { ABLATION_KINDS } from "learning-objectives";
import type { AblationKind } from "learning-objectives";
import type { WorldAgentBinding, WorldAgentBindingValidationError } from "world-agent-runtime";
import { validatePopulation } from "./validate.js";
import type { Population, PopulationScope } from "./population.js";
import {
  canonicalMemberOrder,
  memberBindingIds,
  memberSubstrateIds,
  memberValidationErrors,
  sealGeneration,
} from "./population.js";
import type { AblationCitation, AblationOperation, MemberRetirement } from "./population.js";

// --- the typed transition error family (closed set — every law named) ---

export type PopulationTransitionErrorCode =
  | "parent-invalid" // the parent generation failed whole-record re-validation (carried verbatim)
  | "invalid-registry" // the W040 gate refused the registry (carried verbatim)
  | "registry-scope-mismatch" // the registry's scope ≠ the population's
  | "empty-addition" // adding zero members is a no-op, not a transition
  | "invalid-member" // a new member failed W044's own re-validation (carried verbatim)
  | "scope-mismatch" // a new member's scope disagrees with the population's
  | "duplicate-member" // a new member is already in the population (or duplicated in the input)
  | "empty-retirement" // retiring zero members is a no-op, not a transition
  | "unknown-retired-member" // a retirement cites a member the population does not carry
  | "duplicate-retirement" // the same member retired twice in one transition
  | "blank-retirement-reason" // a retirement without a non-blank reason
  | "empty-result" // the transition would empty the population
  | "invalid-ablation-kind" // the ablation axis is outside the closed ABLATION_KINDS table
  | "invalid-ablation-operation" // the ablation operation is outside the W039 origin vocabulary
  | "blank-ablation-subject" // the ablation cites no subject id
  | "deprecated-capability" // a member's endowment capability died (the W040 lifecycle carried)
  | "revoked-capability"; // terminal death (carried)

export interface PopulationTransitionError {
  readonly code: PopulationTransitionErrorCode;
  readonly message: string;
  readonly bindingId?: string;
  readonly memberId?: string;
  readonly capabilityId?: string;
  readonly substrateId?: string;
  /** Present on `parent-invalid`: this package's own validation errors, verbatim. */
  readonly parentErrors?: readonly { readonly code: string; readonly message: string }[];
  /** Present on `invalid-registry`: W040's own errors, verbatim. */
  readonly registryErrors?: readonly unknown[];
  /** Present on `invalid-member`: W044's own validation errors, verbatim. */
  readonly memberErrors?: readonly WorldAgentBindingValidationError[];
  /** Present on deprecated/revoked-capability: the W040 lifecycle transitions, carried VERBATIM. */
  readonly lifecycle?: readonly { readonly to: string; readonly reason: string }[];
}

export type PopulationTransitionOutcome =
  | { readonly ok: true; readonly population: Population }
  | { readonly ok: false; readonly errors: readonly PopulationTransitionError[] };

function error(code: PopulationTransitionErrorCode, message: string, extras: Omit<PopulationTransitionError, "code" | "message"> = {}): PopulationTransitionError {
  return { code, message, ...extras };
}

// --- the shared gate laws ---

/** The parent lineage gate: a transition composes from a PROVEN parent generation only. */
function parentGate(population: Population): PopulationTransitionError[] {
  const validation = validatePopulation(population);
  if (!validation.ok) {
    return [error(
      "parent-invalid",
      `the parent generation '${String(population.populationId)}' failed whole-population re-validation (${String(validation.errors.length)} error(s), carried verbatim) — lineage never extends from a broken generation`,
      { parentErrors: validation.errors },
    )];
  }
  return [];
}

/** The W040 registry gate + scope agreement with the population. */
function registryGate(registry: CapabilityRegistry, scope: PopulationScope): PopulationTransitionError[] {
  const validation = validateCapabilityRegistry(registry);
  if (!validation.ok) {
    return [error(
      "invalid-registry",
      `the W040 gate refused the capability registry (${String(validation.errors.length)} error(s), carried verbatim) — no transition runs against an unproven registry`,
      { registryErrors: validation.errors },
    )];
  }
  if (
    String(registry.scope.tenantId) !== scope.tenantId ||
    String(registry.scope.projectId) !== scope.projectId ||
    String(registry.scope.worldId) !== scope.worldId
  ) {
    return [error(
      "registry-scope-mismatch",
      `the registry scope (${String(registry.scope.tenantId)}, ${String(registry.scope.projectId)}, ${String(registry.scope.worldId)}) disagrees with the population scope (${scope.tenantId}, ${scope.projectId}, ${scope.worldId}) — the registry is single-scope`,
    )];
  }
  return [];
}

/**
 * The dead-endowment gate: every member of the RESULTING generation is
 * re-checked against the W040 registry — an endowment capability BORNE by
 * the member's substrate surface (the W040 bearer dimension) that is now
 * deprecated or revoked is refused LOUDLY, lifecycle carried verbatim.
 */
function deadCapabilityGate(members: readonly WorldAgentBinding[], registry: CapabilityRegistry): PopulationTransitionError[] {
  const errors: PopulationTransitionError[] = [];
  for (const member of members) {
    for (const substrateId of memberSubstrateIds(member)) {
      for (const entry of registry.entries) {
        const bearer = entry.descriptor.bearer;
        if (bearer.kind !== "substrate" || String(bearer.substrateId) !== substrateId) {
          continue;
        }
        if (entry.state === "deprecated" || entry.state === "revoked") {
          errors.push(error(
            entry.state === "deprecated" ? "deprecated-capability" : "revoked-capability",
            `endowment capability '${String(entry.descriptor.capabilityId)}' borne by substrate '${substrateId}' of member '${String(member.bindingId)}' is ${entry.state} at transition time — the W040 lifecycle is carried loudly, the transition refuses`,
            {
              bindingId: String(member.bindingId),
              substrateId,
              capabilityId: String(entry.descriptor.capabilityId),
              lifecycle: entry.transitions.map((transition) => ({ to: String(transition.to), reason: String(transition.reason) })),
            },
          ));
        }
      }
    }
  }
  return errors;
}

/** The new-member gates: W044's own re-proof, scope agreement, duplicate refusal. */
function newMemberGates(population: Population, additions: readonly WorldAgentBinding[]): PopulationTransitionError[] {
  const errors: PopulationTransitionError[] = [];
  const existing = new Set(memberBindingIds(population.membership));
  const fresh = new Set<string>();
  for (const member of additions) {
    const bindingId = String(member.bindingId);
    if (existing.has(bindingId)) {
      errors.push(error(
        "duplicate-member",
        `member binding '${bindingId}' is already a member of population '${String(population.populationId)}' — a member joins once (one binding, one member)`,
        { bindingId },
      ));
      continue;
    }
    if (fresh.has(bindingId)) {
      errors.push(error(
        "duplicate-member",
        `member binding '${bindingId}' appears twice in the transition input — the canonical membership never repeats`,
        { bindingId },
      ));
      continue;
    }
    fresh.add(bindingId);
    const memberErrors = memberValidationErrors(member);
    if (memberErrors.length > 0) {
      errors.push(error(
        "invalid-member",
        `new member binding '${bindingId}' failed W044's own re-validation (${String(memberErrors.length)} error(s), carried verbatim) — nothing joins on an unproven binding`,
        { bindingId, memberErrors },
      ));
    }
    const scope = member.scope;
    if (
      String(scope.tenantId) !== population.scope.tenantId ||
      String(scope.projectId) !== population.scope.projectId ||
      String(scope.worldId) !== population.scope.worldId
    ) {
      errors.push(error(
        "scope-mismatch",
        `new member binding '${bindingId}' belongs to scope (${String(scope.tenantId)}, ${String(scope.projectId)}, ${String(scope.worldId)}) but the population lives in (${population.scope.tenantId}, ${population.scope.projectId}, ${population.scope.worldId}) — one world, one scope`,
        { bindingId },
      ));
    }
  }
  return errors;
}

/** The retirement gates: real members, unique, with non-blank reasons as DATA. */
function retirementGates(population: Population, retirements: readonly MemberRetirement[]): PopulationTransitionError[] {
  const errors: PopulationTransitionError[] = [];
  const known = new Set(memberBindingIds(population.membership));
  const seen = new Set<string>();
  for (const retirement of retirements) {
    const memberId = String(retirement.memberId);
    if (!known.has(memberId)) {
      errors.push(error(
        "unknown-retired-member",
        `retirement cites member '${memberId}', which population '${String(population.populationId)}' does not carry — the lineage never cites ghosts`,
        { memberId },
      ));
      continue;
    }
    if (seen.has(memberId)) {
      errors.push(error(
        "duplicate-retirement",
        `member '${memberId}' is retired twice in one transition — one member, one retirement`,
        { memberId },
      ));
      continue;
    }
    seen.add(memberId);
    if (typeof retirement.reason !== "string" || retirement.reason.trim().length === 0) {
      errors.push(error(
        "blank-retirement-reason",
        `the retirement of member '${memberId}' carries no reason — retirements are cited with reasons as DATA, never blank`,
        { memberId },
      ));
    }
  }
  return errors;
}

/** The ablation citation gates: the W036/W039 closed vocabulary + a non-blank subject. */
function ablationGates(ablation: AblationCitation): PopulationTransitionError[] {
  const errors: PopulationTransitionError[] = [];
  const kind = String(ablation.kind) as AblationKind;
  if (!ABLATION_KINDS.includes(kind)) {
    errors.push(error(
      "invalid-ablation-kind",
      `ablation axis '${String(ablation.kind)}' is outside the closed ABLATION_KINDS table (§13: ${ABLATION_KINDS.join(", ")}) — population transitions cite the W039 axis vocabulary only`,
    ));
  }
  const operations: readonly AblationOperation[] = ["remove-position", "remove-unit", "substitute-body-requirement", "substitute-substrate-requirement"];
  if (!operations.includes(ablation.operation)) {
    errors.push(error(
      "invalid-ablation-operation",
      `ablation operation '${String(ablation.operation)}' is outside the W039 origin operation vocabulary (${operations.join(", ")}) — the citation names the operation the ablation acted with`,
    ));
  }
  if (typeof ablation.subject !== "string" || ablation.subject.trim().length === 0) {
    errors.push(error(
      "blank-ablation-subject",
      "the ablation cites no subject id — the citation names the position or unit the operation acted on",
    ));
  }
  return errors;
}

/** Retirements in canonical member-id order (A9 — input order never matters). */
function canonicalRetirements(retirements: readonly MemberRetirement[]): MemberRetirement[] {
  return [...retirements].sort((left, right) => (left.memberId < right.memberId ? -1 : left.memberId > right.memberId ? 1 : 0));
}

/** Seal the next generation (the shared closer — parent cited, never mutated). */
function nextGeneration(
  population: Population,
  registry: CapabilityRegistry,
  members: readonly WorldAgentBinding[],
  origin: Population["lineage"]["origin"],
): Population {
  return sealGeneration({
    scope: population.scope,
    members,
    lineage: {
      parentPopulationId: population.populationId,
      generation: population.lineage.generation + 1,
      origin,
    },
    foundedAt: population.provenance.foundedAt,
    registry,
  });
}

// --- THE TRANSITION GATES ---

/** THE ADDITION TRANSITION: new proven members join; a NEW generation is sealed. */
export function addMembers(
  population: Population,
  registry: CapabilityRegistry,
  additions: readonly WorldAgentBinding[],
): PopulationTransitionOutcome {
  const errors: PopulationTransitionError[] = [];
  errors.push(...parentGate(population));
  errors.push(...registryGate(registry, population.scope));
  if (additions.length === 0) {
    errors.push(error("empty-addition", "adding zero members changes nothing — a transition is a change, the lineage never records no-ops"));
  }
  errors.push(...newMemberGates(population, additions));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const resulting = canonicalMemberOrder([...population.membership, ...additions]);
  errors.push(...deadCapabilityGate(resulting, registry));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    population: nextGeneration(population, registry, resulting, {
      kind: "add",
      addedMemberIds: memberBindingIds(canonicalMemberOrder(additions)),
    }),
  };
}

/** THE RETIREMENT TRANSITION: members leave, cited by id with reasons as DATA. */
export function retireMembers(
  population: Population,
  registry: CapabilityRegistry,
  retirements: readonly MemberRetirement[],
): PopulationTransitionOutcome {
  const errors: PopulationTransitionError[] = [];
  errors.push(...parentGate(population));
  errors.push(...registryGate(registry, population.scope));
  if (retirements.length === 0) {
    errors.push(error("empty-retirement", "retiring zero members changes nothing — a transition is a change, the lineage never records no-ops"));
  }
  errors.push(...retirementGates(population, retirements));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const retired = new Set(retirements.map((retirement) => String(retirement.memberId)));
  const resulting = population.membership.filter((member) => !retired.has(String(member.bindingId)));
  if (resulting.length === 0) {
    return { ok: false, errors: [...errors, error(
      "empty-result",
      `retiring ${String(retirements.length)} member(s) would empty population '${String(population.populationId)}' — the lineage never dead-ends (the W039 last-position precedent)`,
    )] };
  }
  errors.push(...deadCapabilityGate(resulting, registry));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    population: nextGeneration(population, registry, resulting, { kind: "retire", retirements: canonicalRetirements(retirements) }),
  };
}

/** The ablation input: the W039-axis citation + the retirements the ablation removes. */
export interface PopulationAblation {
  readonly ablation: AblationCitation;
  readonly retirements: readonly MemberRetirement[];
}

/**
 * THE ABLATION TRANSITION: members leave BECAUSE an organization-side
 * ablation removed their reason for being — the citation speaks the
 * W036/W039 axis vocabulary, the retirements cite the members removed,
 * reasons as DATA.
 */
export function ablateMembers(
  population: Population,
  registry: CapabilityRegistry,
  input: PopulationAblation,
): PopulationTransitionOutcome {
  const errors: PopulationTransitionError[] = [];
  errors.push(...parentGate(population));
  errors.push(...registryGate(registry, population.scope));
  errors.push(...ablationGates(input.ablation));
  if (input.retirements.length === 0) {
    errors.push(error("empty-retirement", "an ablation that retires nobody changes nothing — a transition is a change, the lineage never records no-ops"));
  }
  errors.push(...retirementGates(population, input.retirements));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const retired = new Set(input.retirements.map((retirement) => String(retirement.memberId)));
  const resulting = population.membership.filter((member) => !retired.has(String(member.bindingId)));
  if (resulting.length === 0) {
    return { ok: false, errors: [...errors, error(
      "empty-result",
      `ablating ${String(input.retirements.length)} member(s) would empty population '${String(population.populationId)}' — the lineage never dead-ends (the W039 last-position precedent)`,
    )] };
  }
  errors.push(...deadCapabilityGate(resulting, registry));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    population: nextGeneration(
      population,
      registry,
      resulting,
      { kind: "ablate", ablation: input.ablation, retirements: canonicalRetirements(input.retirements) },
    ),
  };
}
