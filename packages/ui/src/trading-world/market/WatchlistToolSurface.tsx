/**
 * Watchlist tool surface — W008 (the trader's market overview of the
 * Trading World cockpit).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (Watchlist cell of the
 * left column: live market overview of the world's instruments) and
 * "Simulation disclosure" (persistent, text — never color alone);
 * spec/ARCHITECTURE-LOCK.md A6 (a projection of world truth through the
 * world-client seam — never authoritative); spec/WORLD-PROTOCOL.md "UI
 * projection law" (may batch/conflate; may never fabricate financial
 * facts).
 *
 * Data flow: the W006 world-client seam (`useTradingWorldClient`) provides
 * the four-port protocol; the framework-free controller
 * (`./watchlistProjection.ts`) fetches `query.getWorldMeta` (world identity
 * + declared regime schedule), `query.getTimeline` (announced
 * `market.regime.changed` transitions + instrument discovery),
 * `query.getInstrument` + `query.getQuote` (per-instrument quote rows) and
 * `clock.getClock` (the world's simulation clock), and keeps them LIVE
 * through the W018 push channels (`onPublished` + `onClock`) with a
 * polling fallback. EVERY state is honest:
 * - runtime `unattached` (fail-closed noop provider) → teaching state;
 * - clock at the world origin → quote-less rows (empty books shown empty);
 * - per-instrument rejection → that row's typed error (one bad instrument
 *   never blanks the list);
 * - fatal read / transport death → the typed error state (fail-closed,
 *   never stale fake data).
 *
 * Mounted through the W006 tool registry: this component replaces the
 * watchlist placeholder via `withSurfaceOverride("watchlist", …)` — see
 * `./index.ts`.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { ComponentType } from "react";

import { cn } from "@/components/lib/utils.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../components/PlaceholderToolSurface.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import {
  formatSimulationTimestampMs,
  nextScheduledRegimeChange,
  scheduledRegimeAt,
  type MarketInstrumentId,
  type MarketRegimeInForce,
  type WatchlistRow,
} from "./marketData.js";
import {
  createWatchlistProjectionController,
  seamClientHasPushChannels,
  type WatchlistProjectionSnapshot,
} from "./watchlistProjection.js";
import { WatchlistSurfaceStatusBody } from "./WatchlistSurfaceStates.js";

/**
 * Default instruments the watchlist projects. The production World Alpha
 * pane is worldId "alpha" (useAppPanels wiring) and the alpha world
 * declares one ES-like instrument with the id `instrument-es-<worldId>`
 * (`../runtime/engineAttachment.ts`) — the REAL World Alpha instrument id,
 * not a guess. Composition can bind any set (`createWatchlistToolSurface`);
 * journal discovery merges in instruments the world actually quotes/trades.
 */
export const DEFAULT_WATCHLIST_INSTRUMENT_IDS: readonly string[] = [
  "instrument-es-alpha",
];

/** Default projection refresh cadence for the polling fallback (ms). */
export const DEFAULT_WATCHLIST_POLL_MS = 2000;

/** Configuration for the watchlist surface component. */
export interface WatchlistToolSurfaceConfig {
  /**
   * Opaque instrument identities to project (query keys, not symbols) —
   * the watchlist's configured rows, in composition order.
   */
  readonly instrumentIds?: readonly string[];
  /** Merge instruments observed in the world's journal into the rows. */
  readonly discoveryEnabled?: boolean;
  /** Polling fallback cadence in ms; 0 disables (default 2000). */
  readonly pollMs?: number;
}

export function createWatchlistToolSurface(
  config: WatchlistToolSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  // Frozen at factory time (the W007 composition pattern): plain strings in,
  // branded identity at the port call sites only.
  const instrumentIds = (config.instrumentIds ?? DEFAULT_WATCHLIST_INSTRUMENT_IDS).map(
    (id) => id as MarketInstrumentId,
  );
  const discoveryEnabled = config.discoveryEnabled ?? true;
  const pollMs = config.pollMs ?? DEFAULT_WATCHLIST_POLL_MS;

  function WatchlistToolSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    const controller = useMemo(
      () =>
        createWatchlistProjectionController({
          client,
          instrumentIds,
          discoveryEnabled,
          pollMs,
        }),
      // One controller per seam client; the config is frozen at factory time.
      [client],
    );
    useEffect(() => {
      controller.start();
      return () => controller.stop();
    }, [controller]);
    const snapshot = useSyncExternalStore(
      controller.subscribe,
      controller.getSnapshot,
      controller.getServerSnapshot,
    );

    const rows = snapshot.status === "ready" ? snapshot.rows : [];
    const rowLabel =
      snapshot.status === "ready"
        ? `${rows.length} instrument${rows.length === 1 ? "" : "s"}`
        : "—";
    const live = client.status === "ready" && seamClientHasPushChannels(client);

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-watchlist-surface=""
        data-trading-world-watchlist-status={snapshot.status}
        data-trading-world-watchlist-rows={rows.length}
        data-trading-world-watchlist-discovery={discoveryEnabled ? "true" : "false"}
        data-trading-world-watchlist-live={live ? "push" : client.status === "ready" ? "poll" : "none"}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 px-2">
          <span className="shrink-0 font-mono text-ui-xs text-foreground-subtle">
            {rowLabel}
          </span>
          <span
            data-trading-world-simulation-disclosure=""
            title="Simulation disclosure — this world has no live execution authority (World Alpha)"
            className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
          >
            {TRADING_WORLD_SIMULATED_DISCLOSURE}
          </span>
          <WatchlistHeaderChips snapshot={snapshot} />
          <span
            data-trading-world-watchlist-live-indicator=""
            title={
              live
                ? "Live through the W018 push channels (published + clock)"
                : "Polling fallback (no push channels on this client)"
            }
            className={cn(
              "ml-auto shrink-0 font-mono text-ui-xs",
              live ? "text-foreground-subtlest" : "text-foreground-subtle",
            )}
          >
            {live ? "live · push" : "live · poll"}
          </span>
        </header>

        {snapshot.status === "ready" ? (
          <WatchlistTable rows={rows} />
        ) : (
          <WatchlistSurfaceStatusBody
            snapshot={snapshot}
            onRetry={() => {
              void controller.refresh();
            }}
          />
        )}

        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Watchlist surface mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return WatchlistToolSurface;
}

