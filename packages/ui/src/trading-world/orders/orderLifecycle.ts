/**
 * Order lifecycle projection transforms — W010 (pure, framework-free).
 *
 * Spec: spec/WORK-ITEMS.md W010 ("order-lifecycle surface — the trader's own
 * orders with live status (accepted/resting, partially-filled, filled,
 * cancelled/rejected), plus cancel/replace actions wired to the real
 * commands"); spec/WORLD-PROTOCOL.md "UI projection law" (projections may
 * batch/conflate/virtualize; they may never fabricate financial facts);
 * spec/ARCHITECTURE-LOCK.md A6 (statuses come from the authoritative
 * matching state via `query.getOrders` — never client-side guessed).
 *
 * All transforms here are display projections of REAL engine values:
 * - row models carry the engine's own `Order` verbatim plus derived,
 *   clearly-labeled display fields;
 * - cancel/replace availability follows the W003 lifecycle transition law
 *   (`ORDER_LIFECYCLE_TRANSITIONS`: terminal states have no outgoing
 *   transitions) — the CONTRACT's law, not a guess; the engine's typed
 *   `order-not-modifiable` rejection still decides races;
 * - fill rows are derived from the journal's `matching.order.filled` events
 *   (structural payload mirror of the matching-engine taxonomy — the drift
 *   guard in the W010 tests runs the shapes against the REAL engine).
 */

import {
  isTerminalOrderStatus,
  type CommandResult,
  type Order,
  type OrderStatus,
  type WorldEventEnvelope,
} from "tradrl-world-contracts";

/** Display row for one of the trader's orders (engine Order + labels). */
export interface OrderRowModel {
  readonly order: Order;
  readonly shortId: string;
  readonly shortReplacedBy?: string;
  /** e.g. "buy limit" — direction always as text (never color alone). */
  readonly sideAndKind: string;
  /** e.g. "3 / 10 filled". */
  readonly quantitySummary: string;
  /** Limit/stop prices actually carried by the order. */
  readonly priceSummary: string;
  /** TIF (+ post-only/reduce-only when set). */
  readonly constraintSummary: string;
  /** Rejection/cancel reason when the engine recorded one. */
  readonly reasonSummary: string;
  /** True while the lifecycle law admits cancel/replace. */
  readonly canModify: boolean;
  readonly canModifyReason: string;
}

function shortIdOf(orderId: string): string {
  return orderId.length <= 16 ? orderId : `${orderId.slice(0, 8)}…${orderId.slice(-4)}`;
}

function constraintSummaryOf(order: Order): string {
  const parts: string[] = [order.constraints.timeInForce];
  if (order.constraints.postOnly === true) {
    parts.push("post-only");
  }
  if (order.constraints.reduceOnly === true) {
    parts.push("reduce-only");
  }
  return parts.join(" · ");
}

function priceSummaryOf(order: Order): string {
  const parts: string[] = [];
  if (order.limitPrice !== undefined) {
    parts.push(`limit ${order.limitPrice}`);
  }
  if (order.stopPrice !== undefined) {
    parts.push(`stop ${order.stopPrice}`);
  }
  return parts.length === 0 ? "—" : parts.join(" · ");
}

function reasonSummaryOf(order: Order): string {
  if (order.rejectionReason !== undefined) {
    return `rejected: ${order.rejectionReason}`;
  }
  if (order.cancelReason !== undefined) {
    return `cancelled: ${order.cancelReason}`;
  }
  return "";
}

/** Derive the display row for one engine order (pure). */
export function deriveOrderRowModel(order: Order): OrderRowModel {
  const canModify = !isTerminalOrderStatus(order.status);
  return {
    order,
    shortId: shortIdOf(order.orderId),
    ...(order.replacedByOrderId === undefined
      ? {}
      : { shortReplacedBy: shortIdOf(order.replacedByOrderId) }),
    sideAndKind: `${order.side} ${order.kind}`,
    quantitySummary:
      order.filledQuantity === "0"
        ? `${order.quantity} (0 filled)`
        : `${order.filledQuantity} / ${order.quantity} filled`,
    priceSummary: priceSummaryOf(order),
    constraintSummary: constraintSummaryOf(order),
    reasonSummary: reasonSummaryOf(order),
    canModify,
    canModifyReason: canModify
      ? "working — the venue accepts cancel/replace"
      : `${order.status} is terminal — the lifecycle law has no outgoing transitions (order-not-modifiable)`,
  };
}

/** Sort orders for display: newest submissions first, stable by id. */
export function sortOrdersForDisplay(orders: readonly Order[]): readonly Order[] {
  return [...orders].sort((a, b) => {
    if (a.submittedAt !== b.submittedAt) {
      return b.submittedAt - a.submittedAt;
    }
    return a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0;
  });
}

/** Display filter options for the lifecycle list (display-only conflation). */
export type OrderDisplayFilter = "all" | "working" | "terminal";

/** Working (non-terminal) statuses per the W003 lifecycle law. */
export function isWorkingStatus(status: OrderStatus): boolean {
  return !isTerminalOrderStatus(status);
}

/** Apply the display filter over the engine's own orders (no invented rows). */
export function applyOrderDisplayFilter(
  orders: readonly Order[],
  filter: OrderDisplayFilter,
): readonly Order[] {
  if (filter === "all") {
    return orders;
  }
  return orders.filter((order) =>
    filter === "working" ? isWorkingStatus(order.status) : isTerminalOrderStatus(order.status),
  );
}

// --- command outcome capsules ----------------------------------------------------

