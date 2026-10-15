/**
 * Whole-population re-validation (W045) — re-proving a sealed population
 * from its own recorded data alone (the W043 `validateCommissionedBody`
 * and W044 `validateAgentBinding` precedents): the content-addressed
 * identity re-derivation, the canonical membership laws (order,
 * uniqueness, every member re-proven through W044's own validators with
 * errors carried verbatim, scope agreement), the CARRY law (the recorded
 * aggregate view must deep-equal the pure projection of the membership —
 * a carried view that drifted is a re-scored view, and this package
 * never re-scores), the immutable lineage laws (genesis ⇔ null parent +
 * generation 0; derived generations cite their parent and carry
 * well-formed origin data), and the deterministic provenance laws.
 * Pure, deterministic, fail-closed — every violation collected.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { ABLATION_KINDS } from "learning-objectives";
import { stableDigest } from "skills";
import type { WorldAgentBindingValidationError } from "world-agent-runtime";
import { membersView } from "./view.js";
import type { Population, PopulationOrigin } from "./population.js";
import { POPULATION_ID_PREFIX } from "./population.js";
import { memberBindingIds, memberValidationErrors, membershipSealedAt } from "./population.js";

export interface PopulationValidationError {
  readonly code: PopulationValidationErrorCode;
  readonly message: string;
}

export type PopulationValidationErrorCode =
  | "identity-mismatch" // the population id is not the content address of the recorded data
  | "empty-membership" // a population of zero members
  | "membership-order" // the membership is not in canonical binding-id order
  | "duplicate-member" // the same member binding twice
  | "invalid-member" // W044's own validator refused a member (carried verbatim)
  | "scope-mismatch" // a member's scope disagrees with the population's
  | "invalid-scope" // the population scope carries a blank member
  | "view-mismatch" // the carried view ≠ the pure projection (the carry law)
  | "lineage-invalid" // the generational lineage's own laws
  | "invalid-provenance"; // the deterministic provenance's own laws

export type PopulationValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly PopulationValidationError[] };

function violation(code: PopulationValidationErrorCode, message: string): PopulationValidationError {
  return { code, message };
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The origin data's own laws (well-formed citations, re-provable without the parent). */
function originViolations(origin: PopulationOrigin): PopulationValidationError[] {
  const violations: PopulationValidationError[] = [];
  if (origin.kind === "genesis") {
    return violations;
  }
  if (origin.kind === "add") {
    if (origin.addedMemberIds.length === 0) {
      violations.push(violation("lineage-invalid", "an add-origin generation records no added member — a transition is a change"));
    }
    const ids = origin.addedMemberIds.map(String);
    if (new Set(ids).size !== ids.length) {
      violations.push(violation("lineage-invalid", "an add-origin generation records the same member twice"));
    }
    if (ids.some((id) => !nonBlank(id))) {
      violations.push(violation("lineage-invalid", "an add-origin generation records a blank member id — identity is explicit"));
    }
    return violations;
  }
  const retirements = origin.kind === "retire" ? origin.retirements : origin.retirements;
  if (retirements.length === 0) {
    violations.push(violation("lineage-invalid", `a ${origin.kind}-origin generation records no retirement — a transition is a change`));
  }
  const ids = retirements.map((retirement) => String(retirement.memberId));
  if (new Set(ids).size !== ids.length) {
    violations.push(violation("lineage-invalid", `a ${origin.kind}-origin generation retires the same member twice`));
  }
  for (const retirement of retirements) {
    if (!nonBlank(retirement.memberId) || !nonBlank(retirement.reason)) {
      violations.push(violation("lineage-invalid", "a retirement citation carries a blank member id or reason — retirements are DATA, never blank"));
    }
  }
  if (origin.kind === "ablate") {
    const citation = origin.ablation;
    if (!ABLATION_KINDS.includes(String(citation.kind) as (typeof ABLATION_KINDS)[number])) {
      violations.push(violation("lineage-invalid", `the ablation citation's axis '${String(citation.kind)}' is outside the closed ABLATION_KINDS table (§13: ${ABLATION_KINDS.join(", ")})`));
    }
    const operations = ["remove-position", "remove-unit", "substitute-body-requirement", "substitute-substrate-requirement"] as const;
    if (!operations.includes(citation.operation as (typeof operations)[number])) {
      violations.push(violation("lineage-invalid", `the ablation citation's operation '${String(citation.operation)}' is outside the W039 origin operation vocabulary`));
    }
    if (!nonBlank(citation.subject)) {
      violations.push(violation("lineage-invalid", "the ablation citation carries a blank subject — the citation names what the operation acted on"));
    }
  }
  return violations;
}

/**
 * Re-prove a sealed population from its own recorded data. The
 * declared-participants proof needs the world, so it runs at FOUNDING
 * (where the world is given); everything else is re-provable from the
 * record alone and is re-proved here.
 */
