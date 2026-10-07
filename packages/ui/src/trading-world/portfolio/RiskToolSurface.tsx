/**
 * Risk tool surface — W011 (the constraint cards + breach history).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (Risk cell);
 * spec/WORK-ITEMS.md W011 ("the risk view — constraint cards WITH numbers:
 * the actual limits and their consumption, not just predicate labels;
 * breaches surfaced").
 *
 * ONE CARD PER NAMED GATE (the W003 RiskGateId set), each carrying REAL
 * numbers only: the declared limit from the engine's own `query.getRisk`
 * projection (unset limits are honestly labeled "not enforced" — the W003
 * law), the consumption computed exactly from the real positions/portfolio
 * (gross exposure, leverage, largest open quantity, current buying power),
 * a live over/within comparison when derivable, and the engine-recorded
 * breach history of that gate with its own detail text and timestamps.
 * Figures the ports cannot project (the drawdown measure needs the
 * engine-internal peak equity; the order-size gate is per-submission) are
 * labeled as such — the card never invents a number (A6, the UI projection
 * law).
 */

import { useMemo } from "react";
import type { ComponentType } from "react";

import { cn } from "@/components/lib/utils.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import { deriveRiskSummary, type RiskSummaryModel } from "./riskCards.js";
import {
  alphaTraderPortfolioIdentity,
  resolvePortfolioIdentity,
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

/** Configuration for the risk surface component. */
export interface RiskToolSurfaceConfig {
  /** The trader whose risk state is projected (default: alpha convention). */
  readonly identity?: PortfolioIdentitySpec;
  /** Projection refresh cadence fallback (default 2000). */
  readonly pollMs?: number;
}

export function createRiskToolSurface(
  config: RiskToolSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  const identitySpec: PortfolioIdentitySpec = config.identity ?? alphaTraderPortfolioIdentity;
  const pollMs = config.pollMs ?? DEFAULT_PORTFOLIO_POLL_MS;

  function RiskToolSurface(props: TradingWorldToolSurfaceProps) {
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

    // Derived in render from the READY snapshot; malformed figures are
    // caught and rendered as the honest fail-closed error body.
    const derived = useMemo(() => {
      if (state.status !== "ready") {
        return undefined;
      }
      try {
        return {
          status: "ok" as const,
          summary: deriveRiskSummary({
            risk: state.snapshot.risk,
            portfolio: state.snapshot.portfolio,
            positions: state.snapshot.positions,
          }),
        };
      } catch (error) {
        return {
          status: "inconsistent" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }, [state]);
    const summary: RiskSummaryModel | undefined =
      derived?.status === "ok" ? derived.summary : undefined;

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-risk=""
        data-trading-world-risk-data-status={state.status}
        data-trading-world-risk-account={identity.accountId}
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
            body="The risk surface renders the real getRisk/getPositions/getPortfolio projections — no limits, consumption or breaches are shown without an attached engine."
          />
        ) : null}
        {state.status === "loading" ? (
          <PortfolioSurfaceNotice stateId="loading" title="Loading risk projection…" body="" />
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
        {state.status === "ready" && derived?.status === "inconsistent" ? (
          <PortfolioSurfaceErrorBody message={derived.message} onRetry={() => feed.refresh()} />
        ) : null}
        {state.status === "ready" && summary !== undefined ? (
          <div
            data-trading-world-risk-body=""
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-2"
          >
            <p
              data-trading-world-risk-summary=""
              className="shrink-0 text-center font-mono text-ui-xs text-foreground-subtle"
              title="Declared limits vs recorded breaches of this account (query.getRisk)"
            >
              {String(summary.enforcedCount)}/6 limits enforced ·{" "}
              {String(summary.breachCount)} breach
              {summary.breachCount === 1 ? "" : "es"} recorded · as-of{" "}
              {formatPortfolioTime(summary.asOfMs)}
            </p>
            {summary.noLimitsDeclared ? (
              <p
                data-trading-world-risk-no-limits=""
                className="shrink-0 rounded-sm border border-border/50 bg-surface px-2 py-1 text-ui-xs text-foreground-subtle"
                title="The honest no-limits case: this world declares no risk limits for the trader account"
              >
                This world declares no risk limits for the trader account — the six gates
                below are not enforced (the account's own margin/buying-power model still
                applies at order acceptance). Consumption figures are still real, computed
                from the live projections.
              </p>
            ) : null}
            <ul data-trading-world-risk-cards="" className="flex flex-col gap-1.5">
              {summary.cards.map((card) => (
                <li
                  key={card.gate}
                  data-trading-world-risk-card={card.gate}
                  data-trading-world-risk-card-over={String(card.overLimit ?? "")}
                  className="flex shrink-0 flex-col gap-0.5 rounded-sm border border-border/50 bg-surface px-2 py-1.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-ui-xs font-medium text-foreground">
                      {card.gateLabel}
                    </span>
                    {card.limitText === undefined ? (
                      <span
                        data-trading-world-risk-limit="not-enforced"
                        className="rounded-sm border border-border px-1 text-ui-xs text-foreground-subtlest"
                        title={card.limitNote}
                      >
                        not enforced
                      </span>
                    ) : (
                      <span
                        data-trading-world-risk-limit={card.limitText}
                        className="rounded-sm border border-border px-1 font-mono text-ui-xs text-foreground-subtle"
                        title={card.limitNote}
                      >
                        limit {card.limitText}
                      </span>
                    )}
                    {card.overLimit === true ? (
                      <span
                        data-trading-world-risk-over-badge=""
                        className="ml-auto rounded-sm border border-border bg-surface px-1 text-ui-xs font-medium text-foreground"
                        title="live comparison of the real consumption against the declared limit"
                      >
                        OVER
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3 font-mono text-ui-xs">
                    {card.consumptionText !== undefined ? (
                      <span
                        data-trading-world-risk-consumption={card.consumptionText}
                        className={cn(
                          card.overLimit === true ? "text-foreground" : "text-foreground-subtle",
                        )}
                        title={card.consumptionNote}
                      >
                        now {card.consumptionText}
                      </span>
                    ) : (
                      <span
                        data-trading-world-risk-consumption="not-projected"
                        className="text-foreground-subtlest"
                        title={card.consumptionNote}
                      >
                        {card.gate === "drawdown"
                          ? "consumption not projected (engine-internal peak equity)"
                          : "checked per order at submission"}
                      </span>
                    )}
                  </div>
                  {card.breaches.length > 0 ? (
                    <ul data-trading-world-risk-breaches="" className="flex flex-col gap-0.5">
                      {card.breaches.map((breach, index) => (
                        <li
                          key={`${breach.gate}-${String(breach.occurredAtMs)}-${String(index)}`}
                          data-trading-world-risk-breach={breach.gate}
                          className="break-words font-mono text-ui-xs text-foreground-subtle"
                          title={`breach recorded at ${breach.occurredAtText} (engine journal truth)`}
                        >
                          breach · {breach.occurredAtText} · {breach.detail}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Risk mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return RiskToolSurface;
}

/** The default risk surface (alpha-world identity). */
export const RiskToolSurface = createRiskToolSurface();
