/**
 * Order-surface shared state shapes + honest status bodies — W010.
 *
 * Split from the surface components (repo lint law: ≤400 code lines per
 * file) with zero behavior change: the projection-state unions the order
 * surfaces render over, the shared live-projection revision hook (published
 * + clock channels through the W018 controller, with an honest poll
 * fallback), the persistent simulation-disclosure header and the honest
 * non-ready bodies. Every body is a disclosure (ACCEPTANCE-WORLD-ALPHA K,
 * ARCHITECTURE-LOCK A6/A14) — no state ever implies an order fact it does
 * not have.
 */

import { useEffect, useState } from "react";

import { cn } from "@/components/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../components/PlaceholderToolSurface.js";
import type { EngineWorldClient } from "../runtime/engineWorldClient.js";
import type { TradingWorldClient } from "../runtime/worldClient.js";
import type { ClockView } from "../runtime/worldContracts.js";
import type { CommandOutcomeCapsule } from "./orderLifecycle.js";

/**
 * World-data projection state shared by the order surfaces (`ready` carries
 * the component's own rows).
 */
export type OrdersProjectionState<TReady> =
  | { readonly status: "unattached" }
  | { readonly status: "loading" }
  | { readonly status: "teaching" }
  | { readonly status: "ready"; readonly payload: TReady }
  | { readonly status: "error"; readonly message: string };

/** Default projection refresh cadence (ms); the honest poll fallback. */
export const DEFAULT_ORDERS_POLL_MS = 2000;

/** The engine publication/clock subscription surface (structural check). */
type ProjectionStreamClient = Pick<EngineWorldClient, "onPublished" | "onClock">;

function projectionStreamOf(client: TradingWorldClient): ProjectionStreamClient | undefined {
  const candidate = client as Partial<ProjectionStreamClient>;
  return typeof candidate.onPublished === "function" && typeof candidate.onClock === "function"
    ? (candidate as ProjectionStreamClient)
    : undefined;
}

/**
 * Live-projection revision: bumps whenever the engine publishes (every
 * applied command — including the generated market's synthetic commands),
 * whenever the settled clock view changes, and on the poll fallback cadence.
 * Consumers refetch the REAL projection (`query.getOrders` /
 * `evidence.getEvents`) on every revision — statuses come from the
 * authoritative matching state, never client-side guesses (work order W010
 * live-updates law).
 */
export function useEngineProjectionRevision(client: TradingWorldClient, pollMs: number): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (client.status !== "ready") {
      return;
    }
    let cancelled = false;
    const bump = (): void => {
      if (!cancelled) {
        setRevision((value) => value + 1);
      }
    };
    const stream = projectionStreamOf(client);
    const unsubscribePublished = stream?.onPublished(bump);
    const unsubscribeClock = stream?.onClock(bump);
    const timer = pollMs > 0 ? setInterval(bump, pollMs) : undefined;
    return () => {
      cancelled = true;
      unsubscribePublished?.();
      unsubscribeClock?.();
      if (timer !== undefined) {
        clearInterval(timer);
      }
    };
  }, [client, pollMs]);
  return revision;
}

/** Latest settled clock view (display + the commands' issuedAt domain). */
export function useEngineClockView(client: TradingWorldClient, pollMs: number): ClockView | undefined {
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
          // Honest absence: no fabricated clock (the surface shows no chip).
        });
    };
    read();
    const stream = projectionStreamOf(client);
    const unsubscribeClock = stream?.onClock(read);
    const timer = pollMs > 0 ? setInterval(read, pollMs) : undefined;
    return () => {
      cancelled = true;
      unsubscribeClock?.();
      if (timer !== undefined) {
        clearInterval(timer);
      }
    };
  }, [client, pollMs]);
  return clock;
}

/** Simulation-time text (W004: display in the world's time domain). */
export function formatSimulationTime(ms: number): string {
  const date = new Date(ms);
  const iso = date.toISOString();
  return iso.replace("T", " ").replace(".000Z", "Z");
}