export function validatePopulation(population: Population): PopulationValidationOutcome {
  const errors: PopulationValidationError[] = [];
  if (population.membership.length === 0) {
    return { ok: false, errors: [violation("empty-membership", "the population carries no members — a population composes at least one proven binding")] };
  }
  if (!nonBlank(population.scope.tenantId) || !nonBlank(population.scope.projectId) || !nonBlank(population.scope.worldId)) {
    errors.push(violation("invalid-scope", "the population scope carries a blank member — the explicit tenant/project/world identity law"));
  }
  const ids = memberBindingIds(population.membership);
  const sorted = [...ids].sort(compareStrings);
  if (ids.join(",") !== sorted.join(",")) {
    errors.push(violation("membership-order", "the membership is not in canonical binding-id order (A9)"));
  }
  if (new Set(ids).size !== ids.length) {
    errors.push(violation("duplicate-member", "the same member binding appears twice — the canonical membership never repeats"));
  }
  for (const member of population.membership) {
    const memberErrors: readonly WorldAgentBindingValidationError[] = memberValidationErrors(member);
    if (memberErrors.length > 0) {
      errors.push(violation("invalid-member", `member binding '${String(member.bindingId)}' fails W044's own re-validation (${String(memberErrors.length)} error(s), carried verbatim)`));
    }
    const scope = member.scope;
    if (
      String(scope.tenantId) !== population.scope.tenantId ||
      String(scope.projectId) !== population.scope.projectId ||
      String(scope.worldId) !== population.scope.worldId
    ) {
      errors.push(violation("scope-mismatch", `member binding '${String(member.bindingId)}' belongs to a different scope than the population — one world, one scope`));
    }
  }
  const projected = membersView(population.membership);
  if (stableDigest(projected) !== stableDigest(population.view)) {
    errors.push(violation("view-mismatch", "the carried aggregate view is not the pure projection of the membership — views CARRY the members' own data, they never re-score (drift is a new authority source, refused)"));
  }
  const lineage = population.lineage;
  const isGenesis = lineage.origin.kind === "genesis";
  if (isGenesis && (lineage.parentPopulationId !== null || lineage.generation !== 0)) {
    errors.push(violation("lineage-invalid", "a genesis population carries a parent or a non-zero generation — genesis is generation 0 with no parent"));
  }
  if (!isGenesis && (lineage.parentPopulationId === null || lineage.generation < 1)) {
    errors.push(violation("lineage-invalid", "a derived population cites no parent or carries a non-positive generation — every transition extends a parent generation"));
  }
  if (!nonBlank(String(lineage.parentPopulationId ?? "")) && !isGenesis) {
    errors.push(violation("lineage-invalid", "a derived population cites a blank parent id — the lineage is content-addressed, never blank"));
  }
  errors.push(...originViolations(lineage.origin));
  const sealedAt = membershipSealedAt(population.membership);
  if (population.provenance.sealedAt !== sealedAt) {
    errors.push(violation("invalid-provenance", `the declared seal time ${String(population.provenance.sealedAt)} is not the latest declared member boundAt ${String(sealedAt)} — declared DATA, never a clock read (A9)`));
  }
  if (typeof population.provenance.foundedAt !== "number" || !Number.isFinite(population.provenance.foundedAt)) {
    errors.push(violation("invalid-provenance", "the founding time is not a finite declared number — deterministic DATA"));
  }
  if (isGenesis && population.provenance.foundedAt !== sealedAt) {
    errors.push(violation("invalid-provenance", "a genesis population's founding time is not its own seal time — founding is the first seal"));
  }
  const fingerprint = population.provenance.registryFingerprint;
  if (isGenesis && fingerprint !== null) {
    errors.push(violation("invalid-provenance", "a genesis population records a transition-registry fingerprint — founding takes no registry"));
  }
  if (!isGenesis && !nonBlank(String(fingerprint ?? ""))) {
    errors.push(violation("invalid-provenance", "a derived population records no W040 registry fingerprint — every transition gate ran against one"));
  }
  const expected = `${POPULATION_ID_PREFIX}${stableDigest({
    kind: "population",
    scope: { tenantId: population.scope.tenantId, projectId: population.scope.projectId, worldId: population.scope.worldId },
    generation: lineage.generation,
    parentPopulationId: lineage.parentPopulationId === null ? null : String(lineage.parentPopulationId),
    members: ids.map(String),
    origin: lineage.origin,
  })}`;
  if (expected !== String(population.populationId)) {
    errors.push(violation("identity-mismatch", `the population id is not the content address of the recorded lineage (expected ${expected.slice(0, 20)}…, recorded ${String(population.populationId).slice(0, 20)}…)`));
  }
  return errors.length === 0
    ? { ok: true, checked: ["identity", "membership", "member-bindings", "scope", "view-carry", "lineage", "provenance"] }
    : { ok: false, errors };
}
