/**
 * The Bar dtype mapper laws (W021): bar_type parsing (from the RIGHT — the
 * instrument_id contains a dash), the derived interval, the ts_init→
 * availableAt boundary, the float64→canonical-decimal conversion, and the
 * loud violation taxonomy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIME_AGGREGATIONS,
  barGranularityLabel,
  mapNautilusBar,
  parseNautilusBarType,
} from "../bar.js";
import type { NautilusRecordContext } from "../mapping.js";
import {
  MINUTE_MS,
  NAUTILUS_BARS,
  NAUTILUS_INSTRUMENTS,
  T0_MS,
  T0_NS,
} from "./fixtures.js";

const CONTEXT: NautilusRecordContext = { instruments: NAUTILUS_INSTRUMENTS };

function okMapping(result: ReturnType<typeof mapNautilusBar>) {
  if (!result.ok) {
    assert.fail(`expected an ok mapping, got: ${result.violations.map((v) => v.detail).join("; ")}`);
  }
  return result;
}

test("bar_type parses from the RIGHT (the instrument_id itself contains a dash)", () => {
  const parsed = parseNautilusBarType("BTCUSDT-BINANCE-1-MINUTE-LAST-EXTERNAL");
  assert.ok(parsed.ok);
  assert.equal(parsed.parts.instrumentId, "BTCUSDT-BINANCE");
  assert.equal(parsed.parts.step, 1);
  assert.equal(parsed.parts.aggregation, "MINUTE");
  assert.equal(parsed.parts.priceType, "LAST");
  assert.equal(parsed.parts.specification, "EXTERNAL");
  // A perpetual's symbol suffix survives: BTCUSDT-PERP-BINANCE-5-MINUTE-MID-INTERNAL.
  const perp = parseNautilusBarType("BTCUSDT-PERP-BINANCE-5-MINUTE-MID-INTERNAL");
  assert.ok(perp.ok);
  assert.equal(perp.parts.instrumentId, "BTCUSDT-PERP-BINANCE");
  assert.equal(perp.parts.step, 5);
  assert.equal(perp.parts.priceType, "MID");
});

test("bar_type garbage is a typed malformed-record rejection (never a guess)", () => {
  for (const bad of ["BTCUSDT-BINANCE", "BTCUSDT-BINANCE-1-MINUTE", "", 42, null]) {
    const parsed = parseNautilusBarType(bad);
    assert.ok(!parsed.ok, `expected a rejection for '${String(bad)}'`);
  }
  const badStep = parseNautilusBarType("BTCUSDT-BINANCE-0-MINUTE-LAST-EXTERNAL");
  assert.ok(!badStep.ok);
  assert.match(badStep.violations[0]?.detail ?? "", /step '0' must be a positive integer/);
  const badAgg = parseNautilusBarType("BTCUSDT-BINANCE-1-FORTNIGHT-LAST-EXTERNAL");
  assert.ok(!badAgg.ok);
  assert.match(badAgg.violations[0]?.detail ?? "", /not a documented aggregation/);
  const badPrice = parseNautilusBarType("BTCUSDT-BINANCE-1-MINUTE-VWAP-EXTERNAL");
  assert.ok(!badPrice.ok);
  assert.match(badPrice.violations[0]?.detail ?? "", /price_type 'VWAP'/);
  const badSpec = parseNautilusBarType("BTCUSDT-BINANCE-1-MINUTE-LAST-MAGIC");
  assert.ok(!badSpec.ok);
  assert.match(badSpec.violations[0]?.detail ?? "", /specification 'MAGIC'/);
});

test("the granularity label derives from the parsed bar_type", () => {
  const minute = parseNautilusBarType("BTCUSDT-BINANCE-1-MINUTE-LAST-EXTERNAL");
  const hour = parseNautilusBarType("BTCUSDT-BINANCE-4-HOUR-BID-COMPUTED");
  const volume = parseNautilusBarType("BTCUSDT-BINANCE-100-VOLUME-LAST-INTERNAL");
  assert.ok(minute.ok && hour.ok && volume.ok);
  assert.equal(barGranularityLabel(minute.parts), "1m");
  assert.equal(barGranularityLabel(hour.parts), "4h");
  assert.equal(barGranularityLabel(volume.parts), "100irregular");
});

test("a documented Bar row maps to a W020 bar: ns->ms, derived interval, declared availability", () => {
  const rows = NAUTILUS_BARS.payload as Record<string, unknown>[];
  const first = okMapping(mapNautilusBar(rows[0], CONTEXT));
  assert.equal(first.record.kind, "bar");
  if (first.record.kind !== "bar") return;
  assert.equal(first.record.symbol, "BTCUSDT-BINANCE");
  assert.equal(first.record.openTime, T0_MS);
  // Declared derivation: interval end = ts_event + bar_type duration (half-open).
  assert.equal(first.record.closeTime, T0_MS + MINUTE_MS);
  assert.equal(first.record.open, "48000.1");
  assert.equal(first.record.high, "48000.6");
  assert.equal(first.record.low, "48000");
  assert.equal(first.record.close, "48000.4");
  assert.equal(first.record.volume, "12.5");
  // Declared conversion: ts_init (the bar close in the wrangler convention)
  // becomes availableAt — the A7 availability is part of the record.
  assert.equal(first.record.availableAt, T0_MS + MINUTE_MS);
});

test("string ns Bar rows convert with full int64 fidelity (sub-ms truncated)", () => {
  const rows = NAUTILUS_BARS.payload as Record<string, unknown>[];
  const row = { ...rows[0]!, ts_event: "1700448000123456789", ts_init: "1700448060123456789" };
  const mapped = okMapping(mapNautilusBar(row, CONTEXT));
  if (mapped.record.kind !== "bar") return;
  assert.equal(mapped.record.openTime, T0_MS + 123);
  assert.equal(mapped.record.closeTime, T0_MS + 123 + MINUTE_MS);
  assert.equal(mapped.record.availableAt, T0_MS + MINUTE_MS + 123);
});

test("time aggregations derive the interval; a contradicting declared granularity is a LOUD mismatch", () => {
  const rows = NAUTILUS_BARS.payload as Record<string, unknown>[];
  const mismatch = mapNautilusBar(rows[0], {
    instruments: NAUTILUS_INSTRUMENTS,
    granularityMs: 5 * MINUTE_MS,
  });
  assert.ok(!mismatch.ok);
  assert.equal(mismatch.violations[0]?.kind, "interval-length-mismatch");
  assert.match(mismatch.violations[0]?.detail ?? "", /derives a 60000ms interval/);
  const agreeing = mapNautilusBar(rows[0], {
    instruments: NAUTILUS_INSTRUMENTS,
    granularityMs: MINUTE_MS,
  });
  assert.ok(agreeing.ok);
});

test("irregular aggregations REQUIRE a declared granularityMs (never invented)", () => {
  const row = {
    bar_type: "BTCUSDT-BINANCE-100-VOLUME-LAST-INTERNAL",
    open: 48000.1,
    high: 48000.6,
    low: 48000,
    close: 48000.4,
    volume: 100,
    ts_event: T0_NS,
    ts_init: T0_NS + 60_000_000_000,
  };
  const missing = mapNautilusBar(row, CONTEXT);
  assert.ok(!missing.ok);
  assert.equal(missing.violations[0]?.kind, "missing-field");
  assert.match(missing.violations[0]?.detail ?? "", /aggregation 'VOLUME' is irregular/);
  const declared = mapNautilusBar(row, {
    instruments: NAUTILUS_INSTRUMENTS,
    granularityMs: MINUTE_MS,
  });
  assert.ok(declared.ok);
});

test("the A7 boundary: ts_init before the derived close is a loud typed rejection", () => {
  const rows = NAUTILUS_BARS.payload as Record<string, unknown>[];
  const early = { ...rows[0]!, ts_init: T0_NS + 1000 }; // open+1ms < close
  const result = mapNautilusBar(early, CONTEXT);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "availability-boundary");
  assert.match(result.violations[0]?.detail ?? "", /precedes the event-time basis/);
});

test("an unmapped instrument inside bar_type is a typed unknown-instrument rejection", () => {
  const rows = NAUTILUS_BARS.payload as Record<string, unknown>[];
  const foreign = { ...rows[0]!, bar_type: "ETHUSDT-KRAKEN-1-MINUTE-LAST-EXTERNAL" };
  const result = mapNautilusBar(foreign, CONTEXT);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "unknown-instrument");
  assert.match(result.violations[0]?.detail ?? "", /no world instrument mapping/);
});

test("float64 columns must have a canonical decimal form — never silently rounded", () => {
  const rows = NAUTILUS_BARS.payload as Record<string, unknown>[];
  const floatGarbage = { ...rows[0]!, open: 0.30000000000000004 }; // 17 fraction digits
  const rejected = mapNautilusBar(floatGarbage, CONTEXT);
  assert.ok(!rejected.ok);
  assert.equal(rejected.violations[0]?.kind, "malformed-record");
  assert.match(rejected.violations[0]?.detail ?? "", /no canonical decimal form/);
  const negative = { ...rows[0]!, open: -48000.1 };
  const negated = mapNautilusBar(negative, CONTEXT);
  assert.ok(!negated.ok);
  assert.match(negated.violations[0]?.detail ?? "", /no canonical decimal form/);
});

test("inconsistent OHLC is rejected at mapping time (before any import)", () => {
  const rows = NAUTILUS_BARS.payload as Record<string, unknown>[];
  const crossed = { ...rows[0]!, high: 48000.05 }; // high < open
  const result = mapNautilusBar(crossed, CONTEXT);
  assert.ok(!result.ok);
  assert.ok(result.violations.some((violation) => violation.detail.includes("inconsistent OHLC")));
});

test("collect-everything: a row with several problems reports ALL of them", () => {
  const row = {
    bar_type: "BTCUSDT-BINANCE-1-MINUTE-LAST-EXTERNAL",
    open: 48000.1,
    high: 48000.6,
    low: 48000,
    close: 48000.4,
    volume: 12.5,
    ts_event: T0_MS, // ms value in an ns field (unit swap)
    // ts_init missing
  };
  const result = mapNautilusBar(row, CONTEXT);
  assert.ok(!result.ok);
  const kinds = result.violations.map((violation) => violation.kind);
  assert.ok(kinds.includes("timestamp-out-of-range"));
  assert.ok(kinds.includes("missing-field"));
});

test("a non-object row and a blank bar_type are malformed rejections", () => {
  const notObject = mapNautilusBar([1, 2, 3], CONTEXT);
  assert.ok(!notObject.ok);
  assert.match(notObject.violations[0]?.detail ?? "", /must be a JSON object/);
  const rows = NAUTILUS_BARS.payload as Record<string, unknown>[];
  const blankType = mapNautilusBar({ ...rows[0]!, bar_type: "" }, CONTEXT);
  assert.ok(!blankType.ok);
  assert.equal(blankType.violations[0]?.kind, "missing-field");
});

test("every time aggregation derives its documented unit (s/m/h/d)", () => {
  assert.equal(TIME_AGGREGATIONS.SECOND, 1_000);
  assert.equal(TIME_AGGREGATIONS.MINUTE, 60_000);
  assert.equal(TIME_AGGREGATIONS.HOUR, 3_600_000);
  assert.equal(TIME_AGGREGATIONS.DAY, 86_400_000);
  const day = parseNautilusBarType("ETHUSD-BINANCE-1-DAY-LAST-EXTERNAL");
  assert.ok(day.ok);
  const mapped = mapNautilusBar(
    {
      bar_type: "ETHUSD-BINANCE-1-DAY-LAST-EXTERNAL",
      open: 1800.1,
      high: 1800.6,
      low: 1800,
      close: 1800.4,
      volume: 220.5,
      ts_event: T0_NS,
      ts_init: T0_NS + 86_400_000_000_000,
    },
    CONTEXT,
  );
  assert.ok(mapped.ok);
  if (!mapped.ok || mapped.record.kind !== "bar") return;
  assert.equal(mapped.record.closeTime - mapped.record.openTime, 86_400_000);
  assert.equal(mapped.record.symbol, "ETHUSD-BINANCE");
});
