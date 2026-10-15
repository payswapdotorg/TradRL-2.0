/**
 * The shared binding gate laws (W044) — the per-seat proofs both binding
 * gates compose: the W040 registry gate, the commissioned re-proof
 * (commissioning's own validation, verbatim), the W023 participant-slot
 * lookup, the grants-entry liveness/record laws, the commissioned-grant
 * presence law (R050), the W034 WITH-WORLD re-proof (the attach proof
 * W039/W043 deferred to the runtime), endowment capability liveness
 * (the W040 lifecycle carried), and the observation/action wiring
 * derivation. DATA + pure proofs only — the gates that SEAL live in
 * ./binding.ts.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateCapabilityRegistry } from "capability-registry";
import type { CapabilityRegistry } from "capability-registry";
import { validateCommissionedBody } from "body-forge/commissioning";
import type { CommissionedBody } from "body-forge/commissioning";
import { checkPossessionCompatibility } from "possession";
import type { PossessionCheckKind, PossessionDescriptor } from "possession";
import { stableDigest } from "skills";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type {
  ActionRoutingContract,
  AuthorityChannel,
  BindingError,
  BindingGrantEntry,
  GrantAuthority,
  ObservationRoutingContract,
  ParticipantSlotAttachment,
} from "./contracts.js";

type Extras = Omit<BindingError, "code" | "message">;

export function error(code: BindingError["code"], message: string, extras: Extras = {}): BindingError {
  return { code, message, ...extras };
}

export function sameScope(
  left: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
  right: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
): boolean {
  return (
    String(left.tenantId) === String(right.tenantId) &&
    String(left.projectId) === String(right.projectId) &&
    String(left.worldId) === String(right.worldId)
  );
}

export function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** One grant proven live, compatible-with-world, with its W034 evidence. */
interface ProvenGrant {
  readonly entry: BindingGrantEntry;
  readonly checked: readonly PossessionCheckKind[];
}

/** The commissioned possession descriptor, reconstructed VERBATIM. */
function commissionedDescriptorOf(record: CommissionedBody): PossessionDescriptor {
  return {
    possessionId: record.possession.possessionId,
    body: record.body,
    substrate: record.substrate,
    grant: record.possession.grant,
    scope: record.possession.scope,
  };
}

// --- the shared gate laws -----------------------------------------------------

/** The W040 registry gate + scope agreement with the world. */
export function registryGate(registry: CapabilityRegistry, world: WorldDefinition): BindingError[] {
  const validation = validateCapabilityRegistry(registry);
  if (!validation.ok) {
    return [error(
      "invalid-registry",
      `the W040 gate refused the capability registry (${String(validation.errors.length)} error(s), carried verbatim) — nothing binds`,
      { registryErrors: validation.errors },
    )];
  }
  if (!sameScope(registry.scope, world.scope)) {
    return [error(
      "registry-scope-mismatch",
      `the registry scope (${String(registry.scope.tenantId)}, ${String(registry.scope.projectId)}, ${String(registry.scope.worldId)}) disagrees with the world scope (${String(world.scope.tenantId)}, ${String(world.scope.projectId)}, ${String(world.scope.worldId)}) — the registry is single-scope`,
    )];
  }
  return [];
}

/** The commissioned re-proof (commissioning's own validation, verbatim). */
export function commissionedGate(record: CommissionedBody): BindingError[] {
  const validation = validateCommissionedBody(record);
  if (!validation.ok) {
    return [error(
      "invalid-commissioned-body",
      `the commissioned body '${String(record.commissionedId)}' failed commissioning's own re-validation (${String(validation.errors.length)} error(s), carried verbatim) — nothing binds`,
      { commissionedId: String(record.commissionedId), commissioningErrors: validation.errors },
    )];
  }
  return [];
}

/** The W023 participant-slot lookup (a REAL declared participant, on the declared account). */
function slotOf(
  world: WorldDefinition,
  record: CommissionedBody,
): { readonly ok: true; readonly slot: ParticipantSlotAttachment } | { readonly ok: false; readonly errors: readonly BindingError[] } {
  const participantId = String(record.body.participantId);
  const seat = world.participants.find((candidate) => String(candidate.participantId) === participantId);
  if (seat === undefined) {
    return { ok: false, errors: [error(
      "unknown-participant-slot",
      `participant '${participantId}' is not a declared participant slot of world '${String(world.scope.worldId)}' — the binding attaches to REAL W023 slots only (fail-closed)`,
      { participantId, commissionedId: String(record.commissionedId) },
    )] };
  }
  if (String(seat.accountId) !== String(record.body.accountId)) {
    return { ok: false, errors: [error(
      "unknown-participant-slot",
      `participant slot '${participantId}' trades account '${String(seat.accountId)}' in the world, but the commissioned body declares '${String(record.body.accountId)}'`,
      { participantId, commissionedId: String(record.commissionedId) },
    )] };
  }
  if (String(seat.worldId) !== String(world.scope.worldId)) {
    return { ok: false, errors: [error(
      "unknown-participant-slot",
      `participant slot '${participantId}' belongs to world '${String(seat.worldId)}', not '${String(world.scope.worldId)}'`,
      { participantId, commissionedId: String(record.commissionedId) },
    )] };
  }
  return { ok: true, slot: {
    participantId,
    accountId: String(record.body.accountId),
    kind: seat.kind,
    worldId: String(world.scope.worldId),
  } };
}

