/**
 * Organization validation (W039) — the fail-closed laws of the model.
 *
 * Every violation is a LOUD typed error naming the exact law (never a
 * silent default): unknown capability reference, a position without
 * requirements, cyclic composition, duplicate ids, scope mismatch (a
 * binding that widens authority beyond the position's own requirement),
 * an invalid lineage, an unbound or doubly-bound position. Check order
 * is deterministic (the W032/W034 validate precedent).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { BODY_COMMAND_KINDS, BODY_OBSERVATION_KINDS } from "agent-body";
import { SUBSTRATE_STATE_MODES } from "cognitive-substrate";
import { ABLATION_KINDS } from "learning-objectives";
import { POSSESSION_CHANNELS } from "possession";
import type { OrganizationDefinition, OrganizationPosition } from "./definition.js";

/** The typed error of one violated organization law. */
export interface OrganizationError {
  readonly code: OrganizationErrorCode;
  readonly message: string;
  readonly field?: string;
}

export type OrganizationErrorCode =
  | "blank-field" // a blank id/title/name/basis/rationale
  | "empty-organization" // an organization with no positions
  | "duplicate-position" // the same position id declared twice
  | "duplicate-unit" // the same unit id declared twice
  | "duplicate-capability" // the same capability declared twice
  | "duplicate-binding" // more than one binding for one position
  | "duplicate-entry" // a duplicate inside one requirement/member list
  | "unknown-position" // a binding/unit references an undeclared position
  | "unknown-unit" // a unit's parent (or a member) references an undeclared unit
  | "unknown-capability" // a position demands an undeclared capability
  | "cyclic-composition" // the unit parent chain is cyclic
  | "position-without-requirements" // a seat whose requirements say nothing
  | "invalid-requirement" // a requirement violates a closed set / rate shape
  | "invalid-channel" // a possession binding off the "organization" channel
  | "duplicate-membership" // a position composing into more than one unit
  | "scope-mismatch" // a binding narrows LESS than nothing (widens) or leaves the requirement
  | "invalid-lineage" // genesis/derived lineage shape violated
  | "unbound-position"; // a position with no possession binding

/** The validation outcome: ok, or every collected violation loudly. */
export type OrganizationValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly OrganizationError[] };

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function error(
  code: OrganizationError["code"],
  message: string,
  field?: string,
): OrganizationError {
  return { code, message, ...(field === undefined ? {} : { field }) };
}

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicated.add(value);
    }
    seen.add(value);
  }
  return [...duplicated];
}

function checkNoDuplicates(
  values: readonly string[],
  label: string,
  code: OrganizationErrorCode,
  errors: OrganizationError[],
): void {
  for (const duplicate of duplicatesOf(values)) {
    errors.push(error(code, `duplicate ${label} '${duplicate}' — position identity is exact string identity`, label));
  }
}

function subsetOf(
  values: readonly string[],
  allowed: readonly string[],
): string[] {
  return values.filter((value) => !allowed.includes(value));
}

/**
 * The validation gate: an organization definition is valid iff EVERY law
 * below holds. Deterministic check order: identity/blankness →
 * duplicates → requirement shapes (closed sets, rate shape, non-empty) →
 * capabilities → composition (unknown parents, cycles, members) →
 * bindings (unknown/duplicate positions, channel, grant, narrowing ⊆
 * requirement) → lineage → non-emptiness.
 */
