/**
 * The organization compile service (W039) — `compileOrganization`.
 *
 * Given a validated `OrganizationDefinition` and a validated component
 * registry, produce the `CompiledOrganization`: the resolved binding
 * plan (which concrete W032 body and W033 substrate fill each position),
 * the W034 possession declaration for every seat — verified through
 * `checkPossessionCompatibility` with incompatibilities carried
 * verbatim — the satisfied capability demands, the canonical
 * A6-friendly execution-order plan, and a content-addressed compiled id.
 *
 * Determinism (A9): candidates are considered in canonical sorted
 * component-identity order and the FIRST eligible body and substrate win
 * — NO backtracking (a capability or compatibility failure is a loud
 * typed error, never a silent re-pick); same definition + same registry
 * ⇒ byte-identical plan and same id (the twin law); no wall clocks, no
 * randomness, no env reads. Fail-closed: the compile NEVER silently
 * drops a position.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { BodyDescriptor } from "agent-body";
import type { CognitiveSubstrateDescriptor } from "cognitive-substrate";
import {
  organizationIdOf,
  stableDigest,
  validateOrganizationDefinition,
} from "organization";
import type {
  OrganizationCapabilityId,
  OrganizationDefinition,
  OrganizationError,
  OrganizationId,
  OrganizationPosition,
  OrganizationPositionId,
  OrganizationScope,
  OpaqueId,
} from "organization";
import { checkPossessionCompatibility } from "possession";
import type {
  PossessionCheckKind,
  PossessionGrant,
  PossessionId,
  PossessionIncompatibility,
  PossessionScope,
} from "possession";
import type {
  ComponentRegistryError,
  OrganizationComponentRegistry,
  RegisteredBody,
  RegisteredSubstrate,
} from "./registry.js";
import { validateComponentRegistry } from "./registry.js";

/** The identity of one compiled organization (opaque; digest-derived). */
export type CompiledOrganizationId = OpaqueId<"CompiledOrganizationId">;

/** One resolved seat: the binding plan entry for one position. */
export interface CompiledPositionBinding {
  readonly positionId: OrganizationPositionId;
  readonly bodyId: BodyDescriptor["bodyId"];
  readonly substrateId: CognitiveSubstrateDescriptor["substrateId"];
  readonly possessionId: PossessionId;
  /** The W034 grant the organization issued for this seat (verbatim). */
  readonly grant: PossessionGrant;
  /** The W034 scope the compiled possession declares. */
  readonly scope: PossessionScope;
  /** The compatibility evidence W034 proved for this binding (R051). */
  readonly compatibility: {
    readonly checked: readonly PossessionCheckKind[];
    readonly streamDigest?: string;
  };
  /** The position's demanded capabilities, ALL satisfied (sorted). */
  readonly satisfiedCapabilities: readonly OrganizationCapabilityId[];
}

/** The compiled organization: the resolved plan, as data. */
export interface CompiledOrganization {
  readonly compiledOrganizationId: CompiledOrganizationId;
  readonly organizationId: OrganizationId;
  readonly scope: OrganizationScope;
  /** One binding per position, canonical positionId order. */
  readonly bindings: readonly CompiledPositionBinding[];
  /** The canonical A6-friendly execution-order plan. */
  readonly executionOrder: readonly OrganizationPositionId[];
}

export type OrganizationCompileErrorCode =
  | "definition-invalid" // the model's own laws refused the definition (verbatim)
  | "registry-invalid" // the registry's own laws refused it (verbatim)
  | "registry-scope-mismatch" // the registry's scope disagrees with the definition's
  | "unresolvable-position" // NO registered component can fill the seat
  | "missing-capability" // the bound pair does not provide a demanded capability
  | "incompatible-binding"; // W034 refused the possession (verbatim)

/** One loud compile failure — never a silent drop. */
export interface OrganizationCompileError {
  readonly code: OrganizationCompileErrorCode;
  readonly message: string;
  readonly positionId?: string;
  readonly capabilityId?: string;
  readonly validationErrors?: readonly OrganizationError[];
  readonly registryErrors?: readonly ComponentRegistryError[];
  readonly incompatibilities?: readonly PossessionIncompatibility[];
}

export type OrganizationCompileOutcome =
  | { readonly ok: true; readonly compiled: CompiledOrganization }
  | { readonly ok: false; readonly error: OrganizationCompileError };

function sortedBodies(registry: OrganizationComponentRegistry): RegisteredBody[] {
  return [...registry.bodies].sort((a, b) => compareIds(a.body.bodyId, b.body.bodyId));
}

