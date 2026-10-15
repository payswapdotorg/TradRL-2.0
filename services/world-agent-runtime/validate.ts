/**
 * Whole-binding re-validation (W044) — re-proving a sealed binding from
 * its own recorded data alone (the W043 `validateCommissionedBody`
 * precedent): the content-addressed identity re-derivation, the slot
 * laws, the observation/action routing-contract laws (every authority
 * citation's digest re-derived; every channel carries authority), the
 * immutable lineage laws, the deterministic provenance laws, and (for
 * organizations) the canonical execution-order seat laws. Pure,
 * deterministic, fail-closed — every violation collected, never dropped.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { stableDigest } from "skills";
import type { ParticipantKind } from "tradrl-world-contracts";
import { AGENT_BINDING_ID_PREFIX } from "./contracts.js";
import type { AgentBinding, OrganizationBinding } from "./contracts.js";
import type { AuthorityChannel, ObservationRoutingContract } from "./contracts.js";

export interface WorldAgentBindingValidationError {
  readonly code: WorldAgentBindingValidationErrorCode;
  readonly message: string;
}

export type WorldAgentBindingValidationErrorCode =
  | "identity-mismatch" // the binding id is not the content address of the recorded data
  | "invalid-slot" // the participant-slot attachment's own laws
  | "invalid-observation-contract" // the observation wiring's own laws
  | "invalid-action-contract" // the action wiring's own laws (A13)
  | "lineage-mismatch" // the lineage disagrees with the wiring it cites
  | "invalid-provenance" // the provenance's declared-time/fingerprint laws
  | "invalid-seats" // the organization seat laws (order, uniqueness)
  | "kind-mismatch"; // the record's shape disagrees with its kind

export type WorldAgentBindingValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly WorldAgentBindingValidationError[] };

function violation(
  code: WorldAgentBindingValidationErrorCode,
  message: string,
): WorldAgentBindingValidationError {
  return { code, message };
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const PARTICIPANT_KINDS: readonly ParticipantKind[] = [
  "human",
  "noise-trader",
  "liquidity-taker",
  "passive-market-maker",
  "momentum",
];

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The observation routing contract's own laws. */
function observationViolations(contract: ObservationRoutingContract): WorldAgentBindingValidationError[] {
  const violations: WorldAgentBindingValidationError[] = [];
  if (contract.routes.length === 0 || contract.config.kinds.length === 0) {
    violations.push(violation("invalid-observation-contract", "the observation routing contract routes nothing — a bound agent observes the commissioned possession's declared kinds"));
    return violations;
  }
  if (contract.routes.map((route) => String(route.kind)).join(",") !== contract.config.kinds.map(String).join(",")) {
    violations.push(violation("invalid-observation-contract", "the observation routes do not mirror the declared config kinds — the config IS the routed surface (W035 vocabulary)"));
  }
  for (const route of contract.routes) {
    if (!nonBlank(String(route.kind)) || !nonBlank(String(route.substrateId))) {
      violations.push(violation("invalid-observation-contract", "an observation route carries a blank kind or substrate surface — wiring is explicit, never blank"));
    }
    if (route.instruments.length === 0) {
      violations.push(violation("invalid-observation-contract", `observation kind '${String(route.kind)}' routes no instruments — a route addresses at least one real instrument`));
    }
    if ([...route.instruments].map(String).some((id, index, all) => all.indexOf(id) !== index)) {
      violations.push(violation("invalid-observation-contract", `observation kind '${String(route.kind)}' routes a duplicate instrument — canonical wiring never repeats`));
    }
  }
  return violations;
}