export function validateOrganizationDefinition(
  definition: OrganizationDefinition,
): OrganizationValidationOutcome {
  const errors: OrganizationError[] = [];

  // --- scope identity ------------------------------------------------------
  for (const [field, value] of Object.entries(definition.scope)) {
    if (!isNonBlank(value)) {
      errors.push(error("blank-field", `scope.${field} must be a non-blank string (the explicit tenant/project/world identity law)`, `scope.${field}`));
    }
  }

  // --- positions: identity + requirement laws ------------------------------
  const positionIds = definition.positions.map((position) => String(position.positionId));
  checkNoDuplicates(positionIds, "position id", "duplicate-position", errors);
  for (const position of definition.positions) {
    validatePosition(position, errors);
  }

  // --- units: identity + composition laws ----------------------------------
  const unitIds = definition.units.map((unit) => String(unit.unitId));
  checkNoDuplicates(unitIds, "unit id", "duplicate-unit", errors);
  for (const unit of definition.units) {
    if (!isNonBlank(unit.unitId)) {
      errors.push(error("blank-field", "unitId must be a non-blank string", "unitId"));
    }
    if (!isNonBlank(unit.name)) {
      errors.push(error("blank-field", `unit '${String(unit.unitId)}' name must be a non-blank string`, "name"));
    }
    checkNoDuplicates(unit.positionIds.map(String), `position member of unit '${String(unit.unitId)}'`, "duplicate-entry", errors);
  }
  const knownUnits = new Set(unitIds);
  for (const unit of definition.units) {
    if (unit.parentUnitId !== null && !knownUnits.has(String(unit.parentUnitId))) {
      errors.push(error("unknown-unit", `unit '${String(unit.unitId)}' composes into unknown parent unit '${String(unit.parentUnitId)}'`, "parentUnitId"));
    }
    if (unit.parentUnitId !== null && String(unit.parentUnitId) === String(unit.unitId)) {
      errors.push(error("cyclic-composition", `unit '${String(unit.unitId)}' composes into itself — the composition tree must be acyclic`, "parentUnitId"));
    }
  }
  detectUnitCycle(definition, knownUnits, errors);

  // --- membership: every unit member is a declared position, exactly once -
  const knownPositions = new Set(positionIds);
  const memberships = new Map<string, string>();
  for (const unit of definition.units) {
    for (const member of unit.positionIds) {
      if (!knownPositions.has(String(member))) {
        errors.push(error("unknown-position", `unit '${String(unit.unitId)}' composes unknown position '${String(member)}'`, "positionIds"));
      }
      const prior = memberships.get(String(member));
      if (prior !== undefined) {
        errors.push(error("duplicate-membership", `position '${String(member)}' composes into both unit '${prior}' and unit '${String(unit.unitId)}' — a position composes into exactly ONE unit (or the organization root)`, "positionIds"));
      } else {
        memberships.set(String(member), String(unit.unitId));
      }
    }
  }

  // --- capabilities ----------------------------------------------------------
  const capabilityIds = definition.capabilities.map((capability) => String(capability.capabilityId));
  checkNoDuplicates(capabilityIds, "capability id", "duplicate-capability", errors);
  for (const capability of definition.capabilities) {
    if (!isNonBlank(capability.capabilityId)) {
      errors.push(error("blank-field", "capabilityId must be a non-blank string", "capabilityId"));
    }
    if (!isNonBlank(capability.name)) {
      errors.push(error("blank-field", `capability '${String(capability.capabilityId)}' name must be a non-blank string`, "name"));
    }
  }
  const knownCapabilities = new Set(capabilityIds);
  for (const position of definition.positions) {
    for (const demand of position.capabilityDemands) {
      if (!isNonBlank(demand.rationale)) {
        errors.push(error("blank-field", `position '${String(position.positionId)}' demand '${String(demand.capabilityId)}' rationale must be non-blank (rationale-as-data, §10)`, "rationale"));
      }
      if (!knownCapabilities.has(String(demand.capabilityId))) {
        errors.push(error("unknown-capability", `position '${String(position.positionId)}' demands unknown capability '${String(demand.capabilityId)}' — capabilities are declared in the organization's own catalogue, never assumed`, "capabilityDemands"));
      }
    }
    checkNoDuplicates(
      position.capabilityDemands.map((demand) => String(demand.capabilityId)),
      `capability demand of position '${String(position.positionId)}'`,
      "duplicate-entry",
      errors,
    );
  }

  // --- bindings ---------------------------------------------------------------
  validateBindings(definition, knownPositions, errors);

  // --- lineage ------------------------------------------------------------------
  validateLineage(definition, errors);

  // --- non-emptiness -------------------------------------------------------------
  if (definition.positions.length === 0) {
    errors.push(error("empty-organization", "an organization must declare at least one position — an empty organization cannot compose bodies"));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    checked: [
      "scope-identity",
      "position-identity",
      "position-requirements",
      "capability-references",
      "composition-acyclic",
      "unit-membership",
      "membership-uniqueness",
      "binding-uniqueness",
      "binding-channel",
      "binding-scope-subset",
      "lineage-shape",
      "organization-nonempty",
    ],
  };
}

