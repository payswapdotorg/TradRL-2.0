/**
 * Framework-free live watchlist projection — W008.
 *
 * The controller behind `./WatchlistToolSurface.tsx`: it fetches the
 * watchlist's world projections through the W006 world-client seam
 * (`../runtime/worldClient.ts`) and keeps them LIVE through the W018 push
 * paths (`onPublished` / `onClock` — the parity-tested channels of
 * `../runtime/engineWorldClient.ts`), with a polling fallback for clients
 * without push channels. Every law is testable in plain Node
 * (packages/ui/test/tradingWorldMarketProjection.test.ts) — the React
 * surface is a thin `useSyncExternalStore` wrapper.
 *
 * Laws (work order W008 + ARCHITECTURE-LOCK A6):
 * - NEVER FABRICATE: every row value comes from a real projection
 *   (getWorldMeta / getTimeline / getInstrument / getQuote / getClock).
 *   Absent quote fields stay absent (empty book at the world origin).
 * - ERRORS SURFACE, NEVER SWALLOW: a typed remote error (e.g.
 *   TradingWorldRemoteError / TradingWorldTransportClosedError) either fails
 *   the fatal read (error snapshot — the transport is broken) or is carried
 *   per-consumer (per-row quote/instrument errors, regime-context /
 *   clock-chip notices) and rendered honestly.
 * - FAIL CLOSED: when the transport dies, every call rejects and the
 *   snapshot becomes the typed error — the surface NEVER keeps rendering
 *   stale rows as if they were live.
 * - LIVE, COALESCED: publishes and clock pushes request a refresh; a
 *   refresh already in flight absorbs the request into ONE trailing refetch
 *   (WORLD-PROTOCOL "UI projection law": projections may batch/conflate).
 */

import type { ClockView } from "../runtime/worldContracts.js";
import type { TradingWorldClient } from "../runtime/worldClient.js";
import {
  buildWatchlistRows,
  discoverInstrumentIds,
  parseRegimeAnnouncements,
  WATCHLIST_TIMELINE_EVENT_TYPES,
  type MarketInstrumentId,
  type MarketInstrumentProjection,
  type MarketQuoteProjection,
  type MarketRegimeAnnouncement,
  type MarketRegimeScheduleEntry,
  type WatchlistRow,
} from "./marketData.js";

/** Structural slice of `WorldMeta` the watchlist header projects. */
export interface WatchlistWorldMeta {
  readonly worldId: string;
  readonly mode: string;
  readonly engine: string;
  readonly engineVersion: string;
  readonly executionAuthority: string;
  readonly seed: string;
  readonly regimeSchedule: readonly MarketRegimeScheduleEntry[];
}

/** The snapshot the React surface renders (immutable; identity-stable). */
export type WatchlistProjectionSnapshot =
  | { readonly status: "unattached" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly world: WatchlistWorldMeta;
      readonly clock?: ClockView;
      readonly rows: readonly WatchlistRow[];
      readonly announcements: readonly MarketRegimeAnnouncement[];
      /** Honest typed-error notices (rendered, never swallowed). */
      readonly timelineError?: string;
      readonly clockError?: string;
    }
  | { readonly status: "error"; readonly message: string };

/** Input for {@link createWatchlistProjectionController}. */
export interface WatchlistProjectionControllerInput {
  /** The seam client (noop fail-closed before W018 attaches, ready after). */
  readonly client: TradingWorldClient;
  /** Configured instrument ids (opaque query keys, composition order). */
  readonly instrumentIds: readonly MarketInstrumentId[];
  /** Merge instruments observed in the world's journal into the rows. */
  readonly discoveryEnabled: boolean;
  /** Polling fallback cadence in ms; 0 disables polling. */
  readonly pollMs: number;
}

