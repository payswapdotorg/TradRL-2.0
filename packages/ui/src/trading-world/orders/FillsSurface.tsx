/**
 * Fills tool surface — W010 (the execution/fill blotter).
 *
 * Spec: spec/UX-DESIGN.md "Core World Alpha tools" (fills); spec/WORK-ITEMS.md
 * W010; spec/WORLD-PROTOCOL.md "UI projection law" + "Event envelope"
 * (sequence is monotonic within a world — the tape is ordered by the
 * engine's own journal sequences).
 *
 * THE FILL TAPE IS JOURNAL TRUTH: rows are derived from the engine's own
 * `matching.order.filled` events (`evidence.getEvents`, A7-observability
 * firewall applied by the port) — every row carries the real price,
 * quantity, fee, liquidity role and the causal market trade reference.
 * `query.getOrders` supplies the trader's own order count (venue truth);
 * nothing is fabricated or client-side reconstructed.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";

import { useTradingWorldClient } from "../runtime/worldClient.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import {
  ALPHA_TRADER_IDENTITY,
  resolveOrderTicketIdentity,
  type OrderTicketIdentitySpec,
} from "./orderTicket.js";
import {
  deriveFillRows,
  type FillRowModel,
} from "./orderLifecycle.js";
import type { Order, WorldEventEnvelope } from "tradrl-world-contracts";
import {
  DEFAULT_ORDERS_POLL_MS,
  formatSimulationTime,
  OrderSurfaceErrorBody,
  OrderSurfaceHeader,
  OrderSurfaceNotice,
  useEngineClockView,
  useEngineProjectionRevision,
} from "./OrderSurfaceStates.js";

/** Configuration for the fills surface component. */
export interface FillsSurfaceConfig {
  /** The trader whose fills are projected (default: alpha convention). */
  readonly identity?: OrderTicketIdentitySpec;
  /** Projection refresh cadence fallback (default 2000). */
  readonly pollMs?: number;
}

const FILL_EVENT_TYPE = "matching.order.filled";

interface FillsReady {
  readonly rows: readonly FillRowModel[];
  readonly orderCount: number;
}

export function createFillsSurface(
  config: FillsSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  const identitySpec = config.identity ?? ALPHA_TRADER_IDENTITY;
  const pollMs = config.pollMs ?? DEFAULT_ORDERS_POLL_MS;

  function FillsSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    const identity = useMemo(
      () => resolveOrderTicketIdentity(identitySpec, props.worldId),
      [props.worldId],
    );
    const revision = useEngineProjectionRevision(client, pollMs);
    const clockView = useEngineClockView(client, pollMs);
    const [state, setState] = useState<
      | { status: "unattached" }
      | { status: "loading" }
      | { status: "teaching" }
      | { status: "ready"; payload: FillsReady }
      | { status: "error"; message: string }
    >(() => (client.status === "unattached" ? { status: "unattached" } : { status: "loading" }));

    const fetchFills = useCallback(
      async (signal: { cancelled: boolean }): Promise<void> => {
        try {
          const [events, orders]: readonly [readonly WorldEventEnvelope[], readonly Order[]] =
            await Promise.all([
              client.evidence.getEvents({ types: [FILL_EVENT_TYPE] }),
              client.query.getOrders({ accountId: identity.accountId }),
            ]);
          if (signal.cancelled) {
            return;
          }
          const rows = deriveFillRows(events, identity.accountId);
          setState(
            rows.length === 0
              ? { status: "teaching" }
              : { status: "ready", payload: { rows, orderCount: orders.length } },
          );
        } catch (error) {
          if (signal.cancelled) {
            return;
          }
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
      [client, identity.accountId],
    );

    useEffect(() => {
      if (client.status !== "ready") {
        return;
      }
      const signal = { cancelled: false };
      void fetchFills(signal);
      return () => {
        signal.cancelled = true;
      };
    }, [client, revision, fetchFills]);

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-fills=""
        data-trading-world-fills-status={state.status}
        data-trading-world-fills-account={identity.accountId}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <OrderSurfaceHeader toolId={props.toolId} instrumentId={identity.instrumentId} clock={clockView} />
        {state.status === "unattached" ? (
          <OrderSurfaceNotice
            stateId="unattached"
            title="No world runtime attached"
            body="The fill blotter projects the engine's own matching.order.filled journal events — no fills are shown without an attached engine."
          />
        ) : null}
        {state.status === "loading" ? (
          <OrderSurfaceNotice stateId="loading" title="Loading fill projection…" body="" />
        ) : null}
        {state.status === "teaching" ? (
          <OrderSurfaceNotice
            stateId="teaching"
            title="No fills yet in this world"
            body="Fills appear here as the venue matches the trader's orders — each row carries the real price, quantity, fee, liquidity role and the causal market trade (journal truth, newest first)."
          />
        ) : null}
        {state.status === "error" ? (
          <OrderSurfaceErrorBody
            message={state.message}
            onRetry={() => {
              setState({ status: "loading" });
              void fetchFills({ cancelled: false });
            }}
          />
        ) : null}
        {state.status === "ready" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <p
              data-trading-world-fills-summary=""
              className="shrink-0 border-b border-border/50 px-2 py-1 font-mono text-ui-xs text-foreground-subtlest"
            >
              {String(state.payload.rows.length)} fills (matching.order.filled) ·{" "}
              {String(state.payload.orderCount)} orders on the account
            </p>
            <ul data-trading-world-fills-rows="" className="flex min-h-0 flex-1 flex-col divide-y divide-border/40 overflow-y-auto">
              {state.payload.rows.map((row) => (
                <li
                  key={row.fillId}
                  data-trading-world-fill-row={row.fillId}
                  data-trading-world-fill-order={row.orderId}
                  className="flex shrink-0 flex-col gap-0.5 px-2 py-1.5 font-mono text-ui-xs"
                  title={`fill ${row.fillId} · order ${row.orderId} · journal sequence ${String(
                    row.sequence,
                  )} · market trade ${row.marketTradeId} (seq ${String(row.marketSequence)})`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{row.liquidity}</span>
                    <span data-trading-world-fill-price="">{row.price}</span>
                    <span data-trading-world-fill-quantity="">× {row.quantity}</span>
                    <span className="ml-auto text-foreground-subtlest">
                      {formatSimulationTime(row.occurredAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-foreground-subtle">
                    <span>{row.shortOrderId}</span>
                    <span data-trading-world-fill-fee="">fee {row.feeText}</span>
                    <span data-trading-world-fill-cumulative="">
                      cumulative {row.cumulativeFilledQuantity}
                    </span>
                    <span data-trading-world-fill-order-status="">order {row.orderStatus}</span>
                  </div>
                  <div className="text-foreground-subtlest">
                    trade {row.marketTradeId} · journal seq {String(row.sequence)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Fills mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return FillsSurface;
}

/** The default fills surface (alpha-world identity). */
export const FillsSurface = createFillsSurface();
