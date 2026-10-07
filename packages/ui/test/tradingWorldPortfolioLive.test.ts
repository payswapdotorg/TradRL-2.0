/**
 * Portfolio/positions/risk LIVE tests (W011) — every figure read back from
 * the REAL engine through the W018 provider seam, never from fixtures.
 *
 * Two real worlds drive the suites:
 * 1. THE ALPHA WORLD (runtime/engineAttachment.ts — the W017 generated
 *    market behind the W018 in-process transport): a marketable limit
 *    FILLS against the generated makers, the position projects with exact
 *    decimal P&L, the financial summary verifies the W003 consistency law
 *    and derives margin bit-for-bit, the mark MOVES with the generated
 *    market (cross-view consistency with getQuote's last print), and the
 *    Close action terminates at the REAL CommandPort with a typed ack —
 *    the flat book afterwards is the honest projection.
 * 2. A SCRATCH WORLD WITH DECLARED RISK LIMITS (the sim helpers' definition
 *    + createInProcessWorldTransport, the W018 test pattern): leverage 2,
 *    all six gates declared, and a MARK-CAUSED gross-exposure breach (a
 *    later print re-marks the trader's position past the limit — the W015
 *    documented case: an exposure limit can be breached by the market,
 *    with no new order). Every hand-computed figure below is exact decimal
 *    arithmetic (no floats anywhere).
 *
 * Plus the framework-free projection-feed controller lifecycle: fail-closed
 * start, engine-publication refreshes, honest flat book, typed errors for a
 * mis-scoped account, and fail-closed stop.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldPortfolioLive.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { SubmitOrderCommand } from "tradrl-world-contracts";
import { createInProcessWorldTransport } from "../../tradrl-world-sim/adapter/inProcess.js";
import {
  fixedWallTimeSource,
  INSTRUMENT,
  START,
  testAccount,
  testDefinition,
  testParticipant,
  testVenue,
  TRADER,
  TRADER_ACCOUNT,
  WORLD,
} from "../../tradrl-world-sim/world/test/helpers.js";
import { attachEngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import { createAlphaEngineTransport } from "../src/trading-world/runtime/engineAttachment.js";
import { alphaTraderPortfolioIdentity } from "../src/trading-world/portfolio/portfolioIdentity.js";
import { deriveFinancialSummary } from "../src/trading-world/portfolio/portfolioData.js";
import { deriveRiskSummary } from "../src/trading-world/portfolio/riskCards.js";
import {
  createPortfolioProjectionFeedController,
  fetchPortfolioProjection,
} from "../src/trading-world/portfolio/portfolioProjection.js";
import { addMoneyUnits, formatMoneyUnits, parseMoneyText, subtractMoneyUnits } from "../src/trading-world/portfolio/decimalText.js";

const ALPHA_WORLD = "world-w011-live";

async function attachAlpha(worldId = ALPHA_WORLD): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createAlphaEngineTransport(worldId),
    expectedWorldId: worldId,
  });
}

function alphaSubmitOrder(input: {
  readonly client: EngineWorldClient;
  readonly commandId: string;
  readonly kind: "market" | "limit";
  readonly side: "buy" | "sell";
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly issuedAt: number;
  readonly worldId?: string;
}) {
  const worldId = input.worldId ?? ALPHA_WORLD;
  const identity = alphaTraderPortfolioIdentity(worldId);
  const command: SubmitOrderCommand = {
    kind: "submit-order",
    commandId: input.commandId as never,
    worldId: worldId as never,
    issuedBy: identity.participantId,
    issuedAt: input.issuedAt as never,
    accountId: identity.accountId,
    instrumentId: `instrument-es-${worldId}` as never,
    submission: {
      kind: input.kind,
      side: input.side,
      quantity: input.quantity as never,
      ...(input.limitPrice === undefined ? {} : { limitPrice: input.limitPrice as never }),
      constraints: { timeInForce: input.kind === "market" ? "IOC" : "GTC" },
    },
  };
  return input.client.command.submitOrder(command);
}

// --- the alpha world: positions, financials, marks, close ------------------------

test("alpha world: a filled marketable limit opens an exact-decimal position; financials and margin derive bit-for-bit", async (t) => {
  const client = await attachAlpha();
  t.after(() => client.dispose());
  const identity = alphaTraderPortfolioIdentity(ALPHA_WORLD);

  await client.clock.step(10_000);
  const quote = await client.query.getQuote(`instrument-es-${ALPHA_WORLD}` as never);
  // The W008-pinned deterministic quote at +10s (same seed, same step).
  assert.equal(quote.ask, "4800.25");
  const ask = quote.ask!;

  const ack = await alphaSubmitOrder({
    client,
    commandId: "cmd-w011-alpha-buy",
    kind: "limit",
    side: "buy",
    quantity: "1",
    limitPrice: ask,
    issuedAt: quote.asOf,
  });
  assert.equal(ack.status, "acked");

  const positions = await client.query.getPositions(identity.accountId);
  assert.equal(positions.length, 1);
  const position = positions[0]!;
  assert.equal(position.quantity, "1");
  assert.equal(position.averageEntryPrice, ask);
  assert.equal(position.markPrice, ask);
  assert.equal(position.realizedPnl.amount, "0");
  assert.equal(position.unrealizedPnl.amount, "0");

  const portfolio = await client.query.getPortfolio(identity.accountId);
  // Taker fee on 1 × 4800.25 at 5bps + 0.10 fixed = 2.500125 exact
  // (the bps leg quantizes to 8 fraction digits, the venue kernel law).
  const notional = parseMoneyText(ask, "ask") * parseMoneyText("1", "qty");
  const bpsFeeAt8 = (notional * 5n + 5n * 10n ** 19n) / 10n ** 20n;
  const fee = formatMoneyUnits(
    addMoneyUnits(bpsFeeAt8 * 10n ** 4n, parseMoneyText("0.10", "fixed")),
  );
  assert.equal(fee, "2.500125");
  assert.equal(
    portfolio.cash.amount,
    formatMoneyUnits(
      subtractMoneyUnits(parseMoneyText("100000", "cash"), parseMoneyText(fee, "fee")),
    ),
  );
  assert.equal(portfolio.cash.amount, "99997.499875");
  assert.equal(portfolio.equity.amount, "99997.499875");

  // The financial summary verifies the consistency law, computes the gross
  // exposure exactly and derives the margin model bit-for-bit (leverage 1).
  const summary = deriveFinancialSummary(portfolio, positions);
  assert.equal(summary.grossExposureText, ask);
  assert.notEqual(summary.margin, undefined);
  assert.equal(summary.margin!.leverageText, "1×");
  assert.equal(summary.margin!.marginUsedText, ask);
  assert.equal(summary.margin!.marginAvailableText, formatMoneyUnits(subtractMoneyUnits(parseMoneyText(portfolio.equity.amount, "e"), parseMoneyText(ask, "m"))));
  assert.equal(summary.margin!.marginAvailableText, portfolio.buyingPower.amount);

  // The alpha world declares no risk limits: honest cards, real consumption.
  const risk = await client.query.getRisk(identity.accountId);
  assert.deepEqual(risk.limits, {});
  assert.deepEqual(risk.breaches, []);
  const riskSummary = deriveRiskSummary({ risk, portfolio, positions });
  assert.equal(riskSummary.noLimitsDeclared, true);
  const grossCard = riskSummary.cards.find((card) => card.gate === "gross-exposure")!;
  assert.equal(grossCard.consumptionText, ask);
  assert.equal(grossCard.limitText, undefined);
});

test("alpha world: the mark moves with the generated market (cross-view consistency, exact unrealized)", async (t) => {
  const client = await attachAlpha();
  t.after(() => client.dispose());
  const identity = alphaTraderPortfolioIdentity(ALPHA_WORLD);
  const instrumentId = `instrument-es-${ALPHA_WORLD}` as never;

  await client.clock.step(10_000);
  const quote0 = await client.query.getQuote(instrumentId);
  const ack = await alphaSubmitOrder({
    client,
    commandId: "cmd-w011-mark-open",
    kind: "limit",
    side: "buy",
    quantity: "1",
    limitPrice: quote0.ask!,
    issuedAt: quote0.asOf,
  });
  assert.equal(ack.status, "acked");
  const entry = quote0.ask!;

  // The generator keeps printing as the clock advances — the mark follows.
  await client.clock.step(60_000);
  const quoteAfter = await client.query.getQuote(instrumentId);
  const positions = await client.query.getPositions(identity.accountId);
  assert.equal(positions.length, 1);
  const position = positions[0]!;
  // Cross-view consistency (J-WORLD-04): the position's mark IS the book's
  // last printed trade — the engine's remark law, never a UI guess.
  assert.equal(position.markPrice, quoteAfter.last);
  // Unrealized = (mark − entry) × signed quantity, exact decimal text.
  const expectedUnrealized = formatMoneyUnits(
    (parseMoneyText(position.markPrice!, "mark") - parseMoneyText(entry, "entry")) *
      parseMoneyText("1", "qty") /
      10n ** 12n,
  );
  assert.equal(position.unrealizedPnl.amount, expectedUnrealized);
  assert.ok(position.updatedAt > position.openedAt, "the re-mark advanced updatedAt");

  const portfolio = await client.query.getPortfolio(identity.accountId);
  const summary = deriveFinancialSummary(portfolio, positions);
  assert.equal(
    summary.grossExposureText,
    formatMoneyUnits(parseMoneyText(position.markPrice!, "mark") * parseMoneyText("1", "q") / 10n ** 12n),
  );
  assert.equal(summary.unrealizedText, position.unrealizedPnl.amount);
});

test("alpha world: closePosition terminates at the REAL CommandPort; the flat book is honest", async (t) => {
  const client = await attachAlpha();
  t.after(() => client.dispose());
  const identity = alphaTraderPortfolioIdentity(ALPHA_WORLD);
  const instrumentId = `instrument-es-${ALPHA_WORLD}` as never;

  await client.clock.step(10_000);
  const quote = await client.query.getQuote(instrumentId);
  const entry = quote.ask!;
  await alphaSubmitOrder({
    client,
    commandId: "cmd-w011-close-open",
    kind: "limit",
    side: "buy",
    quantity: "1",
    limitPrice: entry,
    issuedAt: quote.asOf,
  });
  const before = await client.query.getPortfolio(identity.accountId);
  assert.equal(before.positions.length, 1);

  const clock = await client.clock.getClock();
  const closeAck = await client.command.closePosition({
    kind: "close-position",
    commandId: "cmd-w011-close-1" as never,
    worldId: ALPHA_WORLD as never,
    issuedBy: identity.participantId,
    issuedAt: clock.simulationTime,
    accountId: identity.accountId,
    instrumentId,
  });
  assert.equal(closeAck.status, "acked");
  assert.ok(closeAck.ack.journalCursor > 0);

  // Flat means flat: no fabricated zero rows, just the honest empty list.
  const positionsAfter = await client.query.getPositions(identity.accountId);
  assert.deepEqual(positionsAfter, []);

  // The close fill is journaled (A7: observable past the venue latency) —
  // the trader's LAST fill in journal order is the close (no side field on
  // fill payloads; journal order is the causality truth).
  await client.clock.step(1_000);
  const events = await client.evidence.getEvents({ types: ["matching.order.filled"] });
  const ownFills = events.filter(
    (envelope) => (envelope.payload as { accountId?: string }).accountId === identity.accountId,
  );
  assert.ok(ownFills.length >= 2, "the open and close fills are journaled for the trader");
  const payload = ownFills[ownFills.length - 1]!.payload as {
    price: string;
    quantity: string;
    fee: { amount: string };
  };
  const closePrice = payload.price;

  // Realized = (close − entry) × 1 (the engine's own numbers, exact law).
  const after = await client.query.getPortfolio(identity.accountId);
  const expectedRealized = formatMoneyUnits(
    (parseMoneyText(closePrice, "close") - parseMoneyText(entry, "entry")) *
      parseMoneyText("1", "qty") /
      10n ** 12n,
  );
  assert.equal(after.realizedPnl.amount, expectedRealized);
  // Cash after = cash before − the close fill's fee (exact).
  assert.equal(
    after.cash.amount,
    formatMoneyUnits(subtractMoneyUnits(parseMoneyText(before.cash.amount, "c"), parseMoneyText(payload.fee.amount, "f"))),
  );
  // Flat account: margin 0, buying power = equity (leverage 1).
  const summary = deriveFinancialSummary(after, []);
  assert.equal(summary.openPositionCount, 0);
  assert.equal(summary.margin!.marginUsedText, "0");
  assert.equal(summary.margin!.marginAvailableText, after.equity.amount);
  assert.equal(after.buyingPower.amount, after.equity.amount);
});

// --- the scratch world with declared limits + a MARK-caused breach ----------------

const MAKER = "participant-maker" as never;
const TAKER = "participant-taker" as never;
const MAKER_ACCOUNT = "account-maker" as never;
const TAKER_ACCOUNT = "account-taker" as never;

function limitsWorldDefinition() {
  return testDefinition({
    venues: [testVenue()],
    accounts: [
      testAccount({ leverage: 2 }),
      testAccount({ accountId: MAKER_ACCOUNT, leverage: 2 }),
      testAccount({ accountId: TAKER_ACCOUNT, leverage: 2 }),
    ],
    participants: [
      testParticipant(),
      testParticipant({ participantId: MAKER, accountId: MAKER_ACCOUNT }),
      testParticipant({ participantId: TAKER, accountId: TAKER_ACCOUNT }),
    ],
    riskLimits: {
      [String(TRADER_ACCOUNT)]: {
        maxOrderQuantity: "10" as never,
        maxPositionQuantity: "5" as never,
        maxLeverage: 1.5,
        maxGrossExposure: { amount: "9602", currency: "USD" } as never,
        maxDrawdown: { amount: "5000", currency: "USD" } as never,
        minBuyingPowerAfterOrder: { amount: "100000", currency: "USD" } as never,
      },
    },
  });
}

function scratchOrder(input: {
  readonly commandId: string;
  readonly by: typeof TRADER | typeof MAKER | typeof TAKER;
  readonly account: string;
  readonly submission: SubmitOrderCommand["submission"];
}): SubmitOrderCommand {
  return {
    kind: "submit-order",
    commandId: input.commandId as never,
    worldId: WORLD,
    issuedBy: input.by,
    issuedAt: START as never,
    accountId: input.account as never,
    instrumentId: INSTRUMENT,
    submission: input.submission,
  };
}

async function attachLimitsWorld(): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createInProcessWorldTransport({
      definition: limitsWorldDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    }),
    expectedWorldId: WORLD,
  });
}

test("limits world: fills build exact positions; margin derives at leverage 2; every declared limit projects verbatim", async (t) => {
  const client = await attachLimitsWorld();
  t.after(() => client.dispose());

  // The maker rests two ask levels: 1 @ 4800.25 and 1 @ 4800.75.
  for (const [id, price] of [
    ["cmd-rest-1", "4800.25"],
    ["cmd-rest-2", "4800.75"],
  ] as const) {
    const ack = await client.command.submitOrder(
      scratchOrder({
        commandId: id,
        by: MAKER,
        account: String(MAKER_ACCOUNT),
        submission: {
          kind: "limit",
          side: "sell",
          quantity: "1" as never,
          limitPrice: price as never,
          constraints: { timeInForce: "GTC" },
        },
      }),
    );
    assert.equal(ack.status, "acked");
  }

  // The trader crosses both levels with one market buy of 2.
  const cross = await client.command.submitOrder(
    scratchOrder({
      commandId: "cmd-cross",
      by: TRADER,
      account: String(TRADER_ACCOUNT),
      submission: {
        kind: "market",
        side: "buy",
        quantity: "2" as never,
        constraints: { timeInForce: "IOC" },
      },
    }),
  );
  assert.equal(cross.status, "acked");

  const positions = await client.query.getPositions(TRADER_ACCOUNT);
  assert.deepEqual(
    positions.map((position) => ({
      quantity: position.quantity,
      averageEntryPrice: position.averageEntryPrice,
      markPrice: position.markPrice,
    })),
    [{ quantity: "2", averageEntryPrice: "4800.5", markPrice: "4800.75" }],
  );

  // Fees: taker 5bps on each fill (4800.25 + 4800.75) + 0.10 fixed once
  // = 2.400125 + 2.400375 + 0.10 = 4.9005 exact; cash 99995.0995.
  const portfolio = await client.query.getPortfolio(TRADER_ACCOUNT);
  assert.equal(portfolio.cash.amount, "99995.0995");
  assert.equal(portfolio.realizedPnl.amount, "0");
  assert.equal(portfolio.unrealizedPnl.amount, "0.5");
  assert.equal(portfolio.equity.amount, "99995.5995");
  // marginAvailable = 99995.5995 − 4800.75 = 95194.8495; BP = × 2.
  assert.equal(portfolio.buyingPower.amount, "190389.699");

  // The margin solve reproduces the engine's leverage-2 model bit-for-bit.
  const summary = deriveFinancialSummary(portfolio, positions);
  assert.equal(summary.margin!.leverageText, "2×");
  assert.equal(summary.margin!.marginUsedText, "4800.75");
  assert.equal(summary.margin!.marginAvailableText, "95194.8495");

  // Every declared limit projects verbatim through getRisk.
  const risk = await client.query.getRisk(TRADER_ACCOUNT);
  assert.equal(risk.limits.maxOrderQuantity, "10");
  assert.equal(risk.limits.maxPositionQuantity, "5");
  assert.equal(risk.limits.maxLeverage, 1.5);
  assert.equal(risk.limits.maxGrossExposure!.amount, "9602");
  assert.equal(risk.limits.maxDrawdown!.amount, "5000");
  assert.equal(risk.limits.minBuyingPowerAfterOrder!.amount, "100000");
  assert.equal(risk.breaches.length, 0);
});

test("limits world: a LATER PRINT breaches the gross-exposure limit with no new trader order — the card shows real numbers", async (t) => {
  const client = await attachLimitsWorld();
  t.after(() => client.dispose());

  for (const [id, price] of [
    ["cmd-rest-1", "4800.25"],
    ["cmd-rest-2", "4800.75"],
    ["cmd-rest-3", "4801.25"],
  ] as const) {
    await client.command.submitOrder(
      scratchOrder({
        commandId: id,
        by: MAKER,
        account: String(MAKER_ACCOUNT),
        submission: {
          kind: "limit",
          side: "sell",
          quantity: "1" as never,
          limitPrice: price as never,
          constraints: { timeInForce: "GTC" },
        },
      }),
    );
  }
  await client.command.submitOrder(
    scratchOrder({
      commandId: "cmd-cross",
      by: TRADER,
      account: String(TRADER_ACCOUNT),
      submission: {
        kind: "market",
        side: "buy",
        quantity: "2" as never,
        constraints: { timeInForce: "IOC" },
      },
    }),
  );
  // At this point the trader is long 2 marked 4800.75 (gross 9601.5, within
  // the 9602 limit). A THIRD PARTY now trades at 4801.25 — the print
  // re-marks the trader's position: gross = 2 × 4801.25 = 9602.5 > 9602.
  await client.command.submitOrder(
    scratchOrder({
      commandId: "cmd-print",
      by: TAKER,
      account: String(TAKER_ACCOUNT),
      submission: {
        kind: "market",
        side: "buy",
        quantity: "1" as never,
        constraints: { timeInForce: "IOC" },
      },
    }),
  );

  const positions = await client.query.getPositions(TRADER_ACCOUNT);
  assert.equal(positions[0]!.markPrice, "4801.25");
  const portfolio = await client.query.getPortfolio(TRADER_ACCOUNT);
  assert.equal(portfolio.unrealizedPnl.amount, "1.5");

  const risk = await client.query.getRisk(TRADER_ACCOUNT);
  assert.equal(risk.breaches.length, 1);
  assert.equal(risk.breaches[0]!.gate, "gross-exposure");
  assert.equal(risk.breaches[0]!.detail, "gross exposure 9602.5 exceeds limit 9602");

  // The constraint card: the declared limit, the real consumption, the live
  // over-limit comparison and the engine-recorded breach — all numbers.
  const riskSummary = deriveRiskSummary({ risk, portfolio, positions });
  assert.equal(riskSummary.enforcedCount, 6);
  assert.equal(riskSummary.noLimitsDeclared, false);
  const gross = riskSummary.cards.find((card) => card.gate === "gross-exposure")!;
  assert.equal(gross.limitText, "9602");
  assert.equal(gross.consumptionText, "9602.5");
  assert.equal(gross.overLimit, true);
  assert.equal(gross.breaches.length, 1);
  assert.ok(gross.breaches[0]!.occurredAtText.length > 0);

  const positionLimit = riskSummary.cards.find((card) => card.gate === "position-limit")!;
  assert.equal(positionLimit.consumptionText, "2");
  assert.equal(positionLimit.overLimit, false);
  const leverage = riskSummary.cards.find((card) => card.gate === "leverage")!;
  assert.equal(leverage.limitText, "1.5");
  assert.equal(leverage.overLimit, false);
  const buyingPower = riskSummary.cards.find((card) => card.gate === "buying-power")!;
  assert.equal(buyingPower.limitText, "100000");
  assert.equal(buyingPower.consumptionText, portfolio.buyingPower.amount);
  assert.equal(buyingPower.overLimit, false);
  const drawdown = riskSummary.cards.find((card) => card.gate === "drawdown")!;
  assert.equal(drawdown.consumptionText, undefined);
  assert.equal(drawdown.breaches.length, 0);
});

// --- the projection-feed controller (framework-free, REAL engine) -----------------

test("controller: fail-closed start, honest flat book, engine-publication refresh, typed errors, fail-closed stop", async (t) => {
  const client = await attachAlpha("world-w011-feed");
  const identity = alphaTraderPortfolioIdentity("world-w011-feed");
  t.after(() => client.dispose());

  // Before start the state is unattached (fail closed).
  const controller = createPortfolioProjectionFeedController({
    accountId: identity.accountId,
    pollMs: 0,
  });
  assert.equal(controller.getState().status, "unattached");

  // Start: the honest flat book is READY (not an error, not fabricated).
  controller.start(client);
  await new Promise<void>((resolve) => {
    const unsubscribe = controller.subscribe(() => {
      if (controller.getState().status !== "loading") {
        unsubscribe();
        resolve();
      }
    });
  });
  let state = controller.getState();
  assert.equal(state.status, "ready");
  assert.deepEqual(state.snapshot.positions, []);
  assert.equal(state.snapshot.portfolio.cash.amount, "100000");

  // The fetch helper composes the same triple through the seam.
  const direct = await fetchPortfolioProjection(client, identity.accountId);
  assert.equal(direct.portfolio.accountId, identity.accountId);
  assert.deepEqual(direct.risk.limits, {});

  // An engine publication (any applied command) refreshes the feed.
  const revisions: string[] = [];
  let lastAsOf = state.snapshot.portfolio.asOf;
  const unsubscribe = controller.subscribe(() => {
    const current = controller.getState();
    if (current.status === "ready") {
      if (current.snapshot.portfolio.asOf !== lastAsOf) {
        revisions.push(String(current.snapshot.portfolio.asOf));
        lastAsOf = current.snapshot.portfolio.asOf;
      }
    }
  });
  await client.clock.step(5_000);
  await client.command.addAnnotation({
    kind: "add-annotation",
    commandId: "cmd-w011-feed-annotate" as never,
    worldId: "world-w011-feed" as never,
    issuedBy: identity.participantId,
    issuedAt: (await client.clock.getClock()).simulationTime,
    at: (await client.clock.getClock()).simulationTime,
    text: "w011 feed refresh probe",
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 250));
  assert.ok(revisions.length >= 1, "the published channel refreshed the feed");
  unsubscribe();

  // A mis-scoped account is the typed honest error (never fake data).
  const wrongAccount = createPortfolioProjectionFeedController({
    accountId: "account-nobody",
    pollMs: 0,
  });
  t.after(() => wrongAccount.stop());
  wrongAccount.start(client);
  await new Promise<void>((resolve) => {
    const unsubscribeWrong = wrongAccount.subscribe(() => {
      if (wrongAccount.getState().status !== "loading") {
        unsubscribeWrong();
        resolve();
      }
    });
  });
  const errorState = wrongAccount.getState();
  assert.equal(errorState.status, "error");
  assert.equal(
    errorState.status === "error" ? errorState.remoteName : undefined,
    "UnknownWorldEntityError",
  );

  // Stop: fail closed again; a stopped controller ignores refreshes.
  controller.stop();
  assert.equal(controller.getState().status, "unattached");
  controller.refresh();
  assert.equal(controller.getState().status, "unattached");
  client.dispose();
});

test("controller: transport death surfaces as the honest error state (fail closed, A6)", async (t) => {
  const client = await attachAlpha("world-w011-death");
  const identity = alphaTraderPortfolioIdentity("world-w011-death");
  const controller = createPortfolioProjectionFeedController({
    accountId: identity.accountId,
    pollMs: 20,
  });
  // Never leak the interval past the test (the runner awaits the loop).
  t.after(() => {
    controller.stop();
    client.dispose();
  });
  controller.start(client);
  await new Promise<void>((resolve) => setTimeout(resolve, 120));
  assert.equal(controller.getState().status, "ready");

  client.dispose();
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  const state = controller.getState();
  assert.equal(state.status, "error");
  if (state.status === "error") {
    assert.ok(state.message.length > 0);
  }
  controller.stop();
});
