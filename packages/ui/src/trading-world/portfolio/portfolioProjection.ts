/**
 * Portfolio projection feed controller — W011 (framework-free).
 *
 * The live lifecycle core behind the three W011 surfaces (positions /
 * portfolio / risk), following the W009 `createTradingWorldProjectionFeed`
 * and W018 `createEngineWorldClientController` patterns so every law is
 * testable in plain Node:
 *
 * - REAL PROJECTIONS ONLY (ARCHITECTURE-LOCK A6, WORLD-PROTOCOL.md "UI
 *   projection law"): every refresh fetches the engine's OWN
 *   `query.getPositions(accountId)` + `query.getPortfolio(accountId)` +
 *   `query.getRisk(accountId)` — the W015 financial state through the W018
 *   provider seam. Nothing is fabricated: a flat book projects as the
 *   honest empty position list, not as zero rows that imply positions.
 * - LIVE UPDATES (work order W011): the feed subscribes the W018 engine
 *   channels (`published` — every applied command, including the generated
 *   market's synthetic fills that MOVE THE MARKS — and `clock` — settled
 *   clock views) and refreshes when the world moves; a poll fallback
 *   (`pollMs`) covers clients without the engine extension surface.
 * - COALESCED: pushes arriving while a refresh is in flight set a pending
 *   flag; exactly one follow-up refresh runs. Never a fetch storm.
 * - HONEST ERRORS: a failed fetch is a visible typed error state (the
 *   remote error's class name when the W018 provider reconstructed one —
 *   e.g. the typed `UnknownWorldEntityError` for a mis-scoped account);
 *   polling continues so transient failures self-heal, but the state never
 *   falls back to stale figures as if they were current.
 * - FAIL CLOSED: before a client attaches — and after `stop()` — the state
 *   is `unattached`; a closed transport surfaces as the honest error state.
 */

import type { Portfolio, Position, RiskState } from "tradrl-world-contracts";

import type { TradingWorldClient } from "../runtime/worldClient.js";

/** The three real projections one refresh carries (the trader's account). */
export interface PortfolioProjectionSnapshot {
  readonly positions: readonly Position[];
  readonly portfolio: Portfolio;
  readonly risk: RiskState;
}

/** The feed state the surfaces render (a flat book is READY, not teaching). */
export type PortfolioProjectionFeedState =
  | { readonly status: "unattached" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: PortfolioProjectionSnapshot }
  | {
      readonly status: "error";
      readonly message: string;
      /** The remote error class name when the W018 provider reconstructed one. */
      readonly remoteName?: string;
    };

/** Read-only controller view. */
export interface PortfolioProjectionFeedController {
  subscribe(listener: () => void): () => void;
  getState(): PortfolioProjectionFeedState;
  /** SSR snapshot: the synchronous initial state (no effects ever run). */
  getServerState(): PortfolioProjectionFeedState;
  /** Attach a client and start the feed (idempotent per client identity). */
  start(client: TradingWorldClient): void;
  /** Stop the feed (cancels in-flight refresh, unsubscribes, fail-closes). */
  stop(): void;
  /** Force a refresh now (the error-state Retry button; no-op when stopped). */
  refresh(): void;
}

type Unsubscribe = () => void;

/** The engine publication/clock subscription surface (structural check). */
interface EngineSignalClientSurface {
  readonly onPublished?: (listener: (projection: unknown) => void) => Unsubscribe;
  readonly onClock?: (listener: (clock: unknown) => void) => Unsubscribe;
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

/** Fetch the three real projections for one account (the feed's read). */
export async function fetchPortfolioProjection(
  client: TradingWorldClient,
  accountId: string,
): Promise<PortfolioProjectionSnapshot> {
  const [positions, portfolio, risk] = await Promise.all([
    client.query.getPositions(accountId as never),
    client.query.getPortfolio(accountId as never),
    client.query.getRisk(accountId as never),
  ]);
  return { positions, portfolio, risk };
}

/**
 * Create the feed controller for one account's financial projections.
 * PURE until `start()`: `initialClient` only seeds the synchronous initial
 * state (an unattached client renders the unattached state immediately,
 * even server-side; an attached client renders `loading` — effects never
 * run during SSR).
 */
export function createPortfolioProjectionFeedController(input: {
  /** The trader account whose financial state is projected. */
  readonly accountId: string;
  /** Poll fallback cadence in ms; 0 disables polling. */
  readonly pollMs: number;
  readonly initialClient?: TradingWorldClient;
}): PortfolioProjectionFeedController {
  const initial: PortfolioProjectionFeedState =
    input.initialClient !== undefined && input.initialClient.status !== "unattached"
      ? { status: "loading" }
      : { status: "unattached" };
  const serverState = initial;
  let state: PortfolioProjectionFeedState = initial;
  const listeners = new Set<() => void>();
  let client: TradingWorldClient | undefined = input.initialClient;
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
      const snapshot = await fetchPortfolioProjection(current, input.accountId);
      if (cancelled || client !== current) {
        return;
      }
      state = { status: "ready", snapshot };
    } catch (error) {
      if (cancelled || client !== current) {
        return;
      }
      const remoteName = remoteErrorNameOf(error);
      state = {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
        ...(remoteName === undefined ? {} : { remoteName }),
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
        nextClient.status === "unattached"
          ? { status: "unattached" }
          : { status: "loading" };
      if (nextClient.status === "unattached") {
        emit();
        return;
      }
      const engine = nextClient as TradingWorldClient & EngineSignalClientSurface;
      if (typeof engine.onPublished === "function" && typeof engine.onClock === "function") {
        const unsubscribers = [
          engine.onPublished(() => scheduleFetch()),
          engine.onClock(() => scheduleFetch()),
        ];
        unsubscribeSignals = () => {
          for (const unsubscribe of unsubscribers) {
            unsubscribe();
          }
        };
      }
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
