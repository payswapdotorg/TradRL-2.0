/**
 * THE W019 GOLDEN JOURNEY — part 1 of the World Alpha golden integration
 * suite: ONE scripted trader session through the multi-regime alpha day on
 * the REAL composed product, with every surface's numbers cross-checked
 * against the engine's direct projections.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md — B (market), C (execution),
 * D (financial state), E (clock), F (cross-view consistency: "one golden
 * command sequence must produce matching assertions in chart, DOM, T&S,
 * orders, positions, portfolio and risk"), G (branch safety, at the
 * integration surface), H (information firewall), L (evidence) — plus the
 * WORLD-PROTOCOL UI projection law and ARCHITECTURE-LOCK A6/A7.
 *
 * The journey itself lives in ./goldenJourney.helpers.ts (frozen command
 * stream). This file runs it ONCE (~6 minutes: the day is two simulated
 * hours across five regimes and ~96k journal events) and asserts:
 * - the PINNED deterministic facts (every number below was observed on this
 *   exact stream — they are the golden output, not expectations);
 * - every surface's derivation (W007–W012 transforms, the same functions
 *   the real surfaces render) equals the engine's own projections;
 * - the A7 firewall is visible (evidence/timeline reads hide latent market
 *   facts the current-state quote already reflects);
 * - the projection law: the published stream IS the journal (every event
 *   exactly once, sequences contiguous);
 * - ACCEPTANCE L: every fill cites its journaled trade; the first event is
 *   the origin-rule regime announcement; command causality is recorded.
 *
 * Run (repo root): node_modules/.bin/tsx --test tests/trading-world/*.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  GOLDEN_ACCOUNT_ID,
  GOLDEN_INSTRUMENT_ID,
  GOLDEN_WORLD_ID,
  runGoldenJourney,
  SIM_START,
  type GoldenJourneyFacts,
} from "./goldenJourney.helpers.js";

import {
  buildWatchlistRows,
  parseRegimeAnnouncements,
  REGIME_CHANGED_EVENT_TYPE,
  type MarketInstrumentId,
} from "../../packages/ui/src/trading-world/market/marketData.js";
import { buildDomLadderProjection } from "../../packages/ui/src/trading-world/orderbook/bookData.js";
import { buildTimeAndSalesProjection } from "../../packages/ui/src/trading-world/orderbook/tapeData.js";
import { buildChartSeriesProjection } from "../../packages/ui/src/trading-world/charts/chartData.js";
import {
  deriveFillRows,
  deriveOrderRowModel,
} from "../../packages/ui/src/trading-world/orders/orderLifecycle.js";
import { deriveFinancialSummary } from "../../packages/ui/src/trading-world/portfolio/portfolioData.js";
import { deriveRiskSummary } from "../../packages/ui/src/trading-world/portfolio/riskCards.js";
import {
  describeSimulationClockView,
  parseTimelineRegimeEntries,
} from "../../packages/ui/src/trading-world/simulation/clockTimelineData.js";

// The journey runs ONCE for the whole file (top-level await): every test
// below asserts on the captured facts — a single ~6-minute pass.
const facts: GoldenJourneyFacts = await runGoldenJourney();

/** Narrow a captured projection value with a loud failure message. */
function expect<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `expected ${what} to be present`);
  return value;
}

function moneyOf(value: unknown): string {
  return String((value as { amount?: unknown }).amount ?? "?");
}

