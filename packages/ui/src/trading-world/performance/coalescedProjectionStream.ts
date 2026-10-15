/**
 * The coalesced projection stream — W030's streaming seam for the
 * trading-world tool surfaces.
 *
 * THE LAW (spec/WORLD-PROTOCOL.md "UI projection law" + ARCHITECTURE-LOCK
 * A6): the engine publishes projections per journal event; at high event
 * rates the surfaces receive redundant intermediate states. This stream
 * coalesces them: every signal (engine publication, settled clock view) is
 * INGESTED into the pure W030 coalescer
 * (packages/tradrl-world-sim/performance) and at every OBSERVATION POINT
 * (the scheduler's drain — one macrotask by default, injectable) each dirty
 * (surface, key) feed runs its fetch EXACTLY ONCE. Identical final states,
 * strictly fewer intermediate refreshes — never a blend (A6), never stale
 * beyond the configured windows, the published channel itself untouched.
 *
 * The feeds follow the W009 controller laws (fail-closed unattached, honest
 * error states, coalesced in-flight refreshes); the stream is framework-free
 * so every law is testable in plain Node.
 */

import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { ClockView } from "tradrl-world-contracts";
// NOTE(tradrl-world-sim): the W030 coalescer is imported by the relative
// source path because the package's `exports` map registration
// ("./performance") is a TL action item (the frozen write surface forbids
// editing the sim manifest). Erased to a plain relative module reference.
import {
  createProjectionCoalescer,
  type CoalescedSurfaceName,
  type ProjectionCoalescerConfig,
} from "../../../../tradrl-world-sim/performance/index.js";
import type { TradingWorldClient } from "../runtime/worldClient.js";
import type { ProjectionFeedFetchResult } from "../orderbook/projectionFeed.js";
import {
  createCoalescedSurfaceFeed,
  type CoalescedSurfaceFeedController,
} from "./coalescedSurfaceFeed.js";

type Unsubscribe = () => void;

/**
 * The observation scheduler: signals schedule ONE drain; everything ingested
 * before the drain runs is coalesced into it. Default: the macrotask
 * boundary (Node timers — works in browsers too; a real pane can inject
 * requestAnimationFrame for frame alignment).
 */
export interface CoalescingDrainScheduler {
  schedule(drain: () => void): void;
  cancel(): void;
}

/** The default macrotask scheduler (one drain per macrotask). */
export function macrotaskScheduler(): CoalescingDrainScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(drain) {
      if (timer !== undefined) {
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        drain();
      }, 0);
    },
    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

/** A manual scheduler for tests: drains run only when the test says so. */
export function manualScheduler(): CoalescingDrainScheduler & {
  readonly pending: () => boolean;
  run(): void;
} {
  let drain: (() => void) | undefined;
  return {
    schedule(next) {
      drain = next;
    },
    cancel() {
      drain = undefined;
    },
    pending: () => drain !== undefined,
    run() {
      const current = drain;
      drain = undefined;
      current?.();
    },
  };
}

/** Honest stream metrics — COUNTS only (wall-clock is never asserted). */
export interface CoalescedStreamMetrics {
  readonly publications: number;
  readonly clockSignals: number;
  readonly eventsIngested: number;
  readonly drains: number;
  readonly feedDrives: number;
}

/** Input for {@link createCoalescedProjectionStream}. */
export interface CoalescedProjectionStreamInput {
  /** An ATTACHED engine client (the W018 `EngineWorldClient`). */
  readonly client: TradingWorldClient & {
    onPublished?: (listener: (projection: { events: readonly WorldEventEnvelope[] }) => void) => Unsubscribe;
    onClock?: (listener: (clock: ClockView) => void) => Unsubscribe;
  };
  /** The coalescer config (typed, validated loudly by the sim coalescer). */
  readonly config: ProjectionCoalescerConfig;
  /** Observation scheduler; default: the macrotask boundary. */
  readonly scheduler?: CoalescingDrainScheduler;
}

export interface CoalescedProjectionStream {
  /** Register one surface feed (the pane's data source). */
  registerFeed<T>(input: {
    readonly surface: CoalescedSurfaceName;
    readonly key: string | undefined;
    readonly fetch: (client: TradingWorldClient) => Promise<ProjectionFeedFetchResult<T>>;
  }): CoalescedSurfaceFeedController<T>;
  /** Run a drain NOW (the observation point; also the Retry path). */
  drainNow(): Promise<void>;
  /** Honest counts (diagnostics + tests). */
  metrics(): CoalescedStreamMetrics;
  /** Unsubscribe every channel; feeds stay on their last state machine step. */
  dispose(): void;
}

interface RegisteredFeed {
  readonly surface: CoalescedSurfaceName;
  readonly key: string | undefined;
  readonly controller: CoalescedSurfaceFeedController<unknown>;
}

/**
 * Create the coalesced projection stream over an attached engine client:
 * subscribes the `published` + `clock` channels, ingests every signal into
 * the pure coalescer, and drains at the scheduler's observation points.
 * Feeds registered for (surface, key) pairs the config does not cover are
 * rejected LOUDLY (they would never refresh — a wiring bug).
 */
