/**
 * Venue policy resolution + the deterministic latency policy (W014
 * `matching` module).
 *
 * Spec: spec/ARCHITECTURE.md §5 "State" — Venue owns matching rules, order
 * types, fee schedule, latency and halt/auction policy; spec/REQUIREMENTS.md
 * R022 (explicit latency policy). The world definition (W013) may declare
 * venues; instruments resolve their policy through their `venueId`.
 *
 * DEFAULT POLICY (documented): a world that declares no venue for an
 * instrument runs on the synthetic default venue — price-time priority, all
 * four order kinds, zero fees, zero latency. Every default is a declaration,
 * not a hidden market assumption; worlds that want fees/latency/kind
 * restrictions declare a `Venue` (W003 contract) in the definition.
 *
 * LATENCY POLICY (how SIMULATION.md's venue latency is placed): execution
 * itself is atomic at the command's simulation time T (the deterministic
 * core — matching never reorders), and the venue delays are expressed as
 * EVENT OBSERVABILITY (the envelope's `availableAt`, ARCHITECTURE-LOCK.md
 * A7), never as reordered execution:
 * - order-lifecycle events (accepted/triggered/canceled/replaced/rejected)
 *   become observable at T + acknowledgementMs;
 * - market facts (trade prints, fills, book deltas) become observable at
 *   T + acknowledgementMs + fillPropagationMs.
 * Zero-latency venues omit `availableAt` (observable immediately).
 */

import type { FeeSchedule, Instrument, OrderKind, Venue, VenueLatency } from "tradrl-world-contracts";
import type { TimestampMs } from "tradrl-world-contracts";
import type { WorldDefinition } from "../world/definition.js";

/** The matching-relevant venue policy for one instrument. */
export interface VenuePolicy {
  readonly venueId: Venue["venueId"];
  readonly allowedOrderKinds: readonly OrderKind[];
  readonly feeSchedule: FeeSchedule;
  readonly latency: VenueLatency;
}

const ALL_ORDER_KINDS: readonly OrderKind[] = ["market", "limit", "stop", "stop-limit"];

/** The documented synthetic default (zero fees, zero latency, all kinds). */
export const DEFAULT_VENUE_POLICY: VenuePolicy = {
  venueId: "venue-sim-default" as Venue["venueId"],
  allowedOrderKinds: ALL_ORDER_KINDS,
  feeSchedule: { makerRateBps: 0, takerRateBps: 0 },
  latency: { acknowledgementMs: 0, fillPropagationMs: 0 },
};

/**
 * Resolve the venue policy for an instrument: the declared venue whose id
 * matches the instrument's, or the documented default when the definition
 * declares none for it.
 */
export function resolveVenuePolicy(definition: WorldDefinition, instrument: Instrument): VenuePolicy {
  const venue = (definition.venues ?? []).find((candidate) => candidate.venueId === instrument.venueId);
  if (venue === undefined) {
    return DEFAULT_VENUE_POLICY;
  }
  return {
    venueId: venue.venueId,
    allowedOrderKinds: venue.allowedOrderKinds.length === 0 ? ALL_ORDER_KINDS : venue.allowedOrderKinds,
    feeSchedule: venue.feeSchedule,
    latency: venue.latency,
  };
}

/** The observability time for an order-lifecycle event (acknowledgement delay). */
export function acknowledgementAvailableAt(policy: VenuePolicy, at: TimestampMs): TimestampMs | undefined {
  const delay = Math.max(0, Math.trunc(policy.latency.acknowledgementMs));
  return delay === 0 ? undefined : (at + delay) as TimestampMs;
}

/** The observability time for a market fact (trade/fill/delta propagation). */
export function fillAvailableAt(policy: VenuePolicy, at: TimestampMs): TimestampMs | undefined {
  const delay =
    Math.max(0, Math.trunc(policy.latency.acknowledgementMs)) +
    Math.max(0, Math.trunc(policy.latency.fillPropagationMs));
  return delay === 0 ? undefined : (at + delay) as TimestampMs;
}