/** The action routing contract's own laws (A13: authority is the grants). */
function actionViolations(channels: readonly AuthorityChannel[]): WorldAgentBindingValidationError[] {
  const violations: WorldAgentBindingValidationError[] = [];
  if (channels.length === 0) {
    violations.push(violation("invalid-action-contract", "the action routing contract opens no authority channels — a bound agent acts through its commissioned possession's granted command kinds"));
    return violations;
  }
  const kinds = channels.map((channel) => String(channel.commandKind));
  if ([...kinds].sort(compareStrings).join(",") !== kinds.join(",")) {
    violations.push(violation("invalid-action-contract", "the authority channels are not in canonical command-kind order (A9)"));
  }
  if (new Set(kinds).size !== kinds.length) {
    violations.push(violation("invalid-action-contract", "the same command kind is channeled twice — one kind, one channel"));
  }
  for (const channel of channels) {
    if (!nonBlank(String(channel.commandKind)) || !nonBlank(String(channel.possessionId))) {
      violations.push(violation("invalid-action-contract", "an authority channel carries a blank command kind or possession id — wiring is explicit, never blank"));
    }
    if (channel.instruments.length === 0) {
      violations.push(violation("invalid-action-contract", `the '${String(channel.commandKind)}' channel covers no instruments — a channel addresses at least one real instrument`));
    }
    if (channel.authority.length === 0) {
      violations.push(violation("invalid-action-contract", `the '${String(channel.commandKind)}' channel cites NO authorizing grant — A13: execution authority routes ONLY through possession grants (never a bare model output)`));
    }
    const digests = channel.authority.map((authority) => authority.grantDigest);
    if ([...digests].sort(compareStrings).join(",") !== digests.join(",")) {
      violations.push(violation("invalid-action-contract", `the '${String(channel.commandKind)}' channel's authority citations are not in canonical grant-digest order (A9)`));
    }
    for (const authority of channel.authority) {
      if (stableDigest(authority.grant) !== authority.grantDigest) {
        violations.push(violation("invalid-action-contract", `the authority citation for possession '${String(authority.possessionId)}' does not match its grant's content digest — authority is content-addressed, never paraphrased`));
      }
      if (authority.checked.length === 0 || !nonBlank(String(authority.possessionId))) {
        violations.push(violation("invalid-action-contract", "an authority citation carries no W034 evidence or a blank possession id — R051: every channel is proven"));
      }
    }
  }
  return violations;
}

/** The shared record laws (both binding shapes). */
function commonViolations(binding: AgentBinding | OrganizationBinding): WorldAgentBindingValidationError[] {
  const violations: WorldAgentBindingValidationError[] = [];
  const scope = binding.scope;
  if (!nonBlank(scope.tenantId) || !nonBlank(scope.projectId) || !nonBlank(scope.worldId)) {
    violations.push(violation("invalid-slot", "the binding's scope carries a blank member — the explicit tenant/project/world identity law"));
  }
  for (const slot of binding.world.slots) {
    if (!nonBlank(String(slot.participantId)) || !nonBlank(String(slot.accountId)) || !nonBlank(String(slot.worldId))) {
      violations.push(violation("invalid-slot", "a recorded world slot carries a blank member — the W023 slot attachment is explicit"));
    }
    if (String(slot.worldId) !== scope.worldId) {
      violations.push(violation("invalid-slot", `a recorded world slot belongs to world '${String(slot.worldId)}' but the binding's scope names '${scope.worldId}'`));
    }
    if (!PARTICIPANT_KINDS.includes(slot.kind)) {
      violations.push(violation("invalid-slot", `a recorded world slot carries the unknown participant kind '${String(slot.kind)}' — the W023 closed vocabulary`));
    }
  }
  if (binding.world.slots.length === 0) {
    violations.push(violation("invalid-slot", "the binding records no world slot — a binding attaches to at least one W023 participant slot"));
  }
  violations.push(...observationViolations(binding.kind === "agent" ? binding.observation : binding.seats[0]!.observation));
  const channels = binding.kind === "agent" ? binding.action.channels : binding.seats[0]!.action.channels;
  violations.push(...actionViolations(channels));
  const grantDigests = binding.lineage.grantDigests;
  const authority = (binding.kind === "agent" ? binding.action.channels : binding.seats.flatMap((seat) => seat.action.channels))
    .flatMap((channel) => channel.authority);
  const union = [...new Set(authority.map((entry) => entry.grantDigest))].sort(compareStrings);
  if (union.join(",") !== [...grantDigests].join(",")) {
    violations.push(violation("lineage-mismatch", "the lineage's grant digests are not the canonical union of the wiring's authority citations — the lineage IS the authority history"));
  }
  if (binding.lineage.commissionedIds.length !== binding.lineage.commissionedHeads.length) {
    violations.push(violation("lineage-mismatch", "the lineage's commissioned ids and possession heads disagree in length — one head per activation record"));
  }
  for (const head of binding.lineage.commissionedHeads) {
    if (!nonBlank(head)) {
      violations.push(violation("lineage-mismatch", "a lineage possession head is blank — the commissioned chain is content-addressed, never blank"));
    }
  }
  if (!nonBlank(binding.provenance.registryFingerprint) || !nonBlank(binding.provenance.planId)) {
    violations.push(violation("invalid-provenance", "the provenance carries a blank registry fingerprint or plan id — deterministic DATA, never blank"));
  }
  const boundAt = authority.reduce((latest, entry) => Math.max(latest, Number(entry.grant.grantedAt)), Number.NEGATIVE_INFINITY);
  if (binding.provenance.boundAt !== boundAt) {
    violations.push(violation("invalid-provenance", `the declared binding time ${String(binding.provenance.boundAt)} is not the latest declared grantedAt ${String(boundAt)} among the backing grants — declared DATA, never a clock read (A9)`));
  }
  return violations;
}