/** The engine's CommandResult as an honest display capsule. */
export interface CommandOutcomeCapsule {
  readonly kind: "acked" | "rejected" | "error";
  /** Full text, e.g. "acked · journal cursor 12 · commandId cmd-…" */
  readonly text: string;
  readonly commandId: string;
  readonly journalCursor?: number;
  readonly stage?: string;
  readonly code?: string;
  readonly message?: string;
}

/**
 * Describe a command result. Acked results surface the engine's own
 * `journalCursor` + `commandId`; rejections surface the stage and the TYPED
 * code — never swallowed, never fabricated.
 */
export function describeCommandOutcome(result: CommandResult): CommandOutcomeCapsule {
  if (result.status === "acked") {
    return {
      kind: "acked",
      commandId: result.ack.commandId,
      journalCursor: result.ack.journalCursor,
      text: `acked · journal cursor ${String(result.ack.journalCursor)} · accepted at ${String(
        result.ack.acceptedAt,
      )} · commandId ${result.ack.commandId}`,
    };
  }
  const { rejection } = result;
  return {
    kind: "rejected",
    commandId: "",
    stage: rejection.stage,
    code: rejection.code,
    message: rejection.message,
    text: `rejected (${rejection.stage}) · ${rejection.code} — ${rejection.message}`,
  };
}

/**
 * Describe a THROWN error from a command call (typed remote error, closed
 * transport, unavailable runtime). Thrown errors are transport/runtime
 * failures — distinct from the engine's typed rejection VALUES — and are
 * surfaced as honest error capsules, never as fabricated outcomes.
 */
export function describeThrownCommandError(error: unknown): CommandOutcomeCapsule {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return {
    kind: "error",
    commandId: "",
    text: `error (${name}) · ${message} — the command call failed (no fabricated outcome)`,
  };
}

// --- fills projection -----------------------------------------------------------

/**
 * Structural mirror of the matching engine's `matching.order.filled` payload
 * (matching-engine taxonomy, W014). The W010 tests prove the mirror against
 * the REAL engine's journal; the surface never imports engine internals
 * (ADR-003: UI depends on protocols, not concrete engines).
 */
export interface OrderFillEventPayload {
  readonly type: "matching.order.filled";
  readonly orderId: string;
  readonly instrumentId: string;
  readonly accountId: string;
  readonly fillId: string;
  readonly price: string;
  readonly quantity: string;
  readonly fee: { readonly currency: string; readonly amount: string; readonly rateBps: number };
  readonly liquidity: string;
  readonly marketRef: { readonly tradeId: string; readonly sequence: number };
  readonly cumulativeFilledQuantity: string;
  readonly status: OrderStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Structural guard for the fill payload (unknown journal payload → typed). */
export function isOrderFillEventPayload(payload: unknown): payload is OrderFillEventPayload {
  if (!isRecord(payload) || payload.type !== "matching.order.filled") {
    return false;
  }
  return (
    typeof payload.orderId === "string" &&
    typeof payload.instrumentId === "string" &&
    typeof payload.accountId === "string" &&
    typeof payload.fillId === "string" &&
    typeof payload.price === "string" &&
    typeof payload.quantity === "string" &&
    typeof payload.liquidity === "string" &&
    isRecord(payload.fee) &&
    typeof (payload.fee as Record<string, unknown>).currency === "string" &&
    typeof (payload.fee as Record<string, unknown>).amount === "string" &&
    typeof (payload.fee as Record<string, unknown>).rateBps === "number" &&
    isRecord(payload.marketRef) &&
    typeof (payload.marketRef as Record<string, unknown>).tradeId === "string" &&
    typeof (payload.marketRef as Record<string, unknown>).sequence === "number" &&
    typeof payload.cumulativeFilledQuantity === "string" &&
    typeof payload.status === "string"
  );
}

/** One fill of the trader's own orders, projected from the journal. */
export interface FillRowModel {
  readonly fillId: string;
  readonly orderId: string;
  readonly shortOrderId: string;
  readonly price: string;
  readonly quantity: string;
  readonly feeText: string;
  readonly liquidity: string;
  readonly marketTradeId: string;
  readonly marketSequence: number;
  readonly cumulativeFilledQuantity: string;
  readonly orderStatus: OrderStatus;
  readonly occurredAt: number;
  readonly sequence: number;
}

/**
 * Project fill rows from journal envelopes. Envelopes whose payload is not a
 * structurally-valid fill payload are SKIPPED (never guessed into rows);
 * `accountFilter` keeps only the trader's own fills (the payload carries the
 * engine's own accountId — venue truth).
 */
export function deriveFillRows(
  envelopes: readonly WorldEventEnvelope[],
  accountFilter?: string,
): readonly FillRowModel[] {
  const rows: FillRowModel[] = [];
  for (const envelope of envelopes) {
    if (envelope.eventType !== "matching.order.filled") {
      continue;
    }
    if (!isOrderFillEventPayload(envelope.payload)) {
      continue;
    }
    const payload = envelope.payload;
    if (accountFilter !== undefined && payload.accountId !== accountFilter) {
      continue;
    }
    rows.push({
      fillId: payload.fillId,
      orderId: payload.orderId,
      shortOrderId: shortIdOf(payload.orderId),
      price: payload.price,
      quantity: payload.quantity,
      feeText: `${payload.fee.amount} ${payload.fee.currency}`,
      liquidity: payload.liquidity,
      marketTradeId: payload.marketRef.tradeId,
      marketSequence: payload.marketRef.sequence,
      cumulativeFilledQuantity: payload.cumulativeFilledQuantity,
      orderStatus: payload.status,
      occurredAt: envelope.occurredAt,
      sequence: envelope.sequence,
    });
  }
  // Newest first (journal sequence desc); the journal is monotonic.
  return rows.sort((a, b) => b.sequence - a.sequence);
}
