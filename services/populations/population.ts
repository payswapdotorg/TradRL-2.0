/**
 * The population record + founding gate (W045) — POPULATIONS: the typed
 * record of MANY agents bound into one world. A member IS a proven W044
 * binding, carried VERBATIM; founding re-proves every member through
 * world-agent-runtime's own validators (errors carried verbatim), proves
 * scope + declared-slot agreement with the world, refuses duplicate
 * member ids, and seals the content-addressed pop-<digest> record: the
 * membership in canonical binding-id order, the aggregate view AS
 * CARRIED DATA (./view.ts — never re-scored), the explicit scope, the
 * immutable generational lineage (genesis here; ./transitions.ts extends
 * it, never rewriting it), and deterministic founding provenance (A9: no
 * clocks — the seal time is the members' own declared boundAt, DATA).
 *
 * A14: a population COMPOSES records — it never executes, never steps a
 * world. W046 owns curriculum/self-play; W048 owns episode generation.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { registryFingerprintOf, stableDigest } from "skills";
import type { OpaqueId } from "skills";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type {
  AgentBinding,
  OrganizationBinding,
  WorldAgentBinding,
  WorldAgentBindingValidationError,
} from "world-agent-runtime";
import { validateAgentBinding, validateOrganizationBinding } from "world-agent-runtime";
import type { CapabilityRegistry } from "capability-registry";
import type { AblationKind } from "learning-objectives";
import { membersView } from "./view.js";
import type { PopulationView } from "./view.js";

/** The identity of one population (opaque; digest-derived). */
export type PopulationId = OpaqueId<"PopulationId">;

/** The population id prefix (the W016 family convention). */
export const POPULATION_ID_PREFIX = "pop-";

/** The explicit single-world scope a population lives in. */
export interface PopulationScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

/** One retirement citation: the member's binding id + the reason, as DATA. */
export interface MemberRetirement {
  readonly memberId: string;
  readonly reason: string;
}

/**
 * The ablation operation vocabulary, mirrored from the W039
 * `OrganizationOrigin` operation set (organization does not export the
 * union itself — a structural mirror, the W039 worklog's own precedent).
 */
export type AblationOperation =
  | "remove-position"
  | "remove-unit"
  | "substitute-body-requirement"
  | "substitute-substrate-requirement";

/**
 * One ablation citation: the W036/W039 closed ablation axis kind (the
 * `ABLATION_KINDS` table the organization vocabulary imports), the W039
 * origin operation, and the id the operation acted on.
 */
export interface AblationCitation {
  readonly kind: AblationKind;
  readonly operation: AblationOperation;
  readonly subject: string;
}

/** How one generation came to be: genesis, or one of the three transitions. */
export type PopulationOrigin =
  | { readonly kind: "genesis" }
  | { readonly kind: "add"; readonly addedMemberIds: readonly string[] }
  | { readonly kind: "retire"; readonly retirements: readonly MemberRetirement[] }
  | { readonly kind: "ablate"; readonly ablation: AblationCitation; readonly retirements: readonly MemberRetirement[] };

/**
 * The immutable generational lineage: the parent population (null iff
 * genesis), the generation number (0 for genesis, +1 per transition),
 * and the origin of THIS generation. Immutable means transitions never
 * edit a lineage — every transition seals a NEW record citing its parent.
 */
export interface PopulationLineage {
  readonly parentPopulationId: PopulationId | null;
  readonly generation: number;
  readonly origin: PopulationOrigin;
}

/**
 * The population provenance — deterministic DATA, never a clock read
 * (A9): the genesis seal time, this generation's seal time (both the
 * latest declared boundAt among the members — the members' own DATA),
 * and the W040 registry fingerprint the last transition gate ran
 * against (null iff genesis — founding takes no registry).
 */
export interface PopulationProvenance {
  readonly foundedAt: number;
  readonly sealedAt: number;
  readonly registryFingerprint: string | null;
}

/** The Population record: typed DATA (A14). */
export interface Population {
  readonly populationId: PopulationId;
  readonly kind: "population";
  readonly scope: PopulationScope;
  /** The member bindings, in canonical binding-id order. */
  readonly membership: readonly WorldAgentBinding[];
  /** The aggregate view, sealed at generation time as carried data (the pure projection of ./view.ts). */
  readonly view: PopulationView;
  readonly lineage: PopulationLineage;
  readonly provenance: PopulationProvenance;
}