/** Re-prove a sealed agent binding from its own recorded data. */
export function validateAgentBinding(binding: AgentBinding): WorldAgentBindingValidationOutcome {
  const errors: WorldAgentBindingValidationError[] = [];
  if (binding.kind !== "agent") {
    return { ok: false, errors: [violation("kind-mismatch", "the record's shape is not an agent binding")] };
  }
  if (!nonBlank(String(binding.commissionedId)) || !nonBlank(String(binding.substrateId))) {
    errors.push(violation("invalid-slot", "the binding carries a blank commissioned id or substrate surface — identity is explicit"));
  }
  const expected = `${AGENT_BINDING_ID_PREFIX}${stableDigest({
    kind: "agent",
    world: { ...binding.scope, participantId: binding.slot.participantId, accountId: binding.slot.accountId },
    commissionedId: String(binding.commissionedId),
    planId: binding.provenance.planId,
    grantDigests: binding.lineage.grantDigests,
  })}`;
  if (expected !== binding.bindingId) {
    errors.push(violation("identity-mismatch", `the binding id is not the content address of the recorded provenance (expected ${expected.slice(0, 24)}…, recorded ${String(binding.bindingId).slice(0, 24)}…)`));
  }
  if (binding.lineage.commissionedIds.length !== 1 || String(binding.lineage.commissionedIds[0]) !== String(binding.commissionedId)) {
    errors.push(violation("lineage-mismatch", "the agent binding's lineage does not cite exactly its own commissioned record"));
  }
  errors.push(...commonViolations(binding));
  return errors.length === 0 ? { ok: true, checked: ["identity", "slot", "observation-contract", "action-contract", "lineage", "provenance"] } : { ok: false, errors };
}

/** Re-prove a sealed organization binding from its own recorded data. */
export function validateOrganizationBinding(binding: OrganizationBinding): WorldAgentBindingValidationOutcome {
  const errors: WorldAgentBindingValidationError[] = [];
  if (binding.kind !== "organization") {
    return { ok: false, errors: [violation("kind-mismatch", "the record's shape is not an organization binding")] };
  }
  if (binding.seats.length === 0) {
    return { ok: false, errors: [violation("invalid-seats", "the organization binding seats nobody — a compiled plan binds at least one position")] };
  }
  const positionIds = binding.seats.map((seat) => String(seat.positionId));
  if (new Set(positionIds).size !== positionIds.length) {
    errors.push(violation("invalid-seats", "the same position is seated twice — one position, one seat"));
  }
  const commissionedIds = binding.seats.map((seat) => String(seat.commissionedId));
  if (new Set(commissionedIds).size !== commissionedIds.length) {
    errors.push(violation("invalid-seats", "the same commissioned body seats twice — one activation record, one seat"));
  }
  for (const [index, seat] of binding.seats.entries()) {
    if (seat.executionIndex !== index) {
      errors.push(violation("invalid-seats", `seat '${positionIds[index]}' carries execution index ${String(seat.executionIndex)} but sits at ${String(index)} — the seats ARE the canonical execution order`));
    }
    if (!nonBlank(String(seat.substrateId))) {
      errors.push(violation("invalid-slot", `the seat for position '${positionIds[index]}' carries a blank substrate surface`));
    }
    errors.push(...observationViolations(seat.observation).map((entry) => ({ ...entry, message: `[seat ${positionIds[index]}] ${entry.message}` })));
    errors.push(...actionViolations(seat.action.channels).map((entry) => ({ ...entry, message: `[seat ${positionIds[index]}] ${entry.message}` })));
  }
  if (binding.seats.length !== binding.lineage.commissionedIds.length) {
    errors.push(violation("lineage-mismatch", "the lineage does not cite exactly one commissioned record per seat"));
  }
  if (binding.provenance.planId !== binding.compiledOrganizationId) {
    errors.push(violation("invalid-provenance", "the provenance's plan id is not the compiled organization id it bound through"));
  }
  const expected = `${AGENT_BINDING_ID_PREFIX}${stableDigest({
    kind: "organization",
    world: {
      ...binding.scope,
      slots: binding.seats.map((seat) => ({ participantId: seat.slot.participantId, accountId: seat.slot.accountId })),
    },
    compiledOrganizationId: binding.compiledOrganizationId,
    commissionedIds: binding.seats.map((seat) => String(seat.commissionedId)),
    grantDigests: binding.lineage.grantDigests,
  })}`;
  if (expected !== binding.bindingId) {
    errors.push(violation("identity-mismatch", `the binding id is not the content address of the recorded provenance (expected ${expected.slice(0, 24)}…, recorded ${String(binding.bindingId).slice(0, 24)}…)`));
  }
  errors.push(...commonViolations(binding));
  return errors.length === 0 ? { ok: true, checked: ["identity", "seats", "slot", "observation-contract", "action-contract", "lineage", "provenance"] } : { ok: false, errors };
}
