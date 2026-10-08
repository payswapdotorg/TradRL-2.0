/**
 * The coalesced surface feed controller — W030's per-surface state machine
 * over the shared coalesced projection stream (the W009
 * `createTradingWorldProjectionFeedController` laws, driven by DRAINS instead
 * of per-signal fetches).
 *
 * FAIL CLOSED (ARCHITECTURE-LOCK A6): before the stream's first drain — and
 * after `stop()` — the state is `unattached`; nothing is ever fabricated.
 * HONEST ERRORS: a failed fetch is a visible typed error state; the next
 * drain that dirties this (surface, key) retries naturally. The state never
 * falls back to stale data as if it were current.
 *
 * Framework-free by design (the W009 controller pattern): every law is
 * testable in plain Node.
 */

import type { TradingWorldClient } from "../runtime/worldClient.js";
import type {
  ProjectionFeedFetchResult,
  TradingWorldProjectionFeedState,
} from "../orderbook/projectionFeed.js";

/** Read-only controller view (the W009 feed surface). */
export interface CoalescedSurfaceFeedController<T> {
  subscribe(listener: () => void): () => void;
  getState(): TradingWorldProjectionFeedState<T>;
  /** SSR snapshot: the synchronous initial state (no effects ever run). */
  getServerState(): TradingWorldProjectionFeedState<T>;
  /** Stop the feed (fail-closes; the stream no longer drives it). */
  stop(): void;
  /** Force a refresh now (the error-state Retry action; a direct drain). */
  refresh(): () => void;
  /** The stream's observation-point drive: run the fetch once, now. */
  drive(drive: FeedDriveInput): Promise<void>;
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

/** Drive input the stream sends when this (surface, key) is dirty at a drain. */
export interface FeedDriveInput {
  readonly client: TradingWorldClient;
}

/**
 * Create one coalesced surface feed. PURE until the stream drives it: the
 * initial state is `unattached` (the teaching state — even server-side); the
 * first drain runs the feed's fetch inside the stream's observation point.
 */
export function createCoalescedSurfaceFeed<T>(input: {
  readonly surface: string;
  readonly key: string | undefined;
  readonly fetch: (client: TradingWorldClient) => Promise<ProjectionFeedFetchResult<T>>;
  readonly onStop: () => void;
  readonly onRefresh: () => void;
}): CoalescedSurfaceFeedController<T> {
  const initial: TradingWorldProjectionFeedState<T> = { status: "unattached" };
  const serverState = initial;
  let state: TradingWorldProjectionFeedState<T> = initial;
  const listeners = new Set<() => void>();
  let stopped = false;
  let inFlight = false;
  let pendingDrive = false;

  function emit(): void {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  async function runFetch(drive: FeedDriveInput): Promise<void> {
    inFlight = true;
    try {
      const result = await input.fetch(drive.client);
      if (stopped) {
        return;
      }
      state =
        result.status === "ready"
          ? { status: "ready", data: result.data }
          : { status: "empty" };
    } catch (error) {
      if (stopped) {
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
    }
    if (!stopped) {
      emit();
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
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      input.onStop();
      state = { status: "unattached" };
      emit();
    },
    refresh() {
      if (stopped) {
        return;
      }
      input.onRefresh();
    },
    async drive(drive: FeedDriveInput): Promise<void> {
      if (stopped) {
        return;
      }
      if (state.status === "unattached") {
        state = { status: "loading" };
        emit();
      }
      if (inFlight) {
        // Coalesce: the in-flight fetch's drain already carries this dirty
        // state forward; run exactly one follow-up fetch (the W009 law).
        pendingDrive = true;
        return;
      }
      await runFetch(drive);
      if (pendingDrive && !stopped) {
        pendingDrive = false;
        await runFetch(drive);
      }
    },
  };
}
