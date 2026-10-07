/**
 * Positions tool surface — W011 (the trader's open positions).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (Positions cell) and
 * "Core World Alpha tools"; spec/WORK-ITEMS.md W011 ("positions — per
 * instrument: signed quantity, entry/reference, mark, unrealized P&L in
 * exact decimal text").
 *
 * EVERY FIGURE IS THE ENGINE'S OWN (A6 / the UI projection law): rows are
 * the REAL `query.getPositions(accountId)` projection — signed quantities,
 * average entry, mark, exact-decimal unrealized/realized P&L — refreshed by
 * engine publications (the generated market's fills and trade prints MOVE
 * THE MARKS, so unrealized P&L moves with the market), settled clock views
 * and an honest poll fallback. A FLAT BOOK IS HONEST: no positions means
 * the flat teaching body, never fabricated zero rows.
 *
 * CLOSE issues the REAL `command.closePosition` (typed outcome: ack cursor
 * or typed rejection code — never swallowed) and the feed refreshes from
 * the engine's own projection on the next publication.
 */

import { useCallback, useMemo, useState } from "react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import { derivePositionRows, type PositionRowModel } from "./portfolioData.js";
import { positionNotionalText, totalUnrealizedUnitsOf } from "./riskCards.js";
import { formatMoneyUnits } from "./decimalText.js";
import {
  alphaTraderPortfolioIdentity,
  buildClosePositionCommand,
  describePortfolioCommandError,
  describePortfolioCommandOutcome,
  newPortfolioCommandId,
  resolvePortfolioIdentity,
  type PortfolioCommandOutcomeCapsule,
  type PortfolioIdentitySpec,
} from "./portfolioIdentity.js";
import { usePortfolioProjectionFeed } from "./usePortfolioProjection.js";
import {
  DEFAULT_PORTFOLIO_POLL_MS,
  formatPortfolioTime,
  PortfolioSurfaceErrorBody,
  PortfolioSurfaceHeader,
  PortfolioSurfaceNotice,
  usePortfolioClockView,
} from "./PortfolioSurfaceStates.js";

/** Configuration for the positions surface component. */
export interface PositionsToolSurfaceConfig {
  /** The trader whose positions are projected (default: alpha convention). */
  readonly identity?: PortfolioIdentitySpec;
  /** Projection refresh cadence fallback (default 2000). */
  readonly pollMs?: number;
}

