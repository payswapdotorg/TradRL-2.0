/**
 * The W019 golden journey — stages S10–S14 (the mean-reversion dwell, the
 * trend fill, the HV/LL/closing-MR boundaries). Split from
 * goldenJourney.helpers.ts for the 400-line lint law; verbatim stage code.
 */

import { MIN, SIM_START } from "./goldenJourneyFacts.js";
import type { JourneyContext } from "./goldenJourneyContext.js";

/** Run stages S10–S14; returns the per-stage fact objects. */
export async function stagesS10ThroughS14(ctx: JourneyContext) {
  // --- S10: mean-reversion dwell — when does the replaced sell fill? ----------
  const dwellScan: { atMs: number; sell: string; deep: string }[] = [];
  let sellFilledAtMs = 0;
  for (const offset of [70_000, 150_000, 300_000, 600_000, 900_000, 1_200_000, 1_770_000]) {
    await ctx.client.clock.seek((SIM_START + 10_000 + offset) as never);
    const orders = await ctx.ourOrders();
    const newSell = orders.find((order) => order.limitPrice === "4801.75" && order.side === "sell");
    const deep = orders.find((order) => order.limitPrice === "4790.00");
    const atMs = 10_000 + offset;
    dwellScan.push({
      atMs,
      sell: newSell?.status ?? "MISSING",
      deep: deep?.status ?? "MISSING",
    });
    if (newSell !== undefined && newSell.status === "filled") {
      sellFilledAtMs = atMs;
      break;
    }
  }
  const trades10 = await ctx.client.query.getTrades(ctx.inst, {});
  const positions10 = await ctx.client.query.getPositions(ctx.account);
  const portfolio10 = await ctx.client.query.getPortfolio(ctx.account);
  const quote10 = await ctx.client.query.getQuote(ctx.inst);
  const s10 = {
    scan: dwellScan,
    sellFilledAtMs,
    trades: trades10.length,
    lastTrades: trades10.slice(-3) as unknown as readonly Record<string, unknown>[],
    positions: positions10 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio10 as unknown as Record<string, unknown>,
    quote: quote10 as unknown as Record<string, unknown>,
  };

  // --- S11: the trend regime — when does the deep buy fill? -------------------
  const trendScan: {
    atMs: number;
    quote: Record<string, unknown>;
    deep: string;
    deepFilled: string;
  }[] = [];
  let deepFilledAtMs = 0;
  for (const target of [30 * MIN + 30_000, 31 * MIN, 32 * MIN]) {
    await ctx.client.clock.seek((SIM_START + target) as never);
    const quote = await ctx.client.query.getQuote(ctx.inst);
    const orders = await ctx.ourOrders();
    const deep = orders.find((order) => order.limitPrice === "4790.00");
    trendScan.push({
      atMs: target,
      quote: quote as unknown as Record<string, unknown>,
      deep: deep?.status ?? "MISSING",
      deepFilled: deep?.filledQuantity ?? "0",
    });
    if (deep !== undefined && deep.status === "filled") {
      deepFilledAtMs = target;
      break;
    }
  }
  const regimes11 = await ctx.regimes();
  const positions11 = await ctx.client.query.getPositions(ctx.account);
  const portfolio11 = await ctx.client.query.getPortfolio(ctx.account);
  const risk11 = await ctx.client.query.getRisk(ctx.account);
  const s11 = {
    scan: trendScan,
    deepFilledAtMs,
    regimes: regimes11.map(({ to }) => ({ to })),
    positions: positions11 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio11 as unknown as Record<string, unknown>,
    risk: risk11 as unknown as Record<string, unknown>,
  };

  // --- S12/S13/S14: the HV, LL and closing-MR boundaries ----------------------
  await ctx.client.clock.seek((SIM_START + 60 * MIN + 30_000) as never);
  const quote12 = await ctx.client.query.getQuote(ctx.inst);
  const trades12 = await ctx.client.query.getTrades(ctx.inst, {});
  const positions12 = await ctx.client.query.getPositions(ctx.account);
  const portfolio12 = await ctx.client.query.getPortfolio(ctx.account);
  const regimes12 = await ctx.regimes();
  const s12 = {
    quote: quote12 as unknown as Record<string, unknown>,
    trades: trades12.length,
    positions: positions12 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio12 as unknown as Record<string, unknown>,
    regimes: regimes12.map(({ to }) => ({ to })),
  };

  await ctx.client.clock.seek((SIM_START + 90 * MIN + 30_000) as never);
  const quote13 = await ctx.client.query.getQuote(ctx.inst);
  const trades13 = await ctx.client.query.getTrades(ctx.inst, {});
  const regimes13 = await ctx.regimes();
  const s13 = {
    quote: quote13 as unknown as Record<string, unknown>,
    trades: trades13.length,
    regimes: regimes13.map(({ to }) => ({ to })),
  };

  await ctx.client.clock.seek((SIM_START + 120 * MIN + 30_000) as never);
  const quote14 = await ctx.client.query.getQuote(ctx.inst);
  const trades14 = await ctx.client.query.getTrades(ctx.inst, {});
  const positions14 = await ctx.client.query.getPositions(ctx.account);
  const portfolio14 = await ctx.client.query.getPortfolio(ctx.account);
  const regimes14 = await ctx.regimes();
  const s14 = {
    quote: quote14 as unknown as Record<string, unknown>,
    trades: trades14.length,
    positions: positions14 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio14 as unknown as Record<string, unknown>,
    regimes: regimes14.map(({ to }) => ({ to })),
  };
  return { s10, s11, s12, s13, s14 };
}
