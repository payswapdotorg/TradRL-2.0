/**
 * DOM / order-book tool surface — W009 (the ladder of the trader cockpit).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (the execution rail's
 * "Order Book / DOM" cell) and "Simulation disclosure" (persistent, text —
 * never color alone); spec/ARCHITECTURE-LOCK.md A6 (a projection of world
 * truth through the world-client seam — never authoritative); the W003
 * `OrderBookSnapshot` convention (bids descend, asks ascend around the
 * spread — validated, never re-sorted; see `./bookData.ts`).
 *
 * Data flow: the W006 world-client seam (`useTradingWorldClient`) provides
 * the four-port protocol; the surface projects `query.getOrderBook` into the
 * ladder (`./bookData.ts`: per-level price/size/order-count + exact
 * cumulative depth + spread/mid). Live updates run through the W018 engine
 * channels (`published` + `clock`) via the shared feed controller
 * (`./projectionFeed.ts`) — the generated market's makers requote as the
 * clock advances — with a poll fallback. EVERY state is honest:
 * - runtime `unattached` (fail-closed noop) → teaching state, no data;
 * - empty book (clock at origin — books legitimately start empty) → teaching
 *   state telling the user to advance the clock;
 * - query rejection → the typed error, visibly, with Retry;
 * - ready → the real levels, the engine's own canonical text verbatim.
 *
 * Mounted through the W006 tool registry: this component replaces the
 * order-book placeholder via `withSurfaceOverride` — see `./index.ts`.
 */

import type { ComponentType } from "react";

import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../components/PlaceholderToolSurface.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import {
  alphaInstrumentIdForWorld,
  buildDomLadderProjection,
  windowDomLadderSide,
  type DomLadderProjection,
  type DomLadderRow,
  type OrderBookInstrumentId,
} from "./bookData.js";
import { useTradingWorldProjectionFeed } from "./useProjectionFeed.js";
import {
  formatSimulationClockLabel,
  OrderBookSurfaceStatusBody,
} from "./OrderBookSurfaceStates.js";

/** Depth requested from `query.getOrderBook` (levels per side). */
export const DEFAULT_DOM_LADDER_DEPTH = 10;

/** Display window: ladder rows rendered per side (batching only). */
export const DEFAULT_DOM_LADDER_MAX_LEVELS = 10;

/** Poll fallback cadence (ms). 0 disables polling. */
export const DEFAULT_DOM_LADDER_POLL_MS = 2000;

/** Configuration for the DOM ladder surface component. */
export interface OrderBookToolSurfaceConfig {
  /**
   * Opaque instrument identity to project (query key, not a symbol). Defaults
   * to the alpha-world convention `instrument-es-${worldId}` (see
   * `alphaInstrumentIdForWorld`); W008 owns real instrument selection.
   */
  readonly instrumentId?: string;
  /** Levels per side requested from the engine (default 10). */
  readonly depth?: number;
  /** Ladder rows rendered per side (default 10). */
  readonly maxLevelsPerSide?: number;
  /** Poll fallback cadence in ms (default 2000; 0 disables). */
  readonly pollMs?: number;
}