// ---------------------------------------------------------------------------
// The typed founding error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type PopulationErrorCode =
  | "empty-membership" // founding needs at least one member
  | "invalid-member" // W044's own validator refused the member (carried verbatim)
  | "scope-mismatch" // a member's scope disagrees with the world's
  | "unknown-member-slot" // a member's slot is not a declared participant of the world
  | "duplicate-member"; // the same member binding twice

export interface PopulationError {
  readonly code: PopulationErrorCode;
  readonly message: string;
  readonly bindingId?: string;
  readonly participantId?: string;
  /** Present on `invalid-member`: W044's own validation errors, verbatim. */
  readonly memberErrors?: readonly WorldAgentBindingValidationError[];
}

export type PopulationOutcome =
  | { readonly ok: true; readonly population: Population }
  | { readonly ok: false; readonly errors: readonly PopulationError[] };

function error(code: PopulationErrorCode, message: string, extras: Omit<PopulationError, "code" | "message"> = {}): PopulationError {
  return { code, message, ...extras };
}

// ---------------------------------------------------------------------------
// The shared member helpers (founding, transitions and validation compose them)
// ---------------------------------------------------------------------------

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The canonical member order: binding-id lexicographic (A9). */
export function canonicalMemberOrder(members: readonly WorldAgentBinding[]): WorldAgentBinding[] {
  return [...members].sort((left, right) => compareStrings(String(left.bindingId), String(right.bindingId)));
}

/** One member's own W044 re-proof (the validator for its kind, errors verbatim). */
export function memberValidationErrors(member: WorldAgentBinding): WorldAgentBindingValidationError[] {
  const outcome = member.kind === "agent"
    ? validateAgentBinding(member as AgentBinding)
    : validateOrganizationBinding(member as OrganizationBinding);
  return outcome.ok ? [] : [...outcome.errors];
}

/** The member binding ids, in the given (canonical) order. */
export function memberBindingIds(members: readonly WorldAgentBinding[]): string[] {
  return members.map((member) => String(member.bindingId));
}

/** The substrate surfaces a member rides on (as carried — the W040 bearer dimension). */
export function memberSubstrateIds(member: WorldAgentBinding): string[] {
  if (member.kind === "agent") {
    return [String(member.substrateId)];
  }
  return [...new Set(member.seats.map((seat) => String(seat.substrateId)))];
}

/** The declared seal time of a membership: the latest member boundAt (DATA, A9). */
export function membershipSealedAt(members: readonly WorldAgentBinding[]): number {
  return members.reduce((latest, member) => Math.max(latest, Number(member.provenance.boundAt)), Number.NEGATIVE_INFINITY);
}

/** Deep-freeze the sealed record (the W043/W044 precedent). */
export function freezePopulation(value: unknown): void {
  if (value !== null && (typeof value === "object" || Array.isArray(value))) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezePopulation(child);
    }
  }
}

/** The content address of a generation: scope + lineage + the member ids (A9). */
function populationIdOf(scope: PopulationScope, lineage: PopulationLineage, memberIds: readonly string[]): PopulationId {
  return `${POPULATION_ID_PREFIX}${stableDigest({
    kind: "population",
    scope: { tenantId: scope.tenantId, projectId: scope.projectId, worldId: scope.worldId },
    generation: lineage.generation,
    parentPopulationId: lineage.parentPopulationId === null ? null : String(lineage.parentPopulationId),
    members: memberIds.map(String),
    origin: lineage.origin,
  })}` as PopulationId;
}

/**
 * Seal one generation (the shared seam founding and transitions compose):
 * canonical-order members + lineage + provenance ⇒ the frozen record.
 */
export function sealGeneration(input: {
  readonly scope: PopulationScope;
  readonly members: readonly WorldAgentBinding[];
  readonly lineage: PopulationLineage;
  readonly foundedAt: number;
  readonly registry: CapabilityRegistry | null;
}): Population {
  const members = canonicalMemberOrder(input.members);
  const memberIds = memberBindingIds(members);
  const population: Population = {
    populationId: populationIdOf(input.scope, input.lineage, memberIds),
    kind: "population",
    scope: input.scope,
    membership: members,
    view: membersView(members),
    lineage: input.lineage,
    provenance: {
      foundedAt: input.foundedAt,
      sealedAt: membershipSealedAt(members),
      registryFingerprint: input.registry === null ? null : registryFingerprintOf(input.registry),
    },
  };
  freezePopulation(population);
  return population;
}