export function createCoalescedProjectionStream(
  input: CoalescedProjectionStreamInput,
): CoalescedProjectionStream {
  const scheduler = input.scheduler ?? macrotaskScheduler();
  const client = input.client;
  const coalescer = createProjectionCoalescer(input.config);
  const feeds: RegisteredFeed[] = [];
  let disposed = false;
  let drainScheduled = false;
  let draining = false;
  /** Total signals ingested (publications + clock views) — the exact
   * missed-signal detector: a drain that observed ingestCount N and sees a
   * different count at completion left entries unrefreshed. */
  let ingestCount = 0;
  /** The in-flight drain's completion promise (settled AFTER its finally). */
  let inFlightCompletion: Promise<void> | undefined;
  /** The ingestCount snapshot of the most recent drain (missed-signal check). */
  let lastDrainIngestsAtDrain: number | undefined;
  /** drainNow() callers waiting on the in-flight drain (they run the
   * follow-up inline, so the scheduler path must not double-schedule). */
  let drainNowWaiters = 0;
  const metrics: CoalescedStreamMetrics = {
    publications: 0,
    clockSignals: 0,
    eventsIngested: 0,
    drains: 0,
    feedDrives: 0,
  };

  function ensureDrainScheduled(): void {
    if (disposed || drainScheduled) {
      return;
    }
    drainScheduled = true;
    scheduler.schedule(() => {
      drainScheduled = false;
      void runDrain();
    });
  }

  async function runDrain(force = false): Promise<void> {
    if (disposed) {
      return;
    }
    if (draining) {
      // A drain is in flight. A DIRECT caller (drainNow) awaits its
      // completion — and any follow-up it spawns — so callers always
      // observe settled state; the exact missed-signal check (below)
      // decides whether a follow-up is needed at all (the W009 law:
      // signals that arrived during the drain's fetch phase are picked up
      // by EXACTLY ONE follow-up, never dropped, never duplicated).
      drainNowWaiters += 1;
      try {
        while (draining && !disposed) {
          await inFlightCompletion;
        }
      } finally {
        drainNowWaiters -= 1;
      }
      if (
        !disposed &&
        !draining &&
        lastDrainIngestsAtDrain !== undefined &&
        ingestCount !== lastDrainIngestsAtDrain
      ) {
        // Signals arrived during the in-flight drain's fetch phase and were
        // not refreshed: run the follow-up inline (the scheduler path did
        // not schedule one — a waiter owns it now).
        return runDrain(force);
      }
      return;
    }
    draining = true;
    const ingestsAtDrain = ingestCount;
    let settleCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });
    inFlightCompletion = completion;
    const work = (async () => {
      try {
        const drain = coalescer.drain(force ? { force: true } : undefined);
        metrics.drains += 1;
        for (const entry of drain.entries) {
          for (const feed of feeds) {
            if (feed.surface !== entry.surface || feed.key !== entry.key) {
              continue;
            }
            metrics.feedDrives += 1;
            await feed.controller.drive({ client });
          }
        }
      } finally {
        draining = false;
        lastDrainIngestsAtDrain = ingestsAtDrain;
        inFlightCompletion = undefined;
        if (!disposed && drainNowWaiters === 0 && ingestCount !== ingestsAtDrain) {
          // Signals arrived during this drain's fetch phase and no direct
          // caller is waiting: the scheduler owns the exactly-one follow-up.
          ensureDrainScheduled();
        }
        settleCompletion();
      }
    })();
    await work;
  }

  const unsubscribers: Unsubscribe[] = [];
  if (typeof client.onPublished === "function") {
    unsubscribers.push(
      client.onPublished((projection) => {
        if (disposed) {
          return;
        }
        metrics.publications += 1;
        metrics.eventsIngested += projection.events.length;
        ingestCount += 1;
        coalescer.ingestPublication(projection.events);
        ensureDrainScheduled();
      }),
    );
  }
  if (typeof client.onClock === "function") {
    unsubscribers.push(
      client.onClock(() => {
        if (disposed) {
          return;
        }
        metrics.clockSignals += 1;
        ingestCount += 1;
        coalescer.ingestClock();
        ensureDrainScheduled();
      }),
    );
  }

  return {
    registerFeed<T>(feedInput: {
      surface: CoalescedSurfaceName;
      key: string | undefined;
      fetch: (client: TradingWorldClient) => Promise<ProjectionFeedFetchResult<T>>;
    }): CoalescedSurfaceFeedController<T> {
      if (disposed) {
        throw new Error("createCoalescedProjectionStream: the stream is disposed");
      }
      const surfaceConfig = input.config.surfaces[feedInput.surface];
      if (surfaceConfig === undefined) {
        throw new Error(
          `coalesced stream: feed surface '${feedInput.surface}' is not configured — ` +
            "an unconfigured surface never refreshes (check the stream config)",
        );
      }
      if (
        surfaceConfig.keys !== undefined &&
        feedInput.key !== undefined &&
        !surfaceConfig.keys.includes(feedInput.key)
      ) {
        throw new Error(
          `coalesced stream: feed key '${feedInput.key}' is outside the configured ` +
            `keys of surface '${feedInput.surface}' — it would never refresh`,
        );
      }
      const registered: RegisteredFeed = {
        surface: feedInput.surface,
        key: feedInput.key,
        controller: undefined as unknown as CoalescedSurfaceFeedController<unknown>,
      };
      const controller = createCoalescedSurfaceFeed<T>({
        surface: feedInput.surface,
        key: feedInput.key,
        fetch: feedInput.fetch,
        onStop: () => {
          const index = feeds.indexOf(registered);
          if (index >= 0) {
            feeds.splice(index, 1);
          }
        },
        onRefresh: () => {
          void runDrain(false);
        },
      });
      registered.controller = controller as unknown as CoalescedSurfaceFeedController<unknown>;
      feeds.push(registered);
      // The attach fetch: declared keys start dirty, so the next drain
      // refreshes the feed immediately (the W009 first-fetch law).
      ensureDrainScheduled();
      return controller;
    },
    drainNow() {
      return runDrain(false);
    },
    metrics: () => ({ ...metrics }),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      scheduler.cancel();
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    },
  };
}
