/**
 * The binding gates (W044) — `bindAgent` and `bindOrganization`: the
 * pure, typed act that BINDS a commissioned agent (or a whole
 * organization, through its compiled plan) to a World, sealing the typed
 * wiring record. The shared per-seat gate laws live in ./gates.ts; this
 * module owns the two GATES + the compiled plan's recorded-output-law
 * re-proof (W039 ships no whole-plan validator, disclosed: its walk's
 * own output invariants re-proved from recorded data, the W042/W043
 * precedent).
 *
 * A13: every authority channel cites the covering grants — execution
 * authority is always OUTSIDE model outputs. A14: the runtime BINDS —
 * wiring records and routing CONTRACTS, never execution. A9: no clocks
 * (the binding time is the latest declared grantedAt — DATA), no
 * randomness, no env reads; same inputs ⇒ byte-identical record + id.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { CommissionedBody } from "body-forge/commissioning";
import { registryFingerprintOf, stableDigest } from "skills";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type { CompiledOrganization } from "organization-compiler";
import type { AgentBindingId } from "./contracts.js";
import { AGENT_BINDING_ID_PREFIX } from "./contracts.js";
import type {
  AgentBinding,
  AgentBindingOutcome,
  BindingError,
  BindingGrants,
  OrganizationBinding,
  OrganizationBindingOutcome,
  OrganizationSeatBinding,
} from "./contracts.js";
import { commissionedGate, compareStrings, endowmentGate, error, freeze, registryGate, sameScope, seatGate } from "./gates.js";

// --- bindAgent ----------------------------------------------------------------

/** THE AGENT BINDING: one commissioned body → one world participant slot. */
export function bindAgent(
  worldIdentity: WorldDefinition,
  commissionedBody: CommissionedBody,
  grants: BindingGrants,
): AgentBindingOutcome {
  const errors: BindingError[] = [];
  errors.push(...registryGate(grants.registry, worldIdentity));
  errors.push(...endowmentGate(commissionedBody, grants.registry));
  const seat = seatGate(worldIdentity, commissionedBody, grants.grants);
  if (!seat.ok) {
    errors.push(...seat.errors);
  }
  if (errors.length > 0 || !seat.ok) {
    return { ok: false, errors };
  }
  const wiring = seat.wiring;
  const authority = wiring.action.channels.flatMap((channel) => channel.authority);
  const grantDigests = [...new Set(authority.map((entry) => entry.grantDigest))].sort(compareStrings);
  const boundAt = authority.reduce((latest, entry) => Math.max(latest, Number(entry.grant.grantedAt)), Number.NEGATIVE_INFINITY);
  const scope = {
    tenantId: String(worldIdentity.scope.tenantId),
    projectId: String(worldIdentity.scope.projectId),
    worldId: String(worldIdentity.scope.worldId),
  };
  const bindingId = `${AGENT_BINDING_ID_PREFIX}${stableDigest({
    kind: "agent",
    world: { ...scope, participantId: wiring.slot.participantId, accountId: wiring.slot.accountId },
    commissionedId: String(wiring.record.commissionedId),
    planId: String(wiring.record.provenance.planId),
    grantDigests,
  })}` as AgentBindingId;
  const binding: AgentBinding = {
    bindingId,
    kind: "agent",
    world: {
      scope,
      slots: [worldIdentity.participants.find((candidate) => String(candidate.participantId) === wiring.slot.participantId)!],
    },
    slot: wiring.slot,
    commissionedId: wiring.record.commissionedId,
    substrateId: wiring.record.substrate.substrateId,
    observation: wiring.observation,
    action: wiring.action,
    scope,
    lineage: {
      commissionedIds: [wiring.record.commissionedId],
      commissionedHeads: [wiring.commissionedHead],
      grantDigests,
    },
    provenance: {
      boundAt,
      registryFingerprint: registryFingerprintOf(grants.registry),
      planId: String(wiring.record.provenance.planId),
    },
  };
  freeze(binding);
  return { ok: true, binding };
}