export function createPositionsToolSurface(
  config: PositionsToolSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  const identitySpec: PortfolioIdentitySpec = config.identity ?? alphaTraderPortfolioIdentity;
  const pollMs = config.pollMs ?? DEFAULT_PORTFOLIO_POLL_MS;

  function PositionsToolSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    const identity = useMemo(
      () => resolvePortfolioIdentity(identitySpec, props.worldId),
      [props.worldId],
    );
    const clockView = usePortfolioClockView(client, pollMs);
    const feed = usePortfolioProjectionFeed({
      client,
      accountId: identity.accountId,
      pollMs,
    });
    const [rowOutcomes, setRowOutcomes] = useState<Record<string, PortfolioCommandOutcomeCapsule>>({});
    const [acting, setActing] = useState(false);

    const rows = useMemo(
      () =>
        feed.state.status === "ready"
          ? derivePositionRows(feed.state.snapshot.positions)
          : [],
      [feed.state],
    );
    const totalUnrealized = useMemo(
      () =>
        feed.state.status === "ready"
          ? formatMoneyUnits(totalUnrealizedUnitsOf(feed.state.snapshot.positions))
          : "0",
      [feed.state],
    );

    const recordOutcome = useCallback(
      (instrumentId: string, capsule: PortfolioCommandOutcomeCapsule): void => {
        setRowOutcomes((previous) => ({ ...previous, [instrumentId]: capsule }));
      },
      [],
    );

    const handleClose = useCallback(
      async (row: PositionRowModel) => {
        if (acting) {
          return;
        }
        setActing(true);
        const instrumentId = row.position.instrumentId;
        try {
          let issuedAt = clockView?.simulationTime;
          if (issuedAt === undefined) {
            // Honest fallback: read the engine's own clock (the commands'
            // issuedAt domain); a failure surfaces as a typed error capsule.
            const view = await client.clock.getClock();
            issuedAt = view.simulationTime;
          }
          const result = await client.command.closePosition(
            buildClosePositionCommand({
              identity,
              worldId: props.worldId,
              instrumentId,
              commandId: newPortfolioCommandId("close"),
              issuedAt,
            }),
          );
          recordOutcome(instrumentId, describePortfolioCommandOutcome(result));
        } catch (error) {
          recordOutcome(instrumentId, describePortfolioCommandError(error));
        } finally {
          setActing(false);
        }
      },
      [acting, client, clockView, identity, props.worldId, recordOutcome],
    );

    const state = feed.state;

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-positions=""
        data-trading-world-positions-data-status={
          state.status === "ready" && rows.length === 0 ? "flat" : state.status
        }
        data-trading-world-positions-account={identity.accountId}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <PortfolioSurfaceHeader
          toolId={props.toolId}
          accountId={identity.accountId}
          clock={clockView}
        />
        {state.status === "unattached" ? (
          <PortfolioSurfaceNotice
            stateId="unattached"
            title="No world runtime attached"
            body="The positions surface renders the real getPositions projection of the authoritative financial state — nothing is shown without an attached engine (no fabricated positions)."
          />
        ) : null}
        {state.status === "loading" ? (
          <PortfolioSurfaceNotice stateId="loading" title="Loading position projection…" body="" />
        ) : null}
        {state.status === "error" ? (
          <PortfolioSurfaceErrorBody
            message={state.message}
            {...("remoteName" in state && state.remoteName !== undefined
              ? { remoteName: state.remoteName }
              : {})}
            onRetry={() => feed.refresh()}
          />
        ) : null}
        {state.status === "ready" && rows.length === 0 ? (
          <PortfolioSurfaceNotice
            stateId="flat"
            title="Flat — no open positions"
            body="This account holds no open positions in this world (a flat book is the honest projection). Submit an order from the Order Ticket — every fill opens a position here, live from the engine's own ledger."
          />
        ) : null}
        {state.status === "ready" && rows.length > 0 ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2 py-1">
              <span className="font-mono text-ui-xs text-foreground-subtle">
                {String(rows.length)} open
              </span>
              <span
                data-trading-world-positions-total-unrealized={totalUnrealized}
                title="Exact fold of the projected per-position unrealized P&L (canonical decimal text)"
                className="ml-auto font-mono text-ui-xs text-foreground"
              >
                Σ unrealized {totalUnrealized}{" "}
                {state.snapshot.portfolio.unrealizedPnl.currency}
              </span>
            </div>
            <ul
              data-trading-world-positions-rows=""
              className="flex min-h-0 flex-1 flex-col divide-y divide-border/40 overflow-y-auto"
            >
              {rows.map((row) => (
                <li
                  key={`${row.position.accountId}:${row.position.instrumentId}`}
                  data-trading-world-position-row={row.position.instrumentId}
                  data-trading-world-position-side={row.side}
                  className="flex shrink-0 flex-col gap-0.5 px-2 py-1.5"
                  title={`opened ${formatPortfolioTime(row.openedAtMs)} · updated ${formatPortfolioTime(row.updatedAtMs)} · accountId ${row.position.accountId}`}
                >
                  <div className="flex items-center gap-2 font-mono text-ui-xs">
                    <span className="font-medium text-foreground">
                      {row.position.instrumentId}
                    </span>
                    <span
                      data-trading-world-position-side-badge=""
                      className="rounded-sm border border-border bg-surface px-1 text-foreground-subtle"
                    >
                      {row.side}
                    </span>
                    <span className="ml-auto text-foreground-subtle">
                      qty {row.quantityText}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-ui-xs text-foreground-subtle">
                    <span title="volume-weighted average entry price">
                      entry {row.entryText}
                    </span>
                    <span title="last printed trade price (mark)">
                      mark {row.markText ?? "—"}
                    </span>
                    <span title="|quantity| × mark (exact)">
                      notional {positionNotionalText(row.position)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-ui-xs">
                    <span
                      data-trading-world-position-unrealized={row.unrealizedText}
                      title="unrealized P&L = (mark − entry) × signed quantity — exact decimal text from the engine"
                      className={
                        row.unrealizedText.startsWith("-")
                          ? "text-foreground"
                          : "text-foreground-subtle"
                      }
                    >
                      unrealized {row.unrealizedText} {row.quoteCurrency}
                    </span>
                    <span
                      data-trading-world-position-realized={row.realizedText}
                      title="lifetime realized P&L of this instrument ledger (closed lots)"
                      className="text-foreground-subtle"
                    >
                      realized {row.realizedText} {row.quoteCurrency}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!row.canClose || acting}
                      data-trading-world-position-close=""
                      title="Close this position through the real CommandPort (reduce-only market close)"
                      onClick={() => void handleClose(row)}
                    >
                      Close
                    </Button>
                    <span className="text-ui-xs text-foreground-subtlest">
                      as-of {formatPortfolioTime(state.snapshot.portfolio.asOf)}
                    </span>
                  </div>
                  {rowOutcomes[row.position.instrumentId] !== undefined ? (
                    <p
                      data-trading-world-position-outcome={rowOutcomes[row.position.instrumentId]!.kind}
                      data-trading-world-position-outcome-code={rowOutcomes[row.position.instrumentId]!.code ?? ""}
                      className="break-words font-mono text-ui-xs text-foreground-subtle"
                    >
                      {rowOutcomes[row.position.instrumentId]!.text}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Positions mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return PositionsToolSurface;
}

/** The default positions surface (alpha-world identity). */
export const PositionsToolSurface = createPositionsToolSurface();
