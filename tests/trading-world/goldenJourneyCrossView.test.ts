/**
 * The W019 golden journey tests — part F (cross-view consistency: every
 * surface's numbers equal the engine's direct projections) + the projection
 * law + the headless-report golden output. Split from the original
 * goldenJourney.test.ts for the 400-line lint law; verbatim. The journey
 * runs ONCE per file (top-level await).
 */

import {
  type GoldenJourneyFacts,
  runGoldenJourney,
  GOLDEN_WORLD_ID,
  SIM_START,
  GOLDEN_INSTRUMENT_ID
} from "./goldenJourney.helpers.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  type MarketInstrumentId,
  buildWatchlistRows,
  parseRegimeAnnouncements,
  REGIME_CHANGED_EVENT_TYPE
} from "../../packages/ui/src/trading-world/market/marketData.js";
import {
  buildDomLadderProjection
} from "../../packages/ui/src/trading-world/orderbook/bookData.js";
import {
  buildTimeAndSalesProjection
} from "../../packages/ui/src/trading-world/orderbook/tapeData.js";
import {
  buildChartSeriesProjection
} from "../../packages/ui/src/trading-world/charts/chartData.js";
import {
  deriveOrderRowModel
} from "../../packages/ui/src/trading-world/orders/orderLifecycle.js";
import {
  deriveFinancialSummary
} from "../../packages/ui/src/trading-world/portfolio/portfolioData.js";
import {
  deriveRiskSummary
} from "../../packages/ui/src/trading-world/portfolio/riskCards.js";
import {
  describeSimulationClockView,
  parseTimelineRegimeEntries
} from "../../packages/ui/src/trading-world/simulation/clockTimelineData.js";

// The journey runs ONCE for the whole file (top-level await): every test
// below asserts on the captured facts — a single ~6-minute pass.
const facts: GoldenJourneyFacts = await runGoldenJourney();

/** Narrow a captured projection value with a loud failure message. */
function expect<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `expected ${what} to be present`);
  return value;
}