test("B: the generated market — origin, seeded book, quotes that change across every regime", () => {
  // The world origin: paused clock, empty books, no announcements yet.
  assert.deepEqual(facts.s0, {
    clock: { simulationTime: SIM_START, status: "paused", speed: 1 },
    bidLevels: 0,
    askLevels: 0,
    regimeAnnouncements: 0,
  });

  // +10s: the makers have seeded a two-sided market around the 4800 anchor.
  assert.deepEqual(facts.s1.quote, {
    instrumentId: GOLDEN_INSTRUMENT_ID,
    bid: "4799.75",
    bidSize: "10",
    ask: "4800.25",
    askSize: "14",
    last: "4799.75",
    asOf: SIM_START + 10_000,
  });
  assert.deepEqual(facts.s1.book, {
    instrumentId: GOLDEN_INSTRUMENT_ID,
    asOf: SIM_START + 10_000,
    sequence: 61,
    bids: [
      { price: "4799.75", quantity: "10", orderCount: 2 },
      { price: "4799.5", quantity: "16", orderCount: 2 },
      { price: "4799.25", quantity: "16", orderCount: 2 },
    ],
    asks: [
      { price: "4800.25", quantity: "14", orderCount: 2 },
      { price: "4800.5", quantity: "16", orderCount: 2 },
      { price: "4800.75", quantity: "16", orderCount: 2 },
    ],
  });
  // The tape at +10s: the cold-start prints, all past their availableAt.
  assert.equal(facts.s1.trades.length, 5);
  // The W017 ORIGIN RULE: the first announcement is the regime in force at
  // the origin, carrying the anchor parameters.
  assert.deepEqual(facts.s1.regimes, [
    { at: SIM_START, to: "mean-reversion", parameters: { anchorPrice: 4800, direction: 1 } },
  ]);

  // The day: every regime boundary announced, in journal order (B: "the
  // deterministic market generator can create multiple regimes").
  assert.deepEqual(
    facts.endState.regimes,
    [
      { at: SIM_START, to: "mean-reversion", parameters: { anchorPrice: 4800, direction: 1 } },
      { at: SIM_START + 30 * 60_000, to: "trend" },
      { at: SIM_START + 60 * 60_000, to: "high-volatility" },
      { at: SIM_START + 90 * 60_000, to: "low-liquidity" },
      { at: SIM_START + 120 * 60_000, to: "mean-reversion" },
    ],
    "the multi-regime day, announced in journal order",
  );

  // Quotes and tape move across the regimes (B: quote/book/T&S change).
  assert.equal((facts.s12.quote as { last?: string }).last, "4215", "HV quote");
  assert.equal((facts.s13.quote as { last?: string }).last, "4009.5", "LL quote");
  assert.equal((facts.s14.quote as { last?: string }).last, "4043.5", "closing MR quote");
  assert.ok(facts.s12.trades > facts.s10.trades, "tape grows through HV");
  assert.ok(facts.s13.trades > facts.s12.trades, "tape grows through LL");
  assert.ok(facts.s14.trades > facts.s13.trades, "tape grows through the close");
  assert.deepEqual([facts.s10.trades, facts.s12.trades, facts.s13.trades, facts.s14.trades], [259, 1453, 3158, 3384]);
});

