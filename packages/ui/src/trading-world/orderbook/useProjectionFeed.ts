/**
 * The React projection-feed hook — W009.
 *
 * Thin {@link useSyncExternalStore} wrapper over the framework-free
 * {@link createTradingWorldProjectionFeedController} (the W018
 * `useEngineWorldClient` pattern): the lifecycle laws (fail-closed start,
 * engine-channel live updates, coalesced refreshes, honest errors) live in
 * the controller where plain-Node tests can drive them; this hook only binds
 * the controller to the world-client context and keeps it alive across
 * renders (J-WORLD-02: hidden tabs never unmount their surfaces).
 *
 * SSR-safe: the server snapshot is the synchronous initial state (an
 * unattached client renders the teaching state; an attached one renders
 * `loading` — no data is fetched during server render, ever).
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import type { TradingWorldClient } from "../runtime/worldClient.js";
import {
  createTradingWorldProjectionFeedController,
  type ProjectionFeedFetchResult,
  type TradingWorldProjectionFeedState,
} from "./projectionFeed.js";

/** Input for {@link useTradingWorldProjectionFeed}. */
export interface TradingWorldProjectionFeedInput<T> {
  /** The world client from the cockpit context (W006 seam). */
  readonly client: TradingWorldClient;
  /**
   * Fetch one projection through the client (the surface's own port calls +
   * transforms; returns `empty` for a legitimately empty world view).
   * May be an inline lambda — identity churn never re-subscribes.
   */
  readonly fetch: (client: TradingWorldClient) => Promise<ProjectionFeedFetchResult<T>>;
  /** Poll fallback cadence in ms; 0 disables polling. */
  readonly pollMs: number;
}

/** The live projection feed handle for one W009 surface. */
export interface TradingWorldProjectionFeed<T> {
  /** The current feed state (the surface renders over it). */
  readonly state: TradingWorldProjectionFeedState<T>;
  /** Force a refresh now (the error-state Retry action). */
  readonly refresh: () => void;
}

/**
 * The live projection feed for one W009 surface. Subscribes the engine's
 * `published` + `clock` channels through the controller when the client is
 * the W018 engine client, polls as a fallback, and re-feeds when the client
 * identity changes (a fresh world attachment).
 */
export function useTradingWorldProjectionFeed<T>(
  input: TradingWorldProjectionFeedInput<T>,
): TradingWorldProjectionFeed<T> {
  const client = input.client;
  // Latest-ref: inline fetch lambdas must not churn the controller.
  const fetchRef = useRef(input.fetch);
  useEffect(() => {
    fetchRef.current = input.fetch;
  });

  const controller = useMemo(
    () =>
      createTradingWorldProjectionFeedController<T>({
        fetch: (current) => fetchRef.current(current),
        pollMs: input.pollMs,
        initialClient: client,
      }),
    // The controller is per (client identity, pollMs); the fetch closure is
    // read through the ref above, so its identity never matters here.
    [client, input.pollMs],
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
