/**
 * W015 integration tests: the financial lifecycle through the CommandPort —
 * order acceptance checks, risk-gate rejections, reduce-only enforcement
 * over real positions, close-position through the venue, positions/P&L/
 * margin projections and breach recording — every figure hand-verified
 * exact decimal text (no floats anywhere).
 *
 * Spec: spec/DOMAIN-MODEL.md (account/position/P&L semantics),
 * spec/ACCEPTANCE-WORLD-ALPHA.md C (execution) + D (financial state),
 * spec/ARCHITECTURE-LOCK.md A13 (runtime gates).
 *
 * Two participants (a taker and a maker) trade one ES future on a fee
 * venue (maker 2bps, taker 5bps, 0.10 fixed per order, 250/500ms latency)
 * so fills, fees, positions and marks all exercise the exact ledger.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { SubmitOrderCommand } from "tradrl-world-contracts";
import { createHeadlessWorldEngine } from "../index.js";
import type { WorldDefinition } from "../index.js";
import {
  INSTRUMENT,
  START,
  TRADER,
  TRADER_ACCOUNT,
  OTHER_ACCOUNT,
  closePositionCommand,
  fixedWallTimeSource,
  testAccount,
  testDefinition,
  testParticipant,
  testVenue,
} from "./helpers.js";

const MAKER = "participant-maker" as never;
const TAKER_ACCOUNT = "account-taker" as never;

function financialDefinition(
  overrides: { riskLimits?: WorldDefinition["riskLimits"] } = {},
) {
  const definition = testDefinition({
    venues: [testVenue()],
    accounts: [
      testAccount(),
      testAccount({
        accountId: TAKER_ACCOUNT,
        balances: { USD: { amount: "20000.00" as never, currency: "USD" as never } } as never,
        buyingPower: { amount: "20000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "20000.00" as never, currency: "USD" as never },
        leverage: 2,
      }),
      testAccount({
        accountId: OTHER_ACCOUNT,
        balances: { USD: { amount: "10000.00" as never, currency: "USD" as never } } as never,
        buyingPower: { amount: "10000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "10000.00" as never, currency: "USD" as never },
        leverage: 2,
        permissions: { canTrade: true, canShort: false, liveExecutionAllowed: false },
      }),
    ],
    participants: [
      testParticipant(),
      testParticipant({ participantId: MAKER, accountId: TAKER_ACCOUNT }),
      testParticipant({ participantId: "participant-other" as never, accountId: OTHER_ACCOUNT }),
    ],
    ...(overrides.riskLimits === undefined ? {} : { riskLimits: overrides.riskLimits }),
  });
  return definition;
}

function engineOf(overrides: Parameters<typeof financialDefinition>[0] = {}) {
  return createHeadlessWorldEngine({
    definition: financialDefinition(overrides),
    wallTimeSource: fixedWallTimeSource(),
  });
}

function order(input: {
  commandId: string;
  by?: typeof TRADER | typeof MAKER | "participant-other";
  account?: typeof TRADER_ACCOUNT | typeof TAKER_ACCOUNT | typeof OTHER_ACCOUNT;
  submission: SubmitOrderCommand["submission"];
}): SubmitOrderCommand {
  return {
    kind: "submit-order",
    commandId: input.commandId as never,
    worldId: "world-w013-tests" as never,
    issuedBy: (input.by ?? TRADER) as never,
    issuedAt: START as never,
    accountId: (input.account ?? TRADER_ACCOUNT) as never,
    instrumentId: INSTRUMENT,
    submission: input.submission,
  };
}

const usd = (amount: string) => ({ amount: amount as never, currency: "USD" as never });

test("financial lifecycle: fills build positions, fees charge cash, margin follows", async () => {
  const e = engineOf();
  // 1. the taker rests an ask: sell 5 @ 4800.25 (acceptance: short 5 needs
  //    margin 5×4800.25/2 = 12000.625 ≤ 20000 available — accepted)
  const rest = await e.command.submitOrder(order({
    commandId: "cmd-rest-sell",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "5" as never,
      limitPrice: "4800.25" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  assert.equal(rest.status, "acked");
  // 2. the trader crosses 2: market buy 2 (margin 2×4800.25 = 9600.5 ≤ 100000)
  const cross = await e.command.submitOrder(order({
    commandId: "cmd-cross-buy",
    submission: {
      kind: "market",
      side: "buy",
      quantity: "2" as never,
      constraints: { timeInForce: "IOC" },
    },
  }));
  assert.equal(cross.status, "acked");

  // positions: trader long 2 @ 4800.25 (taker fee 4.80025 + 0.10 fixed);
  // taker short 2 @ 4800.25 (maker fee 1.9201 + 0.10 fixed — partial fill of 5)
  const positions = await e.query.getPositions();
  assert.deepEqual(positions, [
    {
      accountId: TRADER_ACCOUNT,
      worldId: "world-w013-tests",
      instrumentId: INSTRUMENT,
      quantity: "2",
      averageEntryPrice: "4800.25",
      markPrice: "4800.25",
      realizedPnl: usd("0"),
      unrealizedPnl: usd("0"),
      openedAt: START,
      updatedAt: START,
    },
    {
      accountId: TAKER_ACCOUNT,
      worldId: "world-w013-tests",
      instrumentId: INSTRUMENT,
      quantity: "-2",
      averageEntryPrice: "4800.25",
      markPrice: "4800.25",
      realizedPnl: usd("0"),
      unrealizedPnl: usd("0"),
      openedAt: START,
      updatedAt: START,
    },
  ]);
  const traderPositions = await e.query.getPositions(TRADER_ACCOUNT);
  assert.equal(traderPositions.length, 1);
  assert.equal(traderPositions[0]?.accountId, TRADER_ACCOUNT);

  // portfolio: cash = initial − fees (taker 4.90025, maker 2.0201)
  const traderPortfolio = await e.query.getPortfolio(TRADER_ACCOUNT);
  assert.deepEqual(traderPortfolio, {
    accountId: TRADER_ACCOUNT,
    worldId: "world-w013-tests",
    positions: traderPositions,
    cash: usd("99995.09975"),
    buyingPower: usd("90394.59975"),
    realizedPnl: usd("0"),
    unrealizedPnl: usd("0"),
    equity: usd("99995.09975"),
    asOf: START,
  });
  // margin: 2×4800.25 = 9600.5 used (leverage 1) → 99995.09975 − 9600.5
  // available; buying power = marginAvailable × leverage
  const takerPortfolio = await e.query.getPortfolio(TAKER_ACCOUNT);
  assert.equal(takerPortfolio.cash.amount, "19997.9799");
  // leverage 2: margin 9600.5/2 = 4800.25 used → 15197.7299 available × 2
  assert.equal(takerPortfolio.buyingPower.amount, "30395.4598");

  // risk projection: no limits declared → no breaches, empty limits
  const risk = await e.query.getRisk(TRADER_ACCOUNT);
  assert.deepEqual(risk, {
    accountId: TRADER_ACCOUNT,
    worldId: "world-w013-tests",
    limits: {},
    breaches: [],
    asOf: START,
  });
  // unknown accounts are typed errors; omitted ids default to the first account
  await assert.rejects(e.query.getPortfolio("account-ghost" as never), /unknown account/);
  const first = await e.query.getPortfolio();
  assert.equal(first.accountId, TRADER_ACCOUNT);
  const balances = e.headlessReport();
  assert.deepEqual(balances.balances.map((entry) => entry.amount), ["99995.09975", "19997.9799", "10000"]);
});

test("financial lifecycle: mark-to-market moves unrealized P&L with the tape", async () => {
  const e = engineOf();
  await e.command.submitOrder(order({
    commandId: "cmd-rest-sell",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "2" as never,
      limitPrice: "4800.25" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  await e.command.submitOrder(order({
    commandId: "cmd-cross-buy",
    submission: {
      kind: "market",
      side: "buy",
      quantity: "2" as never,
      constraints: { timeInForce: "IOC" },
    },
  }));
  // a later trade at a HIGHER price re-marks both positions: the maker rests
  // a fresh ask one tick up and the trader lifts it
  await e.clock.step(1_000);
  await e.command.submitOrder(order({
    commandId: "cmd-mark-rest",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "1" as never,
      limitPrice: "4801" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  await e.command.submitOrder(order({
    commandId: "cmd-mark-buy",
    submission: {
      kind: "market",
      side: "buy",
      quantity: "1" as never,
      constraints: { timeInForce: "IOC" },
    },
  }));
  // trader: long 2 @ 4800.25 + 1 @ 4801 = long 3 @ avg 4800.5, mark 4801
  //   → unrealized (4801 − 4800.5) × 3 = +1.5
  //   cash 100000 − 4.90025 − (4801 × 5bps + 0.10 = 2.5005) = 99992.59925
  //   → equity 99994.09925
  // taker: short 2 @ 4800.25 + sold 1 @ 4801 = short 3 @ avg 4800.5
  //   → unrealized (4800.5 − 4801) × 3 = −1.5, realized 0 (nothing closed)
  const traderPortfolio = await e.query.getPortfolio(TRADER_ACCOUNT);
  assert.equal(traderPortfolio.unrealizedPnl.amount, "1.5");
  assert.equal(traderPortfolio.equity.amount, "99994.09925");
  const takerPortfolio = await e.query.getPortfolio(TAKER_ACCOUNT);
  assert.equal(takerPortfolio.realizedPnl.amount, "0");
  assert.equal(takerPortfolio.unrealizedPnl.amount, "-1.5");
  // marks persist across a clock step with no events (deterministic marks)
  await e.clock.step(5_000);
  assert.equal((await e.query.getPortfolio(TRADER_ACCOUNT)).unrealizedPnl.amount, "1.5");
});

test("financial lifecycle: close-position reduces through the venue", async () => {
  const e = engineOf();
  await e.command.submitOrder(order({
    commandId: "cmd-rest-sell",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "2" as never,
      limitPrice: "4800.25" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  await e.command.submitOrder(order({
    commandId: "cmd-cross-buy",
    submission: {
      kind: "market",
      side: "buy",
      quantity: "2" as never,
      constraints: { timeInForce: "IOC" },
    },
  }));

  // close into an EMPTY bid: accepted, nothing filled, ioc-remainder cancels
  const empty = await e.command.closePosition(closePositionCommand({ commandId: "cmd-close-1" as never }));
  assert.equal(empty.status, "acked");
  assert.equal((await e.query.getPositions(TRADER_ACCOUNT))[0]?.quantity, "2");

  // the taker rests a bid (the ask is exhausted, so it rests); the close
  // crosses it and closes the long
  await e.command.submitOrder(order({
    commandId: "cmd-rest-buy",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "2" as never,
      limitPrice: "4800.5" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  const closed = await e.command.closePosition(closePositionCommand({ commandId: "cmd-close-2" as never }));
  assert.equal(closed.status, "acked");
  // position fully closed at 4800.5: realized (4800.5 − 4800.25) × 2 = 0.5
  assert.deepEqual(await e.query.getPositions(TRADER_ACCOUNT), [], "closed records do not project");
  const portfolio = await e.query.getPortfolio(TRADER_ACCOUNT);
  assert.equal(portfolio.realizedPnl.amount, "0.5");
  assert.equal(portfolio.unrealizedPnl.amount, "0");
  assert.equal(portfolio.positions.length, 0);
  // the ledger record persists in state (audit trail) — visible via report pnl
  assert.equal(e.headlessReport().pnl[0]?.realized.amount, "0.5");
  // a second close on the now-flat account is the typed no-open-position rejection
  const again = await e.command.closePosition(closePositionCommand({ commandId: "cmd-close-3" as never }));
  assert.equal(again.status, "rejected");
  assert.equal(again.status === "rejected" && again.rejection.code, "no-open-position");
});

test("financial lifecycle: pre-trade gates reject with typed evidence", async () => {
  const e = engineOf();
  // oversized vs margin: needs 480000, has 100000 → insufficient-buying-power
  const big = await e.command.submitOrder(order({
    commandId: "cmd-big",
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "100" as never,
      limitPrice: "4800" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  assert.equal(big.status, "rejected");
  assert.equal(big.status === "rejected" && big.rejection.stage, "domain-rules");
  assert.equal(big.status === "rejected" && big.rejection.code, "insufficient-buying-power");
  assert.match(big.status === "rejected" ? big.rejection.message : "", /480000/);

  // canShort=false blocks a projected short
  const short = await e.command.submitOrder(order({
    commandId: "cmd-short",
    by: "participant-other" as never,
    account: OTHER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "1" as never,
      limitPrice: "4800" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  assert.equal(short.status === "rejected" && short.rejection.code, "account-cannot-short");

  // market into an empty book sizes nothing (no reference) — the venue answers
  const emptyBook = await e.command.submitOrder(order({
    commandId: "cmd-empty",
    submission: {
      kind: "market",
      side: "buy",
      quantity: "10" as never,
      constraints: { timeInForce: "IOC" },
    },
  }));
  assert.equal(emptyBook.status, "acked");
});

test("financial lifecycle: declared risk limits gate with typed outcome evidence", async () => {
  const e = engineOf({
    riskLimits: {
      [TRADER_ACCOUNT]: {
        maxOrderQuantity: "2" as never,
        maxGrossExposure: usd("9000"),
        minBuyingPowerAfterOrder: usd("90000"),
      },
    },
  });
  // order-size fires after the acceptance check passed
  const over = await e.command.submitOrder(order({
    commandId: "cmd-over",
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "3" as never,
      limitPrice: "4800" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  assert.equal(over.status, "rejected");
  const rejection = over.status === "rejected" ? over.rejection : undefined;
  assert.equal(rejection?.code, "risk-limit");
  assert.match(rejection?.message ?? "", /order-size/);
  assert.match(rejection?.message ?? "", /limit 2, requested 3/);
  // the risk projection carries the declared limits
  const risk = await e.query.getRisk(TRADER_ACCOUNT);
  assert.deepEqual(risk.limits, {
    maxOrderQuantity: "2",
    maxGrossExposure: usd("9000"),
    minBuyingPowerAfterOrder: usd("90000"),
  });
  assert.deepEqual(risk.breaches, []);
  // gross exposure: buy 2 @ 4800 (within margin, within order size) projects
  // gross 9600 > 9000 → the exposure gate refuses it
  const gross = await e.command.submitOrder(order({
    commandId: "cmd-gross",
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "2" as never,
      limitPrice: "4800" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  const grossRejection = gross.status === "rejected" ? gross.rejection : undefined;
  assert.equal(grossRejection?.code, "risk-limit");
  assert.match(grossRejection?.message ?? "", /gross-exposure/);
  assert.match(grossRejection?.message ?? "", /9600 exceeds maxGrossExposure 9000/);
  // within all limits: buy 1 @ 4800 (exposure 4800, floor 96000−4800=91200 ≥ 90000)
  const fine = await e.command.submitOrder(order({
    commandId: "cmd-fine",
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "1" as never,
      limitPrice: "4800" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  assert.equal(fine.status, "acked");
});

test("financial lifecycle: reduce-only is enforced over real positions (the W014 seam wired)", async () => {
  const e = engineOf();
  // flat account: every reduce-only side would open a position
  const flat = await e.command.submitOrder(order({
    commandId: "cmd-ro-flat",
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "1" as never,
      limitPrice: "4800" as never,
      constraints: { timeInForce: "GTC", reduceOnly: true },
    },
  }));
  assert.equal(flat.status, "rejected");
  assert.equal(
    flat.status === "rejected" && flat.rejection.code,
    "reduce-only-would-increase-position",
    "previously permissive — the W015 wiring makes the venue seam real",
  );
  // build a short: the taker rests a bid and the trader sells into it
  await e.command.submitOrder(order({
    commandId: "cmd-ro-bid",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "2" as never,
      limitPrice: "4799.75" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  await e.command.submitOrder(order({
    commandId: "cmd-ro-short",
    submission: {
      kind: "market",
      side: "sell",
      quantity: "2" as never,
      constraints: { timeInForce: "IOC" },
    },
  }));
  assert.deepEqual((await e.query.getPositions(TRADER_ACCOUNT))[0]?.quantity, "-2");
  const reducing = await e.command.submitOrder(order({
    commandId: "cmd-ro-buy",
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "2" as never,
      limitPrice: "4700" as never,
      constraints: { timeInForce: "GTC", reduceOnly: true },
    },
  }));
  assert.equal(reducing.status, "acked");
  const increasing = await e.command.submitOrder(order({
    commandId: "cmd-ro-sell",
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "1" as never,
      limitPrice: "4900" as never,
      constraints: { timeInForce: "GTC", reduceOnly: true },
    },
  }));
  assert.equal(
    increasing.status === "rejected" && increasing.rejection.code,
    "reduce-only-would-increase-position",
  );
});

test("financial lifecycle: drawdown breaches record from journaled marks and block increases", async () => {
  const e = engineOf({
    riskLimits: { [TRADER_ACCOUNT]: { maxDrawdown: usd("10") } },
  });
  await e.command.submitOrder(order({
    commandId: "cmd-dd-rest",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "5" as never,
      limitPrice: "4800.25" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  await e.command.submitOrder(order({
    commandId: "cmd-dd-buy",
    submission: {
      kind: "market",
      side: "buy",
      quantity: "2" as never,
      constraints: { timeInForce: "IOC" },
    },
  }));
  // the mark drops to 4795 through the taker's own ask (the trader stays long 2)
  await e.command.submitOrder(order({
    commandId: "cmd-dd-lower",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "1" as never,
      limitPrice: "4795" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  await e.command.submitOrder(order({
    commandId: "cmd-dd-take",
    by: MAKER,
    account: TAKER_ACCOUNT,
    submission: {
      kind: "market",
      side: "buy",
      quantity: "1" as never,
      constraints: { timeInForce: "IOC" },
    },
  }));
  const risk = await e.query.getRisk(TRADER_ACCOUNT);
  assert.equal(risk.breaches.length, 1);
  assert.equal(risk.breaches[0]?.gate, "drawdown");
  // the trader is in drawdown: mark 4795 on long 2 @ 4800.25 → unrealized
  // −10.5, equity 99995.09975 − 10.5 = 99984.59975, peak 100000 → drawdown
  // 15.40025 > 10: risk-increasing orders are refused; a close never is
  const blocked = await e.command.submitOrder(order({
    commandId: "cmd-dd-more",
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "1" as never,
      limitPrice: "4795" as never,
      constraints: { timeInForce: "GTC" },
    },
  }));
  assert.equal(blocked.status === "rejected" && blocked.rejection.code, "risk-limit");
  assert.match(blocked.status === "rejected" ? blocked.rejection.message : "", /drawdown/);
  const closing = await e.command.closePosition(closePositionCommand({ commandId: "cmd-dd-close" as never }));
  assert.equal(closing.status, "acked", "a close is never refused by the drawdown gate");
});
