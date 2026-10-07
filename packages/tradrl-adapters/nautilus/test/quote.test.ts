/**
 * The QuoteTick dtype mapper laws (W021): the documented top-of-book shape
 * (NO last-trade price — never invented), sizes, the availability boundary,
 * and the loud violation taxonomy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mapNautilusQuote } from "../quote.js";
import type { NautilusRecordContext } from "../mapping.js";
import {
  NAUTILUS_INSTRUMENTS,
  NAUTILUS_QUOTE_TICKS,
  T0_MS,
} from "./fixtures.js";

const CONTEXT: NautilusRecordContext = { instruments: NAUTILUS_INSTRUMENTS };

function okMapping(result: ReturnType<typeof mapNautilusQuote>) {
  if (!result.ok) {
    assert.fail(`expected an ok mapping, got: ${result.violations.map((v) => v.detail).join("; ")}`);
  }
  return result;
}

test("a documented QuoteTick maps to a W020 top-of-book quote (no `last` — never invented)", () => {
  const rows = NAUTILUS_QUOTE_TICKS.payload as Record<string, unknown>[];
  const first = okMapping(mapNautilusQuote(rows[0], CONTEXT));
  if (first.record.kind !== "quote") return;
  assert.equal(first.record.symbol, "BTCUSDT-BINANCE");
  assert.equal(first.record.timestamp, T0_MS);
  assert.equal(first.record.availableAt, T0_MS);
  assert.equal(first.record.bid, "48000.1");
  assert.equal(first.record.bidSize, "3");
  assert.equal(first.record.ask, "48000.3");
  assert.equal(first.record.askSize, "5");
  assert.equal("last" in first.record, false); // the honest gap, pinned
});

test("all three fixture quotes map in ascending event order (STRING ns truncation)", () => {
  const rows = NAUTILUS_QUOTE_TICKS.payload as Record<string, unknown>[];
  const mapped = rows.map((row) => okMapping(mapNautilusQuote(row, CONTEXT)).record);
  const times = mapped.map((record) => (record.kind === "quote" ? record.timestamp : -1));
  assert.deepEqual(times, [T0_MS, T0_MS + 5_000, T0_MS + 15_000]);
});

test("a crossed top of book (bid > ask) is a loud malformed rejection", () => {
  const base = (NAUTILUS_QUOTE_TICKS.payload as Record<string, unknown>[])[0]!;
  const crossed = mapNautilusQuote({ ...base, bid_price: 48000.5 }, CONTEXT);
  assert.ok(!crossed.ok);
  assert.ok(crossed.violations.some((violation) => violation.detail.includes("crossed")));
});

test("an unmapped instrument_id is a typed unknown-instrument rejection", () => {
  const base = (NAUTILUS_QUOTE_TICKS.payload as Record<string, unknown>[])[0]!;
  const result = mapNautilusQuote({ ...base, instrument_id: "DOGEUSDT-BINANCE" }, CONTEXT);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "unknown-instrument");
});

test("the A7 boundary: ts_init before ts_event is a loud typed rejection", () => {
  const base = (NAUTILUS_QUOTE_TICKS.payload as Record<string, unknown>[])[0]!;
  const result = mapNautilusQuote(
    { ...base, ts_event: "1700448005000123456", ts_init: "1700448000000123456" },
    CONTEXT,
  );
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "availability-boundary");
});

test("missing dtype fields are loud missing-field rejections (never defaulted)", () => {
  const base = (NAUTILUS_QUOTE_TICKS.payload as Record<string, unknown>[])[0]!;
  for (const field of ["instrument_id", "bid_price", "ask_price", "bid_size", "ask_size", "ts_event", "ts_init"]) {
    const row = { ...base };
    delete row[field];
    const result = mapNautilusQuote(row, CONTEXT);
    assert.ok(!result.ok, `${field} is required`);
    assert.ok(
      result.violations.some((violation) => violation.kind === "missing-field" || violation.kind === "malformed-record"),
      `${field} produces a typed violation`,
    );
  }
});

test("float64 columns must have a canonical decimal form — never silently rounded", () => {
  const base = (NAUTILUS_QUOTE_TICKS.payload as Record<string, unknown>[])[0]!;
  const result = mapNautilusQuote({ ...base, bid_size: 3.0000000000000004 }, CONTEXT);
  assert.ok(!result.ok);
  assert.ok(result.violations.some((violation) => violation.detail.includes("no canonical decimal form")));
});