// ---------------------------------------------------------------------------
// THE FOUNDING GATE
// ---------------------------------------------------------------------------

function sameScope(left: PopulationScope, right: { readonly tenantId: string; readonly projectId: string; readonly worldId: string }): boolean {
  return String(left.tenantId) === String(right.tenantId) && String(left.projectId) === String(right.projectId) && String(left.worldId) === String(right.worldId);
}

/** Every slot a member occupies must be a REAL declared participant of the world. */
function memberSlotErrors(world: WorldDefinition, member: WorldAgentBinding): PopulationError[] {
  const errors: PopulationError[] = [];
  const slots = member.kind === "agent" ? [member.slot] : member.seats.map((seat) => seat.slot);
  for (const slot of slots) {
    const participantId = String(slot.participantId);
    const declared = world.participants.find((candidate) => String(candidate.participantId) === participantId);
    if (declared === undefined) {
      errors.push(error(
        "unknown-member-slot",
        `member '${String(member.bindingId)}' occupies participant slot '${participantId}', which world '${String(world.scope.worldId)}' does not declare — a population is founded on REAL W023 slots only (fail-closed)`,
        { bindingId: String(member.bindingId), participantId },
      ));
      continue;
    }
    if (String(declared.accountId) !== String(slot.accountId) || String(declared.kind) !== String(slot.kind) || String(declared.worldId) !== String(slot.worldId)) {
      errors.push(error(
        "unknown-member-slot",
        `member '${String(member.bindingId)}' occupies slot '${participantId}' as (${String(slot.accountId)}, ${String(slot.kind)}), but the world declares (${String(declared.accountId)}, ${String(declared.kind)}) — the slot attachment must agree with the declared participant`,
        { bindingId: String(member.bindingId), participantId },
      ));
    }
  }
  return errors;
}

/**
 * THE FOUNDING GATE: `foundPopulation(worldIdentity, bindings)` — compose
 * MANY proven W044 bindings into one world's population and seal the
 * genesis generation. Deterministic (A9): same members + same world ⇒
 * deep-equal population, same canonical id — input order never matters.
 */
export function foundPopulation(
  worldIdentity: WorldDefinition,
  bindings: readonly WorldAgentBinding[],
): PopulationOutcome {
  const errors: PopulationError[] = [];
  if (bindings.length === 0) {
    return { ok: false, errors: [error("empty-membership", "a population of zero members is refused — founding composes at least one proven binding")] };
  }
  const scope: PopulationScope = {
    tenantId: String(worldIdentity.scope.tenantId),
    projectId: String(worldIdentity.scope.projectId),
    worldId: String(worldIdentity.scope.worldId),
  };
  const seen = new Set<string>();
  for (const member of bindings) {
    const bindingId = String(member.bindingId);
    if (seen.has(bindingId)) {
      errors.push(error(
        "duplicate-member",
        `member binding '${bindingId}' appears twice in the founding input — one binding, one member (the canonical membership never repeats)`,
        { bindingId },
      ));
      continue;
    }
    seen.add(bindingId);
    const memberErrors = memberValidationErrors(member);
    if (memberErrors.length > 0) {
      errors.push(error(
        "invalid-member",
        `member binding '${bindingId}' failed W044's own re-validation (${String(memberErrors.length)} error(s), carried verbatim) — nothing is founded on an unproven binding`,
        { bindingId, memberErrors },
      ));
    }
    if (!sameScope(member.scope, scope)) {
      errors.push(error(
        "scope-mismatch",
        `member binding '${bindingId}' belongs to scope (${String(member.scope.tenantId)}, ${String(member.scope.projectId)}, ${String(member.scope.worldId)}) but the population is founded in (${scope.tenantId}, ${scope.projectId}, ${scope.worldId}) — one world, one scope`,
        { bindingId },
      ));
    }
    errors.push(...memberSlotErrors(worldIdentity, member));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const members = canonicalMemberOrder(bindings);
  const population = sealGeneration({
    scope,
    members,
    lineage: { parentPopulationId: null, generation: 0, origin: { kind: "genesis" } },
    foundedAt: membershipSealedAt(members),
    registry: null,
  });
  return { ok: true, population };
}