test("C: execution — complete fill, partial fill, cancel, replace, fees, rejections, position updates", () => {
  // Marketable buy 1 @ the ask: complete fill (5 journaled events, cursor 66).
  const buy1 = facts.s2.buy1Ack as { status: string; ack?: { resultingEventIds?: string[]; journalCursor?: number } };
  assert.equal(buy1.status, "acked");
  assert.deepEqual(buy1.ack?.resultingEventIds, [
    `evt:${GOLDEN_WORLD_ID}:62`,
    `evt:${GOLDEN_WORLD_ID}:63`,
    `evt:${GOLDEN_WORLD_ID}:64`,
    `evt:${GOLDEN_WORLD_ID}:65`,
    `evt:${GOLDEN_WORLD_ID}:66`,
  ]);
  assert.equal(buy1.ack?.journalCursor, 66);

  // Buy 19 into the 14 remaining at the ask: 13 filled, 6 working.
  const buy19 = facts.s2.buy19Ack as { status: string; ack?: { journalCursor?: number } };
  assert.equal(buy19.status, "acked");
  assert.equal(buy19.ack?.journalCursor, 74);
  const orders2 = facts.s2.orders;
  assert.deepEqual(
    orders2.map((order) => ({ id: order.orderId, status: order.status, qty: order.quantity, filled: order.filledQuantity })),
    [
      { id: `ord:${GOLDEN_WORLD_ID}:19`, status: "filled", qty: "1", filled: "1" },
      { id: `ord:${GOLDEN_WORLD_ID}:20`, status: "partially-filled", qty: "19", filled: "13" },
    ],
  );

  // Resting orders land on the book where they were placed.
  assert.equal((facts.s3.sellAck as { status: string }).status, "acked");
  assert.equal((facts.s3.deepAck as { status: string }).status, "acked");
  assert.deepEqual(facts.s3.asks12, [
    { price: "4800.5", quantity: "16", orderCount: 2 },
    { price: "4800.75", quantity: "16", orderCount: 2 },
    { price: "4802.25", quantity: "1", orderCount: 1 },
  ]);
  assert.deepEqual(facts.s3.bidsAtOrBelow4792, [{ price: "4790", quantity: "1", orderCount: 1 }]);

  // Cancel of the remainder: the order is canceled for a user request.
  assert.equal((facts.s5.cancelAck as { status: string }).status, "acked");
  assert.deepEqual(
    ((order) => ({ status: order.status, reason: order.cancelReason, filled: order.filledQuantity }))(
      expect(facts.s5.orders.find((order) => order.quantity === "19"), "the canceled order"),
    ),
    { status: "canceled", reason: "user-request", filled: "13" },
  );

  // Replace: the old order is replaced BY the new one at the new price.
  assert.equal((facts.s6.replaceAck as { status: string }).status, "acked");
  const replaced = expect(facts.s6.orders.find((order) => order.orderId === `ord:${GOLDEN_WORLD_ID}:21`), "the replaced sell");
  assert.equal(replaced.status, "replaced");
  assert.equal(replaced.replacedByOrderId, `ord:${GOLDEN_WORLD_ID}:23`);
  assert.deepEqual(facts.s6.asksAtOrAbove4801, [{ price: "4801.75", quantity: "1", orderCount: 1 }]);

  // Typed rejections are VALUES (typed stage + code + message), never errors.
  assert.deepEqual(facts.s7.fokRejection, {
    status: "rejected",
    rejection: {
      stage: "domain-rules",
      code: "fok-unfillable",
      message: "FOK buy 1 cannot fill immediately at 4000.00",
    },
  });
  assert.deepEqual(facts.s7.unknownCancelRejection, {
    status: "rejected",
    rejection: {
      stage: "validate",
      code: "unknown-order",
      message: `order ord:${GOLDEN_WORLD_ID}:999999 does not exist in this world`,
    },
  });

  // The resting sell fills during the mean-reversion dwell (+610s), the
  // deep buy during the trend (+32 min) — both at maker fees.
  assert.equal(facts.s10.sellFilledAtMs, 610_000);
  assert.deepEqual(
    facts.s10.scan.map((step) => [step.atMs, step.sell]),
    [[80_000, "accepted"], [160_000, "accepted"], [310_000, "accepted"], [610_000, "filled"]],
  );
  assert.equal(facts.s11.deepFilledAtMs, 1_920_000);
  assert.deepEqual(
    facts.s11.scan.map((step) => [step.atMs, step.deep]),
    [[1_830_000, "accepted"], [1_860_000, "accepted"], [1_920_000, "filled"]],
  );

  // End state: every order reached its terminal state.
  assert.deepEqual(
    facts.endState.ourOrders.map((order) => [order.orderId, order.status, order.filledQuantity]),
    [
      [`ord:${GOLDEN_WORLD_ID}:19`, "filled", "1"],
      [`ord:${GOLDEN_WORLD_ID}:20`, "canceled", "13"],
      [`ord:${GOLDEN_WORLD_ID}:21`, "replaced", "0"],
      [`ord:${GOLDEN_WORLD_ID}:22`, "filled", "1"],
      [`ord:${GOLDEN_WORLD_ID}:23`, "filled", "1"],
    ],
  );
});

