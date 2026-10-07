/**
 * Watchlist surface state shapes + honest status bodies — W008.
 *
 * Split out of `./WatchlistToolSurface.tsx` (repo lint law: ≤400 code lines
 * per file) following the W007 `ChartSurfaceStates.tsx` pattern: the state
 * union the surface renders over, and the non-table bodies it renders
 * INSTEAD of quote rows when the world data is not available. Every body is
 * an honest disclosure (ACCEPTANCE-WORLD-ALPHA K, ARCHITECTURE-LOCK A6) —
 * no state ever shows a market fact it does not have.
 */

import { Button } from "@/components/ui/button.js";

import type { WatchlistProjectionSnapshot } from "./watchlistProjection.js";

/**
 * The body rendered instead of the quote table for every non-ready state.
 * (`ready` renders the table itself in WatchlistToolSurface.)
 */
export function WatchlistSurfaceStatusBody({
  snapshot,
  onRetry,
}: {
  readonly snapshot: WatchlistProjectionSnapshot;
  readonly onRetry: () => void;
}) {
  if (snapshot.status === "unattached") {
    return (
      <WatchlistNotice
        stateId="unattached"
        title="No world runtime attached"
        body="The watchlist renders real market data only. Until a world engine attaches through the W018 transport, no instruments, quotes or regimes are shown — never sample or placeholder prices."
      />
    );
  }
  if (snapshot.status === "loading") {
    return <WatchlistNotice stateId="loading" title="Loading world market data…" body="" />;
  }
  if (snapshot.status === "ready") {
    // The surface renders the quote table itself for ready snapshots; this
    // body is only mounted for the non-ready states.
    return null;
  }
  return (
    <div
      data-trading-world-watchlist-state="error"
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">Market data unavailable</p>
      <p className="max-w-[24rem] break-words font-mono text-ui-xs text-foreground-subtle">
        {snapshot.message}
      </p>
      <p className="max-w-[24rem] text-ui-xs text-foreground-subtlest">
        The watchlist never substitutes, estimates or caches market facts — a failed read stays
        an honest failure (fail-closed, never stale fake data).
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function WatchlistNotice({
  stateId,
  title,
  body,
}: {
  readonly stateId: string;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div
      data-trading-world-watchlist-state={stateId}
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">{title}</p>
      {body.length > 0 ? (
        <p className="max-w-[24rem] text-ui-xs text-foreground-subtle">{body}</p>
      ) : null}
    </div>
  );
}
