/**
 * Organization ablation (W039) — R053 "Organization is optimizable" and
 * §13's evaluation axes made structural: typed PURE operations over the
 * declarative model, each producing a NEW valid definition with a
 * DERIVED identity and an immutable lineage citing the parent.
 *
 * The axis mapping (W036's closed ABLATION_KINDS table):
 * - "organization" — `ablatePosition` / `ablateUnit` remove structure;
 * - "model-substitution" — `substituteSubstrateRequirement` swaps what
 *   MIND a seat requires (`substituteBodyRequirement` is the body-side
 *   structural substitution and files under "organization").
 *
 * Fail-closed: operating on an unknown id is a loud typed error; if the
 * RESULT would violate any model law (e.g. removing the last position),
 * the operation refuses — the validation errors are carried verbatim and
 * NOTHING is emitted. The input definition is never mutated.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { organizationIdOf } from "./identity.js";
import type { OrganizationPositionId, OrganizationUnitId } from "./identity.js";
import type {
  OrganizationBodyRequirement,
  OrganizationDefinition,
  OrganizationOrigin,
  OrganizationSubstrateRequirement,
} from "./definition.js";
import { validateOrganizationDefinition } from "./validate.js";
import type { OrganizationError } from "./validate.js";

/** The typed error of one refused ablation. */
export interface OrganizationAblationError {
  readonly code:
    | "unknown-position" // the operation names a position the organization does not declare
    | "unknown-unit" // the operation names a unit the organization does not declare
    | "ablation-invalid"; // the RESULT failed the model laws — carried verbatim
  readonly message: string;
  readonly validationErrors?: readonly OrganizationError[];
}

export type OrganizationAblationOutcome =
  | { readonly ok: true; readonly definition: OrganizationDefinition }
  | { readonly ok: false; readonly error: OrganizationAblationError };

function derived(
  base: OrganizationDefinition,
  parts: Omit<OrganizationDefinition, "scope" | "capabilities" | "lineage" | "displayName">,
  origin: OrganizationOrigin,
): OrganizationDefinition {
  return {
    displayName: base.displayName,
    scope: base.scope,
    capabilities: base.capabilities,
    ...parts,
    lineage: {
      parentOrganizationId: organizationIdOf(base),
      origin,
    },
  };
}

/** Emit only a lawfully valid derived definition (the fail-closed gate). */
function finish(
  candidate: OrganizationDefinition,
): OrganizationAblationOutcome {
  const validation = validateOrganizationDefinition(candidate);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: "ablation-invalid",
        message: `the ablation result violates ${String(validation.errors.length)} organization law(s) — refused, nothing emitted (carried verbatim)`,
        validationErrors: validation.errors,
      },
    };
  }
  return { ok: true, definition: candidate };
}

/**
 * Remove ONE position (the "organization" ablation axis): the position,
 * its capability demands, its possession binding and every unit
 * membership disappear; the rest composes unchanged. Removing the last
 * position is refused (empty-organization, carried verbatim).
 */
export function ablatePosition(
  definition: OrganizationDefinition,
  positionId: OrganizationPositionId,
): OrganizationAblationOutcome {
  const id = String(positionId);
  if (!definition.positions.some((position) => String(position.positionId) === id)) {
    return {
      ok: false,
      error: {
        code: "unknown-position",
        message: `cannot ablate unknown position '${id}' — the organization does not declare it`,
      },
    };
  }
  return finish(
    derived(
      definition,
      {
        positions: definition.positions.filter((position) => String(position.positionId) !== id),
        units: definition.units.map((unit) => ({
          ...unit,
          positionIds: unit.positionIds.filter((member) => String(member) !== id),
        })),
        bindings: definition.bindings.filter((binding) => String(binding.positionId) !== id),
      },
      { kind: "organization", operation: "remove-position", subject: id },
    ),
  );
}

/**
 * Remove ONE unit (the "organization" ablation axis): the unit's child
 * units compose into the removed unit's own parent (or the organization
 * root when it had none) and its positions follow — deterministic, never
 * orphaned. Positions of a root unit become direct organization members.
 */
export function ablateUnit(
  definition: OrganizationDefinition,
  unitId: OrganizationUnitId,
): OrganizationAblationOutcome {
  const id = String(unitId);
  const unit = definition.units.find((candidate) => String(candidate.unitId) === id);
  if (unit === undefined) {
    return {
      ok: false,
      error: {
        code: "unknown-unit",
        message: `cannot ablate unknown unit '${id}' — the organization does not declare it`,
      },
    };
  }
  const parent = unit.parentUnitId;
  const reparented = definition.units
    .filter((candidate) => String(candidate.unitId) !== id)
    .map((candidate) => {
      if (String(candidate.parentUnitId) === id) {
        return { ...candidate, parentUnitId: parent };
      }
      if (String(candidate.unitId) === String(parent ?? "")) {
        // The parent absorbs the removed unit's positions (sorted order is
        // the canonical member order — the identity projection sorts it).
        return {
          ...candidate,
          positionIds: [...candidate.positionIds, ...unit.positionIds],
        };
      }
      return candidate;
    });
  return finish(
    derived(
      definition,
      { positions: definition.positions, units: reparented, bindings: definition.bindings },
      { kind: "organization", operation: "remove-unit", subject: id },
    ),
  );
}

/**
 * Substitute what BODY a position requires (the body-side structural
 * substitution, "organization" axis): the seat's body requirement is
 * replaced wholesale; the position keeps its identity, its demands and
 * its binding (the binding's narrowing, if any, must still subset the
 * NEW requirement — otherwise the result is refused loudly).
 */
export function substituteBodyRequirement(
  definition: OrganizationDefinition,
  positionId: OrganizationPositionId,
  bodyRequirement: OrganizationBodyRequirement,
): OrganizationAblationOutcome {
  return substitute(
    definition,
    positionId,
    "substitute-body-requirement",
    "organization",
    (position) => ({ ...position, bodyRequirement }),
  );
}

/**
 * Substitute what MIND a position requires (the "model-substitution"
 * ablation axis — §13's model substitution acts HERE): the seat's
 * substrate requirement is replaced wholesale.
 */
export function substituteSubstrateRequirement(
  definition: OrganizationDefinition,
  positionId: OrganizationPositionId,
  substrateRequirement: OrganizationSubstrateRequirement,
): OrganizationAblationOutcome {
  return substitute(
    definition,
    positionId,
    "substitute-substrate-requirement",
    "model-substitution",
    (position) => ({ ...position, substrateRequirement }),
  );
}

function substitute(
  definition: OrganizationDefinition,
  positionId: OrganizationPositionId,
  operation: "substitute-body-requirement" | "substitute-substrate-requirement",
  kind: "organization" | "model-substitution",
  patch: (position: OrganizationDefinition["positions"][number]) => OrganizationDefinition["positions"][number],
): OrganizationAblationOutcome {
  const id = String(positionId);
  if (!definition.positions.some((position) => String(position.positionId) === id)) {
    return {
      ok: false,
      error: {
        code: "unknown-position",
        message: `cannot substitute into unknown position '${id}' — the organization does not declare it`,
      },
    };
  }
  return finish(
    derived(
      definition,
      {
        positions: definition.positions.map((position) =>
          String(position.positionId) === id ? patch(position) : position,
        ),
        units: definition.units,
        bindings: definition.bindings,
      },
      { kind, operation, subject: id },
    ),
  );
}