function sortedSubstrates(registry: OrganizationComponentRegistry): RegisteredSubstrate[] {
  return [...registry.substrates].sort((a, b) => compareIds(a.substrate.substrateId, b.substrate.substrateId));
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function covers(required: readonly string[], offered: readonly string[]): boolean {
  return required.every((value) => offered.includes(value));
}

/**
 * The canonical execution order (A6-friendly, deterministic): the
 * organization's root positions first (sorted), then a depth-first
 * pre-order walk of the unit forest (siblings sorted by unitId),
 * each unit's positions sorted. Every position appears exactly once —
 * the model's membership-uniqueness law guarantees it.
 */
export function canonicalExecutionOrder(
  definition: OrganizationDefinition,
): OrganizationPositionId[] {
  const membersOf = new Map<string, string[]>();
  for (const unit of definition.units) {
    const key = unit.parentUnitId === null ? "" : String(unit.parentUnitId);
    const bucket = membersOf.get(key) ?? [];
    bucket.push(String(unit.unitId));
    membersOf.set(key, bucket);
  }
  const positionsOf = new Map<string, OrganizationPositionId[]>();
  const rootPositions: OrganizationPositionId[] = [];
  const memberPosition = new Set<string>();
  for (const unit of definition.units) {
    positionsOf.set(String(unit.unitId), [...unit.positionIds]);
    for (const positionId of unit.positionIds) {
      memberPosition.add(String(positionId));
    }
  }
  for (const position of definition.positions) {
    if (!memberPosition.has(String(position.positionId))) {
      rootPositions.push(position.positionId);
    }
  }
  rootPositions.sort((a, b) => (String(a) < String(b) ? -1 : 1));
  const order: OrganizationPositionId[] = [...rootPositions];
  const visit = (unitId: string): void => {
    const positions = positionsOf.get(unitId) ?? [];
    positions.sort((a, b) => (String(a) < String(b) ? -1 : 1));
    order.push(...positions);
    const children = (membersOf.get(unitId) ?? []).sort((a, b) => (a < b ? -1 : 1));
    for (const child of children) {
      visit(child);
    }
  };
  for (const root of membersOf.get("") ?? []) {
    visit(root);
  }
  return order;
}

/**
 * THE COMPILE: definition + registry → compiled organization. Pure,
 * deterministic, fail-closed. The compatibility proof runs WITHOUT a
 * world (the W034 no-world branch: the W032 attach constraints are NOT
 * claimed — attaching to a concrete world is the runtime's proof,
 * W035+), so `compatibility.checked` names exactly what was proven.
 */
export function compileOrganization(
  definition: OrganizationDefinition,
  registry: OrganizationComponentRegistry,
): OrganizationCompileOutcome {
  const validation = validateOrganizationDefinition(definition);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: "definition-invalid",
        message: `the organization definition violates ${String(validation.errors.length)} model law(s) — carried verbatim, nothing compiled`,
        validationErrors: validation.errors,
      },
    };
  }
  const registryValidation = validateComponentRegistry(registry);
  if (!registryValidation.ok) {
    return {
      ok: false,
      error: {
        code: "registry-invalid",
        message: `the component registry violates ${String(registryValidation.errors.length)} registry law(s) — carried verbatim, nothing compiled`,
        registryErrors: registryValidation.errors,
      },
    };
  }
  if (
    registry.scope.tenantId !== definition.scope.tenantId ||
    registry.scope.projectId !== definition.scope.projectId ||
    registry.scope.worldId !== definition.scope.worldId
  ) {
    return {
      ok: false,
      error: {
        code: "registry-scope-mismatch",
        message: `the registry scope (${registry.scope.tenantId}, ${registry.scope.projectId}, ${registry.scope.worldId}) disagrees with the organization scope (${definition.scope.tenantId}, ${definition.scope.projectId}, ${definition.scope.worldId}) — the registry is single-scope`,
      },
    };
  }

  const organizationId = organizationIdOf(definition);
  const bodies = sortedBodies(registry);
  const substrates = sortedSubstrates(registry);
  const bindings: CompiledPositionBinding[] = [];

  for (const position of [...definition.positions].sort((a, b) =>
    compareIds(String(a.positionId), String(b.positionId)),
  )) {
    const resolved = resolvePosition(position, definition, bodies, substrates, organizationId);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }
    bindings.push(resolved.binding);
  }

  const executionOrder = canonicalExecutionOrder(definition);
  const registryFingerprint = registryDigestOf(bodies, substrates);
  const compiledOrganizationId = `orgc-${stableDigest({
    organizationId,
    registryFingerprint,
    bindings: bindings.map((binding) => ({
      positionId: String(binding.positionId),
      bodyId: String(binding.bodyId),
      substrateId: String(binding.substrateId),
      possessionId: String(binding.possessionId),
    })),
    executionOrder: executionOrder.map(String),
  })}` as CompiledOrganizationId;

  return {
    ok: true,
    compiled: {
      compiledOrganizationId,
      organizationId,
      scope: definition.scope,
      bindings,
      executionOrder,
    },
  };
}

