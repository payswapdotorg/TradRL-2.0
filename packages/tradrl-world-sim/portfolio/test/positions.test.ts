/**
 * Unit tests for the W015 `portfolio` module: the signed decimal layer, the
 * position ledger math (open/increase/reduce/flip/close) and the
 * mark-to-market refresh.
 *
 * Spec: spec/DOMAIN-MODEL.md (Position/P&L semantics, "Financial
 * precision"), spec/ACCEPTANCE-WORLD-ALPHA.md D. All expected values are
 * hand-computed exact decimals — no floats anywhere.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { CurrencyCode } from "tradrl-world-contracts";
import {
  applyFillToPosition,
  formatSignedMoney,
  isCanonicalSignedMoney,
  parseSignedMoney,
  projectPosition,
  remarkPosition,
  signedMulDivHalfUp,
  type FillInput,
  type PositionRecord,
} from "../index.js";

const USD = "USD" as CurrencyCode;
const ACCOUNT = "account-trader" as FillInput["accountId"];
const INSTRUMENT = "instrument-es-fut" as FillInput["instrumentId"];
const WORLD = "world-w013-tests" as Parameters<typeof applyFillToPosition>[2];

function fill(
  overrides: Partial<Omit<FillInput, "occurredAt">> & { occurredAt?: number } = {},
): FillInput {
  return {
    accountId: ACCOUNT,
    instrumentId: INSTRUMENT,
    side: overrides.side ?? "buy",
    price: overrides.price ?? "100",
    quantity: overrides.quantity ?? "1",
    quoteCurrency: overrides.quoteCurrency ?? USD,
    occurredAt: (overrides.occurredAt ?? 1_000) as FillInput["occurredAt"],
  };
}

test("decimal layer: signed parse/format round-trips and normalizes", () => {
  assert.equal(parseSignedMoney("-5"), -5_000_000_000_000n);
  assert.equal(parseSignedMoney("3.5"), 3_500_000_000_000n);
  assert.equal(parseSignedMoney("0"), 0n);
  assert.equal(formatSignedMoney(-5_000_000_000_000n), "-5");
  assert.equal(formatSignedMoney(3_500_000_000_000n), "3.5");
  assert.equal(formatSignedMoney(-0n), "0", "negative zero is never a financial fact");
  assert.equal(formatSignedMoney(1_500_000_000_000_000n), "1500");
  assert.throws(() => parseSignedMoney(""));
  assert.throws(() => parseSignedMoney("--5"));
  assert.throws(() => parseSignedMoney("1e5"));
  assert.equal(isCanonicalSignedMoney("-12.5"), true);
  assert.equal(isCanonicalSignedMoney("12.5"), true);
  assert.equal(isCanonicalSignedMoney("-"), false);
  assert.equal(isCanonicalSignedMoney("1.1234567890123"), false, "more than 12 dp is not canonical");
});

test("decimal layer: signedMulDivHalfUp carries the sign, rounds once", () => {
  const SCALE = 10n ** 12n;
  // (mark − entry) × quantity / scale — a long marking up
  assert.equal(signedMulDivHalfUp(101n * SCALE - 100n * SCALE, 5n * SCALE, SCALE), 5n * SCALE);
  // a short marking up (loss): (mark − entry) negative, quantity negative
  assert.equal(signedMulDivHalfUp(101n * SCALE - 100n * SCALE, -5n * SCALE, SCALE), -5n * SCALE);
  // half-up at the money scale: 0.5 × 0.1 = 0.05
  assert.equal(signedMulDivHalfUp(5n * SCALE / 10n, SCALE / 10n, SCALE), 5n * SCALE / 100n);
  // half-up rounds the magnitude up on exact halves, sign carried through
  assert.equal(signedMulDivHalfUp(15n, 1n, 10n), 2n);
  assert.equal(signedMulDivHalfUp(-15n, 1n, 10n), -2n);
  assert.throws(() => signedMulDivHalfUp(1n, 1n, 0n));
});

test("positions: opening a long sets quantity, average entry and zero realized", () => {
  const { record, realizedDelta, opened } = applyFillToPosition(undefined, fill({
    side: "buy", price: "100.25", quantity: "10",
  }), WORLD);
  assert.equal(opened, true);
  assert.equal(realizedDelta, 0n);
  assert.equal(record.quantity, 10n * 10n ** 12n, "scaled quantity ×10^12");
  assert.equal(formatSignedMoney(record.quantity), "10");
  assert.equal(formatSignedMoney(record.averageEntryPrice), "100.25");
  assert.equal(formatSignedMoney(record.realizedPnl), "0");
  assert.equal(formatSignedMoney(record.unrealizedPnl), "0", "mark equals the entry at fill time");
  assert.equal(record.openedAt, 1_000);
});

test("positions: increasing a long re-weights the average entry", () => {
  const first = applyFillToPosition(undefined, fill({
    side: "buy", price: "100", quantity: "10",
  }), WORLD).record;
  const { record, realizedDelta } = applyFillToPosition(first, fill({
    side: "buy", price: "110", quantity: "10", occurredAt: 2_000,
  }), WORLD);
  assert.equal(realizedDelta, 0n);
  assert.equal(formatSignedMoney(record.quantity), "20");
  assert.equal(formatSignedMoney(record.averageEntryPrice), "105");
  // the mark moved to the increasing fill's price: (110 − 105) × 20
  assert.equal(formatSignedMoney(record.unrealizedPnl), "100");
  assert.equal(record.openedAt, 1_000, "openedAt stays the first fill");
  assert.equal(record.updatedAt, 2_000);
});

test("positions: partially reducing a long realizes exact closed-lot P&L", () => {
  // long 10 @ 100, sell 4 @ 101 → realized +4, long 6 @ 100 remains
  const first = applyFillToPosition(undefined, fill({
    side: "buy", price: "100", quantity: "10",
  }), WORLD).record;
  const { record, realizedDelta } = applyFillToPosition(first, fill({
    side: "sell", price: "101", quantity: "4", occurredAt: 2_000,
  }), WORLD);
  assert.equal(formatSignedMoney(realizedDelta), "4");
  assert.equal(formatSignedMoney(record.realizedPnl), "4");
  assert.equal(formatSignedMoney(record.quantity), "6");
  assert.equal(formatSignedMoney(record.averageEntryPrice), "100", "average entry unchanged on reduction");
  // mark moved to the fill price: unrealized = (101 − 100) × 6
  assert.equal(formatSignedMoney(record.unrealizedPnl), "6");
});

test("positions: fully closing keeps the frozen average and zero unrealized", () => {
  const first = applyFillToPosition(undefined, fill({
    side: "buy", price: "100", quantity: "10",
  }), WORLD).record;
  const { record, realizedDelta } = applyFillToPosition(first, fill({
    side: "sell", price: "99.5", quantity: "10", occurredAt: 2_000,
  }), WORLD);
  assert.equal(formatSignedMoney(realizedDelta), "-5");
  assert.equal(formatSignedMoney(record.quantity), "0");
  assert.equal(formatSignedMoney(record.averageEntryPrice), "100", "closed records keep the audit trail");
  assert.equal(formatSignedMoney(record.unrealizedPnl), "0");
  assert.equal(formatSignedMoney(record.realizedPnl), "-5");
});

test("positions: shorts are negative quantities with mirrored P&L", () => {
  // short 5 @ 100 (sell), cover 2 @ 99 → realized +2, short 3 remains
  const short = applyFillToPosition(undefined, fill({
    side: "sell", price: "100", quantity: "5",
  }), WORLD).record;
  assert.equal(formatSignedMoney(short.quantity), "-5");
  assert.equal(formatSignedMoney(short.unrealizedPnl), "0");
  const { record, realizedDelta } = applyFillToPosition(short, fill({
    side: "buy", price: "99", quantity: "2", occurredAt: 2_000,
  }), WORLD);
  assert.equal(formatSignedMoney(realizedDelta), "2");
  assert.equal(formatSignedMoney(record.quantity), "-3");
  // mark 99: unrealized = (99 − 100) × (−3) = +3
  assert.equal(formatSignedMoney(record.unrealizedPnl), "3");
});

test("positions: flipping long→short realizes the whole old side at the fill", () => {
  // long 5 @ 100, sell 12 @ 101 → close 5 (realized +5), open short 7 @ 101
  const long = applyFillToPosition(undefined, fill({
    side: "buy", price: "100", quantity: "5",
  }), WORLD).record;
  const { record, realizedDelta } = applyFillToPosition(long, fill({
    side: "sell", price: "101", quantity: "12", occurredAt: 2_000,
  }), WORLD);
  assert.equal(formatSignedMoney(realizedDelta), "5");
  assert.equal(formatSignedMoney(record.quantity), "-7");
  assert.equal(formatSignedMoney(record.averageEntryPrice), "101");
  assert.equal(formatSignedMoney(record.unrealizedPnl), "0");
  assert.equal(formatSignedMoney(record.realizedPnl), "5");
});

test("positions: flipping short→long when the new side is smaller than the old", () => {
  // short 10 @ 100, buy 15 @ 99 → cover 10 (realized +10), open long 5 @ 99
  const short = applyFillToPosition(undefined, fill({
    side: "sell", price: "100", quantity: "10",
  }), WORLD).record;
  const { record, realizedDelta } = applyFillToPosition(short, fill({
    side: "buy", price: "99", quantity: "15", occurredAt: 2_000,
  }), WORLD);
  assert.equal(formatSignedMoney(realizedDelta), "10");
  assert.equal(formatSignedMoney(record.quantity), "5");
  assert.equal(formatSignedMoney(record.averageEntryPrice), "99");
});

test("positions: sell exactly double a long flips at equal size", () => {
  // long 4 @ 100, sell 8 @ 102 → close 4 (realized +8), open short 4 @ 102
  const long = applyFillToPosition(undefined, fill({
    side: "buy", price: "100", quantity: "4",
  }), WORLD).record;
  const { record, realizedDelta } = applyFillToPosition(long, fill({
    side: "sell", price: "102", quantity: "8", occurredAt: 2_000,
  }), WORLD);
  assert.equal(formatSignedMoney(realizedDelta), "8");
  assert.equal(formatSignedMoney(record.quantity), "-4");
  assert.equal(formatSignedMoney(record.averageEntryPrice), "102");
});

test("positions: re-marking recomputes unrealized for open records only", () => {
  const long = applyFillToPosition(undefined, fill({
    side: "buy", price: "100", quantity: "10",
  }), WORLD).record;
  const marked = remarkPosition(long, "100.5", 3_000 as never);
  assert.equal(formatSignedMoney(marked.unrealizedPnl), "5");
  assert.equal(marked.updatedAt, 3_000);
  assert.equal(formatSignedMoney(marked.markPrice ?? 0n), "100.5");
  const closed: PositionRecord = { ...marked, quantity: 0n, unrealizedPnl: 0n };
  const reMarked = remarkPosition(closed, "200", 4_000 as never);
  assert.equal(formatSignedMoney(reMarked.unrealizedPnl), "0", "closed records carry no unrealized P&L");
  assert.equal(reMarked.updatedAt, 4_000, "the mark still refreshes (audit)");
});

test("positions: the W003 Position projection carries signed canonical text", () => {
  const short = applyFillToPosition(undefined, fill({
    side: "sell", price: "4800.25", quantity: "8",
  }), WORLD).record;
  const projected = projectPosition(short);
  assert.equal(projected.accountId, ACCOUNT);
  assert.equal(projected.instrumentId, INSTRUMENT);
  assert.equal(projected.quantity, "-8");
  assert.equal(projected.averageEntryPrice, "4800.25");
  assert.equal(projected.markPrice, "4800.25");
  assert.deepEqual(projected.realizedPnl, { amount: "0", currency: "USD" });
  assert.deepEqual(projected.unrealizedPnl, { amount: "0", currency: "USD" });
  assert.equal(projected.openedAt, 1_000);
  assert.equal(projected.updatedAt, 1_000);
});