/** Every grants entry: record/descriptor coherence + possession LIVENESS. */
function grantEntryGate(entry: BindingGrantEntry, world: WorldDefinition): BindingError[] {
  const errors: BindingError[] = [];
  const id = String(entry.descriptor.possessionId);
  const record = entry.record;
  if (
    String(record.possessionId) !== id ||
    String(record.bodyId) !== String(entry.descriptor.body.bodyId) ||
    String(record.substrateId) !== String(entry.descriptor.substrate.substrateId)
  ) {
    errors.push(error(
      "grant-record-mismatch",
      `the grant entry's lifecycle record does not match its descriptor (possession '${id}') — the record must describe the very possession it vouches for`,
      { possessionId: id },
    ));
  }
  if (String(record.worldId) !== String(world.scope.worldId)) {
    errors.push(error(
      "grant-record-mismatch",
      `the grant entry's record names world '${String(record.worldId)}' but the binding targets world '${String(world.scope.worldId)}'`,
      { possessionId: id },
    ));
  }
  if (record.state !== "possessed") {
    errors.push(error(
      "revoked-possession",
      `possession '${id}' is '${String(record.state)}' (not live) — a released/revoked possession never authorizes an authority channel (A13, fail-closed)`,
      { possessionId: id, possessionState: String(record.state), ...(record.releaseReason === undefined ? {} : { releaseReason: String(record.releaseReason) }) },
    ));
  }
  return errors;
}

/** The commissioned possession must be among the grants (R050). */
function commissionedGrantOf(
  descriptor: PossessionDescriptor,
  grants: readonly BindingGrantEntry[],
): BindingGrantEntry | undefined {
  const wanted = stableDigest(descriptor);
  return grants.find((entry) => stableDigest(entry.descriptor) === wanted);
}

/** Endowment capability liveness at binding time (the W040 lifecycle carried). */
export function endowmentGate(record: CommissionedBody, registry: CapabilityRegistry): BindingError[] {
  const errors: BindingError[] = [];
  for (const entry of record.endowment.entries) {
    const capabilityId = String(entry.capabilityId);
    const registered = registry.entries.find(
      (candidate) => String(candidate.descriptor.capabilityId) === capabilityId,
    );
    if (registered === undefined) {
      errors.push(error(
        "unregistered-capability",
        `endowment capability '${capabilityId}' of commissioned body '${String(record.commissionedId)}' is not registered — the binding proves the endowment against the registry it commits to`,
        { capabilityId, commissionedId: String(record.commissionedId) },
      ));
      continue;
    }
    if (registered.state === "deprecated" || registered.state === "revoked") {
      errors.push(error(
        registered.state === "deprecated" ? "deprecated-capability" : "revoked-capability",
        `endowment capability '${capabilityId}' of commissioned body '${String(record.commissionedId)}' is ${registered.state} at binding time — the W040 lifecycle is carried loudly, the binding refuses`,
        {
          capabilityId,
          commissionedId: String(record.commissionedId),
          lifecycle: registered.transitions.map((transition) => ({ to: String(transition.to), reason: String(transition.reason) })),
        },
      ));
    }
  }
  return errors;
}

