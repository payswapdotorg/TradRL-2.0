/**
 * Order-book surface state shapes + honest status bodies — W009.
 *
 * The non-ladder/non-tape bodies both W009 surfaces render instead of data
 * (the W007 `ChartSurfaceStates` pattern, split for the repo's ≤400-code-line
 * law). Every body is an honest disclosure (ACCEPTANCE-WORLD-ALPHA K,
 * ARCHITECTURE-LOCK A6): no state ever draws or implies market facts it does
 * not have — the teaching states say WHY there is nothing to show (runtime
 * not attached / clock at origin / no prints yet), and a failed read stays a
 * visible typed failure with a Retry, never a substitution.
 */

import { Button } from "@/components/ui/button.js";

import type { TradingWorldProjectionFeedState } from "./projectionFeed.js";

/** The feed-state alias both W009 surfaces render over. */
export type OrderBookSurfaceDataState<T> = TradingWorldProjectionFeedState<T>;

/** Simulation-time label: deterministic UTC date-time, no locale (W007 law). */
export function formatSimulationClockLabel(simulationMs: number): string {
  const date = new Date(simulationMs);
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
  );
}

/** Props for the shared status body (the `ready` state renders data instead). */
export interface OrderBookSurfaceStatusBodyProps<T> {
  /** The surface's feed state (only non-`ready` states render a body). */
  readonly state: OrderBookSurfaceDataState<T>;
  /** Data attribute carrying the state id in the DOM (test/E2E evidence). */
  readonly stateAttr: string;
  /** Copy for the legitimately-empty world view (books/tape empty at origin). */
  readonly emptyTitle: string;
  readonly emptyBody: string;
  /** Retry handler (the error state's only action). */
  readonly onRetry: () => void;
}

/**
 * The body rendered instead of the ladder/tape for every non-ready state.
 * `unattached`/`loading`/`empty` are teaching states; `error` shows the typed
 * failure (the remote error class when the W018 provider reconstructed one).
 */
export function OrderBookSurfaceStatusBody<T>({
  state,
  stateAttr,
  emptyTitle,
  emptyBody,
  onRetry,
}: OrderBookSurfaceStatusBodyProps<T>) {
  if (state.status === "unattached") {
    return (
      <OrderBookNotice
        stateAttr={stateAttr}
        stateId="unattached"
        title="No world runtime attached"
        body="The ladder and tape render real market data only. The deterministic world engine (W013) and its UI transport (W018) are not attached yet — no book levels or trade prints are shown."
      />
    );
  }
  if (state.status === "loading") {
    return (
      <OrderBookNotice stateAttr={stateAttr} stateId="loading" title="Loading world market data…" body="" />
    );
  }
  if (state.status === "error") {
    return (
      <div
        {...{ [stateAttr]: "error" }}
        className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
      >
        <p className="text-ui-sm font-medium text-foreground">Market data unavailable</p>
        <p className="max-w-[24rem] break-words font-mono text-ui-xs text-foreground-subtle">
          {state.remoteName === undefined ? "" : `${state.remoteName}: `}
          {state.message}
        </p>
        <p className="max-w-[24rem] text-ui-xs text-foreground-subtlest">
          The surface never substitutes, estimates or caches market facts — a failed read stays
          an honest failure.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <OrderBookNotice
      stateAttr={stateAttr}
      stateId="empty"
      title={emptyTitle}
      body={emptyBody}
    />
  );
}

function OrderBookNotice({
  stateAttr,
  stateId,
  title,
  body,
}: {
  readonly stateAttr: string;
  readonly stateId: string;
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div
      {...{ [stateAttr]: stateId }}
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">{title}</p>
      {body.length > 0 ? (
        <p className="max-w-[24rem] text-ui-xs text-foreground-subtle">{body}</p>
      ) : null}
    </div>
  );
}
