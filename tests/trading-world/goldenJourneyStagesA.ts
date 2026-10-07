/**
 * The W019 golden journey — stages S0–S7 (origin through typed rejections).
 * Split from goldenJourney.helpers.ts for the 400-line lint law; the stage
 * code is verbatim (client reads/writes through the journey context).
 */

import type { JourneyContext } from "./goldenJourneyContext.js";

/** Run stages S0–S7; returns the per-stage fact objects. */
export async function stagesS0ThroughS7(ctx: JourneyContext) {
  // --- S0: the ctx.world origin -------------------------------------------------
  const clock0 = await ctx.client.clock.getClock();
  const book0 = await ctx.client.query.getOrderBook(ctx.inst, 5);
  const regimes0 = await ctx.regimes();
  const s0 = {
    clock: { simulationTime: clock0.simulationTime, status: clock0.status, speed: clock0.speed },
    bidLevels: book0.bids.length,
    askLevels: book0.asks.length,
    regimeAnnouncements: regimes0.length,
  };

  // --- S1: step 10s — the generated market seeds itself ---------------------
  await ctx.client.clock.step(10_000);
  const q1 = await ctx.client.query.getQuote(ctx.inst);
  const book1 = await ctx.client.query.getOrderBook(ctx.inst, 5);
  const trades1 = await ctx.client.query.getTrades(ctx.inst, {});
  const regimes1 = await ctx.regimes();
  const s1 = {
    quote: q1 as unknown as Record<string, unknown>,
    book: book1 as unknown as Record<string, unknown>,
    trades: trades1 as unknown as readonly Record<string, unknown>[],
    regimes: regimes1,
  };

  // --- S2: marketable limit buys (complete fill, then partial fill) ----------
  const t1 = await ctx.now();
  const buy1Ack = await ctx.submit(
    "golden-buy-1",
    { kind: "limit", side: "buy", quantity: "1", limitPrice: "4800.25", constraints: { timeInForce: "GTC" } },
    t1,
  );
  const buy19Ack = await ctx.submit(
    "golden-buy-19",
    { kind: "limit", side: "buy", quantity: "19", limitPrice: "4800.25", constraints: { timeInForce: "GTC" } },
    t1,
  );
  const q2 = await ctx.client.query.getQuote(ctx.inst);
  const book2 = await ctx.client.query.getOrderBook(ctx.inst, 5);
  const positions2 = await ctx.client.query.getPositions(ctx.account);
  const portfolio2 = await ctx.client.query.getPortfolio(ctx.account);
  const orders2 = await ctx.ourOrders();
  const s2 = {
    buy1Ack,
    buy19Ack,
    quote: q2 as unknown as Record<string, unknown>,
    askTop: book2.asks.slice(0, 3),
    positions: positions2 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio2 as unknown as Record<string, unknown>,
    orders: orders2 as unknown as readonly Record<string, unknown>[],
  };

  // --- S3: resting sell high + resting buy deep ------------------------------
  const t2 = await ctx.now();
  const sellAck = await ctx.submit(
    "golden-sell-rest",
    { kind: "limit", side: "sell", quantity: "1", limitPrice: "4802.25", constraints: { timeInForce: "GTC" } },
    t2,
  );
  const deepAck = await ctx.submit(
    "golden-buy-deep",
    { kind: "limit", side: "buy", quantity: "1", limitPrice: "4790.00", constraints: { timeInForce: "GTC" } },
    t2,
  );
  const book12 = await ctx.client.query.getOrderBook(ctx.inst, 12);
  const book60 = await ctx.client.query.getOrderBook(ctx.inst, 60);
  const orders3 = await ctx.ourOrders();
  const s3 = {
    sellAck,
    deepAck,
    asks12: book12.asks,
    bidsAtOrBelow4792: book60.bids.filter((level) => Number(level.price) <= 4792),
    orders: orders3 as unknown as readonly Record<string, unknown>[],
  };

  // --- S5: cancel the buy-19 remainder ---------------------------------------
  const beforeCancel = await ctx.ourOrders();
  const remainder = beforeCancel.find(
    (order) => order.quantity === "19" && order.status !== "filled",
  );
  const cancelAck = (await ctx.client.command.cancelOrder({
    kind: "cancel-order",
    commandId: "golden-cancel-remainder" as never,
    worldId: ctx.world,
    issuedBy: ctx.participant,
    issuedAt: (await ctx.now()) as never,
    orderId: remainder?.orderId,
    reason: "golden journey",
  } as never)) as Record<string, unknown>;
  const book5 = await ctx.client.query.getOrderBook(ctx.inst, 5);
  const portfolio5 = await ctx.client.query.getPortfolio(ctx.account);
  const orders5 = await ctx.ourOrders();
  const s5 = {
    cancelAck,
    canceledOrder: (orders5.find((order) => order.quantity === "19") ?? {}) as Record<string, unknown>,
    askTop: book5.asks.slice(0, 2),
    portfolio: portfolio5 as unknown as Record<string, unknown>,
    orders: orders5 as unknown as readonly Record<string, unknown>[],
  };

  // --- S6: replace the resting sell 4802.25 → 4801.75 ------------------------
  const sellOrder = (await ctx.ourOrders()).find(
    (order) => order.side === "sell" && order.status !== "canceled" && order.status !== "filled",
  );
  const replaceAck = (await ctx.client.command.replaceOrder({
    kind: "replace-order",
    commandId: "golden-replace-sell" as never,
    worldId: ctx.world,
    issuedBy: ctx.participant,
    issuedAt: (await ctx.now()) as never,
    orderId: sellOrder?.orderId,
    limitPrice: "4801.75" as never,
  } as never)) as Record<string, unknown>;
  const book12b = await ctx.client.query.getOrderBook(ctx.inst, 12);
  const orders6 = await ctx.ourOrders();
  const s6 = {
    replaceAck,
    asksAtOrAbove4801: book12b.asks.filter((level) => Number(level.price) >= 4801),
    orders: orders6 as unknown as readonly Record<string, unknown>[],
  };

  // --- S7: typed rejections (values, never wire errors) -----------------------
  const t3 = await ctx.now();
  const fokRejection = await ctx.submit(
    "golden-fok",
    { kind: "limit", side: "buy", quantity: "1", limitPrice: "4000.00", constraints: { timeInForce: "FOK" } },
    t3,
  );
  const unknownCancelRejection = (await ctx.client.command.cancelOrder({
    kind: "cancel-order",
    commandId: "golden-cancel-unknown" as never,
    worldId: ctx.world,
    issuedBy: ctx.participant,
    issuedAt: t3 as never,
    orderId: `ord:${ctx.world}:999999`,
    reason: "x",
  } as never)) as Record<string, unknown>;
  const s7 = { fokRejection, unknownCancelRejection };
  return { s0, s1, s2, s3, s5, s6, s7 };
}
