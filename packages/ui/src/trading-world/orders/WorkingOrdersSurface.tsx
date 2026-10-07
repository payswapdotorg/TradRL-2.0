/**
 * Working orders tool surface — W010 (the order-lifecycle list).
 *
 * Spec: spec/UX-DESIGN.md "Default trader cockpit" (Positions / Orders
 * cell); spec/WORK-ITEMS.md W010 ("the trader's own orders with live status
 * (accepted/resting, partially-filled, filled, cancelled/rejected), plus
 * cancel/replace actions wired to the real commands").
 *
 * LIVE STATUSES ARE THE ENGINE'S OWN (A6): every refresh reads the REAL
 * `query.getOrders({accountId})` projection of the authoritative matching
 * state; refreshes trigger on engine publications (every applied command —
 * including the generated market's synthetic orders), settled clock views
 * and an honest poll fallback. The surface never guesses a status
 * client-side (WORLD-PROTOCOL.md "UI projection law").
 *
 * CANCEL/REPLACE issue REAL commands (client.command.cancelOrder /
 * replaceOrder) and display the engine's typed outcomes (ack cursor or typed
 * rejection code — never swallowed). Terminal rows disable the actions with
 * the W003 lifecycle law as the reason; races still get the engine's typed
 * `order-not-modifiable` verdict.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";

import { Button } from "@/components/ui/button.js";
import type { TradingWorldToolSurfaceProps } from "../registry/toolRegistry.js";
import { useTradingWorldClient } from "../runtime/worldClient.js";
import {
  ALPHA_TRADER_IDENTITY,
  buildCancelOrderCommand,
  buildReplaceOrderCommand,
  newUiCommandId,
  resolveOrderTicketIdentity,
  type OrderTicketIdentitySpec,
} from "./orderTicket.js";
import {
  applyOrderDisplayFilter,
  deriveOrderRowModel,
  describeCommandOutcome,
  describeThrownCommandError,
  sortOrdersForDisplay,
  type CommandOutcomeCapsule,
  type OrderDisplayFilter,
  type OrderRowModel,
} from "./orderLifecycle.js";
import {
  ReplaceOrderEditor,
  editorFor,
  type ReplaceEditorState,
} from "./ReplaceOrderEditor.js";
import type { Order, TimestampMs } from "tradrl-world-contracts";
import {
  DEFAULT_ORDERS_POLL_MS,
  formatSimulationTime,
  OrderOptionButton,
  OrderSurfaceErrorBody,
  OrderSurfaceHeader,
  OrderSurfaceNotice,
  useEngineClockView,
  useEngineProjectionRevision,
} from "./OrderSurfaceStates.js";

/** Configuration for the working-orders surface component. */
export interface WorkingOrdersSurfaceConfig {
  /** The trader whose orders are projected (default: alpha convention). */
  readonly identity?: OrderTicketIdentitySpec;
  /** Projection refresh cadence fallback (default 2000). */
  readonly pollMs?: number;
}

const DISPLAY_FILTERS: readonly OrderDisplayFilter[] = ["all", "working", "terminal"];

