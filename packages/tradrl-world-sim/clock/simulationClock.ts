/**
 * The deterministic simulation clock — the W013 engine's `clock` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (clock is the headless
 * engine's time authority) and "Phase 1" (deterministic TypeScript runtime,
 * Node headless target).
 * Spec: spec/WORLD-PROTOCOL.md "ClockPort" (play, pause, step, seek,
 * jumpToEvent, setSpeed, followRealtime, getClock) and "Time"
 * (wallTime/simulationTime/eventTime/availableAt are distinct concepts).
 * Spec: spec/ARCHITECTURE-LOCK.md A7 (time separation — only this module
 * bridges the wall and simulation axes, via speed/followRealtime) and A8
 * (branching, not destructive rewind — in-place backward seeks are the typed
 * `rewind-requires-branch` rejection).
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md E (play/pause/step/speed/seek/jump).
 *
 * All data shapes are W004's contracts (`tradrl-world-contracts/time`):
 * ClockState, the seven typed ClockRequests, ClockResult, the rejection
 * codes and the status transition law. This module adds NO new shapes —
 * only the deterministic state machine behind them.
 *
 * Determinism law: a request sequence fully determines the clock state.
 * `requestedAt` (host-axis reading) is recorded from the request and is
 * never an input to simulation-axis math. Wall time never enters journal
 * events, digests or the determinism manifest (A9).
 */

import type {
  ClockPort,
  ClockStatus,
  ClockView,
  EventId,
  SequenceNumber,
  WorldId,
} from "tradrl-world-contracts";
import type { WallTimeMs, SimulationTimeMs } from "tradrl-world-contracts/time";
import {
  REALTIME_CLOCK_SPEED,
  asSimulationTime,
  asWallTime,
  canTransitionClockStatus,
  isBackwardSeek,
  isValidClockSpeed,
  isValidStepDeltaMs,
} from "tradrl-world-contracts/time";
import type {
  ClockBounds,
  ClockRejection,
  ClockRejectionCode,
  ClockRequest,
  ClockResult,
  ClockState,
} from "tradrl-world-contracts/time";

/** Default `step()` advance when the request omits `deltaMs`. */
export const DEFAULT_CLOCK_STEP_MS = 1000;

/** Default initial status: engines start paused (a headless run is explicit). */
export const DEFAULT_CLOCK_STATUS: ClockStatus = "paused";

/**
 * Read-only event lookup used by `jump-to-event`. Injected by the engine
 * (backed by the journal) so the clock module never depends on the journal
 * module. The full `WorldEventEnvelope` satisfies this structurally.
 */
export interface ClockEventLookup {
  /** The domain timestamp of the event with the given id / world sequence. */
  findEvent(target: EventId | SequenceNumber): { readonly occurredAt: number } | undefined;
}

/** Options for `createSimulationClock`. */
export interface SimulationClockOptions {
  readonly worldId: WorldId;
  /** Initial position on the simulation axis (the world origin). */
  readonly simulationTime: SimulationTimeMs;
  /** Initial host-axis reading. */
  readonly wallTime: WallTimeMs;
  /** Timeline bounds; finite replay worlds declare an `end`. */
  readonly bounds?: ClockBounds;
  readonly defaultStepMs?: number;
  readonly speed?: number;
  readonly status?: ClockStatus;
  readonly followingRealtime?: boolean;
  /** Backing store for `jump-to-event` resolution (the engine's journal). */
  readonly eventLookup?: ClockEventLookup;
}

/** The deterministic simulation clock. */
export interface SimulationClock {
  /** Apply one typed clock operation. */
  request(operation: ClockRequest): ClockResult;
  /** Full clock state (W004's ClockState — richer than the port's ClockView). */
  state(): ClockState;
  /** The minimal `ClockPort.getClock` view of the state. */
  view(): ClockView;
}

/** Thrown when `SimulationClockOptions` are internally inconsistent. */
export class InvalidClockSetupError extends Error {
  constructor(message: string) {
    super(`invalid simulation clock setup: ${message}`);
    this.name = "InvalidClockSetupError";
  }
}

/**
 * The typed clock rejection surfaced by the `ClockPort` adapter (the port's
 * methods return `Promise<void>`, so the typed `ClockRejection` travels as
 * this error). Closed code set: W004's `ClockRejectionCode`.
 */
