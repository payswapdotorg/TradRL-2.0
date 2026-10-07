/**
 * Time & Sales tool surface — W009 (the trade tape of the trader cockpit).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (the focus column's "Time
 * & Sales" cell — chronological trade prints: time/price/size/side) and
 * "Simulation disclosure" (persistent, text — never color alone);
 * spec/ARCHITECTURE-LOCK.md A6 (a projection of world truth through the
 * world-client seam — never authoritative); the W004 availableAt firewall is
 * applied engine-side (`getTrades` only returns observable prints).
 *
 * Data flow: the W006 world-client seam (`useTradingWorldClient`) provides
 * the four-port protocol; the surface projects `query.getTrades` into the
 * tape (`./tapeData.ts`: the prints in journal order — the projection's order
 * is the truth — displayed newest-first, each row keeping its true journal
 * sequence, never re-sorted client-side). Live updates run through the W018
 * engine channels (`published` + `clock`) via the shared feed controller with
 * a poll fallback. EVERY state is honest: unattached runtime → teaching
 * state; no prints yet (clock at origin) → teaching state; query rejection →
 * the typed error, visibly, with Retry; ready → the real prints, the engine's
 * own canonical text verbatim. No print is ever invented, interpolated or
 * renumbered.
 *
 * Mounted through the W006 tool registry: this component replaces the
 * time-and-sales placeholder via `withSurfaceOverride` — see `./index.ts`.
 */

import type { ComponentType } from "react";

import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../components/PlaceholderToolSurface.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import { alphaInstrumentIdForWorld, type OrderBookInstrumentId } from "./bookData.js";
import {
  buildTimeAndSalesProjection,
  describeAggressorSide,
  formatTapeTimestampMs,
  type TapeProjection,
  type TapeRow,
} from "./tapeData.js";
import { useTradingWorldProjectionFeed } from "./useProjectionFeed.js";
import { OrderBookSurfaceStatusBody } from "./OrderBookSurfaceStates.js";

/** Display window: tape rows rendered (the most recent prints). */
export const DEFAULT_TAPE_MAX_ROWS = 50;

/** Poll fallback cadence (ms). 0 disables polling. */
export const DEFAULT_TAPE_POLL_MS = 2000;

/** Configuration for the Time & Sales surface component. */
export interface TimeAndSalesToolSurfaceConfig {
  /**
   * Opaque instrument identity to project (query key). Defaults to the
   * alpha-world convention `instrument-es-${worldId}` (see
   * `alphaInstrumentIdForWorld`); W008 owns real instrument selection.
   */
  readonly instrumentId?: string;
  /** Most-recent prints rendered (default 50). */
  readonly maxRows?: number;
  /** Poll fallback cadence in ms (default 2000; 0 disables). */
  readonly pollMs?: number;
}

export function createTimeAndSalesToolSurface(
  config: TimeAndSalesToolSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  const maxRows = config.maxRows ?? DEFAULT_TAPE_MAX_ROWS;
  const pollMs = config.pollMs ?? DEFAULT_TAPE_POLL_MS;

  function TimeAndSalesToolSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    const instrumentId = (
      config.instrumentId === undefined
        ? alphaInstrumentIdForWorld(props.worldId)
        : (config.instrumentId as OrderBookInstrumentId)
    ) as OrderBookInstrumentId;

    const feed = useTradingWorldProjectionFeed<TapeProjection>({
      client,
      pollMs,
      fetch: async (current) => {
        // Fatal read: without the trade projection there is no tape. The full
        // projection is read (no `limit` — the port slices from the OLDEST
        // prints, which would show a stale tape head; `./tapeData.ts` windows
        // the most recent rows instead). Malformed data is a visible typed
        // error, never a guessed print.
        const trades = await current.query.getTrades(instrumentId);
        const tape = buildTimeAndSalesProjection(trades, { maxRows });
        return tape.totalPrints === 0
          ? { status: "empty" }
          : { status: "ready", data: tape };
      },
    });
    const state = feed.state;
    const rows = state.status === "ready" ? state.data.rows : [];

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-tape-surface=""
        data-trading-world-tape-instrument={instrumentId}
        data-trading-world-tape-data-status={state.status}
        data-trading-world-tape-rows={rows.length}
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
          {state.status === "ready" ? (
            <span
              data-trading-world-tape-prints={state.data.totalPrints}
              title="The engine's full trade tape for this instrument (journal sequence range of the projection; the newest print's price)"
              className="ml-auto shrink-0 font-mono text-ui-xs text-foreground-subtlest"
            >
              {state.data.totalPrints} prints · seq {state.data.fromSequence ?? "—"}→
              {state.data.toSequence ?? "—"} · last {state.data.lastPrice ?? "—"}
            </span>
          ) : null}
        </header>

        {state.status === "ready" ? (
          <div
            data-trading-world-tape=""
            aria-label="Time & Sales — chronological trade prints, newest first"
            className="flex min-h-0 flex-1 flex-col overflow-y-auto font-mono text-ui-xs"
          >
            <div className="sticky top-0 z-10 grid shrink-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-x-2 border-b border-border/50 bg-surface px-2 py-1 text-foreground-subtlest">
              <span>Time</span>
              <span>Price</span>
              <span>Size</span>
              <span>Side</span>
            </div>
            {rows.map((row) => (
              <TapeRowView key={row.tradeId} row={row} />
            ))}
          </div>
        ) : (
          <OrderBookSurfaceStatusBody
            state={state}
            stateAttr="data-trading-world-tape-state"
            emptyTitle="No trades printed in this world yet"
            emptyBody="Play or step the simulation clock (the strip below the cockpit) — prints appear here as the world's aggressive side executes against the makers' resting liquidity. No print is shown without a real trade."
            onRetry={feed.refresh}
          />
        )}

        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Time &amp; Sales surface mounted in background — state kept alive while hidden
            (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return TimeAndSalesToolSurface;
}

/** One tape print (time · price · size · side), the projection verbatim. */
function TapeRowView({ row }: { readonly row: TapeRow }) {
  const side = describeAggressorSide(row.aggressorSide);
  return (
    <div
      data-trading-world-tape-row=""
      data-tape-sequence={row.sequence}
      data-tape-aggressor={row.aggressorSide}
      data-tape-price={row.price}
      data-tape-quantity={row.quantity}
      title={`Trade ${row.tradeId} · journal sequence ${row.sequence} · aggressor ${side}`}
      className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)] gap-x-2 px-2 py-0.5 text-foreground"
    >
      <span className="truncate text-foreground-subtle">{formatTapeTimestampMs(row.occurredAt)}</span>
      <span className="truncate">{row.price}</span>
      <span className="truncate text-right">{row.quantity}</span>
      {/* Side is stated as text — never color alone (UX-DESIGN). */}
      <span className="truncate text-right" data-tape-side-label={side}>
        {side}
      </span>
    </div>
  );
}

/** The default Time & Sales surface (single-instrument World Alpha projection). */
export const TimeAndSalesToolSurface = createTimeAndSalesToolSurface();