export function createOrderBookToolSurface(
  config: OrderBookToolSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  const depth = config.depth ?? DEFAULT_DOM_LADDER_DEPTH;
  const maxLevelsPerSide = config.maxLevelsPerSide ?? DEFAULT_DOM_LADDER_MAX_LEVELS;
  const pollMs = config.pollMs ?? DEFAULT_DOM_LADDER_POLL_MS;

  function OrderBookToolSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    // Single branded-identity choke point (the W007 pattern): plain string in
    // (composition-friendly), the W003 InstrumentId brand at the port call.
    const instrumentId = (
      config.instrumentId === undefined
        ? alphaInstrumentIdForWorld(props.worldId)
        : (config.instrumentId as OrderBookInstrumentId)
    ) as OrderBookInstrumentId;

    const feed = useTradingWorldProjectionFeed<DomLadderProjection>({
      client,
      pollMs,
      fetch: async (current) => {
        // Fatal read: without the book snapshot there is no ladder. The
        // transform may throw OrderBookProjectionDataError — malformed data
        // is a visible error, never a guessed level.
        const snapshot = await current.query.getOrderBook(instrumentId, depth);
        const ladder = buildDomLadderProjection(snapshot);
        return ladder.levelCount === 0
          ? { status: "empty" }
          : { status: "ready", data: ladder };
      },
    });
    const state = feed.state;

    const askRows =
      state.status === "ready" ? windowDomLadderSide(state.data.asks, maxLevelsPerSide) : [];
    const bidRows =
      state.status === "ready" ? windowDomLadderSide(state.data.bids, maxLevelsPerSide) : [];
    // Asks render WORST→best (the snapshot's ascending array reversed for
    // display) so the best ask sits against the spread; bids render
    // best→worst (the snapshot's descending array as-is). The full price axis
    // descends top→bottom — the classic DOM ladder. No level is re-sorted,
    // renumbered or invented; the spread row sits between the real sides.
    const askDisplay = [...askRows].reverse();

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-dom-surface=""
        data-trading-world-dom-instrument={instrumentId}
        data-trading-world-dom-data-status={state.status}
        data-trading-world-dom-asks={askRows.length}
        data-trading-world-dom-bids={bidRows.length}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 px-2">
          <span className="truncate font-mono text-ui-xs text-foreground-subtle">
            {instrumentId}
          </span>
          <span
            data-trading-world-simulation-disclosure=""
            title="Simulation disclosure — this world has no live execution authority (World Alpha)"
            className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
          >
            {TRADING_WORLD_SIMULATED_DISCLOSURE}
          </span>
          {state.status === "ready" && state.data.spread !== undefined ? (
            <span
              data-trading-world-dom-spread={state.data.spread}
              title="Spread (best ask − best bid) and mid ((bid + ask) / 2), exact decimal arithmetic over the real top of book"
              className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
            >
              spread {state.data.spread} · mid {state.data.mid}
            </span>
          ) : null}
          {state.status === "ready" ? (
            <span
              data-trading-world-dom-asof={state.data.asOf}
              title="Simulation time of the book snapshot (the engine's own asOf; journal sequence follows)"
              className="ml-auto shrink-0 font-mono text-ui-xs text-foreground-subtlest"
            >
              {formatSimulationClockLabel(state.data.asOf)} · seq {state.data.sequence}
            </span>
          ) : null}
        </header>

        {state.status === "ready" ? (
          <div
            data-trading-world-dom-ladder=""
            aria-label="DOM ladder — resting order book levels"
            className="flex min-h-0 flex-1 flex-col overflow-y-auto font-mono text-ui-xs"
          >
            <div className="sticky top-0 z-10 grid shrink-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] gap-x-2 border-b border-border/50 bg-surface px-2 py-1 text-foreground-subtlest">
              <span>Price</span>
              <span>Size</span>
              <span>Orders</span>
              <span>Cum</span>
            </div>
            <div data-trading-world-dom-side="asks" aria-label="Ask levels (worst at top, best against the spread)">
              <p className="px-2 py-0.5 text-foreground-subtlest">ASKS</p>
              {askDisplay.map((row) => (
                <DomLadderRowView key={row.price} side="ask" row={row} />
              ))}
            </div>
            <div
              data-trading-world-dom-spread-row=""
              className="my-0.5 flex items-center justify-between border-y border-border/50 bg-surface px-2 py-1 text-foreground-subtlest"
              title="The spread between the real best bid and best ask"
            >
              <span>spread</span>
              <span data-trading-world-dom-spread-value="">
                {state.data.spread === undefined ? "—" : state.data.spread}
              </span>
            </div>
            <div data-trading-world-dom-side="bids" aria-label="Bid levels (best against the spread, worst below)">
              <p className="px-2 py-0.5 text-foreground-subtlest">BIDS</p>
              {bidRows.map((row) => (
                <DomLadderRowView key={row.price} side="bid" row={row} />
              ))}
            </div>
            <div
              data-trading-world-dom-totals=""
              className="mt-auto grid shrink-0 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] gap-x-2 border-t border-border/50 px-2 py-1 text-foreground-subtlest"
              title="Exact total resting quantity per side over the full snapshot (all levels, not just the window)"
            >
              <span>total</span>
              <span data-trading-world-dom-total-asks="">{state.data.asks.totalQuantity}</span>
              <span />
              <span data-trading-world-dom-total-bids="">{state.data.bids.totalQuantity}</span>
            </div>
          </div>
        ) : (
          <OrderBookSurfaceStatusBody
            state={state}
            stateAttr="data-trading-world-dom-state"
            emptyTitle="No resting liquidity in this world yet"
            emptyBody="Play or step the simulation clock (the strip below the cockpit) — the market makers quote and the ladder fills with real resting orders as the world's clock advances. No level is drawn without a real book snapshot."
            onRetry={feed.refresh}
          />
        )}

        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Order book surface mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return OrderBookToolSurface;
}

/** The default DOM ladder surface (single-instrument World Alpha projection). */
export const OrderBookToolSurface = createOrderBookToolSurface();

/** One ladder row (price · size · order count · cumulative depth). */
function DomLadderRowView({
  side,
  row,
}: {
  readonly side: "bid" | "ask";
  readonly row: DomLadderRow;
}) {
  return (
    <div
      data-trading-world-dom-row={side}
      data-dom-price={row.price}
      data-dom-quantity={row.quantity}
      data-dom-cumulative={row.cumulative}
      {...(row.orderCount === undefined ? {} : { "data-dom-orders": row.orderCount })}
      title={`Resting ${side} liquidity at ${row.price} — size ${row.quantity}, cumulative depth ${row.cumulative} from the top of book`}
      className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1fr)] gap-x-2 px-2 py-0.5 text-foreground"
    >
      <span className="truncate">{row.price}</span>
      <span className="truncate text-right">{row.quantity}</span>
      <span className="truncate text-right text-foreground-subtle">
        {row.orderCount === undefined ? "—" : row.orderCount}
      </span>
      <span className="truncate text-right text-foreground-subtle">{row.cumulative}</span>
    </div>
  );
}