test("D: financial state — exact figures at every stage of the day (fees, P&L, buying power)", () => {
  // S2: long 14 @ 4800.25. Cash moved by fees only (futures margin model):
  // taker 5 bps + 0.10 fixed on 14 lots = 33.80175.
  assert.equal(moneyOf((facts.s2.portfolio as { cash?: unknown }).cash), "99966.19825");
  assert.equal(moneyOf((facts.s2.portfolio as { buyingPower?: unknown }).buyingPower), "32762.69825");
  assert.equal(moneyOf((facts.s2.portfolio as { equity?: unknown }).equity), "99966.19825");
  const position2 = expect(facts.s2.positions[0], "the S2 position");
  assert.equal(position2.quantity, "14");
  assert.equal(position2.averageEntryPrice, "4800.25");
  assert.equal(moneyOf(position2.realizedPnl), "0");
  assert.equal(moneyOf(position2.unrealizedPnl), "0");

  // S10 (+610s): the sell filled at 4801.75 as MAKER (fee 1.06035) and
  // realized +1.5; the mark moved to 4799.75 (unrealized −6.5 on 13).
  assert.equal(moneyOf((facts.s10.portfolio as { cash?: unknown }).cash), "99965.1379");
  assert.equal(moneyOf((facts.s10.portfolio as { equity?: unknown }).equity), "99960.1379");
  const position10 = expect(facts.s10.positions[0], "the S10 position");
  assert.equal(position10.quantity, "13");
  assert.equal(moneyOf(position10.realizedPnl), "1.5");
  assert.equal(moneyOf(position10.unrealizedPnl), "-6.5");

  // S11 (+32 min): the deep buy filled at 4790 as maker (fee 1.058) — the
  // average entry is the exact weighted mean (13×4800.25 + 1×4790)/14.
  assert.equal(moneyOf((facts.s11.portfolio as { cash?: unknown }).cash), "99964.0799");
  const position11 = expect(facts.s11.positions[0], "the S11 position");
  assert.equal(position11.quantity, "14");
  assert.equal(position11.averageEntryPrice, "4799.517857142857");
  assert.equal(moneyOf(position11.unrealizedPnl), "-406.249999999998");

  // The boundary crossings re-mark the book — unrealized P&L follows.
  assert.equal(moneyOf(expect(facts.s12.positions[0], "the S12 position").unrealizedPnl), "-8183.249999999998");
  assert.equal(moneyOf((facts.s12.portfolio as { equity?: unknown }).equity), "91782.329900000002");
  assert.equal(moneyOf(expect(facts.s14.positions[0], "the S14 position").unrealizedPnl), "-10584.249999999998");

  // Risk: the alpha world declares no limits — the honest empty state.
  assert.deepEqual(facts.s11.risk, {
    accountId: GOLDEN_ACCOUNT_ID,
    worldId: GOLDEN_WORLD_ID,
    limits: {},
    breaches: [],
    asOf: SIM_START + 1_920_000,
  });

  // The end state, cross-checked against the headless report's own figures.
  assert.equal(moneyOf((facts.endState.portfolio as { cash?: unknown }).cash), "99964.0799");
  assert.equal(moneyOf((facts.endState.portfolio as { equity?: unknown }).equity), "89377.829900000002");
  const reportPnl = (facts.s18.report as { pnl?: readonly { realized?: { amount?: string }; unrealized?: { amount?: string }; total?: { amount?: string } }[] }).pnl;
  const traderPnl = expect(reportPnl?.[0], "the trader's report P&L");
  assert.equal(traderPnl.realized?.amount, "1.5");
  assert.equal(traderPnl.unrealized?.amount, "-10587.749999999998");
  assert.equal(traderPnl.total?.amount, "-10586.249999999998");
});

