/**
 * The pure routing wiring (W044) — the CONTRACTS a runtime drives a
 * binding through, never the execution:
 * - `routeObservationEvent(binding, event)`: given a binding and an
 *   inbound observation event (typed), derive the ADDRESSED SUBSTRATE
 *   SURFACE(S) — which substrate mind the observation reaches, on which
 *   instruments, for which participant. Fail-closed on unknown
 *   observation kinds, instruments the wiring does not route, and (for
 *   organization bindings) unknown participants.
 * - `routeActionIntent(binding, intent)`: given a binding and an
 *   outbound action intent (typed), derive the AUTHORITY-PROOF CHAIN —
 *   which possession grants authorize exactly this command on exactly
 *   this instrument (A13: execution authority is ALWAYS outside model
 *   outputs; an intent with no covering grant is refused LOUDLY, never
 *   silently clipped).
 *
 * A14: these functions route and REFUSE — they never execute a trade,
 * never step the world, never train. Pure, deterministic (A9), typed
 * end to end over the sealed binding record's own data.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  AuthorityChannel,
  GrantAuthority,
  WorldAgentBinding,
} from "./contracts.js";
import type { InstrumentId, ParticipantId } from "tradrl-world-contracts";
import type { BodyCommandKind, BodyObservationKind } from "tradrl-world-contracts/agentBody";
import type { SubstrateId } from "tradrl-world-contracts/cognitiveSubstrate";

// ---------------------------------------------------------------------------
// The inbound observation event (typed)
// ---------------------------------------------------------------------------

/** One inbound observation event: a kind, optionally narrowed to one instrument. */
export interface InboundObservationEvent {
  readonly kind: BodyObservationKind;
  /** When present, the event is narrowed to this instrument (fail-closed if unrouted). */
  readonly instrumentId?: InstrumentId;
  /** Organization bindings: which participant's seat the event addresses. */
  readonly participantId?: ParticipantId;
}

/** The substrate surface one observation event is addressed to. */
export interface AddressedSubstrateSurface {
  readonly participantId: string;
  readonly substrateId: SubstrateId;
  readonly kind: BodyObservationKind;
  readonly instruments: readonly InstrumentId[];
}

export type ObservationRoutingOutcome =
  | { readonly ok: true; readonly surfaces: readonly AddressedSubstrateSurface[] }
  | { readonly ok: false; readonly code: "unknown-observation-kind" | "instrument-not-routed" | "unknown-participant"; readonly message: string };

// ---------------------------------------------------------------------------
// The outbound action intent (typed)
// ---------------------------------------------------------------------------

/** One outbound action intent: WHAT command, on WHICH instrument, for WHOM. */
export interface OutboundActionIntent {
  readonly commandKind: BodyCommandKind;
  readonly instrumentId: InstrumentId;
  /** Organization bindings: which participant's seat issues the intent. */
  readonly participantId?: ParticipantId;
}

/**
 * The authority-proof chain of one routed intent (A13 structural): the
 * channel the intent flowed through and the grants that authorize it.
 */
export interface AuthorityProofChain {
  readonly commandKind: BodyCommandKind;
  readonly instrumentId: InstrumentId;
  readonly participantId: string;
  readonly possessionId: string;
  readonly grants: readonly GrantAuthority[];
}

