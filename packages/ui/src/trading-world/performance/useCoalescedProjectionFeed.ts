/**
 * The React hooks for W030's coalesced projection stream — the drop-in
 * upgrade path for the W009 `useTradingWorldProjectionFeed` surfaces (the
 * pane wiring is a TL action item; this module is the seam the panes mount).
 *
 * `useCoalescedProjectionStream` binds ONE stream per client identity (all
 * feeds of a pane share it); `useCoalescedProjectionFeed` registers one
 * surface data source. The feeds keep the W009 lifecycle laws (fail-closed
 * unattached states, honest errors, hidden tabs never unmount their feeds —
 * J-WORLD-02); the stream coalesces their refreshes at observation points.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";

import type { TradingWorldClient } from "../runtime/worldClient.js";
import type { ProjectionFeedFetchResult } from "../orderbook/projectionFeed.js";
import type { CoalescedSurfaceName } from "../../../../tradrl-world-sim/performance/index.js";
import type { ProjectionCoalescerConfig } from "../../../../tradrl-world-sim/performance/index.js";
import {
  createCoalescedProjectionStream,
  type CoalescedProjectionStream,
} from "./coalescedProjectionStream.js";
import type { CoalescedSurfaceFeedController } from "./coalescedSurfaceFeed.js";
import type { TradingWorldProjectionFeedState } from "../orderbook/projectionFeed.js";

export interface CoalescedStreamHookInput {
  /** The world client from the cockpit context (the W006 seam). */
  readonly client: TradingWorldClient;
  /** The coalescer config (typed, validated loudly). */
  readonly config: ProjectionCoalescerConfig;
}

/** One coalesced projection stream for a client identity. */
export function useCoalescedProjectionStream(
  input: CoalescedStreamHookInput,
): CoalescedProjectionStream {
  const stream = useMemo(
    () => createCoalescedProjectionStream({ client: input.client, config: input.config }),
    // One stream per (client identity, config identity).
    [input.client, input.config],
  );
  useEffect(() => {
    return () => {
      stream.dispose();
    };
  }, [stream]);
  return stream;
}

export interface CoalescedFeedHookInput<T> {
  /** The pane's shared stream (from {@link useCoalescedProjectionStream}). */
  readonly stream: CoalescedProjectionStream;
  readonly surface: CoalescedSurfaceName;
  readonly key: string | undefined;
  /** The surface's fetch (its own port calls + transform). */
  readonly fetch: (client: TradingWorldClient) => Promise<ProjectionFeedFetchResult<T>>;
}

/** The live coalesced feed handle for one surface (the W009 feed surface). */
export interface CoalescedProjectionFeed<T> {
  readonly state: TradingWorldProjectionFeedState<T>;
  /** Force a refresh now (the error-state Retry action). */
  readonly refresh: () => void;
}

/** Register one coalesced surface feed on the pane's stream. */
export function useCoalescedProjectionFeed<T>(
  input: CoalescedFeedHookInput<T>,
): CoalescedProjectionFeed<T> {
  const feed = useMemo(
    () =>
      input.stream.registerFeed<T>({
        surface: input.surface,
        key: input.key,
        fetch: (client) => input.fetch(client),
      }),
    [input.stream, input.surface, input.key],
  );
  useEffect(() => {
    return () => {
      feed.stop();
    };
  }, [feed]);
  const state = useSyncExternalStore(
    feed.subscribe,
    feed.getState,
    feed.getServerState,
  );
  return { state, refresh: () => feed.refresh() };
}

export type { CoalescedSurfaceFeedController };