function validatePosition(position: OrganizationPosition, errors: OrganizationError[]): void {
  const id = String(position.positionId);
  if (!isNonBlank(position.positionId)) {
    errors.push(error("blank-field", "positionId must be a non-blank string", "positionId"));
  }
  if (!isNonBlank(position.title)) {
    errors.push(error("blank-field", `position '${id}' title must be a non-blank string`, "title"));
  }
  const { bodyRequirement, substrateRequirement } = position;

  // Closed sets (the W032/W033 runtime membership tables).
  for (const kind of subsetOf(bodyRequirement.commandKinds, BODY_COMMAND_KINDS)) {
    errors.push(error("invalid-requirement", `position '${id}' body requirement demands unknown command kind '${kind}' (closed set: ${BODY_COMMAND_KINDS.join(", ")})`, "bodyRequirement.commandKinds"));
  }
  for (const kind of subsetOf(bodyRequirement.observations, BODY_OBSERVATION_KINDS)) {
    errors.push(error("invalid-requirement", `position '${id}' body requirement demands unknown observation kind '${kind}' (closed set: ${BODY_OBSERVATION_KINDS.join(", ")})`, "bodyRequirement.observations"));
  }
  for (const kind of subsetOf(substrateRequirement.commandKinds, BODY_COMMAND_KINDS)) {
    errors.push(error("invalid-requirement", `position '${id}' substrate requirement demands unknown command kind '${kind}' (closed set: ${BODY_COMMAND_KINDS.join(", ")})`, "substrateRequirement.commandKinds"));
  }
  if (
    substrateRequirement.stateMode !== undefined &&
    !SUBSTRATE_STATE_MODES.includes(substrateRequirement.stateMode)
  ) {
    errors.push(error("invalid-requirement", `position '${id}' substrate requirement demands unknown state mode '${String(substrateRequirement.stateMode)}' (closed set: ${SUBSTRATE_STATE_MODES.join(", ")})`, "substrateRequirement.stateMode"));
  }
  if (
    !Number.isInteger(substrateRequirement.minMaxDecisionsPerView) ||
    substrateRequirement.minMaxDecisionsPerView < 1
  ) {
    errors.push(error("invalid-requirement", `position '${id}' substrate requirement minMaxDecisionsPerView must be an integer >= 1 (got '${String(substrateRequirement.minMaxDecisionsPerView)}')`, "substrateRequirement.minMaxDecisionsPerView"));
  }
  checkNoDuplicates(bodyRequirement.commandKinds, `command kind of position '${id}' body requirement`, "duplicate-entry", errors);
  checkNoDuplicates(bodyRequirement.instruments.map(String), `instrument of position '${id}' body requirement`, "duplicate-entry", errors);
  checkNoDuplicates(bodyRequirement.observations, `observation of position '${id}' body requirement`, "duplicate-entry", errors);
  checkNoDuplicates(substrateRequirement.commandKinds, `command kind of position '${id}' substrate requirement`, "duplicate-entry", errors);

  // A position without requirements: a seat whose requirements say nothing.
  if (bodyRequirement.commandKinds.length === 0 && bodyRequirement.instruments.length === 0) {
    errors.push(error("position-without-requirements", `position '${id}' declares a body requirement with no command kinds and no instruments — a position must require SOMETHING of the body that fills it`, "bodyRequirement"));
  }
  if (substrateRequirement.commandKinds.length === 0) {
    errors.push(error("position-without-requirements", `position '${id}' declares a substrate requirement with no command kinds — a position must require SOMETHING of the substrate that decides through it`, "substrateRequirement"));
  }
}

function detectUnitCycle(
  definition: OrganizationDefinition,
  knownUnits: Set<string>,
  errors: OrganizationError[],
): void {
  const parents = new Map<string, string | null>();
  for (const unit of definition.units) {
    parents.set(String(unit.unitId), unit.parentUnitId === null ? null : String(unit.parentUnitId));
  }
  for (const start of knownUnits) {
    let cursor: string | null = start;
    const path: string[] = [];
    const visited = new Set<string>();
    while (cursor !== null && parents.has(cursor)) {
      if (visited.has(cursor)) {
        const cycle = [...path.slice(path.indexOf(cursor)), cursor].join(" -> ");
        errors.push(error("cyclic-composition", `the composition tree is cyclic: ${cycle} — units compose into the organization, never into a loop`, "parentUnitId"));
        break;
      }
      visited.add(cursor);
      path.push(cursor);
      cursor = parents.get(cursor) ?? null;
    }
  }
}

