/**
 * The React portfolio-projection hook — W011.
 *
 * Thin {@link useSyncExternalStore} wrapper over the framework-free
 * {@link createPortfolioProjectionFeedController} (the W018
 * `useEngineWorldClient` / W009 `useTradingWorldProjectionFeed` pattern):
 * the lifecycle laws (fail-closed start, engine-channel live updates,
 * coalesced refreshes, honest errors) live in the controller where
 * plain-Node tests drive them against the REAL engine; this hook only binds
 * the controller to the world-client context and keeps it alive across
 * renders (J-WORLD-02: hidden tabs never unmount their surfaces).
 *
 * SSR-safe: the server snapshot is the synchronous initial state (an
 * unattached client renders the unattached state; an attached one renders
 * `loading` — no data is fetched during server render, ever).
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { TradingWorldClient } from "../runtime/worldClient.js";
import {
  createPortfolioProjectionFeedController,
  type PortfolioProjectionFeedState,
} from "./portfolioProjection.js";

/** Input for {@link usePortfolioProjectionFeed}. */
export interface PortfolioProjectionFeedInput {
  /** The world client from the cockpit context (W006/W018 seam). */
  readonly client: TradingWorldClient;
  /** The trader account whose financial state is projected. */
  readonly accountId: string;
  /** Poll fallback cadence in ms; 0 disables polling. */
  readonly pollMs: number;
}

/** The live portfolio projection feed handle for one W011 surface. */
export interface PortfolioProjectionFeed {
  readonly state: PortfolioProjectionFeedState;
  /** Force a refresh now (the error-state Retry action). */
  readonly refresh: () => void;
}

/**
 * The live financial projection feed (positions + portfolio + risk) for one
 * trader account. Subscribes the engine's `published` + `clock` channels
 * through the controller when the client is the W018 engine client, polls
 * as a fallback, and re-feeds when the client identity changes (a fresh
 * world attachment).
 */
export function usePortfolioProjectionFeed(
  input: PortfolioProjectionFeedInput,
): PortfolioProjectionFeed {
  const client = input.client;
  const accountId = input.accountId;

  // The controller is per (client identity, account, pollMs) — a fresh world
  // attachment or a re-scoped account re-feeds; ordinary re-renders do not.
  const controller = useMemo(
    () =>
      createPortfolioProjectionFeedController({
        accountId,
        pollMs: input.pollMs,
        initialClient: client,
      }),
    [client, accountId, input.pollMs],
  );

  useEffect(() => {
    controller.start(client);
    return () => controller.stop();
  }, [controller, client]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getServerState,
  );
  return { state, refresh: controller.refresh };
}