test("E: the clock — play, speed, pause, step; and the A8 refusals", () => {
  assert.deepEqual(facts.s15.play, { simulationTime: SIM_START + 7_230_000, status: "playing", speed: 1, followingRealtime: false });
  assert.deepEqual(facts.s15.speed2, { simulationTime: SIM_START + 7_230_000, status: "playing", speed: 2, followingRealtime: false });
  assert.deepEqual(facts.s15.pause, { simulationTime: SIM_START + 7_230_000, status: "paused", speed: 2, followingRealtime: false });
  assert.deepEqual(facts.s15.step, { simulationTime: SIM_START + 7_231_000, status: "paused", speed: 2, followingRealtime: false });
  // The backward JUMP refusal (A8), verbatim through the provider.
  assert.equal(
    facts.s15.jumpError,
    "TradingWorldRemoteError: ClockRejectionError: in-place backward move to 1700000010000 is refused: " +
      "rewind creates a branch from an immutable snapshot (ARCHITECTURE-LOCK A8)",
  );
  // The backward SEEK refusal (A8), verbatim — and the clock did not move.
  assert.equal(
    facts.s16.rewindError,
    "TradingWorldRemoteError :: ClockRejectionError: in-place backward move to 1700000600000 is refused: " +
      "rewind creates a branch from an immutable snapshot (ARCHITECTURE-LOCK A8)",
  );
  assert.deepEqual(facts.s16.clockAfter, { simulationTime: SIM_START + 7_231_000, status: "paused", speed: 2, followingRealtime: false });
});

test("G: snapshot + branch at the integration surface — lineage facts, parent immutability", () => {
  // The snapshot is content-addressed and journaled.
  assert.deepEqual(facts.s17.snapshotAck, {
    status: "acked",
    ack: {
      commandId: "golden-snapshot",
      worldId: GOLDEN_WORLD_ID,
      acceptedAt: SIM_START + 7_231_000,
      resultingEventIds: [`evt:${GOLDEN_WORLD_ID}:96207`],
      journalCursor: 96207,
    },
  });
  assert.deepEqual(facts.s17.snapshotDescriptor, {
    snapshotId: `snap:${GOLDEN_WORLD_ID}:1`,
    worldId: GOLDEN_WORLD_ID,
    createdAt: SIM_START + 7_231_000,
    journalCursor: 96206,
    digest: "82f0223c",
  });
  // The branch command journals ONE record with complete lineage facts.
  assert.deepEqual(facts.s17.branchEvent, {
    worldId: GOLDEN_WORLD_ID,
    sequence: 96208,
    eventId: `evt:${GOLDEN_WORLD_ID}:96208`,
    eventType: "world.branch.created",
    occurredAt: SIM_START + 7_231_000,
    causationId: "golden-branch",
    correlationId: "golden-branch",
    producer: "world-core",
    schemaVersion: "tradrl-world-sim.events@1",
    payload: {
      type: "world.branch.created",
      branchWorldId: `wld:${GOLDEN_WORLD_ID}:1`,
      parentWorldId: GOLDEN_WORLD_ID,
      sourceSnapshotId: `snap:${GOLDEN_WORLD_ID}:1`,
      snapshotDigest: "82f0223c",
      branchPointSequence: 96206,
      configuration: { label: "golden what-if" },
      engine: "tradrl-world-sim",
      engineVersion: "0.1.0-skeleton",
      seed: `alpha:${GOLDEN_WORLD_ID}`,
      createdAt: SIM_START + 7_231_000,
      issuedBy: `participant-trader-${GOLDEN_WORLD_ID}`,
      createdViaCommand: "golden-branch",
    },
  });
  // The evidence port knows the child's complete lineage; the parent is a
  // root (empty own lineage).
  assert.equal(facts.s17.childLineage.length, 1);
  assert.deepEqual(facts.s17.selfLineage, []);
  // G at the integration surface: mutating the parent AFTER the branch does
  // not alter the snapshot (byte-identical descriptor).
  assert.deepEqual(
    facts.s17.snapshotDescriptorAfterParentMutation,
    facts.s17.snapshotDescriptor,
    "the content-addressed snapshot is immutable under later parent mutation",
  );
  // …and the parent journal kept advancing past the branch point.
  assert.equal((facts.s18.lastEvent as { eventId?: string }).eventId, `evt:${GOLDEN_WORLD_ID}:96209`);
  assert.equal((facts.s18.lastEvent as { eventType?: string }).eventType, "world.annotation.added");
});