function validateBindings(
  definition: OrganizationDefinition,
  knownPositions: Set<string>,
  errors: OrganizationError[],
): void {
  checkNoDuplicates(definition.bindings.map((binding) => String(binding.positionId)), "binding for position", "duplicate-binding", errors);
  const bound = new Set<string>();
  for (const binding of definition.bindings) {
    const id = String(binding.positionId);
    if (!knownPositions.has(id)) {
      errors.push(error("unknown-position", `binding references unknown position '${id}'`, "positionId"));
    }
    bound.add(id);
    if (binding.grant.channel !== "organization") {
      errors.push(error("invalid-channel", `the binding for position '${id}' uses channel '${String(binding.grant.channel)}' — an organization possession binding must use the "organization" channel (POSSESSION_CHANNELS: ${POSSESSION_CHANNELS.join(", ")})`, "grant.channel"));
    }
    if (!isNonBlank(binding.grant.grantedBy)) {
      errors.push(error("blank-field", `the binding for position '${id}' names a blank grantor`, "grant.grantedBy"));
    }
    if (!isNonBlank(binding.grant.basis)) {
      errors.push(error("blank-field", `the binding for position '${id}' declares a blank grant basis`, "grant.basis"));
    }
    if (!Number.isFinite(binding.grant.grantedAt)) {
      errors.push(error("blank-field", `the binding for position '${id}' declares a non-finite grant time (a declared time is data, never a clock read)`, "grant.grantedAt"));
    }
    const position = definition.positions.find((candidate) => String(candidate.positionId) === id);
    if (position === undefined) {
      continue;
    }
    const narrowing = binding.scopeNarrowing;
    if (narrowing === undefined) {
      continue;
    }
    for (const instrument of narrowing.instruments ?? []) {
      if (!position.bodyRequirement.instruments.map(String).includes(String(instrument))) {
        errors.push(error("scope-mismatch", `the binding for position '${id}' narrows instruments to '${String(instrument)}' which is OUTSIDE the position's own body requirement — a possession narrows authority, never widens it (W034 scope law)`, "scopeNarrowing.instruments"));
      }
    }
    for (const kind of narrowing.commandKinds ?? []) {
      if (!position.bodyRequirement.commandKinds.includes(kind)) {
        errors.push(error("scope-mismatch", `the binding for position '${id}' narrows command kinds to '${kind}' which is OUTSIDE the position's own body requirement — a possession narrows authority, never widens it (W034 scope law)`, "scopeNarrowing.commandKinds"));
      }
    }
    for (const kind of narrowing.observations ?? []) {
      if (!position.bodyRequirement.observations.includes(kind)) {
        errors.push(error("scope-mismatch", `the binding for position '${id}' narrows observations to '${kind}' which is OUTSIDE the position's own body requirement — a possession narrows authority, never widens it (W034 scope law)`, "scopeNarrowing.observations"));
      }
    }
  }
  for (const positionId of knownPositions) {
    if (!bound.has(positionId)) {
      errors.push(error("unbound-position", `position '${positionId}' has no possession binding — an organization binds EVERY seat (the compile never silently drops a position)`));
    }
  }
}

function validateLineage(definition: OrganizationDefinition, errors: OrganizationError[]): void {
  const { lineage } = definition;
  const genesis = lineage.origin.kind === "genesis";
  if (genesis && lineage.parentOrganizationId !== null) {
    errors.push(error("invalid-lineage", "a genesis organization cites a parent — only derived organizations have one", "lineage.parentOrganizationId"));
  }
  if (!genesis) {
    if (lineage.parentOrganizationId === null) {
      errors.push(error("invalid-lineage", `a derived organization (origin kind '${String(lineage.origin.kind)}') must cite its parent organization id`, "lineage.parentOrganizationId"));
    }
    if (!ABLATION_KINDS.includes(lineage.origin.kind)) {
      errors.push(error("invalid-lineage", `origin kind '${String(lineage.origin.kind)}' is outside the closed ABLATION_KINDS table (§13: ${ABLATION_KINDS.join(", ")})`, "lineage.origin.kind"));
    }
    if (!isNonBlank(lineage.origin.subject)) {
      errors.push(error("invalid-lineage", "a derived organization names a blank derivation subject", "lineage.origin.subject"));
    }
  }
}