export type ActionRoutingOutcome =
  | { readonly ok: true; readonly proofChain: AuthorityProofChain }
  | {
      readonly ok: false;
      readonly code: "unknown-channel" | "instrument-beyond-channel" | "unknown-participant";
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// The routing functions (pure, fail-closed)
// ---------------------------------------------------------------------------

type SeatLike = {
  readonly slot: { readonly participantId: string };
  readonly observation: { readonly routes: readonly { readonly kind: BodyObservationKind; readonly instruments: readonly InstrumentId[]; readonly substrateId: SubstrateId }[] };
  readonly action: { readonly channels: readonly AuthorityChannel[] };
};

/** The per-seat views of a binding (agent: one seat; organization: many). */
function seatsOf(binding: WorldAgentBinding): readonly (SeatLike & { readonly action: { readonly channels: readonly AuthorityChannel[] } })[] {
  if (binding.kind === "agent") {
    return [binding];
  }
  return binding.seats;
}

/** Resolve the seat(s) an event/intent addresses by participant (fail-closed). */
function seatFor(
  binding: WorldAgentBinding,
  participantId: string | undefined,
  what: "observation" | "action",
): { readonly ok: true; readonly seats: readonly (SeatLike & { readonly action: { readonly channels: readonly AuthorityChannel[] } })[] } | { readonly ok: false; readonly message: string } {
  const seats = seatsOf(binding);
  if (participantId === undefined) {
    if (binding.kind === "organization") {
      return { ok: false, message: `the ${what} names no participant — an organization binding routes per seat, and an unnamed seat is an unknown seat (fail-closed)` };
    }
    return { ok: true, seats };
  }
  const addressed = seats.filter((seat) => seat.slot.participantId === participantId);
  if (addressed.length === 0) {
    return { ok: false, message: `participant '${participantId}' is not a seat of this ${binding.kind} binding — fail-closed on unknown participants` };
  }
  return { ok: true, seats: addressed };
}

/**
 * Route one inbound observation event to the addressed substrate
 * surface(s). Pure; fail-closed on unknown kinds, unrouted instruments
 * and unknown participants; never observes anything itself.
 */
export function routeObservationEvent(
  binding: WorldAgentBinding,
  event: InboundObservationEvent,
): ObservationRoutingOutcome {
  const seat = seatFor(binding, event.participantId === undefined ? undefined : String(event.participantId), "observation");
  if (!seat.ok) {
    return { ok: false, code: "unknown-participant", message: seat.message };
  }
  const surfaces: AddressedSubstrateSurface[] = [];
  for (const candidate of seat.seats) {
    const route = candidate.observation.routes.find((entry) => entry.kind === event.kind);
    if (route === undefined) {
      return {
        ok: false,
        code: "unknown-observation-kind",
        message: `observation kind '${String(event.kind)}' is not routed to any substrate surface of participant '${candidate.slot.participantId}' — the wiring routes only the commissioned possession's declared kinds (fail-closed, never silently observed)`,
      };
    }
    if (event.instrumentId !== undefined && !route.instruments.includes(event.instrumentId)) {
      return {
        ok: false,
        code: "instrument-not-routed",
        message: `instrument '${String(event.instrumentId)}' is not routed for observation kind '${String(event.kind)}' of participant '${candidate.slot.participantId}' (routed: ${route.instruments.map(String).join(", ")}) — fail-closed`,
      };
    }
    surfaces.push({
      participantId: candidate.slot.participantId,
      substrateId: route.substrateId,
      kind: event.kind,
      instruments: event.instrumentId === undefined ? [...route.instruments] : [event.instrumentId],
    });
  }
  return { ok: true, surfaces };
}

/**
 * Route one outbound action intent to its authority-proof chain (A13
 * made structural): the channel it must flow through and the possession
 * grants that authorize exactly it. Pure; an intent with NO covering
 * grant is refused LOUDLY; never issues anything itself.
 */
export function routeActionIntent(
  binding: WorldAgentBinding,
  intent: OutboundActionIntent,
): ActionRoutingOutcome {
  const seat = seatFor(binding, intent.participantId === undefined ? undefined : String(intent.participantId), "action");
  if (!seat.ok) {
    return { ok: false, code: "unknown-participant", message: seat.message };
  }
  for (const candidate of seat.seats) {
    const channel = candidate.action.channels.find((entry) => entry.commandKind === intent.commandKind);
    if (channel === undefined) {
      continue;
    }
    if (!channel.instruments.includes(intent.instrumentId)) {
      return {
        ok: false,
        code: "instrument-beyond-channel",
        message: `instrument '${String(intent.instrumentId)}' is beyond the '${String(intent.commandKind)}' channel of participant '${candidate.slot.participantId}' (channeled: ${channel.instruments.map(String).join(", ")}) — fail-closed`,
      };
    }
    return {
      ok: true,
      proofChain: {
        commandKind: intent.commandKind,
        instrumentId: intent.instrumentId,
        participantId: candidate.slot.participantId,
        possessionId: String(channel.possessionId),
        grants: [...channel.authority],
      },
    };
  }
  return {
    ok: false,
    code: "unknown-channel",
    message: `action intent '${String(intent.commandKind)}' on '${String(intent.instrumentId)}' has NO covering grant in this ${binding.kind} binding — execution authority routes ONLY through possession grants (A13); a model output is never authority (refused loudly, never silently clipped)`,
  };
}