test("F: cross-view consistency — every surface's numbers equal the engine's direct projections", () => {
  const end = facts.endState;

  // --- Watchlist (W008): the row IS the engine quote, verbatim. -----------
  const announcements = parseRegimeAnnouncements(
    (end.regimes as unknown[]).map((entry, index) => ({
      eventType: REGIME_CHANGED_EVENT_TYPE,
      sequence: index + 1,
      occurredAt: (entry as { at: number }).at,
      payload: { type: REGIME_CHANGED_EVENT_TYPE, to: (entry as { to: string }).to },
    })) as never,
  );
  const rows = buildWatchlistRows({
    configuredIds: [GOLDEN_INSTRUMENT_ID as never],
    discoveredIds: [],
    fetches: [
      {
        instrumentId: GOLDEN_INSTRUMENT_ID as MarketInstrumentId,
        quote: end.quote as never,
      },
    ],
    announcements,
    schedule: (end.meta as { regimeSchedule: never[] }).regimeSchedule,
    simulationTime: 1700007231000,
  });
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.source, "configured");
  assert.deepEqual(row.quote, end.quote, "the watchlist row carries the engine quote verbatim");
  // The regime in force is the announced one (journal truth) — the last
  // world-scoped announcement of the day (the closing mean-reversion).
  if (row.regime?.kind !== "announced") {
    assert.fail(
      `expected the announced regime in force, got ${row.regime === undefined ? "none" : row.regime.kind}`,
    );
  }
  assert.equal(row.regime.announcement.to, "mean-reversion", "the announced regime in force (the closing window)");

  // --- DOM (W009): the ladder IS the engine book, with exact depth. -------
  const ladder = buildDomLadderProjection(end.book as never);
  assert.deepEqual(
    { price: ladder.bestBid?.price, quantity: ladder.bestBid?.quantity },
    { price: (end.quote as { bid?: string }).bid, quantity: (end.quote as { bidSize?: string }).bidSize },
    "DOM best bid equals the quote's bid (same authoritative book)",
  );
  assert.deepEqual(
    { price: ladder.bestAsk?.price, quantity: ladder.bestAsk?.quantity },
    { price: (end.quote as { ask?: string }).ask, quantity: (end.quote as { askSize?: string }).askSize },
    "DOM best ask equals the quote's ask",
  );
  assert.equal(ladder.spread, "0.5");
  assert.equal(ladder.mid, "4043.5");
  assert.equal(ladder.levelCount, 6);
  // Exact cumulative depth, re-derived independently in this test:
  assert.deepEqual(
    ladder.bids.levels.map((level) => [level.price, level.cumulative]),
    [["4043.25", "15"], ["4043", "31"], ["4042.75", "44"]],
  );
  assert.deepEqual(
    ladder.asks.levels.map((level) => [level.price, level.cumulative]),
    [["4043.75", "16"], ["4044", "32"], ["4044.25", "48"]],
  );
  assert.equal(ladder.bids.totalQuantity, "44");
  assert.equal(ladder.asks.totalQuantity, "48");

  // --- Time & Sales (W009): the tape IS the engine trades, newest first. --
  const tape = buildTimeAndSalesProjection(end.trades as never, { maxRows: 20 });
  assert.equal(tape.totalPrints, 3384);
  assert.equal(tape.rows.length, 20);
  assert.equal(tape.lastPrice, "4043.5");
  assert.equal(tape.toSequence, 96179);
  const newest = expect(tape.rows[0], "the newest tape row");
  assert.deepEqual(
    [newest.price, newest.quantity, newest.occurredAt, newest.sequence],
    ["4043.5", "1", 1700007227000, 96179],
  );

  // --- Chart (W007): the candles ARE the trades, bucketed on sim time. ----
  const series = buildChartSeriesProjection(end.trades as never, { bucketMs: 60_000 });
  assert.equal(series.tradeCount, 3384);
  assert.equal(series.candles.length, 121, "the day charts exactly the minutes that traded (absent buckets stay absent)");
  // The last bucket re-derived here, independently of the transform:
  const lastBucketStart = Math.floor(1700007227000 / 60_000) * 60_000;
  const lastBucketTrades = (end.trades as { occurredAt: number; price: string; quantity: string; sequence: number }[])
    .filter((trade) => Math.floor(trade.occurredAt / 60_000) * 60_000 === lastBucketStart)
    .sort((left, right) => left.occurredAt - right.occurredAt || left.sequence - right.sequence);
  const lastCandle = series.candles[series.candles.length - 1]!;
  assert.equal(lastCandle.bucketStartMs, lastBucketStart);
  assert.equal(lastCandle.open, Number(lastBucketTrades[0]!.price));
  assert.equal(lastCandle.close, Number(lastBucketTrades[lastBucketTrades.length - 1]!.price));
  assert.equal(
    lastCandle.high,
    Math.max(...lastBucketTrades.map((trade) => Number(trade.price))),
  );
  assert.equal(
    lastCandle.low,
    Math.min(...lastBucketTrades.map((trade) => Number(trade.price))),
  );
  const totalVolume = series.volume.reduce((sum, bucket) => sum + bucket.value, 0);
  const expectedVolume = (end.trades as { quantity: string }[]).reduce(
    (sum, trade) => sum + Number(trade.quantity),
    0,
  );
  assert.equal(totalVolume, expectedVolume, "chart volume is the exact sum of the tape");

  // --- Working orders (W010): the rows ARE the engine orders. -------------
  const orderRows = facts.endState.ourOrders.map((order) => deriveOrderRowModel(order as never));
  assert.deepEqual(
    orderRows.map((model) => [model.order.orderId, model.order.status, model.quantitySummary, model.reasonSummary]),
    [
      [`ord:${GOLDEN_WORLD_ID}:19`, "filled", "1 / 1 filled", ""],
      [`ord:${GOLDEN_WORLD_ID}:20`, "canceled", "13 / 19 filled", "cancelled: user-request"],
      [`ord:${GOLDEN_WORLD_ID}:21`, "replaced", "1 (0 filled)", ""],
      [`ord:${GOLDEN_WORLD_ID}:22`, "filled", "1 / 1 filled", ""],
      [`ord:${GOLDEN_WORLD_ID}:23`, "filled", "1 / 1 filled", ""],
    ],
  );
  assert.equal(orderRows.every((model) => model.canModify === false), true, "every order is terminal — the lifecycle law admits no further cancel/replace");

  // --- Fills (W010): see the L test above (fills cite trades, sums match).

  // --- Portfolio (W011): the summary IS getPortfolio, and the margin solve
  // reproduces the engine's buying power bit-for-bit at the solved leverage.
  const summary = deriveFinancialSummary(
    end.portfolio as never,
    end.positions as never,
  );
  assert.equal(summary.cashText, "99964.0799");
  assert.equal(summary.buyingPowerText, "32772.329900000002");
  assert.equal(summary.equityText, "89377.829900000002");
  assert.equal(summary.realizedText, "1.5");
  assert.equal(summary.unrealizedText, "-10587.749999999998");
  assert.equal(summary.totalPnlText, "-10586.249999999998");
  assert.equal(summary.openPositionCount, 1);
  assert.equal(summary.grossExposureText, "56605.5"); // 14 × mark 4043.25, exact
  assert.deepEqual(summary.margin, {
    leverage: 1n,
    leverageText: "1×",
    marginUsedText: "56605.5",
    marginAvailableText: "32772.329900000002",
  });

  // --- Risk (W011): six constraint cards; no limits declared (honest),
  // real consumption still shown, zero breaches.
  const riskSummary = deriveRiskSummary({
    risk: end.risk as never,
    portfolio: end.portfolio as never,
    positions: end.positions as never,
  });
  assert.equal(riskSummary.cards.length, 6);
  assert.equal(riskSummary.enforcedCount, 0);
  assert.equal(riskSummary.breachCount, 0);
  assert.equal(riskSummary.noLimitsDeclared, true);
  const grossCard = expect(
    riskSummary.cards.find((card) => card.gate === "gross-exposure"),
    "the gross-exposure card",
  );
  assert.equal(grossCard.consumptionText, "56605.5");
  assert.equal(grossCard.overLimit, undefined, "no limit ⇒ no live comparison (honest)");

  // --- Simulation clock (W012): the strip readout IS the engine clock. ----
  const readout = describeSimulationClockView(facts.s18.finalClock as never);
  assert.equal(readout.statusText, "paused");
  assert.equal(readout.speedText, "2×");
  assert.equal(readout.timeText, "2023-11-15 00:13:51 UTC");
  const regimeEntries = parseTimelineRegimeEntries(
    (end.regimes as unknown[]).map((entry, index) => ({
      eventType: REGIME_CHANGED_EVENT_TYPE,
      sequence: index + 1,
      eventId: `evt:${GOLDEN_WORLD_ID}:${String(index + 1)}`,
      occurredAt: (entry as { at: number }).at,
      payload: { type: REGIME_CHANGED_EVENT_TYPE, to: (entry as { to: string }).to },
    })) as never,
  );
  assert.equal(regimeEntries.length, 5);
  for (let index = 1; index < regimeEntries.length; index += 1) {
    assert.ok(
      regimeEntries[index]!.sequence > regimeEntries[index - 1]!.sequence,
      "the strip's regime timeline follows journal order",
    );
  }
});