// --- bindOrganization ---------------------------------------------------------

/** The compiled plan's own recorded output laws (the W039 output-laws re-proof, disclosed). */
function planGate(compiled: CompiledOrganization, world: WorldDefinition): BindingError[] {
  const errors: BindingError[] = [];
  const bindingIds = compiled.bindings.map((binding) => String(binding.positionId));
  const sorted = [...bindingIds].sort(compareStrings);
  if (bindingIds.some((id, index) => id !== sorted[index])) {
    errors.push(error(
      "invalid-plan",
      "the compiled plan's bindings are not in canonical positionId order — the W039 compiler always emits canonical order (A9)",
    ));
  }
  if (new Set(bindingIds).size !== bindingIds.length) {
    errors.push(error("invalid-plan", "the compiled plan binds the same position twice — every position binds exactly once"));
  }
  const order = compiled.executionOrder.map(String);
  if (order.length !== bindingIds.length || new Set(order).size !== order.length || !bindingIds.every((id) => order.includes(id))) {
    errors.push(error(
      "invalid-plan",
      "the compiled plan's execution order is not a permutation of its bindings' positions — the canonical execution order visits every position exactly once (A6/A9)",
    ));
  }
  for (const binding of compiled.bindings) {
    if (
      String(binding.bodyId).trim() === "" || String(binding.substrateId).trim() === "" ||
      String(binding.possessionId).trim() === "" || binding.compatibility.checked.length === 0
    ) {
      errors.push(error(
        "invalid-plan",
        `the binding for position '${String(binding.positionId)}' is incomplete (body/substrate/possession identity or compatibility evidence missing) — the compiler never emits incomplete seats`,
        { positionId: String(binding.positionId) },
      ));
    }
  }
  if (!sameScope(compiled.scope, world.scope)) {
    errors.push(error(
      "plan-scope-mismatch",
      `the compiled plan's scope (${String(compiled.scope.tenantId)}, ${String(compiled.scope.projectId)}, ${String(compiled.scope.worldId)}) disagrees with the world scope (${String(world.scope.tenantId)}, ${String(world.scope.projectId)}, ${String(world.scope.worldId)})`,
    ));
  }
  return errors;
}

