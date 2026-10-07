/**
 * Portfolio tool surface — W011 (the account financials).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (Portfolio cell);
 * spec/WORK-ITEMS.md W011 ("account financials — balances, margin
 * used/available, buying power from the real financial state").
 *
 * EVERY FIGURE IS THE ENGINE'S OWN `query.getPortfolio` projection — cash
 * (the settled balance), buying power, equity, realized/unrealized/total
 * P&L — in the exact canonical decimal text the W015 financial engine
 * projects (never reformatted through a float). Gross exposure is the exact
 * kernel-law fold over the real positions. MARGIN USED/AVAILABLE are not
 * projected by the W003 QueryPort: the surface shows them only when the
 * documented W015 margin model reproduces the PROJECTED buying power
 * bit-for-bit (the leverage solve in `./portfolioData.ts`); otherwise the
 * honest "not projected" note — never a guessed number.
 *
 * The consistency law (equity = cash + realized + unrealized) is verified
 * on every refresh; a violation is a typed fail-closed error state.
 */

import { useMemo } from "react";
import type { ComponentType } from "react";

import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import { deriveFinancialSummary } from "./portfolioData.js";
import {
  alphaTraderPortfolioIdentity,
  resolvePortfolioIdentity,
  type PortfolioIdentitySpec,
} from "./portfolioIdentity.js";
import { usePortfolioProjectionFeed } from "./usePortfolioProjection.js";
import {
  DEFAULT_PORTFOLIO_POLL_MS,
  formatPortfolioTime,
  PortfolioFigureRow,
  PortfolioSurfaceErrorBody,
  PortfolioSurfaceHeader,
  PortfolioSurfaceNotice,
  usePortfolioClockView,
} from "./PortfolioSurfaceStates.js";

/** Configuration for the portfolio surface component. */
export interface PortfolioToolSurfaceConfig {
  /** The trader whose financials are projected (default: alpha convention). */
  readonly identity?: PortfolioIdentitySpec;
  /** Projection refresh cadence fallback (default 2000). */
  readonly pollMs?: number;
}

