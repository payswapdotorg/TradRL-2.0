/**
 * W030 `performance` — the trading-world streaming seam for projection
 * coalescing (the W030 sim-side coalescer wired into the tool surfaces'
 * consumption path).
 *
 * - {@link "./coalescedProjectionStream.js"} — the stream: engine
 *   publications + clock views ingest into the pure sim coalescer; drains at
 *   observation points run each dirty feed's fetch EXACTLY ONCE.
 * - {@link "./coalescedSurfaceFeed.js"} — the per-surface feed state machine
 *   (the W009 controller laws: fail-closed unattached, honest errors,
 *   coalesced in-flight refreshes).
 * - {@link "./useCoalescedProjectionFeed.js"} — the React hooks (one stream
 *   per client identity; the pane wiring is a TL action item).
 */

export {
  createCoalescedProjectionStream,
  macrotaskScheduler,
  manualScheduler,
  type CoalescedDrainScheduler,
  type CoalescedProjectionStream,
  type CoalescedProjectionStreamInput,
  type CoalescedStreamMetrics,
} from "./coalescedProjectionStream.js";
export {
  createCoalescedSurfaceFeed,
  type CoalescedSurfaceFeedController,
  type FeedDriveInput,
} from "./coalescedSurfaceFeed.js";
export {
  useCoalescedProjectionFeed,
  useCoalescedProjectionStream,
  type CoalescedFeedHookInput,
  type CoalescedProjectionFeed,
  type CoalescedStreamHookInput,
} from "./useCoalescedProjectionFeed.js";