export class ClockRejectionError extends Error {
  constructor(readonly rejection: ClockRejection) {
    super(rejection.message);
    this.name = "ClockRejectionError";
  }
}

function reject(code: ClockRejectionCode, message: string): ClockResult {
  return { status: "rejected", rejection: { code, message } };
}

/**
 * Create the deterministic simulation clock. The initial position must lie
 * within `bounds` (when declared); `defaultStepMs` must be a positive finite
 * delta; `speed` a positive finite multiplier.
 */
export function createSimulationClock(options: SimulationClockOptions): SimulationClock {
  const { worldId, simulationTime, wallTime, bounds, eventLookup } = options;
  const defaultStepMs = options.defaultStepMs ?? DEFAULT_CLOCK_STEP_MS;
  const speed = options.speed ?? REALTIME_CLOCK_SPEED;
  const status = options.status ?? DEFAULT_CLOCK_STATUS;
  const followingRealtime = options.followingRealtime ?? false;

  if (!Number.isFinite(simulationTime)) {
    throw new InvalidClockSetupError("simulationTime must be finite");
  }
  if (!isValidStepDeltaMs(defaultStepMs)) {
    throw new InvalidClockSetupError("defaultStepMs must be a positive finite delta");
  }
  if (!isValidClockSpeed(speed)) {
    throw new InvalidClockSetupError("speed must be a positive finite multiplier");
  }
  if (bounds !== undefined) {
    if (!Number.isFinite(bounds.start)) {
      throw new InvalidClockSetupError("bounds.start must be finite");
    }
    if (bounds.end !== undefined && bounds.end < bounds.start) {
      throw new InvalidClockSetupError("bounds.end must not precede bounds.start");
    }
    if (simulationTime < bounds.start) {
      throw new InvalidClockSetupError("initial simulationTime precedes bounds.start");
    }
    if (bounds.end !== undefined && simulationTime > bounds.end) {
      throw new InvalidClockSetupError("initial simulationTime exceeds bounds.end");
    }
  }

  let current: ClockState = Object.freeze({
    worldId,
    simulationTime,
    wallTime,
    status,
    speed,
    followingRealtime,
    ...(bounds === undefined ? {} : { bounds }),
    defaultStepMs,
  });

  /** Shared absolute-move law for `seek` and `jump-to-event`. */
  function moveTo(to: number): ClockResult {
    const target = asSimulationTime(to);
    if (bounds !== undefined && target < bounds.start) {
      return reject(
        "seek-before-start",
        `target ${String(to)} precedes the world origin ${String(bounds.start)}`,
      );
    }
    if (bounds !== undefined && bounds.end !== undefined && target > bounds.end) {
      return reject(
        "seek-beyond-end",
        `target ${String(to)} exceeds the finite timeline end ${String(bounds.end)}`,
      );
    }
    if (isBackwardSeek(current.simulationTime, target)) {
      return reject(
        "rewind-requires-branch",
        `in-place backward move to ${String(to)} is refused: rewind creates a branch ` +
          `from an immutable snapshot (ARCHITECTURE-LOCK A8)`,
      );
    }
    current = { ...current, simulationTime: target };
    return { status: "acked", clock: Object.freeze({ ...current }) };
  }

  function apply(operation: ClockRequest): ClockResult {
    const requestedAt = asWallTime(operation.requestedAt);
    switch (operation.kind) {
      case "play":
      case "pause": {
        // playing ↔ paused are the only status transitions; a redundant
        // play/pause is an idempotent ack (never a violation).
        const next: ClockStatus = operation.kind === "play" ? "playing" : "paused";
        if (canTransitionClockStatus(current.status, next)) {
          current = { ...current, status: next, wallTime: requestedAt };
        } else {
          current = { ...current, wallTime: requestedAt };
        }
        return { status: "acked", clock: Object.freeze({ ...current }) };
      }
      case "step": {
        const deltaMs = operation.deltaMs ?? current.defaultStepMs;
        if (!isValidStepDeltaMs(deltaMs)) {
          return reject(
            "invalid-step-delta",
            `step delta ${String(operation.deltaMs)} must be a positive finite number of ms`,
          );
        }
        let target = current.simulationTime + deltaMs;
        if (current.bounds?.end !== undefined && target > current.bounds.end) {
          // A step never rejects on a finite timeline: it advances to (at
          // most) the end. Moving beyond the end is what seeks/jumps reject.
          target = current.bounds.end;
        }
        current = {
          ...current,
          simulationTime: asSimulationTime(target),
          wallTime: requestedAt,
        };
        return { status: "acked", clock: Object.freeze({ ...current }) };
      }
      case "seek": {
        if (!Number.isFinite(operation.to)) {
          // The W004 rejection-code set is closed; a non-finite target is not
          // a legal point on the timeline, reported as seek-before-start.
          return reject("seek-before-start", "seek target must be a finite timestamp");
        }
        return moveTo(operation.to);
      }
      case "jump-to-event": {
        const found = eventLookup?.findEvent(operation.target);
        if (found === undefined) {
          return reject("unknown-event", `no journaled event matches ${String(operation.target)}`);
        }
        return moveTo(asSimulationTime(found.occurredAt));
      }
      case "set-speed": {
        if (!isValidClockSpeed(operation.speed)) {
          return reject(
            "invalid-speed",
            `speed ${String(operation.speed)} must be a positive finite multiplier`,
          );
        }
        current = { ...current, speed: operation.speed, wallTime: requestedAt };
        return { status: "acked", clock: Object.freeze({ ...current }) };
      }
      case "follow-realtime": {
        // Headless determinism: following realtime records the mode (and the
        // drift readout semantics) but never auto-advances simulation time —
        // the headless engine has no wall-clock timers. Advancement stays
        // explicit (step/seek), so a run is a pure function of its inputs
        // (A9); the W018 adapter supplies the realtime loop if a host wants
        // one.
        current = { ...current, followingRealtime: operation.enabled, wallTime: requestedAt };
        return { status: "acked", clock: Object.freeze({ ...current }) };
      }
    }
  }

  return {
    request(operation: ClockRequest): ClockResult {
      return apply(operation);
    },
    state(): ClockState {
      return Object.freeze({ ...current });
    },
    view(): ClockView {
      const { simulationTime, status: statusNow, speed: speedNow, followingRealtime } = current;
      return Object.freeze({
        simulationTime,
        status: statusNow,
        speed: speedNow,
        followingRealtime,
      });
    },
  };
}