export function createPortfolioToolSurface(
  config: PortfolioToolSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  const identitySpec: PortfolioIdentitySpec = config.identity ?? alphaTraderPortfolioIdentity;
  const pollMs = config.pollMs ?? DEFAULT_PORTFOLIO_POLL_MS;

  function PortfolioToolSurface(props: TradingWorldToolSurfaceProps) {
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
    const state = feed.state;

    // The summary is derived from the READY snapshot only; a consistency
    // violation (or malformed decimal text) is CAUGHT and rendered as the
    // honest fail-closed error body — never a crash, never a guessed figure.
    const summaryState = useMemo(() => {
      if (state.status !== "ready") {
        return undefined;
      }
      try {
        return {
          status: "ok" as const,
          summary: deriveFinancialSummary(state.snapshot.portfolio, state.snapshot.positions),
        };
      } catch (error) {
        return {
          status: "inconsistent" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }, [state]);
    const summary = summaryState?.status === "ok" ? summaryState.summary : undefined;

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-portfolio=""
        data-trading-world-portfolio-data-status={state.status}
        data-trading-world-portfolio-account={identity.accountId}
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
            body="The portfolio surface renders the real getPortfolio projection of the authoritative financial state — no balances, buying power or P&L are shown without an attached engine."
          />
        ) : null}
        {state.status === "loading" ? (
          <PortfolioSurfaceNotice stateId="loading" title="Loading financial projection…" body="" />
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
        {state.status === "ready" && summaryState?.status === "inconsistent" ? (
          <PortfolioSurfaceErrorBody
            message={summaryState.message}
            onRetry={() => feed.refresh()}
          />
        ) : null}
        {state.status === "ready" && summary !== undefined ? (
          <div
            data-trading-world-portfolio-body=""
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2"
          >
            <section
              data-trading-world-portfolio-balances=""
              className="rounded-sm border border-border/50 bg-surface px-2 py-1.5"
              title="query.getPortfolio — the W015 account ledger projection (exact decimal text)"
            >
              <p className="mb-1 text-ui-xs font-medium text-foreground">Balances</p>
              <PortfolioFigureRow
                label="Cash (settled)"
                value={`${summary.cashText} ${summary.currency}`}
                dataAttribute="data-trading-world-portfolio-cash"
                title="Cash = initial deposits − fees (settled balance)"
              />
              <PortfolioFigureRow
                label="Buying power"
                value={`${summary.buyingPowerText} ${summary.currency}`}
                dataAttribute="data-trading-world-portfolio-buying-power"
                title="marginAvailable × leverage (the engine's own figure)"
              />
              <PortfolioFigureRow
                label="Equity"
                value={`${summary.equityText} ${summary.currency}`}
                dataAttribute="data-trading-world-portfolio-equity"
                title="equity = cash + realized + unrealized (the W003 consistency law, verified exactly)"
              />
            </section>
            <section
              data-trading-world-portfolio-margin=""
              className="rounded-sm border border-border/50 bg-surface px-2 py-1.5"
              title="Margin — derived by reproducing the W015 margin model and requiring the projected buying power bit-for-bit"
            >
              <p className="mb-1 text-ui-xs font-medium text-foreground">Margin</p>
              {summary.margin !== undefined ? (
                <>
                  <PortfolioFigureRow
                    label="Leverage"
                    value={summary.margin.leverageText}
                    dataAttribute="data-trading-world-portfolio-leverage"
                    title="The solved integer leverage (the engine's margin model reproduces the projected buying power exactly)"
                  />
                  <PortfolioFigureRow
                    label="Margin used"
                    value={`${summary.margin.marginUsedText} ${summary.currency}`}
                    dataAttribute="data-trading-world-portfolio-margin-used"
                    title="Σ |open quantity| × mark / leverage (one rounding per position — the W015 law)"
                  />
                  <PortfolioFigureRow
                    label="Margin available"
                    value={`${summary.margin.marginAvailableText} ${summary.currency}`}
                    dataAttribute="data-trading-world-portfolio-margin-available"
                    title="equity − margin used (a negative value is a visible margin-call condition, never floored)"
                  />
                </>
              ) : (
                <p
                  data-trading-world-portfolio-margin-not-derived=""
                  className="text-ui-xs text-foreground-subtle"
                  title="Honest absence: the W003 QueryPort projects no margin figures and no candidate margin model reproduces the projected buying power exactly"
                >
                  Margin used/available are not projected by the world ports for this state —
                  the surface never guesses a number (A6).
                </p>
              )}
            </section>
            <section
              data-trading-world-portfolio-pnl=""
              className="rounded-sm border border-border/50 bg-surface px-2 py-1.5"
              title="P&L breakdown — the W003 PnlBreakdown law (realized + unrealized = total)"
            >
              <p className="mb-1 text-ui-xs font-medium text-foreground">P&L</p>
              <PortfolioFigureRow
                label="Realized"
                value={`${summary.realizedText} ${summary.currency}`}
                dataAttribute="data-trading-world-portfolio-realized"
                title="lifetime closed-lot P&L (exact)"
              />
              <PortfolioFigureRow
                label="Unrealized"
                value={`${summary.unrealizedText} ${summary.currency}`}
                dataAttribute="data-trading-world-portfolio-unrealized"
                title="open mark-to-market P&L (moves with the market)"
              />
              <PortfolioFigureRow
                label="Total"
                value={`${summary.totalPnlText} ${summary.currency}`}
                dataAttribute="data-trading-world-portfolio-total-pnl"
                title="realized + unrealized (exact addition)"
              />
            </section>
            <section
              data-trading-world-portfolio-exposure=""
              className="rounded-sm border border-border/50 bg-surface px-2 py-1.5"
              title="Exposure — the exact kernel-law fold over the real open positions"
            >
              <p className="mb-1 text-ui-xs font-medium text-foreground">Exposure</p>
              <PortfolioFigureRow
                label="Open positions"
                value={String(summary.openPositionCount)}
                dataAttribute="data-trading-world-portfolio-open-count"
                title="count of the account's open positions (query.getPositions)"
              />
              <PortfolioFigureRow
                label="Gross exposure"
                value={`${summary.grossExposureText} ${summary.currency}`}
                dataAttribute="data-trading-world-portfolio-gross-exposure"
                title="Σ |open quantity| × (mark ?? entry) — one rounding per position, the engine's own notional law"
              />
            </section>
            <p
              data-trading-world-portfolio-asof=""
              className="shrink-0 text-center font-mono text-ui-xs text-foreground-subtlest"
              title="The projection's as-of simulation time (A7: the clock position of this read)"
            >
              as-of {formatPortfolioTime(summary.asOfMs)}
            </p>
          </div>
        ) : null}
        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Portfolio mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return PortfolioToolSurface;
}

/** The default portfolio surface (alpha-world identity). */
export const PortfolioToolSurface = createPortfolioToolSurface();