test("the projection law: the published stream IS the journal (every event exactly once)", () => {
  assert.equal(facts.s18.publishedBatches, 45416);
  assert.equal(facts.s18.publishedEvents, 96209);
  assert.equal(
    facts.s18.publishedEvents,
    (facts.s18.report as { eventCount?: number }).eventCount,
    "every journaled event crossed the published channel exactly once",
  );
  assert.equal(facts.s18.clockViews, 15, "one settled clock view per acked mutating clock call");
});

test("the headless report and the determinism manifest are the golden output", () => {
  const report = facts.s18.report as {
    worldId?: string;
    mode?: string;
    seed?: string;
    finalSimulationTime?: number;
    eventCount?: number;
    eventHash?: string;
  };
  assert.equal(report.worldId, GOLDEN_WORLD_ID);
  assert.equal(report.mode, "reactive-replay");
  assert.equal(report.seed, `alpha:${GOLDEN_WORLD_ID}`);
  assert.equal(report.finalSimulationTime, SIM_START + 7_231_000);
  assert.equal(report.eventCount, 96209);
  // THE journal digest of the golden journey:
  assert.equal(report.eventHash, "25b9f583");
  assert.deepEqual(
    (facts.s18.report as { balances?: { amount?: string }[] }).balances?.map((balance) => balance.amount),
    ["99964.0799", "93368.9922", "83819.986375"],
  );

  const manifest = facts.s18.manifest as {
    worldDefinitionVersion?: string;
    seed?: string;
    inputHashes?: { worldDefinition?: string; lineage?: string };
    dependencyVersions?: { node?: string };
    commandStreamHash?: string;
  };
  assert.equal(manifest.worldDefinitionVersion, "world-alpha@1");
  assert.equal(manifest.seed, `alpha:${GOLDEN_WORLD_ID}`);
  assert.equal(manifest.inputHashes?.worldDefinition, "723295ff");
  assert.equal(manifest.inputHashes?.lineage, "741638a5");
  assert.equal(manifest.dependencyVersions?.node, process.versions.node);
  assert.equal(manifest.commandStreamHash, "1ed6c7d8:54129");

  // K (journey-level): the world declares itself simulated, deterministically.
  assert.equal((facts.endState.meta as { executionAuthority?: string }).executionAuthority, "simulated-only");
  assert.deepEqual((facts.endState.meta as { determinism?: unknown }).determinism, { kind: "deterministic" });
});
