/**
 * The TradeTick dtype mapper laws (W021): the documented BUY/SELL aggressor
 * side conversion, the int64/legacy trade_id forms, ts_init→availableAt,
 * and the loud violation taxonomy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapNautilusTrade } from "../trade.js";
import type { NautilusRecordContext } from "../mapping.js";
import {
  NAUTILUS_INSTRUMENTS,
  NAUTILUS_TRADE_TICKS,
  NAUTILUS_TRADE_STRING_ID,
  T0_MS,
  T0_NS,
} from "./fixtures.js";

const CONTEXT: NautilusRecordContext = { instruments: NAUTILUS_INSTRUMENTS };

function okMapping(result: ReturnType<typeof mapNautilusTrade>) {
  if (!result.ok) {
    assert.fail(`expected an ok mapping, got: ${result.violations.map((v) => v.detail).join("; ")}`);
  }
  return result;
}

test("a documented TradeTick maps to a W020 trade with the DECLARED aggressor conversion", () => {
  const rows = NAUTILUS_TRADE_TICKS.payload as Record<string, unknown>[];
  const first = okMapping(mapNautilusTrade(rows[0], CONTEXT));
  if (first.record.kind !== "trade") return;
  assert.equal(first.record.symbol, "BTCUSDT-BINANCE");
  // Sub-ms STRING ns times truncate deterministically.
  assert.equal(first.record.timestamp, T0_MS);
  assert.equal(first.record.availableAt, T0_MS); // +250µs truncates to the same ms
  assert.equal(first.record.price, "48000.25");
  assert.equal(first.record.quantity, "0.5");
  assert.equal(first.record.aggressorSide, "sell"); // 'SELL' -> sell
  assert.equal(first.record.tradeId, "20930421");
});

test("all three fixture trades map with their sides and ids in order", () => {
  const rows = NAUTILUS_TRADE_TICKS.payload as Record<string, unknown>[];
  const mapped = rows.map((row) => okMapping(mapNautilusTrade(row, CONTEXT)).record);
  assert.deepEqual(
    mapped.map((record) => (record.kind === "trade" ? record.aggressorSide : "?")),
    ["sell", "buy", "sell"],
  );
  assert.deepEqual(
    mapped.map((record) => (record.kind === "trade" ? record.tradeId : "?")),
    ["20930421", "20930422", "20930423"],
  );
});

test("a trade whose ts_init crosses the next ms keeps its availability (no over-truncation)", () => {
  const row = {
    instrument_id: "BTCUSDT-BINANCE",
    price: 48000.3,
    size: 0.25,
    aggressor_side: "BUY",
    trade_id: 1,
    ts_event: "1700448010000123456",
    ts_init: "1700448010000373456", // +250µs: same ms as event
  };
  const mapped = okMapping(mapNautilusTrade(row, CONTEXT));
  if (mapped.record.kind !== "trade") return;
  assert.equal(mapped.record.timestamp, T0_MS + 10_000);
  assert.equal(mapped.record.availableAt, T0_MS + 10_000);
});

test("the legacy string trade_id export form is accepted verbatim", () => {
  const rows = NAUTILUS_TRADE_STRING_ID.payload as Record<string, unknown>[];
  const mapped = okMapping(mapNautilusTrade(rows[0], CONTEXT));
  if (mapped.record.kind !== "trade") return;
  assert.equal(mapped.record.tradeId, "legacy-id-0001");
});

test("aggressor_side is required and must be the documented form — never fabricated", () => {
  const base = (NAUTILUS_TRADE_TICKS.payload as Record<string, unknown>[])[0]!;
  const missing = { ...base };
  delete missing.aggressor_side;
  const missingResult = mapNautilusTrade(missing, CONTEXT);
  assert.ok(!missingResult.ok);
  assert.equal(missingResult.violations[0]?.kind, "missing-field");
  assert.match(missingResult.violations[0]?.detail ?? "", /never fabricated/);
  // Lowercase is NOT the documented form — a loud rejection, not a case-fold.
  const lower = mapNautilusTrade({ ...base, aggressor_side: "buy" }, CONTEXT);
  assert.ok(!lower.ok);
  assert.equal(lower.violations[0]?.kind, "malformed-record");
  assert.match(lower.violations[0]?.detail ?? "", /must be the documented 'BUY' or 'SELL'/);
});

test("trade_id laws: missing, negative, and blank-string forms are loud rejections", () => {
  const base = (NAUTILUS_TRADE_TICKS.payload as Record<string, unknown>[])[0]!;
  const missing = { ...base };
  delete missing.trade_id;
  assert.ok(!mapNautilusTrade(missing, CONTEXT).ok);
  const negative = mapNautilusTrade({ ...base, trade_id: -1 }, CONTEXT);
  assert.ok(!negative.ok);
  assert.match(negative.violations[0]?.detail ?? "", /non-negative safe integer/);
  const blank = mapNautilusTrade({ ...base, trade_id: "  " }, CONTEXT);
  assert.ok(!blank.ok);
});

test("an unmapped instrument_id is a typed unknown-instrument rejection", () => {
  const base = (NAUTILUS_TRADE_TICKS.payload as Record<string, unknown>[])[0]!;
  const result = mapNautilusTrade({ ...base, instrument_id: "SOLUSDT-OKX" }, CONTEXT);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "unknown-instrument");
});

test("the A7 boundary: ts_init before ts_event is a loud typed rejection", () => {
  const base = (NAUTILUS_TRADE_TICKS.payload as Record<string, unknown>[])[0]!;
  // ts_init one WHOLE MILLISECOND before ts_event (a sub-ms delta would
  // truncate away — the conversion law is truncation, never repair).
  const result = mapNautilusTrade(
    { ...base, ts_event: "1700448000000000000", ts_init: "1700447999999000000" },
    CONTEXT,
  );
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "availability-boundary");
});

test("the classic ns unit swap on a trade timestamp is caught loudly", () => {
  const base = (NAUTILUS_TRADE_TICKS.payload as Record<string, unknown>[])[0]!;
  const swapped = mapNautilusTrade(
    { ...base, ts_event: T0_MS, ts_init: T0_MS },
    CONTEXT,
  );
  assert.ok(!swapped.ok);
  assert.ok(
    swapped.violations.some((violation) => violation.kind === "timestamp-out-of-range"),
  );
});

test("numeric ns trade times convert (the number form)", () => {
  const row = {
    instrument_id: "BTCUSDT-BINANCE",
    price: 48000.25,
    size: 0.5,
    aggressor_side: "BUY",
    trade_id: 7,
    ts_event: T0_NS,
    ts_init: T0_NS + 250_000,
  };
  const mapped = okMapping(mapNautilusTrade(row, CONTEXT));
  if (mapped.record.kind !== "trade") return;
  assert.equal(mapped.record.timestamp, T0_MS);
  assert.equal(mapped.record.availableAt, T0_MS);
});

test("collect-everything: a trade row with several problems reports ALL of them", () => {
  const row = {
    instrument_id: "BTCUSDT-BINANCE",
    price: Number.NaN,
    size: -1,
    aggressor_side: "LONG",
    ts_event: "abc",
  };
  const result = mapNautilusTrade(row, CONTEXT);
  assert.ok(!result.ok);
  const kinds = result.violations.map((violation) => violation.kind);
  assert.deepEqual([...new Set(kinds)].sort(), ["malformed-record", "missing-field"]);
});
