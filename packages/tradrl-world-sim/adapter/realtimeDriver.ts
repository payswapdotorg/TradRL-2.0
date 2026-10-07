/**
 * The transport-layer realtime clock driver (W018).
 *
 * Spec: spec/SIMULATION.md "Phase 1" (deterministic TypeScript runtime) and
 * spec/ARCHITECTURE-LOCK.md A7 (time separation: only the speed/followRealtime
 * bridge crosses the wall and simulation axes).
 *
 * The engine's `followRealtime` is deliberately a MODE FLAG ONLY: the
 * headless engine has no wall-clock timers, so a run stays a pure function of
 * (definition, command stream, explicit clock operations) — A9. This driver
 * is the optional HOST-SIDE loop that makes `followRealtime` observable in an
 * interactive UI: while the clock is `playing` AND `followingRealtime`, it
 * steps the clock by the elapsed wall time × speed.
 *
 * Determinism boundary (honest): driver steps are wall-driven, so two
 * wall-live runs need not produce identical step streams — that is why the
 * driver is DISABLED BY DEFAULT and every headless/parity run leaves it off.
 * Each individual step still enters through the engine's ClockPort — the
 * single arrival-order queue — so commands interleave with driver steps in
 * true arrival order and the journal remains a pure function of the full
 * (command + clock-operation) stream.
 *
 * The scheduler and wall source are injectable so tests drive the loop
 * deterministically.
 */

import type { ClockStatus, ClockView } from "tradrl-world-contracts";
import type { WallTimeMs } from "tradrl-world-contracts/time";
import { asWallTime } from "tradrl-world-contracts/time";
import { DEFAULT_REALTIME_TICK_MS } from "./envelope.js";

/** Injectable timer surface (both DOM workers and Node expose these globals). */
export interface WorldTaskScheduler {
  setInterval(handler: () => void, timeoutMs: number): unknown;
  clearInterval(handle: unknown): void;
}

/** The global scheduler both worker hosts and Node processes provide. */
export const globalTaskScheduler: WorldTaskScheduler = {
  setInterval: (handler, timeoutMs) => setInterval(handler, timeoutMs),
  clearInterval: (handle) => clearInterval(handle as Parameters<typeof clearInterval>[0]),
};

/** Read-only clock state the driver consults (the engine's own view). */
export interface RealtimeClockStateView {
  readonly status: ClockStatus;
  readonly speed: number;
  readonly followingRealtime: boolean;
}

/** Options for {@link createRealtimeClockDriver}. */
export interface RealtimeClockDriverOptions {
  /** The engine's ClockPort (steps enter the engine's arrival-order queue). */
  readonly clock: {
    step(deltaMs?: number): Promise<void>;
    getClock(): Promise<ClockView>;
  };
  /** Synchronous current clock state (engine surface). */
  readonly clockState: () => RealtimeClockStateView;
  /** Wall-axis source — the same source the engine was created with. */
  readonly wallTimeSource: () => WallTimeMs;
  /** Driver cadence; default {@link DEFAULT_REALTIME_TICK_MS}. */
  readonly tickMs?: number;
  /** Injectable scheduler for deterministic tests. */
  readonly scheduler?: WorldTaskScheduler;
  /** Called with the post-step clock view (the host's clock push channel). */
  readonly onStep?: (clock: ClockView) => void;
  /** Non-fatal driver diagnostics (a rejected step stops the driver). */
  readonly onDiagnostics?: (detail: string) => void;
}

/** A controllable realtime driver. */
export interface WorldRealtimeClockDriver {
  start(): void;
  stop(): void;
}

/**
 * Create the realtime driver. The loop only steps while the clock is
 * `playing` AND `followingRealtime`; while inactive the wall anchor keeps
 * refreshing so a later resume does not jump the whole idle span.
 */
export function createRealtimeClockDriver(
  options: RealtimeClockDriverOptions,
): WorldRealtimeClockDriver {
  const scheduler = options.scheduler ?? globalTaskScheduler;
  const tickMs = options.tickMs ?? DEFAULT_REALTIME_TICK_MS;
  let handle: unknown;
  let running = false;
  let busy = false;
  let wallAnchor: WallTimeMs | undefined;

  async function tick(): Promise<void> {
    if (busy) {
      return; // never queue steps behind an in-flight one
    }
    busy = true;
    try {
      const now = options.wallTimeSource();
      const state = options.clockState();
      const anchor = wallAnchor;
      wallAnchor = now;
      if (
        state.status === "playing" &&
        state.followingRealtime &&
        anchor !== undefined
      ) {
        const deltaMs = (now - anchor) * state.speed;
        if (Number.isFinite(deltaMs) && deltaMs > 0) {
          await options.clock.step(deltaMs);
          options.onStep?.(await options.clock.getClock());
        }
      }
    } catch (error) {
      // A step rejection must never loop forever: stop the driver and report.
      stop();
      options.onDiagnostics?.(
        `realtime driver stopped after rejected step: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      busy = false;
    }
  }

  function stop(): void {
    running = false;
    if (handle !== undefined) {
      scheduler.clearInterval(handle);
      handle = undefined;
    }
    wallAnchor = undefined;
  }

  return {
    start(): void {
      if (running) {
        return;
      }
      running = true;
      wallAnchor = options.wallTimeSource();
      handle = scheduler.setInterval(() => {
        void tick();
      }, tickMs);
    },
    stop,
  };
}

/** Shared wall-axis resolution for adapter hosts (fixed value or host clock). */
export function resolveAdapterWallTimeSource(
  fixedWallTime?: number,
): () => WallTimeMs {
  if (fixedWallTime !== undefined) {
    const fixed = asWallTime(fixedWallTime);
    return () => fixed;
  }
  return () => asWallTime(Date.now());
}
