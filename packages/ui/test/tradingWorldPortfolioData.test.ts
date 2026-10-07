/**
 * Portfolio/positions/risk pure-transform tests (W011) — the exact-decimal
 * kernel, position rows, the financial summary (with the margin leverage
 * solve) and the risk constraint cards.
 *
 * Guards the work order's projection laws:
 * - EXACT DECIMAL TEXT: every figure the surfaces display is canonical
 *   decimal text computed on the 12-decimal kernel — `0.1 + 0.2` is `0.3`,
 *   malformed text is a typed error, never a guessed number (A6);
 * - POSITIONS: signed quantities, entry/mark, exact-decimal unrealized/
 *   realized P&L — the engine's own values reformatted, never recomputed
 *   through a float;
 * - FINANCIALS: the W003 consistency law (equity = cash + realized +
 *   unrealized) is verified and fails closed; total P&L is the exact
 *   addition; gross exposure is the engine's notional law (|qty| × mark,
 *   one rounding per position, mark ?? entry);
 * - MARGIN: derived ONLY by reproducing the W015 margin model and requiring
 *   the projected buying power bit-for-bit (the integer leverage solve) —
 *   no exact solve ⇒ honestly undefined, never a guess;
 * - RISK CARDS: the six named gates carry the declared limits AND their
 *   real consumption (gross exposure, leverage ratio, largest open
 *   quantity, current buying power) with live over/within comparisons, the
 *   engine-recorded breach history per gate, and honest "not enforced" /
 *   "not projected" labels where the ports carry no figure.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldPortfolioData.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Portfolio, Position, RiskState } from "tradrl-world-contracts";

import {
  addMoneyUnits,
  formatMoneyUnits,
  multiplyMoneyHalfUp,
  parseMoneyText,
  PortfolioProjectionDataError,
  ratioUnitsText,
} from "../src/trading-world/portfolio/decimalText.js";
import {
  deriveFinancialSummary,
  derivePositionRow,
  derivePositionRows,
  grossExposureUnitsOf,
  PortfolioDataConsistencyError,
} from "../src/trading-world/portfolio/portfolioData.js";
import {
  deriveRiskSummary,
  positionNotionalText,
  totalUnrealizedUnitsOf,
} from "../src/trading-world/portfolio/riskCards.js";

// --- exact decimal kernel ---------------------------------------------------------

test("decimal kernel: canonical text parses to exact units and formats back", () => {
  for (const [text, units] of [
    ["0", 0n],
    ["1", 1_000_000_000_000n],
    ["4800.25", 4_800_250_000_000_000n],
    ["-2.5", -2_500_000_000_000n],
    ["99995.09975", 99_995_099_750_000_000n],
  ] as const) {
    assert.equal(parseMoneyText(text, "test"), units, text);
    assert.equal(formatMoneyUnits(units), text, text);
  }
  // Trailing fraction zeros strip; negative zero is never a financial fact.
  assert.equal(formatMoneyUnits(parseMoneyText("4800.250", "t")), "4800.25");
  assert.equal(formatMoneyUnits(parseMoneyText("2.0", "t")), "2");
  assert.equal(formatMoneyUnits(-0n), "0");
  assert.equal(formatMoneyUnits(0n), "0");
  for (const malformed of ["", "04800", "4.8e2", "1.", ".5", "-", "1.0000000000001", " 1"]) {
    assert.throws(
      () => parseMoneyText(malformed, "test"),
      PortfolioProjectionDataError,
      JSON.stringify(malformed),
    );
  }
});

test("decimal kernel: exact addition and one-rounding multiplication (no float artifacts)", () => {
  const a = parseMoneyText("0.1", "a");
  const b = parseMoneyText("0.2", "b");
  assert.equal(formatMoneyUnits(addMoneyUnits(a, b)), "0.3");
  assert.equal(formatMoneyUnits(multiplyMoneyHalfUp(a, b)), "0.02");
  // |qty| × mark at the engine's kernel scale: 2 × 4800.25 = 9600.5 exact.
  assert.equal(
    formatMoneyUnits(
      multiplyMoneyHalfUp(parseMoneyText("2", "q"), parseMoneyText("4800.25", "m")),
    ),
    "9600.5",
  );
  // Ratios: gross/equity as canonical text; infinite and zero cases honest.
  assert.equal(
    ratioUnitsText(parseMoneyText("9600.5", "g"), parseMoneyText("2", "e")),
    "4800.25",
  );
  assert.equal(ratioUnitsText(parseMoneyText("1", "g"), parseMoneyText("0", "e")), undefined);
  assert.equal(ratioUnitsText(parseMoneyText("0", "g"), parseMoneyText("0", "e")), "0");
});

// --- position rows ---------------------------------------------------------------

function positionOf(overrides: Partial<Position>): Position {
  return {
    accountId: "account-trader" as never,
    worldId: "world-w011" as never,
    instrumentId: "instrument-es" as never,
    quantity: "2" as never,
    averageEntryPrice: "4800.25" as never,
    markPrice: "4800.25" as never,
    realizedPnl: { amount: "-2.5", currency: "USD" } as never,
    unrealizedPnl: { amount: "0", currency: "USD" } as never,
    openedAt: 1_700_000_000_000 as never,
    updatedAt: 1_700_000_005_000 as never,
    ...overrides,
  } as Position;
}

test("position rows: signed quantities, side labels, exact P&L text, deterministic order", () => {
  const longRow = derivePositionRow(positionOf({}));
  assert.equal(longRow.side, "long");
  assert.equal(longRow.quantityText, "2");
  assert.equal(longRow.entryText, "4800.25");
  assert.equal(longRow.markText, "4800.25");
  assert.equal(longRow.unrealizedText, "0");
  assert.equal(longRow.realizedText, "-2.5");
  assert.equal(longRow.quoteCurrency, "USD");
  assert.equal(longRow.canClose, true);
  assert.equal(positionNotionalText(longRow.position), "9600.5");

  const shortRow = derivePositionRow(
    positionOf({
      instrumentId: "instrument-gc" as never,
      quantity: "-4" as never,
      averageEntryPrice: "2000.5" as never,
      markPrice: "1999.75" as never,
      unrealizedPnl: { amount: "3", currency: "USD" } as never,
    }),
  );
  assert.equal(shortRow.side, "short");
  assert.equal(shortRow.quantityText, "-4");
  assert.equal(shortRow.unrealizedText, "3");

  // An unmarked position stays honestly mark-less in the row.
  const unmarkedRow = derivePositionRow(
    positionOf({ markPrice: undefined, instrumentId: "instrument-unmarked" as never }),
  );
  assert.equal(unmarkedRow.markText, undefined);

  // Instrument-id order is deterministic; totals fold exactly.
  const rows = derivePositionRows([
    shortRow.position,
    longRow.position,
    unmarkedRow.position,
  ]);
  assert.deepEqual(
    rows.map((row) => row.position.instrumentId),
    ["instrument-es", "instrument-gc", "instrument-unmarked"],
  );
  assert.equal(
    formatMoneyUnits(totalUnrealizedUnitsOf(rows.map((row) => row.position))),
    "3",
  );
});

test("gross exposure: |qty| × (mark ?? entry), one rounding per position", () => {
  const gross = grossExposureUnitsOf([
    positionOf({ quantity: "2" as never }),
    positionOf({
      instrumentId: "instrument-b" as never,
      quantity: "-3" as never,
      averageEntryPrice: "100.1" as never,
      markPrice: undefined,
    }),
  ]);
  // 2 × 4800.25 + 3 × 100.1 = 9600.5 + 300.3 = 9900.8 exact.
  assert.equal(formatMoneyUnits(gross), "9900.8");
});

// --- financial summary + the margin leverage solve -------------------------------

function portfolioOf(overrides: Partial<Portfolio> = {}): Portfolio {
  return {
    accountId: "account-trader" as never,
    worldId: "world-w011" as never,
    positions: [],
    cash: { amount: "99995.09975", currency: "USD" } as never,
    buyingPower: { amount: "190389.6995", currency: "USD" } as never,
    realizedPnl: { amount: "0", currency: "USD" } as never,
    unrealizedPnl: { amount: "0", currency: "USD" } as never,
    equity: { amount: "99995.09975", currency: "USD" } as never,
    asOf: 1_700_000_010_000 as never,
    ...overrides,
  } as Portfolio;
}

/** The W015 leverage-2 scenario: long 2 @ 4800.25 after a 4.90025 fee. */
const LEVERAGED_POSITIONS: readonly Position[] = [positionOf({})];