/** The live watchlist projection controller (one per mounted surface). */
export interface WatchlistProjectionController {
  /** External-store subscribe (notified when the snapshot changes). */
  subscribe(listener: () => void): () => void;
  /** The current snapshot (stable identity between changes). */
  getSnapshot(): WatchlistProjectionSnapshot;
  /** SSR snapshot: ALWAYS unattached (effects never run server-side). */
  getServerSnapshot(): WatchlistProjectionSnapshot;
  /** Begin fetching + subscribing. No-op when already running. */
  start(): void;
  /** Stop subscriptions + cancel in-flight work (StrictMode-safe restart). */
  stop(): void;
  /** Manual refresh (the error state's Retry). Resolves when settled. */
  refresh(): Promise<void>;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Does this seam client carry the W018 push channels? (Feature detection —
 * the surface shows its live indicator from the same check.)
 */
export function seamClientHasPushChannels(client: TradingWorldClient): boolean {
  return hasPushChannels(client);
}

/** Does this seam client carry the W018 push channels? (feature detection) */
function hasPushChannels(
  client: TradingWorldClient,
): client is TradingWorldClient & {
  onPublished(listener: () => void): () => void;
  onClock(listener: () => void): () => void;
} {
  const candidate = client as {
    onPublished?: unknown;
    onClock?: unknown;
  };
  return (
    typeof candidate.onPublished === "function" && typeof candidate.onClock === "function"
  );
}

/**
 * Create the controller. Pure until {@link WatchlistProjectionController.start}.
 */
export function createWatchlistProjectionController(
  input: WatchlistProjectionControllerInput,
): WatchlistProjectionController {
  const client = input.client;
  const listeners = new Set<() => void>();
  const unattached: WatchlistProjectionSnapshot = { status: "unattached" };
  // Synchronous initial state (the W007 surface pattern): a READY client
  // means data is being fetched — the very first snapshot (before any
  // effect starts the controller, and in static/SSR renders where effects
  // never run) is the honest loading projection; a fail-closed client
  // starts and stays unattached. The reference is stable: it also serves as
  // the useSyncExternalStore server snapshot.
  const initialSnapshot: WatchlistProjectionSnapshot =
    client.status === "ready" ? { status: "loading" } : unattached;
  let snapshot: WatchlistProjectionSnapshot = initialSnapshot;
  let running = false;
  let inFlight = false;
  let pending = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const unsubscribers: (() => void)[] = [];

  function emit(): void {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  function setSnapshot(next: WatchlistProjectionSnapshot): void {
    snapshot = next;
    emit();
  }

  /** Request a refresh: immediate when idle, ONE trailing refetch when busy. */
  function requestRefresh(): void {
    if (!running) {
      return;
    }
    if (inFlight) {
      pending = true;
      return;
    }
    void runRefresh();
  }

  async function runRefresh(): Promise<void> {
    if (inFlight || !running) {
      return;
    }
    inFlight = true;
    try {
      const next = await fetchSnapshot();
      if (running) {
        setSnapshot(next);
      }
    } finally {
      inFlight = false;
      if (running && pending) {
        pending = false;
        void runRefresh();
      }
    }
  }

  async function fetchSnapshot(): Promise<WatchlistProjectionSnapshot> {
    try {
      // Fatal read: without world identity + schedule there is no watchlist
      // projection (and a rejection here usually means the transport died).
      const meta = await client.query.getWorldMeta();
      const world: WatchlistWorldMeta = {
        worldId: String(meta.worldId),
        mode: String(meta.mode),
        engine: String(meta.engine),
        engineVersion: String(meta.engineVersion),
        executionAuthority: String(meta.executionAuthority),
        seed: String(meta.seed),
        regimeSchedule: (meta.regimeSchedule ?? []) as readonly MarketRegimeScheduleEntry[],
      };
      // Context reads: their typed failures are carried honestly (notice),
      // never swallowed, and never fabricated around.
      let timelineError: string | undefined;
      let events: readonly unknown[] = [];
      try {
        const timeline = await client.query.getTimeline({
          types: WATCHLIST_TIMELINE_EVENT_TYPES,
        });
        events = timeline.events as readonly unknown[];
      } catch (error) {
        timelineError = errorText(error);
      }
      let clock: ClockView | undefined;
      let clockError: string | undefined;
      try {
        clock = await client.clock.getClock();
      } catch (error) {
        clockError = errorText(error);
      }
      const marketEvents = events as readonly {
        eventType: string;
        occurredAt: number;
        sequence: number;
        payload: unknown;
      }[];
      const announcements = parseRegimeAnnouncements(marketEvents);
      const discoveredIds = input.discoveryEnabled
        ? discoverInstrumentIds(marketEvents)
        : [];
      const rowIds = new Set<string>([
        ...input.instrumentIds.map((id) => String(id)),
        ...discoveredIds.map((id) => String(id)),
      ]);
      const fetches = await Promise.all(
        [...rowIds].map(async (id) => {
          const instrumentId = id as MarketInstrumentId;
          let instrument: MarketInstrumentProjection | undefined;
          let instrumentError: string | undefined;
          try {
            instrument = (await client.query.getInstrument(
              instrumentId,
            )) as MarketInstrumentProjection;
          } catch (error) {
            instrumentError = errorText(error);
          }
          let quote: MarketQuoteProjection | undefined;
          let quoteError: string | undefined;
          try {
            quote = (await client.query.getQuote(instrumentId)) as MarketQuoteProjection;
          } catch (error) {
            quoteError = errorText(error);
          }
          return {
            instrumentId,
            ...(instrument === undefined ? {} : { instrument }),
            ...(instrumentError === undefined ? {} : { instrumentError }),
            ...(quote === undefined ? {} : { quote }),
            ...(quoteError === undefined ? {} : { quoteError }),
          };
        }),
      );
      const rows = buildWatchlistRows({
        configuredIds: input.instrumentIds,
        discoveredIds,
        fetches,
        announcements,
        schedule: world.regimeSchedule,
        ...(clock === undefined ? {} : { simulationTime: clock.simulationTime }),
      });
      return {
        status: "ready",
        world,
        ...(clock === undefined ? {} : { clock }),
        rows,
        announcements,
        ...(timelineError === undefined ? {} : { timelineError }),
        ...(clockError === undefined ? {} : { clockError }),
      };
    } catch (error) {
      return { status: "error", message: errorText(error) };
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    // Stable-reference server/initial snapshot: static renders (tests) and
    // real SSR (the fail-closed noop client) both render the honest state
    // derived from the seam client status — never fabricated data.
    getServerSnapshot: () => initialSnapshot,
    start() {
      if (running) {
        return;
      }
      running = true;
      if (client.status !== "ready") {
        // Fail-closed seam (W006 noop): the honest teaching state — the
        // surface renders it from the client status; nothing is fetched.
        setSnapshot(unattached);
        return;
      }
      setSnapshot({ status: "loading" });
      // LIVE (work order W008): subscribe the W018 push paths — published
      // projections (any applied command: orders, market events) and the
      // clock channel (settled views after acked mutating clock calls).
      if (hasPushChannels(client)) {
        unsubscribers.push(
          client.onPublished(() => {
            requestRefresh();
          }),
        );
        unsubscribers.push(
          client.onClock(() => {
            requestRefresh();
          }),
        );
      }
      if (input.pollMs > 0) {
        pollTimer = setInterval(() => {
          requestRefresh();
        }, input.pollMs);
      }
      requestRefresh();
    },
    stop() {
      if (!running) {
        return;
      }
      running = false;
      pending = false;
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      for (const unsubscribe of unsubscribers.splice(0)) {
        unsubscribe();
      }
      // An in-flight refresh may still settle; it observes `running` and
      // drops its result — the snapshot returns to the honest unattached
      // state until the next start() re-fetches from scratch.
      setSnapshot(unattached);
    },
    async refresh() {
      if (!running) {
        return;
      }
      if (inFlight) {
        pending = true;
        // Wait for the trailing refetch this request guarantees.
        while (inFlight || pending) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return;
      }
      await runRefresh();
    },
  };
}
