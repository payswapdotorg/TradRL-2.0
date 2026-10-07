/**
 * Projection feed controller — W009 (DOM ladder + Time & Sales).
 *
 * The framework-free lifecycle core behind both W009 surfaces, following the
 * W018 `createEngineWorldClientController` pattern so every law is testable
 * in plain Node (packages/ui/test/tradingWorldOrderbookLiveProjection.test.ts):
 *
 * - FAIL CLOSED (ARCHITECTURE-LOCK A6): before a client attaches — and again
 *   after `stop()` — the state is `unattached`; nothing is ever fabricated.
 * - LIVE UPDATES (work order W009): the feed subscribes the W018 engine
 *   channels (`published` + `clock`) through {@link subscribeEngineProjectionSignals}
 *   and refreshes when the world moves — the generated market's makers
 *   requote and the aggressive side prints as the clock advances. A poll
 *   fallback (`pollMs`, W007 pattern) covers clients without the engine
 *   extension surface.
 * - COALESCED: pushes arriving while a refresh is in flight set a pending
 *   flag; exactly one follow-up refresh runs. Never a fetch storm.
 * - HONEST ERRORS: a failed fetch is a visible typed error state (the
 *   remote error's class name when the W018 provider reconstructed one);
 *   polling continues so transient failures self-heal, but the state never
 *   falls back to stale data as if it were current — the projection's own
 *   `asOf`/sequence always identifies what is shown.
 */

import type { TradingWorldClient } from "../runtime/worldClient.js";

/** Source of a live-update signal. */
export interface EngineProjectionSignal {
  readonly source: "published" | "clock";
}

type Unsubscribe = () => void;

interface EngineSignalClientSurface {
  readonly onPublished?: (listener: (projection: unknown) => void) => Unsubscribe;
  readonly onClock?: (listener: (clock: unknown) => void) => Unsubscribe;
}

/**
 * Subscribe the W018 engine channels when the client carries them (the
 * engine-backed client extends the W006 seam with `onPublished`/`onClock`).
 * Every push becomes one signal; the feed coalesces refreshes itself. For a
 * plain seam client (e.g. the fail-closed noop) this is a no-op — polling
 * remains the fallback. Returns the unsubscriber.
 */
export function subscribeEngineProjectionSignals(
  client: TradingWorldClient,
  onSignal: (signal: EngineProjectionSignal) => void,
): Unsubscribe {
  const engine = client as TradingWorldClient & EngineSignalClientSurface;
  if (typeof engine.onPublished !== "function" || typeof engine.onClock !== "function") {
    return () => {};
  }
  const unsubscribers = [
    engine.onPublished(() => onSignal({ source: "published" })),
    engine.onClock(() => onSignal({ source: "clock" })),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

/** The result of one projection fetch (the surface's transform output). */
export type ProjectionFeedFetchResult<T> =
  | { readonly status: "ready"; readonly data: T }
  | { readonly status: "empty" };

/** The feed state the surfaces render. */
export type TradingWorldProjectionFeedState<T> =
  | { readonly status: "unattached" }
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "ready"; readonly data: T }
  | {
      readonly status: "error";
      readonly message: string;
      /** The remote error class name when the W018 provider reconstructed one. */
      readonly remoteName?: string;
    };

/** Read-only controller view. */
export interface TradingWorldProjectionFeedController<T> {
  subscribe(listener: () => void): Unsubscribe;
  getState(): TradingWorldProjectionFeedState<T>;
  /** SSR snapshot: the synchronous initial state (no effects ever run). */
  getServerState(): TradingWorldProjectionFeedState<T>;
  /** Attach a client and start the feed (idempotent per client identity). */
  start(client: TradingWorldClient): void;
  /** Stop the feed (cancels in-flight refresh, unsubscribes, fail-closes). */
  stop(): void;
  /** Force a refresh now (the error-state Retry button; no-op when stopped). */
  refresh(): void;
}

/** Extract the typed remote error name from a fetch failure, when present. */
function remoteErrorNameOf(error: unknown): string | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "remoteName" in error &&
    typeof (error as { remoteName?: unknown }).remoteName === "string"
  ) {
    return (error as { remoteName: string }).remoteName;
  }
  return undefined;
}

/** Create the feed controller. PURE until {@link TradingWorldProjectionFeedController.start}:
 * `initialClient` only seeds the synchronous initial state (an unattached
 * client renders the teaching state immediately, even server-side; an
 * attached client renders `loading` — effects never run during SSR); the
 * first fetch runs inside `start()` — an effect, never render.
 */
export function createTradingWorldProjectionFeedController<T>(input: {
  readonly fetch: (client: TradingWorldClient) => Promise<ProjectionFeedFetchResult<T>>;
  readonly pollMs: number;
  readonly initialClient?: TradingWorldClient;
}): TradingWorldProjectionFeedController<T> {
  const initial: TradingWorldProjectionFeedState<T> =
    input.initialClient !== undefined && input.initialClient.status !== "unattached"
      ? { status: "loading" }
      : { status: "unattached" };
  const serverState = initial;
  let state: TradingWorldProjectionFeedState<T> = initial;
  const listeners = new Set<() => void>();
  let client: TradingWorldClient | undefined = input.initialClient;
  /**
   * Whether start() ever ran: the FIRST start kicks the feed even when the
   * client matches the constructor's initialClient (otherwise a controller
   * constructed with a client would sit in `loading` forever).
   */
  let started = false;
  let cancelled = false;
  let inFlight = false;
  let pendingRefresh = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribeSignals: Unsubscribe | undefined;

  function emit(): void {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  async function runFetch(): Promise<void> {
    const current = client;
    if (current === undefined || cancelled) {
      return;
    }
    inFlight = true;
    try {
      const result = await input.fetch(current);
      if (cancelled || client !== current) {
        return;
      }
      state =
        result.status === "ready"
          ? { status: "ready", data: result.data }
          : { status: "empty" };
    } catch (error) {
      if (cancelled || client !== current) {
        return;
      }
      state = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        ...(remoteErrorNameOf(error) === undefined
          ? {}
          : { remoteName: remoteErrorNameOf(error) }),
      };
    } finally {
      inFlight = false;
      if (!cancelled && pendingRefresh) {
        pendingRefresh = false;
        void runFetch();
      }
    }
    if (!cancelled) {
      emit();
    }
  }

  function scheduleFetch(): void {
    if (cancelled) {
      return;
    }
    if (inFlight) {
      pendingRefresh = true;
      return;
    }
    void runFetch();
  }

  function stopFeed(): void {
    cancelled = true;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    if (unsubscribeSignals !== undefined) {
      unsubscribeSignals();
      unsubscribeSignals = undefined;
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    getServerState: () => serverState,
    start(nextClient) {
      if (started && client === nextClient && !cancelled) {
        return;
      }
      stopFeed();
      started = true;
      client = nextClient;
      cancelled = false;
      inFlight = false;
      pendingRefresh = false;
      state =
        nextClient.status === "unattached" ? { status: "unattached" } : { status: "loading" };
      if (nextClient.status === "unattached") {
        emit();
        return;
      }
      unsubscribeSignals = subscribeEngineProjectionSignals(nextClient, scheduleFetch);
      if (input.pollMs > 0) {
        timer = setInterval(scheduleFetch, input.pollMs);
      }
      scheduleFetch();
      emit();
    },
    stop() {
      stopFeed();
      started = false;
      client = undefined;
      state = { status: "unattached" };
      emit();
    },
    refresh() {
      if (client === undefined || cancelled) {
        return;
      }
      scheduleFetch();
    },
  };
}