test("financial summary: verifies the W003 consistency law and fails closed on violation", () => {
  const summary = deriveFinancialSummary(portfolioOf(), LEVERAGED_POSITIONS);
  assert.equal(summary.cashText, "99995.09975");
  assert.equal(summary.equityText, "99995.09975");
  assert.equal(summary.totalPnlText, "0");
  assert.equal(summary.grossExposureText, "9600.5");
  assert.equal(summary.openPositionCount, 1);

  assert.throws(
    () =>
      deriveFinancialSummary(
        portfolioOf({ equity: { amount: "1", currency: "USD" } as never }),
        LEVERAGED_POSITIONS,
      ),
    PortfolioDataConsistencyError,
  );
});

test("margin solve: the leverage-2 model reproduces the projected buying power bit-for-bit", () => {
  const summary = deriveFinancialSummary(portfolioOf(), LEVERAGED_POSITIONS);
  assert.notEqual(summary.margin, undefined, "the solve must find leverage 2");
  assert.equal(summary.margin!.leverageText, "2×");
  // marginUsed = 2 × 4800.25 / 2 = 4800.25 exact.
  assert.equal(summary.margin!.marginUsedText, "4800.25");
  // marginAvailable = equity − marginUsed = 95194.84975.
  assert.equal(summary.margin!.marginAvailableText, "95194.84975");
});