test("H: the information firewall is visible — latent market facts are withheld from evidence reads", () => {
  // The journal holds 96209 events; the A7-filtered evidence read returns
  // 96203 — the final step's market facts are still behind availableAt
  // (ack 250ms + fill propagation 500ms), exactly the firewall's promise.
  assert.equal((facts.s18.report as { eventCount?: number }).eventCount, 96209);
  assert.equal(facts.s18.evidenceEvents, 96203);
  assert.equal(facts.s18.hiddenEventCount, 6);
  assert.equal(facts.s18.timelineEvents, facts.s18.evidenceEvents, "getTimeline applies the same A7 filter");
  // The current-state QUOTE already reflects the post-step book (last
  // 4043.25) while the firewalled TAPE still ends at the last visible print
  // (4043.5) — the two views are honestly different (A7 vs current state).
  assert.equal((facts.endState.quote as { last?: string }).last, "4043.25");
  const lastVisibleTrade = expect(facts.endState.trades[facts.endState.trades.length - 1], "the newest visible trade");
  assert.equal(lastVisibleTrade.price, "4043.5");
  assert.equal(facts.endState.trades.length, 3384, "the final step's prints are withheld from the tape");
});

test("L: evidence — causal journal events and provenance for the order lifecycle", () => {
  // The first journaled event is the origin-rule regime announcement,
  // produced by the generator with its own causation id.
  assert.deepEqual(
    (({ eventId, eventType, occurredAt, producer, causationId }) => ({ eventId, eventType, occurredAt, producer, causationId }))(facts.s18.firstEvent as never),
    {
      eventId: `evt:${GOLDEN_WORLD_ID}:1`,
      eventType: "market.regime.changed",
      occurredAt: SIM_START,
      producer: "market-generator",
      causationId: `gen:${GOLDEN_WORLD_ID}:1700000000000`,
    },
  );
  // Provenance: the accepted event of golden-buy-1 is command-caused.
  assert.deepEqual(facts.s18.provenance, {
    subjectEventId: `evt:${GOLDEN_WORLD_ID}:62`,
    producer: "matching-engine",
    inputs: [{ kind: "command", ref: "golden-buy-1" }],
    recordedAt: SIM_START + 10_000,
  });
  // EVERY one of the trader's fills cites a journaled trade, and the fills
  // per order sum to the order's filled quantity (the causality chain).
  const ourFills = deriveFillRows(
    facts.endState.fillEvents as never,
    GOLDEN_ACCOUNT_ID,
  );
  assert.ok(ourFills.length >= 4, `the trader's fills are projected from the journal (got ${String(ourFills.length)})`);
  const tradeIds = new Set(facts.endState.trades.map((trade) => String(trade.tradeId)));
  for (const fill of ourFills) {
    assert.ok(
      tradeIds.has(fill.marketTradeId),
      `fill ${fill.fillId} cites journaled trade ${fill.marketTradeId}`,
    );
  }
  const filledByOrder = new Map<string, number>();
  for (const fill of ourFills) {
    filledByOrder.set(fill.orderId, (filledByOrder.get(fill.orderId) ?? 0) + Number(fill.quantity));
  }
  for (const order of facts.endState.ourOrders) {
    if (order.status === "replaced") {
      continue; // the replaced order never rested in this journey
    }
    assert.equal(
      filledByOrder.get(String(order.orderId)) ?? 0,
      Number(order.filledQuantity),
      `fills of ${String(order.orderId)} sum to its filled quantity`,
    );
  }
});

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
    configuredIds: [GOLDEN_INSTRUMENT_ID as MarketInstrumentId],
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