/** Header context chips: engine, regime in force, next scheduled change, clock. */
function WatchlistHeaderChips({
  snapshot,
}: {
  readonly snapshot: WatchlistProjectionSnapshot;
}) {
  if (snapshot.status !== "ready") {
    return null;
  }
  const { world, clock } = snapshot;
  const worldAnnounced = snapshot.announcements.filter(
    (announcement) => announcement.instrumentId === undefined,
  );
  const lastAnnounced = worldAnnounced[worldAnnounced.length - 1];
  const schedule = world.regimeSchedule;
  const at = clock?.simulationTime;
  const scheduled = at === undefined ? undefined : scheduledRegimeAt(schedule, at);
  const next = at === undefined ? undefined : nextScheduledRegimeChange(schedule, at);
  const regimeChip =
    lastAnnounced === undefined
      ? scheduled === undefined
        ? undefined
        : {
            kind: "scheduled" as const,
            label: `regime ${scheduled.regime} (scheduled)`,
            title: `Declared regime schedule (getWorldMeta): ${scheduled.regime} covers the clock position; the journal has not announced a transition yet.`,
          }
      : {
          kind: "announced" as const,
          label: `regime ${lastAnnounced.to}`,
          title: `Announced ${formatSimulationTimestampMs(lastAnnounced.at)} (market.regime.changed)${
            lastAnnounced.from === undefined ? " · from the world origin" : ` · from ${lastAnnounced.from}`
          }`,
        };
  const nextChip =
    next === undefined
      ? undefined
      : {
          label: `next ${next.entry.regime} @ ${formatSimulationTimestampMs(next.at)}`,
          title: `Next scheduled regime boundary after the clock position (declared schedule, getWorldMeta).`,
        };
  const clockChip =
    clock === undefined
      ? undefined
      : {
          label: `${formatSimulationTimestampMs(clock.simulationTime)} · ${
            clock.status === "playing" ? `playing ${clock.speed}×` : "paused"
          }`,
          title: `Simulation clock (W004): the watchlist's as-of axis is world time${
            snapshot.clockError === undefined ? "" : ` — clock read error: ${snapshot.clockError}`
          }`,
        };
  return (
    <>
      <span
        data-trading-world-watchlist-engine=""
        title={`World engine identity (query.getWorldMeta): ${world.engine}@${world.engineVersion} · mode ${world.mode} · execution ${world.executionAuthority}`}
        className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
      >
        {world.engine} · {world.mode}
      </span>
      {regimeChip === undefined ? null : (
        <span
          data-trading-world-watchlist-regime=""
          data-trading-world-watchlist-regime-kind={regimeChip.kind}
          title={regimeChip.title}
          className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
        >
          {regimeChip.label}
        </span>
      )}
      {nextChip === undefined ? null : (
        <span
          data-trading-world-watchlist-next-regime=""
          title={nextChip.title}
          className="hidden shrink-0 font-mono text-ui-xs text-foreground-subtlest md:inline"
        >
          {nextChip.label}
        </span>
      )}
      {clockChip === undefined ? null : (
        <span
          data-trading-world-watchlist-clock=""
          data-trading-world-watchlist-clock-status={clock?.status ?? "unavailable"}
          title={clockChip.title}
          className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
        >
          {clockChip.label}
        </span>
      )}
      {snapshot.timelineError === undefined ? null : (
        <span
          data-trading-world-watchlist-timeline-error=""
          title={`The timeline read rejected: ${snapshot.timelineError}`}
          className="shrink-0 font-mono text-ui-xs text-foreground-subtle"
        >
          timeline: {snapshot.timelineError}
        </span>
      )}
    </>
  );
}