test("margin solve: a flat leverage-1 account derives margin 0 / equity", () => {
  const summary = deriveFinancialSummary(
    portfolioOf({
      cash: { amount: "100000", currency: "USD" } as never,
      equity: { amount: "100000", currency: "USD" } as never,
      buyingPower: { amount: "100000", currency: "USD" } as never,
    }),
    [],
  );
  assert.equal(summary.margin!.leverageText, "1×");
  assert.equal(summary.margin!.marginUsedText, "0");
  assert.equal(summary.margin!.marginAvailableText, "100000");
});

test("margin solve: no candidate reproduces the buying power ⇒ honestly undefined", () => {
  const summary = deriveFinancialSummary(
    portfolioOf({
      buyingPower: { amount: "123456.789", currency: "USD" } as never,
    }),
    LEVERAGED_POSITIONS,
  );
  assert.equal(summary.margin, undefined);
});

// --- risk constraint cards -------------------------------------------------------

function riskOf(overrides: Partial<RiskState> = {}): RiskState {
  return {
    accountId: "account-trader" as never,
    worldId: "world-w011" as never,
    limits: {
      maxOrderQuantity: "10" as never,
      maxPositionQuantity: "5" as never,
      maxLeverage: 1.5,
      maxGrossExposure: { amount: "9000", currency: "USD" } as never,
      maxDrawdown: { amount: "5000", currency: "USD" } as never,
      minBuyingPowerAfterOrder: { amount: "100000", currency: "USD" } as never,
    },
    breaches: [
      {
        gate: "gross-exposure",
        detail: "gross exposure 9600.5 exceeds limit 9000",
        occurredAt: 1_700_000_010_000 as never,
      },
      {
        gate: "drawdown",
        detail: "drawdown 5001 exceeds limit 5000",
        occurredAt: 1_700_000_020_000 as never,
      },
    ],
    asOf: 1_700_000_020_000 as never,
    ...overrides,
  } as RiskState;
}

