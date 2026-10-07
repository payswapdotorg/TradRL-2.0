/**
 * Distinct time-semantics contracts — the four time concepts of
 * spec/WORLD-PROTOCOL.md "Time":
 *
 * ```
 * wallTime       host time
 * simulationTime world time
 * eventTime      domain timestamp
 * availableAt    earliest legal observation time
 * ```
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — these are different concepts, and
 * "historical information must not be observable before `availableAt`".
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md H — an artifact whose `availableAt`
 * is after current simulation time must not be observable.
 *
 * Two axes exist:
 * - the WALL axis (host time) — only bridgeable to the simulation axis via
 *   the clock's realtime-follow/speed controls (see ./clock.ts);
 * - the SIMULATION axis (world time) — `SimulationTimeMs` is the clock's
 *   position on it; `EventTimeMs` (a domain timestamp stamped on an event)
 *   and `AvailableAtMs` (an observation threshold) are role-narrowed
 *   sub-types of the same axis, so they compare and compose, while wall
 *   time never does.
 *
 * The axis/role brands make cross-axis mistakes (comparing wall time to
 * simulation time, feeding wall time into the information firewall) a
 * compile-time error. The runtime point-in-time LAWS are the pure
 * predicates below; they compose with W003's types exactly
 * (`InformationArtifact`, `WorldEventEnvelope`, `TimestampMs`).
 */

import type { WorldId } from "../../src/ids.js";
import type { TimestampMs } from "../../src/primitives.js";
import type { InformationArtifact } from "../../src/information.js";
import { isInformationAvailable } from "../../src/information.js";
import type { WorldEventEnvelope } from "../../src/events.js";

// --- time axes and roles (A7) --------------------------------------------------

/** Host time (milliseconds since Unix epoch). A different axis from world time. */
export type WallTimeMs = TimestampMs & { readonly __timeAxis: "wall" };

/** World time — the simulation clock's position (milliseconds since Unix epoch). */
export type SimulationTimeMs = TimestampMs & { readonly __timeAxis: "simulation" };

/**
 * Domain timestamp of an event (when it happened in the world). Same axis as
 * the simulation clock, but a role stamped on events — assignable TO
 * `SimulationTimeMs` (events can be compared/jumped to), never the reverse.
 */
export type EventTimeMs = SimulationTimeMs & { readonly __timeRole: "event" };

/**
 * Earliest legal observation time. Same axis as the simulation clock; a role
 * stamped on artifacts/events with delayed availability.
 */
export type AvailableAtMs = SimulationTimeMs & { readonly __timeRole: "availableAt" };

// --- canonical constructors ----------------------------------------------------
// The single explicit choke point for stamping axis/roles onto a number
// (mirrors DOMAIN-MODEL.md "identity laws": canonical encoders only).

/** Stamp a number as host time. */
export const asWallTime = (ms: number): WallTimeMs => ms as WallTimeMs;
/** Stamp a number as simulation (world) time. */
export const asSimulationTime = (ms: number): SimulationTimeMs => ms as SimulationTimeMs;
/** Stamp a number as an event's domain timestamp. */
export const asEventTime = (ms: number): EventTimeMs => ms as EventTimeMs;
/** Stamp a number as an observation-availability threshold. */
export const asAvailableAt = (ms: number): AvailableAtMs => ms as AvailableAtMs;

// --- one instant, both axes -----------------------------------------------------

/**
 * A point in time for one world: where the simulation clock is, and what the
 * host clock read when it was there. The engine stamps every authoritative
 * read/projection with one of these; the firewall uses `simulationTime`.
 */
export interface WorldTimePoint {
  readonly worldId: WorldId;
  readonly simulationTime: SimulationTimeMs;
  readonly wallTime: WallTimeMs;
}

// --- point-in-time laws (A7 / R016 / acceptance H) --------------------------------

/**
 * The information firewall at a point in simulation time: an artifact is
 * observable exactly from its `availableAt` onward, so if
 * `availableAt > simulationTime` the trader cannot observe it. Delegates to
 * W003's `isInformationAvailable` — one canonical rule, no second firewall.
 */
export function isArtifactObservableAt<TPayload>(
  artifact: InformationArtifact<TPayload>,
  at: SimulationTimeMs,
): boolean {
  return isInformationAvailable(artifact, at);
}

/**
 * The effective observation threshold of an event: `availableAt` when the
 * event carries delayed availability, else its `occurredAt` (an event without
 * delayed availability is observable once it has occurred).
 */
export function eventObservationTime(event: WorldEventEnvelope): SimulationTimeMs {
  return asSimulationTime(event.availableAt ?? event.occurredAt);
}

/**
 * Event visibility at a point in simulation time (the A7 law applied to
 * journal events, e.g. delayed market-data feeds).
 */
export function isEventObservableAt(
  event: WorldEventEnvelope,
  at: SimulationTimeMs,
): boolean {
  return at >= eventObservationTime(event);
}

/**
 * Occurrence at a point in simulation time. Distinct from observability:
 * a delayed event may have already occurred and still not be observable —
 * that distinction is exactly A7.
 */
export function hasEventOccurred(event: WorldEventEnvelope, at: SimulationTimeMs): boolean {
  return at >= event.occurredAt;
}

/**
 * Availability delay of an event in simulated milliseconds:
 * `availableAt - occurredAt`, or 0 when the event has no delayed
 * availability. Models delayed feeds/latency deterministically.
 */
export function availabilityDelayMs(event: WorldEventEnvelope): number {
  return event.availableAt === undefined ? 0 : event.availableAt - event.occurredAt;
}

/**
 * Single-event time consistency: an event may never claim to be observable
 * strictly before it occurred. Engines assert this when journaling.
 */
export function isEventTimeConsistent(event: WorldEventEnvelope): boolean {
  return event.availableAt === undefined || event.availableAt >= event.occurredAt;
}