export function createWorkingOrdersSurface(
  config: WorkingOrdersSurfaceConfig = {},
): ComponentType<TradingWorldToolSurfaceProps> {
  const identitySpec = config.identity ?? ALPHA_TRADER_IDENTITY;
  const pollMs = config.pollMs ?? DEFAULT_ORDERS_POLL_MS;

  function WorkingOrdersSurface(props: TradingWorldToolSurfaceProps) {
    const client = useTradingWorldClient();
    const identity = useMemo(
      () => resolveOrderTicketIdentity(identitySpec, props.worldId),
      [props.worldId],
    );
    const revision = useEngineProjectionRevision(client, pollMs);
    const clockView = useEngineClockView(client, pollMs);
    const [ordersState, setOrdersState] = useState<
      | { status: "unattached" }
      | { status: "loading" }
      | { status: "teaching" }
      | { status: "ready"; orders: readonly OrderRowModel[] }
      | { status: "error"; message: string }
    >(() => (client.status === "unattached" ? { status: "unattached" } : { status: "loading" }));
    const [filter, setFilter] = useState<OrderDisplayFilter>("all");
    const [rowOutcomes, setRowOutcomes] = useState<Record<string, CommandOutcomeCapsule>>({});
    const [editor, setEditor] = useState<ReplaceEditorState | null>(null);
    const [acting, setActing] = useState(false);

    const fetchOrders = useCallback(
      async (signal: { cancelled: boolean }): Promise<void> => {
        try {
          const orders: readonly Order[] = await client.query.getOrders({
            accountId: identity.accountId,
          });
          if (signal.cancelled) {
            return;
          }
          const rows = sortOrdersForDisplay(orders).map(deriveOrderRowModel);
          setOrdersState(
            rows.length === 0 ? { status: "teaching" } : { status: "ready", orders: rows },
          );
        } catch (error) {
          if (signal.cancelled) {
            return;
          }
          setOrdersState({
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
      void fetchOrders(signal);
      return () => {
        signal.cancelled = true;
      };
    }, [client, revision, fetchOrders]);

    const recordOutcome = useCallback((orderId: string, capsule: CommandOutcomeCapsule): void => {
      setRowOutcomes((previous) => ({ ...previous, [orderId]: capsule }));
    }, []);

    const issueAt = useCallback(async (): Promise<TimestampMs | undefined> => {
      if (clockView !== undefined) {
        return clockView.simulationTime;
      }
      try {
        const view = await client.clock.getClock();
        return view.simulationTime;
      } catch {
        return undefined;
      }
    }, [client, clockView]);

    const handleCancel = useCallback(
      async (row: OrderRowModel) => {
        if (acting) {
          return;
        }
        setActing(true);
        try {
          const issuedAt = await issueAt();
          if (issuedAt === undefined) {
            recordOutcome(
              row.order.orderId,
              describeThrownCommandError(new Error("simulation clock unavailable")),
            );
            return;
          }
          const result = await client.command.cancelOrder(
            buildCancelOrderCommand({
              identity,
              worldId: props.worldId,
              orderId: row.order.orderId,
              commandId: newUiCommandId("cancel"),
              issuedAt,
            }),
          );
          recordOutcome(row.order.orderId, describeCommandOutcome(result));
        } catch (error) {
          recordOutcome(row.order.orderId, describeThrownCommandError(error));
        } finally {
          setActing(false);
        }
      },
      [acting, client, identity, issueAt, props.worldId, recordOutcome],
    );

    const handleReplace = useCallback(
      async (state: ReplaceEditorState) => {
        if (acting) {
          return;
        }
        setActing(true);
        try {
          const issuedAt = await issueAt();
          if (issuedAt === undefined) {
            recordOutcome(
              state.orderId,
              describeThrownCommandError(new Error("simulation clock unavailable")),
            );
            return;
          }
          const result = await client.command.replaceOrder(
            buildReplaceOrderCommand({
              identity,
              worldId: props.worldId,
              orderId: state.orderId,
              commandId: newUiCommandId("replace"),
              issuedAt,
              quantity: state.quantity,
              ...(state.limitPrice.length > 0 ? { limitPrice: state.limitPrice } : {}),
              ...(state.stopPrice.length > 0 ? { stopPrice: state.stopPrice } : {}),
            }),
          );
          recordOutcome(state.orderId, describeCommandOutcome(result));
          setEditor(null);
        } catch (error) {
          recordOutcome(state.orderId, describeThrownCommandError(error));
        } finally {
          setActing(false);
        }
      },
      [acting, client, identity, issueAt, props.worldId, recordOutcome],
    );

    const rows = useMemo(() => {
      if (ordersState.status !== "ready") {
        return [];
      }
      const byFilter = applyOrderDisplayFilter(
        ordersState.orders.map((row) => row.order),
        filter,
      );
      const visible = new Set(byFilter.map((order) => order.orderId));
      return ordersState.orders.filter((row) => visible.has(row.order.orderId));
    }, [ordersState, filter]);

    return (
      <div
        data-trading-world-tool-surface={props.toolId}
        data-trading-world-working-orders=""
        data-trading-world-orders-data-status={ordersState.status}
        data-trading-world-orders-account={identity.accountId}
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <OrderSurfaceHeader toolId={props.toolId} instrumentId={identity.instrumentId} clock={clockView} />
        {ordersState.status === "unattached" ? (
          <OrderSurfaceNotice
            stateId="unattached"
            title="No world runtime attached"
            body="The lifecycle list renders the real getOrders projection of the authoritative matching state — nothing is shown without an attached engine (no fabricated orders)."
          />
        ) : null}
        {ordersState.status === "loading" ? (
          <OrderSurfaceNotice stateId="loading" title="Loading order projection…" body="" />
        ) : null}
        {ordersState.status === "teaching" ? (
          <OrderSurfaceNotice
            stateId="teaching"
            title="No orders yet in this world"
            body="This is the trader account's own order book. Submit an order from the Order Ticket — every submission's lifecycle (accepted, partially-filled, filled, cancelled, rejected) appears here live from the venue's own records."
          />
        ) : null}
        {ordersState.status === "error" ? (
          <OrderSurfaceErrorBody
            message={ordersState.message}
            onRetry={() => {
              setOrdersState({ status: "loading" });
              void fetchOrders({ cancelled: false });
            }}
          />
        ) : null}
        {ordersState.status === "ready" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1 border-b border-border/50 px-2 py-1">
              {DISPLAY_FILTERS.map((option) => (
                <OrderOptionButton
                  key={option}
                  selected={filter === option}
                  label={option}
                  data-trading-world-orders-filter={option}
                  title={`display filter: ${option} (the engine projection is untouched)`}
                  onClick={() => setFilter(option)}
                />
              ))}
              <span className="ml-auto font-mono text-ui-xs text-foreground-subtlest">
                {String(rows.length)} shown
              </span>
            </div>
            <ul data-trading-world-orders-rows="" className="flex min-h-0 flex-1 flex-col divide-y divide-border/40 overflow-y-auto">
              {rows.map((row) => (
                <li
                  key={row.order.orderId}
                  data-trading-world-order-row={row.order.orderId}
                  data-trading-world-order-status={row.order.status}
                  data-trading-world-order-side={row.order.side}
                  className="flex shrink-0 flex-col gap-0.5 px-2 py-1.5"
                  title={`orderId ${row.order.orderId} · submitted ${formatSimulationTime(
                    row.order.submittedAt,
                  )}${row.order.updatedAt === undefined ? "" : ` · updated ${formatSimulationTime(row.order.updatedAt)}`}`}
                >
                  <div className="flex items-center gap-2 font-mono text-ui-xs">
                    <span className="font-medium text-foreground">{row.sideAndKind}</span>
                    <span
                      data-trading-world-order-status-badge=""
                      className="rounded-sm border border-border bg-surface px-1 text-foreground-subtle"
                    >
                      {row.order.status}
                    </span>
                    <span className="text-foreground-subtle">{row.shortId}</span>
                    <span className="ml-auto text-foreground-subtle">{row.constraintSummary}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono text-ui-xs text-foreground-subtle">
                    <span>{row.quantitySummary}</span>
                    <span>{row.priceSummary}</span>
                    {row.reasonSummary.length > 0 ? (
                      <span data-trading-world-order-reason="">{row.reasonSummary}</span>
                    ) : null}
                    {row.shortReplacedBy !== undefined ? (
                      <span data-trading-world-order-replaced-by="">→ {row.shortReplacedBy}</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!row.canModify || acting}
                      data-trading-world-order-cancel=""
                      title={row.canModifyReason}
                      onClick={() => void handleCancel(row)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!row.canModify || acting}
                      data-trading-world-order-replace=""
                      title={row.canModifyReason}
                      onClick={() => setEditor(editorFor(row))}
                    >
                      Replace…
                    </Button>
                    {!row.canModify ? (
                      <span className="text-ui-xs text-foreground-subtlest">terminal</span>
                    ) : null}
                  </div>
                  {editor !== null && editor.orderId === row.order.orderId ? (
                    <ReplaceOrderEditor
                      row={row}
                      state={editor}
                      acting={acting}
                      onStateChange={setEditor}
                      onSubmit={() => void handleReplace(editor)}
                      onDismiss={() => setEditor(null)}
                    />
                  ) : null}
                  {rowOutcomes[row.order.orderId] !== undefined ? (
                    <p
                      data-trading-world-order-outcome={rowOutcomes[row.order.orderId]!.kind}
                      data-trading-world-order-outcome-code={rowOutcomes[row.order.orderId]!.code ?? ""}
                      className="break-words font-mono text-ui-xs text-foreground-subtle"
                    >
                      {rowOutcomes[row.order.orderId]!.text}
                    </p>
                  ) : null}
                </li>
              ))}
              {rows.length === 0 ? (
                <li data-trading-world-orders-empty-filter="" className="px-2 py-3 text-center text-ui-xs text-foreground-subtlest">
                  No {filter === "all" ? "" : filter} orders in this view (display filter — the
                  engine projection is untouched).
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {props.phase === "mounted-hidden" ? (
          <p data-trading-world-surface-phase="mounted-hidden" className="sr-only">
            Working orders mounted in background — state kept alive while hidden (J-WORLD-02).
          </p>
        ) : null}
      </div>
    );
  }

  return WorkingOrdersSurface;
}

/** The default working-orders surface (alpha-world identity). */
export const WorkingOrdersSurface = createWorkingOrdersSurface();