/** THE ORGANIZATION BINDING: the compiled plan + its commissioned bodies → the world. */
export function bindOrganization(
  worldIdentity: WorldDefinition,
  compiledPlan: CompiledOrganization,
  commissionedBodies: readonly CommissionedBody[],
  grants: BindingGrants,
): OrganizationBindingOutcome {
  const errors: BindingError[] = [];
  errors.push(...registryGate(grants.registry, worldIdentity));
  errors.push(...planGate(compiledPlan, worldIdentity));
  for (const body of commissionedBodies) {
    errors.push(...commissionedGate(body));
    errors.push(...endowmentGate(body, grants.registry));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Seat coherence: one commissioned body per compiled binding (body × substrate).
  const remaining = [...commissionedBodies];
  const usedBodyIds = new Set<string>();
  const seats: OrganizationSeatBinding[] = [];
  const heads: string[] = [];
  for (const binding of compiledPlan.bindings) {
    const match = remaining.find(
      (body) =>
        String(body.body.bodyId) === String(binding.bodyId) &&
        String(body.substrate.substrateId) === String(binding.substrateId),
    );
    if (match === undefined) {
      errors.push(error(
        "uncommissioned-body",
        `compiled position '${String(binding.positionId)}' (body '${String(binding.bodyId)}' × substrate '${String(binding.substrateId)}') has no commissioned body among the input — the runtime binds COMMISSIONED seats only (fail-closed)`,
        { positionId: String(binding.positionId) },
      ));
      continue;
    }
    if (usedBodyIds.has(String(match.body.bodyId))) {
      errors.push(error(
        "duplicate-seat",
        `commissioned body '${String(match.commissionedId)}' fills more than one position — one activation record, one seat`,
        { commissionedId: String(match.commissionedId) },
      ));
      continue;
    }
    usedBodyIds.add(String(match.body.bodyId));
    remaining.splice(remaining.indexOf(match), 1);
    const seat = seatGate(worldIdentity, match, grants.grants);
    if (!seat.ok) {
      errors.push(...seat.errors.map((entry) => ({ ...entry, positionId: String(binding.positionId) })));
      continue;
    }
    if (stableDigest(seat.wiring.record.possession.grant) !== stableDigest(binding.grant)) {
      errors.push(error(
        "uncommissioned-body",
        `the commissioned grant of position '${String(binding.positionId)}' is not the compiled plan's seat grant — the organization's issued grant is the authority the commissioning sealed`,
        { positionId: String(binding.positionId), commissionedId: String(match.commissionedId) },
      ));
      continue;
    }
    seats.push({
      positionId: binding.positionId,
      executionIndex: -1,
      commissionedId: match.commissionedId,
      slot: seat.wiring.slot,
      substrateId: match.substrate.substrateId,
      observation: seat.wiring.observation,
      action: seat.wiring.action,
    });
    heads.push(seat.wiring.commissionedHead);
  }
  for (const body of remaining) {
    errors.push(error(
      "uncommissioned-body",
      `commissioned body '${String(body.commissionedId)}' matches no compiled position — every activation record binds through its seat`,
      { commissionedId: String(body.commissionedId) },
    ));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // The seats, in the compiled plan's canonical execution order.
  const byPosition = new Map(seats.map((seat) => [String(seat.positionId), seat]));
  const orderedSeats = compiledPlan.executionOrder.map((positionId, index) => {
    const seat = byPosition.get(String(positionId))!;
    return { ...seat, executionIndex: index };
  });
  const orderedHeads = compiledPlan.executionOrder.map((positionId) => {
    const index = seats.findIndex((seat) => String(seat.positionId) === String(positionId));
    return heads[index]!;
  });
  const authority = orderedSeats.flatMap((seat) => seat.action.channels.flatMap((channel) => channel.authority));
  const grantDigests = [...new Set(authority.map((entry) => entry.grantDigest))].sort(compareStrings);
  const boundAt = authority.reduce((latest, entry) => Math.max(latest, Number(entry.grant.grantedAt)), Number.NEGATIVE_INFINITY);
  const scope = {
    tenantId: String(worldIdentity.scope.tenantId),
    projectId: String(worldIdentity.scope.projectId),
    worldId: String(worldIdentity.scope.worldId),
  };
  const bindingId = `${AGENT_BINDING_ID_PREFIX}${stableDigest({
    kind: "organization",
    world: {
      ...scope,
      slots: orderedSeats.map((seat) => ({ participantId: seat.slot.participantId, accountId: seat.slot.accountId })),
    },
    compiledOrganizationId: String(compiledPlan.compiledOrganizationId),
    commissionedIds: orderedSeats.map((seat) => String(seat.commissionedId)),
    grantDigests,
  })}` as AgentBindingId;
  const organizationBinding: OrganizationBinding = {
    bindingId,
    kind: "organization",
    world: {
      scope,
      slots: orderedSeats.map((seat) =>
        worldIdentity.participants.find((candidate) => String(candidate.participantId) === seat.slot.participantId)!,
      ),
    },
    compiledOrganizationId: String(compiledPlan.compiledOrganizationId),
    organizationId: String(compiledPlan.organizationId),
    seats: orderedSeats,
    scope,
    lineage: {
      commissionedIds: orderedSeats.map((seat) => seat.commissionedId),
      commissionedHeads: orderedHeads,
      grantDigests,
    },
    provenance: {
      boundAt,
      registryFingerprint: registryFingerprintOf(grants.registry),
      planId: String(compiledPlan.compiledOrganizationId),
    },
  };
  freeze(organizationBinding);
  return { ok: true, binding: organizationBinding };
}