function resolvePosition(
  position: OrganizationPosition,
  definition: OrganizationDefinition,
  bodies: readonly RegisteredBody[],
  substrates: readonly RegisteredSubstrate[],
  organizationId: OrganizationId,
): { readonly ok: true; readonly binding: CompiledPositionBinding } | { readonly ok: false; readonly error: OrganizationCompileError } {
  const id = String(position.positionId);
  const requirement = position.bodyRequirement;
  const eligibleBodies = bodies.filter((entry) =>
    covers(requirement.commandKinds, entry.body.embodiment.commandKinds) &&
    covers(requirement.instruments.map(String), entry.body.embodiment.instruments.map(String)),
  );
  if (eligibleBodies.length === 0) {
    return {
      ok: false,
      error: {
        code: "unresolvable-position",
        positionId: id,
        message: `position '${id}' cannot be filled: no registered body covers its requirement (command kinds: ${requirement.commandKinds.join(", ")}; instruments: ${requirement.instruments.map(String).join(", ")}) — the compile never silently drops a position`,
      },
    };
  }
  const substrateRequirement = position.substrateRequirement;
  const eligibleSubstrates = substrates.filter((entry) =>
    (substrateRequirement.stateMode === undefined ||
      entry.substrate.stateMode === substrateRequirement.stateMode) &&
    entry.substrate.decisionRate.maxDecisionsPerView >= substrateRequirement.minMaxDecisionsPerView &&
    covers(substrateRequirement.commandKinds, entry.substrate.commandKinds),
  );
  if (eligibleSubstrates.length === 0) {
    return {
      ok: false,
      error: {
        code: "unresolvable-position",
        positionId: id,
        message: `position '${id}' cannot be filled: no registered substrate satisfies its requirement (state mode: ${String(substrateRequirement.stateMode)}; min max-decisions-per-view: ${String(substrateRequirement.minMaxDecisionsPerView)}; command kinds: ${substrateRequirement.commandKinds.join(", ")})`,
      },
    };
  }

  // The canonical first eligible pair wins — no backtracking (A9 law).
  const body = eligibleBodies[0]!;
  const substrate = eligibleSubstrates[0]!;

  const provided = new Set<string>([
    ...body.providesCapabilities.map(String),
    ...substrate.providesCapabilities.map(String),
  ]);
  const demanded = [...position.capabilityDemands].sort((a, b) => compareIds(String(a.capabilityId), String(b.capabilityId)));
  for (const demand of demanded) {
    if (!provided.has(String(demand.capabilityId))) {
      return {
        ok: false,
        error: {
          code: "missing-capability",
          positionId: id,
          capabilityId: String(demand.capabilityId),
          message: `position '${id}' demands capability '${String(demand.capabilityId)}' but body '${String(body.body.bodyId)}' + substrate '${String(substrate.substrate.substrateId)}' provide it — the first eligible pair is the deterministic pick, never re-picked`,
        },
      };
    }
  }

  const binding = definition.bindings.find((candidate) => String(candidate.positionId) === id)!;
  const narrowing = binding.scopeNarrowing;
  const scope: PossessionScope = {
    instruments: narrowing?.instruments ?? requirement.instruments,
    observations: narrowing?.observations ?? requirement.observations,
    commandKinds: narrowing?.commandKinds ?? requirement.commandKinds,
    ...(narrowing?.decisionRate === undefined ? {} : { decisionRate: narrowing.decisionRate }),
  };
  const grant: PossessionGrant = {
    grantedBy: binding.grant.grantedBy,
    channel: binding.grant.channel,
    grantedAt: binding.grant.grantedAt as PossessionGrant["grantedAt"],
    basis: binding.grant.basis,
  };
  const possessionId = `poss-${stableDigest({
    organizationId,
    positionId: id,
    bodyId: String(body.body.bodyId),
    substrateId: String(substrate.substrate.substrateId),
  })}` as PossessionId;

  const descriptor = { possessionId, body: body.body, substrate: substrate.substrate, grant, scope };
  const compatibility = checkPossessionCompatibility(descriptor);
  if (!compatibility.ok) {
    return {
      ok: false,
      error: {
        code: "incompatible-binding",
        positionId: id,
        message: `the binding for position '${id}' (body '${String(body.body.bodyId)}' × substrate '${String(substrate.substrate.substrateId)}') is incompatible — W034 incompatibilities carried verbatim`,
        incompatibilities: compatibility.incompatibilities,
      },
    };
  }

  return {
    ok: true,
    binding: {
      positionId: position.positionId,
      bodyId: body.body.bodyId,
      substrateId: substrate.substrate.substrateId,
      possessionId,
      grant,
      scope,
      compatibility: {
        checked: compatibility.checked,
        ...(compatibility.streamDigest === undefined ? {} : { streamDigest: compatibility.streamDigest }),
      },
      satisfiedCapabilities: demanded.map((demand) => demand.capabilityId),
    },
  };
}

/** The registry fingerprint: canonical over the SORTED registry. */
function registryDigestOf(
  bodies: readonly RegisteredBody[],
  substrates: readonly RegisteredSubstrate[],
): string {
  return stableDigest({
    bodies: bodies.map((entry) => ({
      bodyId: String(entry.body.bodyId),
      providesCapabilities: entry.providesCapabilities.map(String).sort(),
    })),
    substrates: substrates.map((entry) => ({
      substrateId: String(entry.substrate.substrateId),
      providesCapabilities: entry.providesCapabilities.map(String).sort(),
    })),
  });
}
