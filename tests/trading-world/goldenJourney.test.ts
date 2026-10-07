/**
 * The W019 golden journey tests — parts A–E (creation, the generated market,
 * execution, the exact financial figures, the clock). Split from the
 * original goldenJourney.test.ts for the 400-line lint law; the journey and
 * assertions are verbatim. The journey runs ONCE per file (top-level await).
 */

import {
  type GoldenJourneyFacts,
  runGoldenJourney,
  GOLDEN_WORLD_ID,
  SIM_START,
  GOLDEN_INSTRUMENT_ID,
  GOLDEN_ACCOUNT_ID
} from "./goldenJourney.helpers.js";
import assert from "node:assert/strict";
import test from "node:test";

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

