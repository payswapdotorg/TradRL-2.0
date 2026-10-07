/**
 * Clock contracts — the data shapes behind the ClockPort.
 *
 * Spec: spec/WORLD-PROTOCOL.md "ClockPort" — play, pause, step, seek,
 * jumpToEvent, setSpeed, followRealtime, getClock.
 * Spec: spec/WORLD-PROTOCOL.md "Time" + spec/ARCHITECTURE-LOCK.md A7 — the
 * wall and simulation axes are distinct; only this module bridges them
 * (speed / followRealtime).
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md E — play, pause, step, speed, seek,
 * jump (snapshot/branch are CommandPort operations, W003 commands.ts).
 * Spec: spec/ARCHITECTURE-LOCK.md A8 — history is immutable; rewind creates
 * a child world, so in-place backward seeks are a typed rejection.
 *
 * W003's `ports.ts` owns the TYPE-ONLY `ClockPort` interface and the minimal
 * `ClockView`; this module owns the richer engine/UI data shapes (W013's
 * engine publishes them, W012's clock UI consumes them): the full clock
 * state, per-operation request/result envelopes, the status transition law,
 * timeline windows/slices and the realtime-drift readout.
 */

import type {
  CorrelationId,
  EventId,
  WorldId,
} from "../../src/ids.js";
import type { SequenceNumber } from "../../src/primitives.js";
import type {
  ClockStatus,
  ClockView,
} from "../../src/ports.js";
import type {
  EventQuery,
  WorldEventEnvelope,
} from "../../src/events.js";
import type {
  SimulationTimeMs,
  WallTimeMs,
} from "./timeSemantics.js";

// --- clock state ----------------------------------------------------------------

/**
 * Optional timeline bounds. Finite replay worlds carry an `end`; open-ended
 * synthetic worlds omit it. Seeks/jumps outside bounds are rejections.
 */
export interface ClockBounds {
  /** Earliest legal simulation time (the world's origin). */
  readonly start: SimulationTimeMs;
  /** Latest simulation time for finite (replay) worlds. */
  readonly end?: SimulationTimeMs;
}

/**
 * The full simulation-clock state. Extends W003's minimal `ClockView` (what
 * `ClockPort.getClock` returns) with world scope, the wall-axis reading and
 * the bounds/default-step the engine and timeline UI need.
 */
export interface ClockState extends ClockView {
  readonly worldId: WorldId;
  /** Narrowed role: the clock's position on the simulation axis (A7). */
  readonly simulationTime: SimulationTimeMs;
  /** Host-axis reading at the clock's last evaluation (A7). */
  readonly wallTime: WallTimeMs;
  /** Timeline bounds, when the world declares them. */
  readonly bounds?: ClockBounds;
  /** The default tick `step()` applies when no explicit delta is given. */
  readonly defaultStepMs: number;
}

/** Speed 1 = realtime (WORLD-PROTOCOL.md followRealtime/getClock semantics). */
export const REALTIME_CLOCK_SPEED = 1;

/** A usable clock speed: finite and strictly positive. */
export function isValidClockSpeed(speed: number): boolean {
  return Number.isFinite(speed) && speed > 0;
}

/** A usable step delta: finite and strictly positive (step only advances). */
export function isValidStepDeltaMs(deltaMs: number): boolean {
  return Number.isFinite(deltaMs) && deltaMs > 0;
}

/**
 * Drift between the host axis and the simulation axis while following
 * realtime: how many milliseconds the world lags (positive) or leads
 * (negative) the host. Zero outside follow mode — the axes are otherwise
 * independent (A7).
 */
export function realtimeDriftMs(clock: ClockState): number {
  return clock.followingRealtime ? clock.wallTime - clock.simulationTime : 0;
}

// --- status transition law --------------------------------------------------------

/**
 * The clock status transition law. `playing ↔ paused` are the only status
 * transitions; step/seek/jump move time but never change status.
 */
export const CLOCK_STATUS_TRANSITIONS: Readonly<
  Record<ClockStatus, readonly ClockStatus[]>
> = {
  playing: ["paused"],
  paused: ["playing"],
};