/**
 * Adapt a `SimulationClock` to the protocol-level `ClockPort` (W003's type-
 * only interface). The port's mutating methods return `Promise<void>`; typed
 * rejections surface as `ClockRejectionError`. `wallTimeSource` supplies the
 * host-axis reading stamped on each request, sampled when the adapter method
 * runs (callers may serialize adapter calls to order them with commands —
 * the engine does).
 */
export function asClockPort(
  clock: SimulationClock,
  wallTimeSource: () => WallTimeMs,
): ClockPort {
  const worldId = clock.state().worldId;
  const dispatch = (request: ClockRequest): Promise<void> => {
    const result = clock.request(request);
    if (result.status === "rejected") {
      return Promise.reject(new ClockRejectionError(result.rejection));
    }
    return Promise.resolve();
  };
  const at = (): WallTimeMs => asWallTime(wallTimeSource());
  return {
    play: () => dispatch({ kind: "play", worldId, requestedAt: at() }),
    pause: () => dispatch({ kind: "pause", worldId, requestedAt: at() }),
    step: (deltaMs?: number) =>
      dispatch({
        kind: "step",
        worldId,
        requestedAt: at(),
        ...(deltaMs === undefined ? {} : { deltaMs }),
      }),
    seek: (to: number) => dispatch({ kind: "seek", worldId, requestedAt: at(), to: asSimulationTime(to) }),
    jumpToEvent: (target: EventId | SequenceNumber) =>
      dispatch({ kind: "jump-to-event", worldId, requestedAt: at(), target }),
    setSpeed: (speed: number) => dispatch({ kind: "set-speed", worldId, requestedAt: at(), speed }),
    followRealtime: (enabled: boolean) =>
      dispatch({ kind: "follow-realtime", worldId, requestedAt: at(), enabled }),
    getClock: async () => clock.view(),
  };
}