test("risk cards: six gates with the declared limits and their real consumption", () => {
  const summary = deriveRiskSummary({
    risk: riskOf(),
    portfolio: portfolioOf(),
    positions: LEVERAGED_POSITIONS,
  });
  assert.equal(summary.enforcedCount, 6);
  assert.equal(summary.noLimitsDeclared, false);
  assert.equal(summary.breachCount, 2);
  const byGate = new Map(summary.cards.map((card) => [card.gate, card]));

  const positionLimit = byGate.get("position-limit")!;
  assert.equal(positionLimit.limitText, "5");
  assert.equal(positionLimit.consumptionText, "2");
  assert.equal(positionLimit.overLimit, false);

  const gross = byGate.get("gross-exposure")!;
  assert.equal(gross.limitText, "9000");
  assert.equal(gross.consumptionText, "9600.5");
  assert.equal(gross.overLimit, true);
  assert.equal(gross.breaches.length, 1);
  assert.equal(gross.breaches[0]!.detail, "gross exposure 9600.5 exceeds limit 9000");
  assert.ok(gross.breaches[0]!.occurredAtText.includes("2023-11-14"));

  const leverage = byGate.get("leverage")!;
  assert.equal(leverage.limitText, "1.5");
  // consumption = 9600.5 / 99995.09975 — the exact ratio, < the 1.5 limit.
  assert.equal(
    leverage.consumptionText,
    ratioUnitsText(
      parseMoneyText("9600.5", "g"),
      parseMoneyText("99995.09975", "e"),
    )! + "×",
  );
  assert.equal(leverage.overLimit, false);

  const buyingPower = byGate.get("buying-power")!;
  assert.equal(buyingPower.limitText, "100000");
  assert.equal(buyingPower.consumptionText, "190389.6995");
  assert.equal(buyingPower.overLimit, false);

  // The order-size gate is per-submission: no standing consumption figure.
  const orderSize = byGate.get("order-size")!;
  assert.equal(orderSize.limitText, "10");
  assert.equal(orderSize.consumptionText, undefined);
  assert.equal(orderSize.overLimit, undefined);
  assert.ok(orderSize.consumptionNote.includes("per-submission"));

  // The drawdown measure is engine-internal (peak equity): honestly not
  // projected, but the engine-recorded breach carries the real numbers.
  const drawdown = byGate.get("drawdown")!;
  assert.equal(drawdown.limitText, "5000");
  assert.equal(drawdown.consumptionText, undefined);
  assert.equal(drawdown.overLimit, undefined);
  assert.equal(drawdown.breaches.length, 1);
  assert.equal(drawdown.breaches[0]!.detail, "drawdown 5001 exceeds limit 5000");
});

test("risk cards: infinite leverage (equity exhausted with exposure) is the honest breach", () => {
  const summary = deriveRiskSummary({
    risk: riskOf({ limits: { maxLeverage: 2 } as never }),
    portfolio: portfolioOf({
      cash: { amount: "0", currency: "USD" } as never,
      equity: { amount: "0", currency: "USD" } as never,
      buyingPower: { amount: "0", currency: "USD" } as never,
      realizedPnl: { amount: "-99995.09975", currency: "USD" } as never,
      unrealizedPnl: { amount: "99995.09975", currency: "USD" } as never,
    }),
    positions: LEVERAGED_POSITIONS,
  });
  const leverage = summary.cards.find((card) => card.gate === "leverage")!;
  assert.equal(leverage.consumptionText, "infinite");
  assert.equal(leverage.overLimit, true);
});

test("risk cards: no declared limits — the honest alpha-world case", () => {
  const summary = deriveRiskSummary({
    risk: riskOf({ limits: {}, breaches: [] }),
    portfolio: portfolioOf(),
    positions: LEVERAGED_POSITIONS,
  });
  assert.equal(summary.noLimitsDeclared, true);
  assert.equal(summary.enforcedCount, 0);
  for (const card of summary.cards) {
    assert.equal(card.limitText, undefined, card.gate);
    assert.equal(card.overLimit, undefined, card.gate);
    assert.equal(card.breaches.length, 0, card.gate);
  }
  // Consumption figures are STILL real where derivable.
  const gross = summary.cards.find((card) => card.gate === "gross-exposure")!;
  assert.equal(gross.consumptionText, "9600.5");
  const buyingPower = summary.cards.find((card) => card.gate === "buying-power")!;
  assert.equal(buyingPower.consumptionText, "190389.6995");
});
