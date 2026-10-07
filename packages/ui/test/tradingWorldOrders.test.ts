/**
 * Order lifecycle tests (W010) — projection transforms, the fills drift
 * guard, LIVE updates against the REAL generated alpha world, and the three
 * tool surfaces' honest static states.
 *
 * Guards the work order's lifecycle laws:
 * - the lifecycle list renders the REAL getOrders projection: statuses,
 *   quantities and reasons are the engine's own values — LIVE updates come
 *  from engine publications + settled clock views (never polling guesses);
 * - cancel/replace actions issue REAL commands and surface their typed
 *   outcomes; terminal rows disable the actions with the W003 lifecycle law
 *   as the visible reason;
 * - fill rows derive from the engine's own matching.order.filled journal
 *   events (structural payload mirror proven against the REAL engine — the
 *   drift guard);
 * - the persistent SIMULATED disclosure and the honest unattached/loading/
 *   teaching/error states render in every surface (ACCEPTANCE K, A6/A14).
 *
 * The live section runs the REAL alpha attachment (engineAttachment — the
 * W017 generated market behind the W018 in-process transport): makers
 * requote around the reference as the clock advances, a marketable limit
 * FILLS against them, a far-away limit RESTS, and the trader cancels it —
 * every status read back from query.getOrders.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldOrders.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  applyOrderDisplayFilter,
  deriveFillRows,
  deriveOrderRowModel,
  describeCommandOutcome,
  describeThrownCommandError,
  isOrderFillEventPayload,
  isWorkingStatus,
  sortOrdersForDisplay,
  type FillRowModel,
  type OrderFillEventPayload,
} from "../src/trading-world/orders/orderLifecycle.js";
import {
  alphaTraderIdentity,
  buildCancelOrderCommand,
  buildSubmitOrderCommand,
  newUiCommandId,
} from "../src/trading-world/orders/orderTicket.js";
import {
  FILLS_TOOL_ID,
  ORDER_TICKET_TOOL_ID,
  WORKING_ORDERS_TOOL_ID,
  withFillsSurface,
  withOrderTicketSurface,
  withOrdersToolSurfaces,
  withWorkingOrdersSurface,
} from "../src/trading-world/orders/index.js";
import {
  FillsSurface,
  OrderTicketSurface,
  WorkingOrdersSurface,
} from "../src/trading-world/orders/index.js";
import { attachEngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import { createAlphaEngineTransport } from "../src/trading-world/runtime/engineAttachment.js";
import {
  createSimulatedNoopWorldClient,
  TradingWorldClientContext,
  type TradingWorldClient,
} from "../src/trading-world/runtime/worldClient.js";
import {
  createTradingWorldCoreToolRegistry,
  type TradingWorldToolSurfaceProps,
} from "../src/trading-world/registry/toolRegistry.js";
import { TradingWorldShell } from "../src/trading-world/components/TradingWorldShell.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../src/trading-world/components/PlaceholderToolSurface.js";
import {
  clearSharedCockpitLayoutStores,
  cockpitLayoutStorageKey,
  getSharedCockpitLayoutStore,
} from "../src/trading-world/layout/cockpitLayoutPersistence.js";
import { createDefaultTradingWorldCockpitLayout } from "../src/trading-world/layout/layoutProfiles.js";
import {
  openTradingWorldSidePane,
  type TradingWorldSidePaneTab,
} from "../src/lib/workspaceSidePane.js";
import type {
  CommandResult,
  Order,
  OrderStatus,
  TimestampMs,
  WorldEventEnvelope,
} from "tradrl-world-contracts";

// --- pure lifecycle transforms ---------------------------------------------------

function orderOf(overrides: Partial<Order>): Order {
  return {
    orderId: "order-1234567890abcdef" as never,
    worldId: "w" as never,
    instrumentId: "i" as never,
    accountId: "a" as never,
    submittedBy: "p" as never,
    kind: "limit",
    side: "buy",
    quantity: "10" as never,
    filledQuantity: "0" as never,
    limitPrice: "4800.25" as never,
    constraints: { timeInForce: "GTC" },
    status: "accepted",
    submittedAt: 1_700_000_000_000 as TimestampMs,
    ...overrides,
  } as Order;
}

test("deriveOrderRowModel: working rows are modifiable; terminal rows cite the lifecycle law", () => {
  const working = deriveOrderRowModel(orderOf({}));
  assert.equal(working.canModify, true);
  assert.equal(working.sideAndKind, "buy limit");
  assert.equal(working.quantitySummary, "10 (0 filled)");
  assert.equal(working.priceSummary, "limit 4800.25");
  assert.equal(working.constraintSummary, "GTC");

  const partial = deriveOrderRowModel(
    orderOf({ status: "partially-filled", filledQuantity: "4" as never }),
  );
  assert.equal(partial.quantitySummary, "4 / 10 filled");
  assert.equal(partial.canModify, true);

  for (const status of ["filled", "canceled", "rejected", "expired", "replaced"] as const) {
    const terminal = deriveOrderRowModel(orderOf({ status, filledQuantity: "10" as never }));
    assert.equal(terminal.canModify, false, `${status} is terminal`);
    assert.ok(terminal.canModifyReason.includes("order-not-modifiable"));
  }

  const rejected = deriveOrderRowModel(
    orderOf({ status: "rejected", rejectionReason: "fok-unfillable" }),
  );
  assert.equal(rejected.reasonSummary, "rejected: fok-unfillable");
  const replaced = deriveOrderRowModel(
    orderOf({ status: "replaced", replacedByOrderId: "order-ffffffffffffeeee" as never }),
  );
  assert.ok(replaced.shortReplacedBy !== undefined);
  assert.ok(replaced.shortReplacedBy.includes("…"));
  const cancelled = deriveOrderRowModel(orderOf({ status: "canceled", cancelReason: "user-request" }));
  assert.equal(cancelled.reasonSummary, "cancelled: user-request");
});

test("sortOrdersForDisplay orders newest-first with a stable tiebreak; filters conflate display only", () => {
  const a = orderOf({ orderId: "a" as never, submittedAt: 100 as TimestampMs });
  const b = orderOf({ orderId: "b" as never, submittedAt: 300 as TimestampMs });
  const c = orderOf({ orderId: "c" as never, submittedAt: 300 as TimestampMs });
  assert.deepEqual(
    sortOrdersForDisplay([a, b, c]).map((order) => order.orderId),
    ["b", "c", "a"],
  );
  const orders = [
    orderOf({ orderId: "w1" as never, status: "accepted" }),
    orderOf({ orderId: "t1" as never, status: "filled", filledQuantity: "10" as never }),
    orderOf({ orderId: "t2" as never, status: "canceled" }),
  ];
  assert.deepEqual(
    applyOrderDisplayFilter(orders, "all").map((order) => order.orderId),
    ["w1", "t1", "t2"],
  );
  assert.deepEqual(
    applyOrderDisplayFilter(orders, "working").map((order) => order.orderId),
    ["w1"],
  );
  assert.deepEqual(
    applyOrderDisplayFilter(orders, "terminal").map((order) => order.orderId),
    ["t1", "t2"],
  );
  assert.equal(isWorkingStatus("partially-filled"), true);
  assert.equal(isWorkingStatus("filled"), false);
});

test("describeCommandOutcome displays the ack cursor/commandId and the typed rejection code", () => {
  const acked = describeCommandOutcome({
    status: "acked",
    ack: {
      commandId: "cmd-1" as never,
      worldId: "w" as never,
      acceptedAt: 5 as TimestampMs,
      resultingEventIds: ["evt-1" as never],
      journalCursor: 12 as never,
    },
  });
  assert.equal(acked.kind, "acked");
  assert.equal(acked.journalCursor, 12);
  assert.ok(acked.text.includes("journal cursor 12"));
  assert.ok(acked.text.includes("cmd-1"));

  const rejected = describeCommandOutcome({
    status: "rejected",
    rejection: { stage: "domain-rules", code: "invalid-quantity", message: "lot grid" },
  });
  assert.equal(rejected.kind, "rejected");
  assert.equal(rejected.stage, "domain-rules");
  assert.equal(rejected.code, "invalid-quantity");
  assert.ok(rejected.text.includes("rejected (domain-rules) · invalid-quantity"));

  const thrown = describeThrownCommandError(new Error("boom"));
  assert.equal(thrown.kind, "error");
  assert.ok(thrown.text.includes("Error") && thrown.text.includes("boom"));
});

test("deriveFillRows projects only structurally-valid fill payloads of the trader's account", () => {
  const fillPayload: OrderFillEventPayload = {
    type: "matching.order.filled",
    orderId: "order-1",
    instrumentId: "i",
    accountId: "account-trader",
    fillId: "fill-1",
    price: "4800.25",
    quantity: "4",
    fee: { currency: "USD", amount: "0.1002", rateBps: 5 },
    liquidity: "taker",
    marketRef: { tradeId: "trade-9", sequence: 9 },
    cumulativeFilledQuantity: "4",
    status: "filled",
  };
  assert.equal(isOrderFillEventPayload(fillPayload), true);
  const envelopes: readonly WorldEventEnvelope[] = [
    {
      worldId: "w" as never,
      sequence: 10 as never,
      eventId: "evt-10" as never,
      eventType: "matching.order.filled",
      occurredAt: 7 as never,
      causationId: "cmd-1" as never,
      correlationId: "cmd-1" as never,
      producer: "matching-engine" as never,
      schemaVersion: "tradrl-world-sim.matching@1",
      payload: fillPayload,
    },
    {
      worldId: "w" as never,
      sequence: 11 as never,
      eventId: "evt-11" as never,
      eventType: "matching.order.filled",
      occurredAt: 8 as never,
      causationId: "cmd-2" as never,
      correlationId: "cmd-2" as never,
      producer: "matching-engine" as never,
      schemaVersion: "tradrl-world-sim.matching@1",
      // Another account's fill: filtered by the engine's own accountId.
      payload: { ...fillPayload, fillId: "fill-2", accountId: "account-mm" },
    },
    {
      worldId: "w" as never,
      sequence: 12 as never,
      eventId: "evt-12" as never,
      eventType: "market.trade.printed",
      occurredAt: 9 as never,
      causationId: "cmd-3" as never,
      correlationId: "cmd-3" as never,
      producer: "matching-engine" as never,
      schemaVersion: "tradrl-world-sim.matching@1",
      payload: { type: "market.trade.printed" },
    },
    {
      worldId: "w" as never,
      sequence: 13 as never,
      eventId: "evt-13" as never,
      eventType: "matching.order.filled",
      occurredAt: 10 as never,
      causationId: "cmd-4" as never,
      correlationId: "cmd-4" as never,
      producer: "matching-engine" as never,
      schemaVersion: "tradrl-world-sim.matching@1",
      // Malformed fill payload: skipped, never guessed into a row.
      payload: { type: "matching.order.filled", orderId: 42 },
    },
  ];
  const rows: readonly FillRowModel[] = deriveFillRows(envelopes, "account-trader");
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.fillId, "fill-1");
  assert.equal(row.price, "4800.25");
  assert.equal(row.quantity, "4");
  assert.equal(row.feeText, "0.1002 USD");
  assert.equal(row.liquidity, "taker");
  assert.equal(row.marketTradeId, "trade-9");
  assert.equal(row.marketSequence, 9);
  assert.equal(row.orderStatus, "filled");
  // No account filter keeps both fills (newest first by journal sequence).
  assert.equal(deriveFillRows(envelopes).length, 2);
  assert.equal(deriveFillRows(envelopes)[0]!.fillId, "fill-2");
});

// --- LIVE updates against the REAL generated alpha world --------------------------

const LIVE_WORLD = "world-w010-live";

async function attachAlpha(): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createAlphaEngineTransport(LIVE_WORLD),
    expectedWorldId: LIVE_WORLD,
  });
}

test("alpha world: a marketable limit FILLS against the generated makers; a far limit RESTS; cancel is typed", async (t) => {
  const client = await attachAlpha();
  t.after(() => client.dispose());
  const identity = alphaTraderIdentity(LIVE_WORLD);

  // Engine publications arrive as the generated market acts (the W018
  // published channel — the surface's live-update source).
  let publishedCount = 0;
  client.onPublished(() => {
    publishedCount += 1;
  });

  // Advance the clock: the makers quote around the 4800 reference.
  await client.clock.step(10_000);
  const quote = await client.query.getQuote(identity.instrumentId);
  assert.ok(quote.ask !== undefined, "makers must be quoting after 10s of market time");

  // A marketable limit buy at the ask fills against the makers.
  const taker = await client.command.submitOrder(
    buildSubmitOrderCommand({
      identity,
      worldId: LIVE_WORLD,
      form: {
        kind: "limit",
        side: "buy",
        quantity: "1",
        limitPrice: quote.ask!,
        stopPrice: "",
        timeInForce: "GTC",
        postOnly: false,
        reduceOnly: false,
      },
      commandId: newUiCommandId("taker"),
      issuedAt: quote.asOf,
    }),
  );
  assert.equal(taker.status, "acked");
  const liveStatus = async (): Promise<Order | undefined> => {
    const orders: readonly Order[] = await client.query.getOrders({
      accountId: identity.accountId,
    });
    return orders.find((order) => order.orderId !== undefined);
  };
  const filledOrder = await liveStatus();
  assert.ok(filledOrder !== undefined, "the trader's order is in the REAL projection");
  assert.equal(filledOrder.accountId, identity.accountId);
  const filled: OrderStatus = filledOrder.status;
  assert.ok(
    filled === "filled" || filled === "partially-filled",
    `marketable limit must fill against the makers (status: ${filled})`,
  );
  assert.notEqual(filledOrder.filledQuantity, "0");

  // A7 (honest observability): the fill EVENT carries the venue's
  // fillPropagation latency as availableAt — advance the clock past it, then
  // the journal surfaces the fill (never before).
  await client.clock.step(1_000);
  const fillEvents: readonly WorldEventEnvelope[] = await client.evidence.getEvents({
    types: ["matching.order.filled"],
  });
  const ownFills = fillEvents.filter(
    (envelope) => isOrderFillEventPayload(envelope.payload) &&
      envelope.payload.accountId === identity.accountId,
  );
  assert.ok(ownFills.length >= 1, "the trader's fill event is journaled");
  const rows = deriveFillRows(fillEvents, identity.accountId);
  assert.ok(rows.length >= 1);
  assert.equal(rows[0]!.liquidity, "taker");

  // A far-away resting limit rests (never fills at these prices).
  const bid = quote.bid ?? "4700.00";
  const farPrice = (Number(bid) - 100).toFixed(2);
  const resting = await client.command.submitOrder(
    buildSubmitOrderCommand({
      identity,
      worldId: LIVE_WORLD,
      form: {
        kind: "limit",
        side: "buy",
        quantity: "1",
        limitPrice: farPrice as never,
        stopPrice: "",
        timeInForce: "GTC",
        postOnly: false,
        reduceOnly: false,
      },
      commandId: newUiCommandId("resting"),
      issuedAt: quote.asOf,
    }),
  );
  assert.equal(resting.status, "acked");
  const ordersAfterRest: readonly Order[] = await client.query.getOrders({
    accountId: identity.accountId,
  });
  const restingOrder = ordersAfterRest.find(
    (order) => order.status === "accepted" && String(order.limitPrice) === farPrice,
  );
  assert.ok(restingOrder !== undefined, "the far limit rests as accepted");

  // Cancel it through the real command; the typed outcome + the projection
  // both tell the truth (user-request cancel reason).
  const cancel: CommandResult = await client.command.cancelOrder(
    buildCancelOrderCommand({
      identity,
      worldId: LIVE_WORLD,
      orderId: restingOrder.orderId as string,
      commandId: newUiCommandId("cancel"),
      issuedAt: quote.asOf,
    }),
  );
  assert.equal(cancel.status, "acked");
  const ordersAfterCancel: readonly Order[] = await client.query.getOrders({
    accountId: identity.accountId,
  });
  const cancelled = ordersAfterCancel.find((order) => order.orderId === restingOrder.orderId);
  assert.ok(cancelled !== undefined);
  assert.equal(cancelled.status, "canceled");
  assert.equal(cancelled.cancelReason, "user-request");

  // The market kept publishing while we worked (the generated cast's
  // commands are journaled — the surfaces' live-update source is real).
  assert.ok(publishedCount >= 1);
});

test("alpha world: getOrders filter semantics keep the cast's orders out of the trader's view", async (t) => {
  const client = await attachAlpha();
  t.after(() => client.dispose());
  const identity = alphaTraderIdentity(LIVE_WORLD);
  await client.clock.step(10_000);
  await client.command.submitOrder(
    buildSubmitOrderCommand({
      identity,
      worldId: LIVE_WORLD,
      form: {
        kind: "limit",
        side: "buy",
        quantity: "1",
        limitPrice: "1000.00",
        stopPrice: "",
        timeInForce: "GTC",
        postOnly: false,
        reduceOnly: false,
      },
      commandId: newUiCommandId("isolate"),
      issuedAt: 1_700_000_000_000 as TimestampMs,
    }),
  );
  const own: readonly Order[] = await client.query.getOrders({
    accountId: identity.accountId,
  });
  assert.ok(own.length >= 1);
  for (const order of own) {
    assert.equal(order.accountId, identity.accountId);
    assert.equal(order.submittedBy, identity.participantId);
  }
  // The unfiltered projection sees the synthetic cast too (venue truth —
  // the account filter is what scopes the trader's own view).
  const everyone: readonly Order[] = await client.query.getOrders();
  assert.ok(everyone.length > own.length, "the generated cast has orders of its own");
});

// --- surface static renders (the W007 pattern) -------------------------------------

const surfaceProps: TradingWorldToolSurfaceProps = {
  toolId: ORDER_TICKET_TOOL_ID,
  worldId: "world-alpha",
  layoutProfileId: "default",
  active: true,
  phase: "mounted-focused",
  onRequestClose: () => {},
};

function renderSurface(
  surface: typeof OrderTicketSurface,
  props: TradingWorldToolSurfaceProps = surfaceProps,
  client?: TradingWorldClient,
): string {
  const element = client
    ? createElement(
        TradingWorldClientContext.Provider,
        { value: client },
        createElement(surface, props),
      )
    : createElement(surface, props);
  return ReactDOMServer.renderToStaticMarkup(element);
}

function readyClient(worldId: string): TradingWorldClient {
  return { ...createSimulatedNoopWorldClient(worldId), status: "ready" };
}

test("the three tool ids match the W006 registry slots", () => {
  assert.equal(ORDER_TICKET_TOOL_ID, "order-ticket");
  assert.equal(WORKING_ORDERS_TOOL_ID, "working-orders");
  assert.equal(FILLS_TOOL_ID, "fills");
});

test("withOrdersToolSurfaces swaps all three W010 slots immutably", () => {
  const base = createTradingWorldCoreToolRegistry();
  const swapped = withOrdersToolSurfaces(base);
  // Immutable: the original registry is untouched.
  assert.equal(base.getTool(ORDER_TICKET_TOOL_ID)!.status, "placeholder");
  assert.equal(base.getTool(WORKING_ORDERS_TOOL_ID)!.status, "placeholder");
  assert.equal(base.getTool(FILLS_TOOL_ID)!.status, "placeholder");
  for (const [toolId, surface] of [
    [ORDER_TICKET_TOOL_ID, OrderTicketSurface],
    [WORKING_ORDERS_TOOL_ID, WorkingOrdersSurface],
    [FILLS_TOOL_ID, FillsSurface],
  ] as const) {
    const descriptor = swapped.getTool(toolId)!;
    assert.equal(descriptor.status, "implemented");
    assert.equal(descriptor.surface, surface);
    assert.equal(descriptor.ownerWorkOrder, "W010");
    assert.equal(descriptor.kind, "orders");
  }
  assert.equal(swapped.getTool(WORKING_ORDERS_TOOL_ID)!.defaultPanel, "bookkeeping");
  assert.equal(swapped.getTool(FILLS_TOOL_ID)!.defaultPanel, "bookkeeping");
  assert.equal(swapped.getTool(ORDER_TICKET_TOOL_ID)!.defaultPanel, "ticket");
  // Everything else is still the placeholder set.
  assert.equal(swapped.getTool("chart")!.status, "placeholder");
  assert.equal(swapped.listTools().length, 11);
  // Individual swaps accept custom surfaces (composition flexibility).
  function Custom(_props: TradingWorldToolSurfaceProps) {
    return createElement("div", { "data-custom-orders-surface": "" });
  }
  const custom = withFillsSurface(
    withWorkingOrdersSurface(withOrderTicketSurface(base, Custom), Custom),
    Custom,
  );
  assert.equal(custom.getTool(ORDER_TICKET_TOOL_ID)!.surface, Custom);
  assert.equal(custom.getTool(WORKING_ORDERS_TOOL_ID)!.surface, Custom);
  assert.equal(custom.getTool(FILLS_TOOL_ID)!.surface, Custom);
});

test("the ticket renders its honest unattached teaching state with the persistent disclosure", () => {
  const markup = renderSurface(OrderTicketSurface);
  assert.ok(markup.includes('data-trading-world-order-ticket=""'));
  assert.ok(markup.includes('data-trading-world-ticket-runtime="unattached"'));
  assert.ok(markup.includes('data-trading-world-ticket-instrument="instrument-es-world-alpha"'));
  assert.ok(markup.includes('data-trading-world-ticket-notice="unattached"'));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.ok(markup.includes('data-trading-world-simulation-disclosure=""'));
  // The form is visible (the trader can prepare) but submission is disabled
  // with visible reasons — never silently.
  assert.ok(markup.includes('data-trading-world-ticket-submit=""'));
  assert.ok(markup.includes("disabled"));
  assert.ok(markup.includes("submission disabled"));
  assert.ok(markup.includes("limit requires a limit price"));
  // All four kinds + three TIFs are offered (the alpha venue policy).
  for (const kind of ["market", "limit", "stop", "stop-limit"]) {
    assert.ok(markup.includes(`data-trading-world-ticket-kind="${kind}"`));
  }
  for (const tif of ["GTC", "IOC", "FOK"]) {
    assert.ok(markup.includes(`data-trading-world-ticket-tif="${tif}"`));
  }
});

test("the ticket renders the loading instrument state against an attached client (no SSR data)", () => {
  const markup = renderSurface(OrderTicketSurface, surfaceProps, readyClient("world-alpha"));
  assert.ok(markup.includes('data-trading-world-ticket-runtime="ready"'));
  assert.ok(!markup.includes('data-trading-world-ticket-notice="unattached"'));
  // Effects have not run in SSR: no instrument facts, no outcomes, and the
  // structural limit-price reason still disables submission.
  assert.ok(!markup.includes("data-trading-world-ticket-outcomes"));
  assert.ok(markup.includes("limit requires a limit price"));
  assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
});

test("the working-orders and fills surfaces render honest unattached states", () => {
  const working = renderSurface(WorkingOrdersSurface, {
    ...surfaceProps,
    toolId: WORKING_ORDERS_TOOL_ID,
  });
  assert.ok(working.includes('data-trading-world-working-orders=""'));
  assert.ok(working.includes('data-trading-world-orders-data-status="unattached"'));
  assert.ok(working.includes('data-trading-world-orders-account="account-trader-world-alpha"'));
  assert.ok(working.includes("No world runtime attached"));
  assert.ok(working.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));

  const fills = renderSurface(FillsSurface, { ...surfaceProps, toolId: FILLS_TOOL_ID });
  assert.ok(fills.includes('data-trading-world-fills=""'));
  assert.ok(fills.includes('data-trading-world-fills-status="unattached"'));
  assert.ok(fills.includes("No world runtime attached"));
  assert.ok(fills.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
});

test("the working-orders and fills surfaces render the loading state against an attached client", () => {
  const working = renderSurface(
    WorkingOrdersSurface,
    { ...surfaceProps, toolId: WORKING_ORDERS_TOOL_ID },
    readyClient("world-alpha"),
  );
  assert.ok(working.includes('data-trading-world-orders-data-status="loading"'));
  const fills = renderSurface(
    FillsSurface,
    { ...surfaceProps, toolId: FILLS_TOOL_ID },
    readyClient("world-alpha"),
  );
  assert.ok(fills.includes('data-trading-world-fills-status="loading"'));
});

test("mounted-hidden phases keep the order surfaces alive (J-WORLD-02)", () => {
  for (const [surface, marker] of [
    [OrderTicketSurface, "data-trading-world-order-ticket"],
    [WorkingOrdersSurface, "data-trading-world-working-orders"],
    [FillsSurface, "data-trading-world-fills"],
  ] as const) {
    const markup = renderSurface(surface, {
      ...surfaceProps,
      active: false,
      phase: "mounted-hidden",
    });
    assert.ok(markup.includes('data-trading-world-surface-phase="mounted-hidden"'));
    assert.ok(markup.includes(marker));
    assert.ok(markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  }
});

test("the cockpit shell mounts the three real W010 surfaces through the registry seam", () => {
  clearSharedCockpitLayoutStores();
  const state = openTradingWorldSidePane(null, {
    workspaceKey: "/ws/w010-shell",
    worldId: "world-alpha",
    layoutProfileId: "default",
  });
  const tab = state.tabs[0] as TradingWorldSidePaneTab;
  getSharedCockpitLayoutStore(
    cockpitLayoutStorageKey("/ws/w010-shell", "default"),
    createDefaultTradingWorldCockpitLayout(),
  );
  const registry = withOrdersToolSurfaces(createTradingWorldCoreToolRegistry());
  const markup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldShell, {
      tab,
      visible: true,
      focused: true,
      registry,
    }),
  );
  // The three real W010 surfaces are mounted (unattached in SSR — the shell
  // attaches the engine in effects)…
  assert.ok(markup.includes('data-trading-world-order-ticket=""'));
  assert.ok(markup.includes('data-trading-world-working-orders=""'));
  assert.ok(markup.includes('data-trading-world-fills=""'));
  assert.ok(markup.includes('data-trading-world-orders-data-status="unattached"'));
  // …their placeholders are gone…
  assert.ok(!markup.includes("Order Ticket surface placeholder"));
  assert.ok(!markup.includes("Working Orders surface placeholder"));
  assert.ok(!markup.includes("Fills surface placeholder"));
  // …while the other tools keep theirs (one WO, one tool set).
  assert.ok(markup.includes("Chart surface placeholder"));
  assert.ok(markup.includes("Positions surface placeholder"));
});