/** The observation routing contract (the W035 vocabulary) + world instruments. */
function observationContractOf(
  record: CommissionedBody,
  world: WorldDefinition,
): { readonly ok: true; readonly contract: ObservationRoutingContract } | { readonly ok: false; readonly errors: readonly BindingError[] } {
  const scope = record.possession.scope;
  const worldInstruments = new Set(world.instruments.map((instrument) => String(instrument.instrumentId)));
  const errors: BindingError[] = [];
  for (const instrumentId of scope.instruments) {
    if (!worldInstruments.has(String(instrumentId))) {
      errors.push(error(
        "instrument-not-in-world",
        `instrument '${String(instrumentId)}' of the commissioned possession scope is not declared by world '${String(world.scope.worldId)}' — the observation routing addresses REAL instruments only`,
        { commissionedId: String(record.commissionedId) },
      ));
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const instruments = [...scope.instruments];
  return { ok: true, contract: {
    config: { kinds: [...scope.observations], instruments },
    routes: [...scope.observations].map((kind) => ({
      kind,
      instruments,
      substrateId: record.substrate.substrateId,
    })),
  } };
}

/** The action routing contract: channels opened strictly from covering grants (A13). */
function actionContractOf(
  record: CommissionedBody,
  proven: readonly ProvenGrant[],
): ActionRoutingContract {
  const scope = record.possession.scope;
  const instruments = [...scope.instruments].sort(compareStrings);
  const channels: AuthorityChannel[] = [...scope.commandKinds]
    .sort(compareStrings)
    .map((commandKind) => {
      const authority: GrantAuthority[] = proven
        .filter((candidate) =>
          candidate.entry.descriptor.scope.commandKinds.includes(commandKind) &&
          instruments.every((instrumentId) => candidate.entry.descriptor.scope.instruments.includes(instrumentId)))
        .map((candidate) => ({
          possessionId: candidate.entry.descriptor.possessionId,
          grant: candidate.entry.descriptor.grant,
          grantDigest: stableDigest(candidate.entry.descriptor.grant),
          checked: [...candidate.checked],
        }));
      return { commandKind, instruments, possessionId: record.possession.possessionId, authority };
    });
  return { channels };
}

/** Deep-freeze the sealed record (the W043 precedent). */
export function freeze(value: unknown): void {
  if (value !== null && (typeof value === "object" || Array.isArray(value))) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freeze(child);
    }
  }
}

/** One commissioned agent's full gate + wiring (shared by both bindings). */
interface SeatWiring {
  readonly record: CommissionedBody;
  readonly slot: ParticipantSlotAttachment;
  readonly observation: ObservationRoutingContract;
  readonly action: ActionRoutingContract;
  readonly commissionedHead: string;
}

export function seatGate(
  world: WorldDefinition,
  record: CommissionedBody,
  grants: readonly BindingGrantEntry[],
): { readonly ok: true; readonly wiring: SeatWiring } | { readonly ok: false; readonly errors: readonly BindingError[] } {
  const errors: BindingError[] = [];
  errors.push(...commissionedGate(record));
  if (!sameScope(record.scope, world.scope)) {
    errors.push(error(
      "scope-mismatch",
      `the commissioned body '${String(record.commissionedId)}' belongs to scope (${record.scope.tenantId}, ${record.scope.projectId}, ${record.scope.worldId}) but the binding targets (${String(world.scope.tenantId)}, ${String(world.scope.projectId)}, ${String(world.scope.worldId)})`,
      { commissionedId: String(record.commissionedId) },
    ));
  }
  const slot = slotOf(world, record);
  if (!slot.ok) {
    errors.push(...slot.errors);
  }
  const descriptor = commissionedDescriptorOf(record);
  if (commissionedGrantOf(descriptor, grants) === undefined) {
    errors.push(error(
      "commissioned-grant-missing",
      `the grants input does not carry the commissioned possession '${String(record.possession.possessionId)}' of body '${String(record.commissionedId)}' — the binding references the commissioned substrate possession, never an implicit model (R050; A13: authority is granted)`,
      { commissionedId: String(record.commissionedId), possessionId: String(record.possession.possessionId) },
    ));
  }
  const proven: ProvenGrant[] = [];
  for (const entry of grants) {
    errors.push(...grantEntryGate(entry, world));
    const compatibility = checkPossessionCompatibility(entry.descriptor, world);
    if (compatibility.ok) {
      proven.push({ entry, checked: compatibility.checked });
    } else {
      errors.push(error(
        "possession-incompatible",
        `the possession '${String(entry.descriptor.possessionId)}' is incompatible with world '${String(world.scope.worldId)}' (${String(compatibility.incompatibilities.length)} W034 incompatibilit(ies), carried verbatim) — the runtime attach proof fails, nothing binds`,
        { possessionId: String(entry.descriptor.possessionId), incompatibilities: compatibility.incompatibilities },
      ));
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const observation = observationContractOf(record, world);
  if (!observation.ok) {
    return { ok: false, errors: observation.errors };
  }
  return {
    ok: true,
    wiring: {
      record,
      slot: slot.ok ? slot.slot : { participantId: "", accountId: "", kind: "human", worldId: "" },
      observation: observation.contract,
      action: actionContractOf(record, proven),
      commissionedHead: String(record.possession.commissionedHead),
    },
  };
}