/** The quote-row table (rendered only for a ready snapshot). */
function WatchlistTable({
  rows,
}: {
  readonly rows: readonly WatchlistRow[];
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        data-trading-world-watchlist-head=""
        className="grid shrink-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.2fr)] gap-1 border-b border-border/50 px-2 py-1 font-mono text-ui-xs text-foreground-subtlest"
      >
        <span>Symbol</span>
        <span className="text-right">Bid</span>
        <span className="text-right">Size</span>
        <span className="text-right">Ask</span>
        <span className="text-right">Size</span>
        <span className="text-right">Last</span>
        <span>Regime</span>
        <span>State</span>
        <span className="text-right">As of</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p
            data-trading-world-watchlist-state="empty"
            className="px-3 py-6 text-center text-ui-xs text-foreground-subtle"
          >
            No instruments in this world's market yet. Play or step the simulation clock (the
            strip below the cockpit) — quote rows appear as the world's market quotes and trades.
            Nothing is shown without real world data.
          </p>
        ) : (
          rows.map((row) => (
            <WatchlistRowLine key={row.instrumentId} row={row} />
          ))
        )}
      </div>
    </div>
  );
}

function WatchlistRowLine({ row }: { readonly row: WatchlistRow }) {
  const quote = row.quote;
  const regime = row.regime;
  const rowError =
    row.quoteError !== undefined
      ? row.quoteError
      : row.instrumentError !== undefined
        ? row.instrumentError
        : undefined;
  return (
    <div
      data-trading-world-watchlist-row={row.instrumentId}
      data-trading-world-watchlist-row-source={row.source}
      data-trading-world-watchlist-row-status={rowError === undefined ? "ready" : "error"}
      title={
        rowError !== undefined
          ? `${row.instrumentId} — ${rowError}`
          : `${row.instrumentId} · ${row.instrument?.symbol ?? ""} @ ${row.instrument?.venueId ?? "?"} (query.getQuote as of ${quote?.asOf ?? "?"})`
      }
      className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.2fr)] items-baseline gap-1 border-b border-border/25 px-2 py-1 font-mono text-ui-xs text-foreground-subtle"
    >
      <span className="truncate">
        {row.instrument?.symbol ?? (
          <span data-trading-world-watchlist-symbol-missing="true">—</span>
        )}
        <span className="ml-1 text-foreground-subtlest">
          {row.source === "discovered" ? "·" : ""}
        </span>
      </span>
      <QuoteCell value={quote?.bid} dataName="bid" />
      <QuoteCell value={quote?.bidSize} dataName="bid-size" />
      <QuoteCell value={quote?.ask} dataName="ask" />
      <QuoteCell value={quote?.askSize} dataName="ask-size" />
      <QuoteCell value={quote?.last} dataName="last" strong />
      <span
        data-trading-world-watchlist-regime=""
        data-trading-world-watchlist-regime-kind={regime === undefined ? "none" : regime.kind}
        title={
          regime === undefined
            ? "No announced transition and no scheduled entry covers the clock position (honest absence)"
            : regime.kind === "announced"
              ? `Announced ${formatSimulationTimestampMs(regime.announcement.at)} (market.regime.changed)${
                  regime.announcement.from === undefined
                    ? " · from the world origin"
                    : ` · from ${regime.announcement.from}`
                }`
              : `Scheduled (declared regime schedule, getWorldMeta): ${regime.entry.regime} covers the clock position; the journal has not announced a transition yet.`
        }
      >
        {regime === undefined ? "—" : `${regimeKindText(regime.kind)} ${regimeName(regime)}`}
      </span>
      <span
        data-trading-world-watchlist-state-cell=""
        title={`Instrument trading state (query.getInstrument): ${row.instrument?.tradingState ?? "?"}${row.instrument?.tradable === false ? " · not tradable" : ""}`}
      >
        {row.instrument?.tradingState ?? "—"}
      </span>
      <span
        className="text-right text-foreground-subtlest"
        data-trading-world-watchlist-asof=""
        title={quote === undefined ? "No quote projection (the read rejected)" : `Quote observation time (simulation clock)`}
      >
        {quote === undefined ? "—" : formatSimulationTimestampMs(quote.asOf).slice(11)}
      </span>
    </div>
  );
}

function regimeKindText(kind: "announced" | "scheduled"): string {
  return kind === "announced" ? "ann." : "sched.";
}

function regimeName(regime: MarketRegimeInForce): string {
  return regime.kind === "announced" ? regime.announcement.to : regime.entry.regime;
}

function QuoteCell({
  value,
  dataName,
  strong,
}: {
  readonly value: string | undefined;
  readonly dataName: string;
  readonly strong?: boolean;
}) {
  return (
    <span
      data-trading-world-watchlist-quote={dataName}
      data-trading-world-watchlist-quote-empty={value === undefined ? "true" : "false"}
      title={value === undefined ? "No value in the projection (empty book / empty side) — never zero-invented" : value}
      className={cn(
        "text-right",
        value === undefined ? "text-foreground-subtlest" : strong ? "text-foreground" : undefined,
      )}
    >
      {value ?? "—"}
    </span>
  );
}

/** The default watchlist surface (World Alpha single-instrument projection). */
export const WatchlistToolSurface = createWatchlistToolSurface();
