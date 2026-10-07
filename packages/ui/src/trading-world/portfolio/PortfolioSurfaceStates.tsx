/**
 * Portfolio-surface shared state shapes + honest status bodies — W011.
 *
 * The W010 `OrderSurfaceStates` pattern applied to the financial surfaces:
 * the persistent simulation-disclosure header (ACCEPTANCE-WORLD-ALPHA K,
 * ARCHITECTURE-LOCK A6/A14), the honest non-ready bodies (unattached /
 * loading / flat-book teaching) and the fail-closed error body with Retry.
 * Every body is a disclosure — no state ever implies a financial fact it
 * does not have (WORLD-PROTOCOL.md "UI projection law": flat means flat).
 */

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../components/PlaceholderToolSurface.js";
import type { EngineWorldClient } from "../runtime/engineWorldClient.js";
import type { TradingWorldClient } from "../runtime/worldClient.js";
import type { ClockView } from "../runtime/worldContracts.js";

/** Default projection refresh cadence (ms); the honest poll fallback. */
export const DEFAULT_PORTFOLIO_POLL_MS = 2000;

/** The engine publication/clock subscription surface (structural check). */
type ProjectionStreamClient = Pick<EngineWorldClient, "onPublished" | "onClock">;

function projectionStreamOf(client: TradingWorldClient): ProjectionStreamClient | undefined {
  const candidate = client as Partial<ProjectionStreamClient>;
  return typeof candidate.onPublished === "function" && typeof candidate.onClock === "function"
    ? (candidate as ProjectionStreamClient)
    : undefined;
}

/**
 * Latest settled clock view (display + the close-position commands'
 * issuedAt domain) — published/clock-driven with an honest poll fallback;
 * no fabricated clock on failure (the surface shows no chip).
 */
export function usePortfolioClockView(
  client: TradingWorldClient,
  pollMs: number,
): ClockView | undefined {
  const [clock, setClock] = useState<ClockView | undefined>(undefined);
  useEffect(() => {
    if (client.status !== "ready") {
      return;
    }
    let cancelled = false;
    const read = (): void => {
      void client.clock
        .getClock()
        .then((view) => {
          if (!cancelled) {
            setClock(view);
          }
        })
        .catch(() => {
          // Honest absence: no fabricated clock.
        });
    };
    read();
    const stream = projectionStreamOf(client);
    const unsubscribeClock = stream?.onClock(read);
    const unsubscribePublished = stream?.onPublished(read);
    const timer = pollMs > 0 ? setInterval(read, pollMs) : undefined;
    return () => {
      cancelled = true;
      unsubscribeClock?.();
      unsubscribePublished?.();
      if (timer !== undefined) {
        clearInterval(timer);
      }
    };
  }, [client, pollMs]);
  return clock;
}

/** Simulation-time text (W004: display in the world's time domain). */
export function formatPortfolioTime(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.replace("T", " ").replace(".000Z", "Z");
}

/** The shared financial-surface header: account + persistent disclosure. */
export function PortfolioSurfaceHeader({
  toolId,
  accountId,
  clock,
}: {
  readonly toolId: string;
  readonly accountId: string;
  readonly clock?: ClockView;
}) {
  return (
    <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 px-2">
      <span className="truncate font-mono text-ui-xs text-foreground-subtle">{accountId}</span>
      <span
        data-trading-world-simulation-disclosure=""
        title="Simulation disclosure — this world has no live execution authority (World Alpha)"
        className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
      >
        {TRADING_WORLD_SIMULATED_DISCLOSURE}
      </span>
      {clock !== undefined ? (
        <span
          data-trading-world-portfolio-clock=""
          data-trading-world-portfolio-clock-status={clock.status}
          title="Simulation clock (the financial surfaces live in simulation time)"
          className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
        >
          {formatPortfolioTime(clock.simulationTime)} · {clock.status}
        </span>
      ) : null}
      <span
        data-trading-world-portfolio-tool=""
        className="ml-auto shrink-0 font-mono text-ui-xs text-foreground-subtlest"
      >
        {toolId}
      </span>
    </header>
  );
}

/** Honest notice body for the non-ready states (unattached/loading/flat). */
export function PortfolioSurfaceNotice({
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
      data-trading-world-portfolio-state={stateId}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">{title}</p>
      <p className="max-w-[26rem] text-ui-xs text-foreground-subtle">{body}</p>
    </div>
  );
}

/** Honest error body: the typed error text, a retry, and the fail-closed law. */
export function PortfolioSurfaceErrorBody({
  message,
  remoteName,
  onRetry,
}: {
  readonly message: string;
  readonly remoteName?: string;
  readonly onRetry: () => void;
}) {
  return (
    <div
      data-trading-world-portfolio-state="error"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">
        Financial projection unavailable
      </p>
      <p className="max-w-[28rem] break-words font-mono text-ui-xs text-foreground-subtle">
        {remoteName !== undefined ? `${remoteName}: ` : ""}
        {message}
      </p>
      <p className="max-w-[28rem] text-ui-xs text-foreground-subtlest">
        The financial surfaces never fabricate positions, balances or risk state — a failed
        read (or a closed transport) stays an honest failure until the runtime recovers.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** A labeled figure row (label left, canonical decimal text right). */
export function PortfolioFigureRow({
  label,
  value,
  title,
  dataAttribute,
  muted,
}: {
  readonly label: string;
  readonly value: string;
  readonly title: string;
  readonly dataAttribute: string;
  readonly muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-ui-xs text-foreground-subtle">{label}</span>
      <span
        {...{ [dataAttribute]: value }}
        title={title}
        className={`break-all text-right font-mono text-ui-xs ${muted ? "text-foreground-subtle" : "text-foreground"}`}
      >
        {value}
      </span>
    </div>
  );
}