/** The shared order-surface header: identity + persistent disclosure. */
export function OrderSurfaceHeader({
  toolId,
  instrumentId,
  clock,
}: {
  readonly toolId: string;
  readonly instrumentId: string;
  readonly clock?: ClockView;
}) {
  return (
    <header className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border/50 px-2">
      <span className="truncate font-mono text-ui-xs text-foreground-subtle">{instrumentId}</span>
      <span
        data-trading-world-simulation-disclosure=""
        title="Simulation disclosure — this world has no live execution authority (World Alpha)"
        className="shrink-0 rounded-full border border-border bg-surface px-1.5 text-ui-xs font-medium leading-5 text-foreground-subtle"
      >
        {TRADING_WORLD_SIMULATED_DISCLOSURE}
      </span>
      {clock !== undefined ? (
        <span
          data-trading-world-orders-clock=""
          data-trading-world-orders-clock-status={clock.status}
          title="Simulation clock (the order surfaces live in simulation time)"
          className="shrink-0 font-mono text-ui-xs text-foreground-subtlest"
        >
          {formatSimulationTime(clock.simulationTime)} · {clock.status}
        </span>
      ) : null}
      <span
        data-trading-world-orders-tool=""
        className="ml-auto shrink-0 font-mono text-ui-xs text-foreground-subtlest"
      >
        {toolId}
      </span>
    </header>
  );
}

/** Honest notice body for the non-ready states (teaching/unattached). */
export function OrderSurfaceNotice({
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
      data-trading-world-orders-state={stateId}
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">{title}</p>
      <p className="max-w-[26rem] text-ui-xs text-foreground-subtle">{body}</p>
    </div>
  );
}

/** Honest error body: the typed error text, a retry, and the fail-closed law. */
export function OrderSurfaceErrorBody({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div
      data-trading-world-orders-state="error"
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-4 py-6 text-center"
    >
      <p className="text-ui-sm font-medium text-foreground">Order projection unavailable</p>
      <p className="max-w-[28rem] break-words font-mono text-ui-xs text-foreground-subtle">
        {message}
      </p>
      <p className="max-w-[28rem] text-ui-xs text-foreground-subtlest">
        The order surfaces never fabricate order state — a failed read (or a closed transport)
        stays an honest failure until the runtime recovers.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/**
 * A selector button for the order surfaces (kind/side/TIF/filter chips):
 * text-stated selection (aria-pressed) + honest disable with the reason in
 * the title when the venue policy forbids the option — never silently
 * removed.
 */
export function OrderOptionButton({
  selected,
  offered = true,
  label,
  suffix,
  title,
  onClick,
  disabled,
  className,
  ...dataAttributes
}: {
  readonly selected: boolean;
  readonly offered?: boolean;
  readonly label: string;
  readonly suffix?: string;
  readonly title: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
  /** Data-* test/evidence attributes are forwarded verbatim. */
  readonly [key: `data-${string}`]: string | undefined;
}) {
  return (
    <button
      type="button"
      disabled={disabled || !offered}
      aria-pressed={selected}
      title={title}
      onClick={onClick}
      {...dataAttributes}
      className={cn(
        "rounded-sm border px-1.5 py-1 font-mono text-ui-xs",
        selected
          ? "border-foreground/40 bg-surface font-medium text-foreground"
          : "border-border bg-background text-foreground-subtle",
        (!offered || disabled) && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      {label}
      {suffix !== undefined ? <span className="ml-1 text-ui-xs">{suffix}</span> : null}
    </button>
  );
}

/** The ticket's command-outcome capsules (engine typed values, newest first). */
export function TicketOutcomeList({
  outcomes,
}: {
  readonly outcomes: readonly CommandOutcomeCapsule[];
}) {
  if (outcomes.length === 0) {
    return null;
  }
  return (
    <ul data-trading-world-ticket-outcomes="" className="flex flex-col gap-1">
      {outcomes.map((outcome, index) => (
        <li
          key={`${outcome.commandId}-${String(index)}`}
          data-trading-world-ticket-outcome={outcome.kind}
          data-trading-world-ticket-outcome-code={outcome.code ?? ""}
          className="break-words rounded-sm border border-border/50 bg-surface px-2 py-1 font-mono text-ui-xs text-foreground-subtle"
        >
          {outcome.text}
        </li>
      ))}
    </ul>
  );
}