/** True when the clock may move between the two statuses directly. */
export function canTransitionClockStatus(from: ClockStatus, to: ClockStatus): boolean {
  return CLOCK_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * A8 (branching, not destructive rewind): moving the clock backwards is a
 * rewind. Engines that do not support in-place rewind reject it with
 * `rewind-requires-branch`; going back always remains available through
 * `CommandPort.branchWorld` from a snapshot.
 */
export function isBackwardSeek(from: SimulationTimeMs, to: SimulationTimeMs): boolean {
  return to < from;
}

// --- clock requests (one typed envelope per ClockPort operation) ------------------

/** Fields shared by every clock request. */
export interface ClockRequestBase {
  readonly worldId: WorldId;
  /** Host-axis reading of when the request was issued. */
  readonly requestedAt: WallTimeMs;
  readonly correlationId?: CorrelationId;
}

export interface PlayClockRequest extends ClockRequestBase {
  readonly kind: "play";
}

export interface PauseClockRequest extends ClockRequestBase {
  readonly kind: "pause";
}

/** Advance by `deltaMs`, or the clock's `defaultStepMs` when omitted. */
export interface StepClockRequest extends ClockRequestBase {
  readonly kind: "step";
  readonly deltaMs?: number;
}

/** Move simulation time to an absolute point on the simulation axis. */
export interface SeekClockRequest extends ClockRequestBase {
  readonly kind: "seek";
  readonly to: SimulationTimeMs;
}

/** Jump to a journal event, identified by id or by world sequence. */
export interface JumpToEventClockRequest extends ClockRequestBase {
  readonly kind: "jump-to-event";
  readonly target: EventId | SequenceNumber;
}

export interface SetSpeedClockRequest extends ClockRequestBase {
  readonly kind: "set-speed";
  readonly speed: number;
}

export interface FollowRealtimeClockRequest extends ClockRequestBase {
  readonly kind: "follow-realtime";
  readonly enabled: boolean;
}

/** Union of the seven clock operations (WORLD-PROTOCOL.md "ClockPort"). */
export type ClockRequest =
  | PlayClockRequest
  | PauseClockRequest
  | StepClockRequest
  | SeekClockRequest
  | JumpToEventClockRequest
  | SetSpeedClockRequest
  | FollowRealtimeClockRequest;

export type ClockRequestKind = ClockRequest["kind"];

// --- clock results -----------------------------------------------------------------

/**
 * Typed clock-operation rejection. Closed set for World Alpha; extensions go
 * through a contract change.
 */
export type ClockRejectionCode =
  | "invalid-speed" // set-speed: non-finite or non-positive speed
  | "invalid-step-delta" // step: non-finite or non-positive deltaMs
  | "seek-before-start" // seek/jump before the world origin
  | "seek-beyond-end" // seek/jump past a finite timeline's end
  | "unknown-event" // jump-to-event target not in the journal
  | "rewind-requires-branch"; // backward seek refused in place (A8)

/** Structured rejection of a clock request. */
export interface ClockRejection {
  readonly code: ClockRejectionCode;
  readonly message: string;
}

/**
 * Result of applying a clock request: the post-operation clock state on ack
 * (mirrors W003's CommandResult ack/rejected shape so the UI treats command
 * and clock feedback uniformly).
 */
export type ClockResult =
  | { readonly status: "acked"; readonly clock: ClockState }
  | { readonly status: "rejected"; readonly rejection: ClockRejection };

// --- timeline windows and slices ----------------------------------------------------

/** A half-open-free (inclusive) window on the simulation axis. */
export interface SimulationTimeWindow {
  readonly from: SimulationTimeMs;
  readonly to: SimulationTimeMs;
}

/** Inclusive containment on both ends. */
export function isWithinSimulationWindow(
  at: SimulationTimeMs,
  window: SimulationTimeWindow,
): boolean {
  return at >= window.from && at <= window.to;
}

/** Window length in simulated milliseconds. */
export function simulationWindowDurationMs(window: SimulationTimeWindow): number {
  return window.to - window.from;
}

/**
 * A slice of the world timeline for a simulation window: the journal events
 * whose domain time falls inside the window, plus paging flags. Composes
 * with W003's `WorldEventEnvelope`; like every projection it may batch or
 * conflate but never fabricate financial facts.
 */
export interface ClockTimelineSlice {
  readonly window: SimulationTimeWindow;
  readonly events: readonly WorldEventEnvelope[];
  readonly hasMoreBefore: boolean;
  readonly hasMoreAfter: boolean;
}

/**
 * Bridge a simulation window to the evidence/timeline query shape: the same
 * window queried through `QueryPort.getTimeline`/`EvidencePort.getEvents`
 * yields the events this slice must contain.
 */
export function eventQueryForWindow(window: SimulationTimeWindow): EventQuery {
  return { from: window.from, to: window.to };
}
