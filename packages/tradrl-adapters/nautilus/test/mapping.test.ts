/**
 * The batch mapping engine laws (W021): structural rejections
 * (unsupported/unmappable dtypes, invalid catalogs), collect-everything,
 * the single-record surface, the A9 determinism law, and the deliberate
 * ordering boundary (the adapter never re-sorts ascending partitions).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { nautilusTraderCatalog, validateNautilusCatalog } from "../dtypes.js";
import type { NautilusCatalogDescriptor } from "../dtypes.js";
import { mapNautilusDataset, mapNautilusRecord } from "../mapping.js";
import {
  MINUTE_MS,
  NAUTILUS_BARS,
  NAUTILUS_INSTRUMENTS,
  NAUTILUS_ORDER_BOOK_DELTA,
  NAUTILUS_QUOTE_TICKS,
  NAUTILUS_TRADE_TICKS,
  T0_MS,
} from "./fixtures.js";

const catalog = nautilusTraderCatalog(NAUTILUS_INSTRUMENTS);

function okMapping(result: ReturnType<typeof mapNautilusDataset>) {
  if (!result.ok) {
    assert.fail(`expected an ok mapping, got: ${result.violations.map((v) => v.detail).join("; ")}`);
  }
  return result;
}

test("an unknown dtypeId is an unsupported-dtype rejection naming the offered dtypes", () => {
  const result = mapNautilusDataset(catalog, "nautilus.order_book_l2", []);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "unsupported-dtype");
  assert.match(result.violations[0]?.detail ?? "", /offers no dtype 'nautilus.order_book_l2'/);
});

test("the OrderBookDelta dtype is an honest unmappable-dtype rejection (never a guessed mapping)", () => {
  const result = mapNautilusDataset(
    catalog,
    "nautilus.order_book_deltas",
    NAUTILUS_ORDER_BOOK_DELTA.payload,
  );
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "unmappable-dtype");
  assert.match(result.violations[0]?.detail ?? "", /level-change event/);
  assert.match(result.violations[0]?.detail ?? "", /never guesses/);
});

test("an invalid catalog fails every batch with its collected invalid-catalog violations", () => {
  const broken: NautilusCatalogDescriptor = { ...catalog, catalogId: " " };
  const result = mapNautilusDataset(broken, "nautilus.bars", NAUTILUS_BARS.payload);
  assert.ok(!result.ok);
  assert.equal(result.violations[0]?.kind, "invalid-catalog");
  assert.equal(validateNautilusCatalog(broken).length, 1);
});

test("a non-array payload is a loud malformed-record rejection", () => {
  const result = mapNautilusDataset(catalog, "nautilus.bars", { not: "an array" });
  assert.ok(!result.ok);
  assert.match(result.violations[0]?.detail ?? "", /array of rows/);
});

test("collect-everything: record violations carry their row INDEX; nothing maps partially", () => {
  const rows = [...(NAUTILUS_BARS.payload as Record<string, unknown>[])];
  const poisonedRow: Record<string, unknown> = { ...rows[1]!, ts_event: T0_MS }; // the classic ms-in-ns unit swap
  delete poisonedRow.ts_init; // a missing required field
  delete poisonedRow.volume; // a missing required column
  const poisoned = [rows[0], poisonedRow, rows[2]];
  const result = mapNautilusDataset(catalog, "nautilus.bars", poisoned);
  assert.ok(!result.ok);
  const indexed = result.violations.filter((violation) => violation.index === 1);
  assert.ok(indexed.length >= 3);
  assert.ok(indexed.some((violation) => violation.kind === "timestamp-out-of-range"));
  assert.ok(indexed.some((violation) => violation.kind === "missing-field"));
  assert.ok(indexed.some((violation) => violation.kind === "malformed-record"));
  // Good rows are never partially returned.
  assert.equal("records" in result, false);
});

test("the batch output is the exact loadHistoricalDataset triple (records + descriptor + symbolMap)", () => {
  const mapped = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  assert.equal(mapped.records.length, 3);
  assert.equal(mapped.symbolMap["BTCUSDT-BINANCE"], "instrument-btcusdt");
  assert.equal(mapped.datasetDescriptor.recordKinds[0], "bar");
  assert.equal(mapped.dtype.dtypeId, "nautilus.bars");
  assert.deepEqual(Object.keys(mapped.datasetDescriptor).sort(), [
    "datasetId",
    "determinism",
    "granularity",
    "knownGaps",
    "limitations",
    "range",
    "recordKinds",
    "source",
  ]);
});

test("A9 DETERMINISM: the same batch maps bit-identically across independent calls", () => {
  const payload = JSON.parse(JSON.stringify(NAUTILUS_TRADE_TICKS.payload));
  const payloadClone = JSON.parse(JSON.stringify(NAUTILUS_TRADE_TICKS.payload));
  const one = okMapping(mapNautilusDataset(catalog, "nautilus.trade_ticks", payload));
  const two = okMapping(mapNautilusDataset(catalog, "nautilus.trade_ticks", payloadClone));
  assert.equal(JSON.stringify(one.records), JSON.stringify(two.records));
  assert.equal(
    JSON.stringify(one.datasetDescriptor),
    JSON.stringify(two.datasetDescriptor),
  );
  assert.equal(
    JSON.stringify(one.datasetDescriptor),
    JSON.stringify(
      okMapping(mapNautilusDataset(catalog, "nautilus.trade_ticks", payload)).datasetDescriptor,
    ),
  );
});

test("the single-record surface maps one row through the same laws", () => {
  const row = (NAUTILUS_QUOTE_TICKS.payload as Record<string, unknown>[])[0]!;
  const single = mapNautilusRecord(catalog, "nautilus.quote_ticks", row);
  assert.ok(single.ok);
  const batch = okMapping(mapNautilusDataset(catalog, "nautilus.quote_ticks", [row]));
  assert.equal(JSON.stringify(single.record), JSON.stringify(batch.records[0]));
  // Structural failures hit the single surface too.
  const unmappable = mapNautilusRecord(catalog, "nautilus.order_book_deltas", row);
  assert.ok(!unmappable.ok);
  assert.equal(unmappable.violations[0]?.kind, "unmappable-dtype");
});

test("BOUNDARY: residual order garbage surfaces as the W020 typed rejection (never re-sorted here)", () => {
  // A newest-first batch passed to an ascending-declared dtype: the adapter
  // keeps the documented order (never reorders), and the W020 import
  // rejects it loudly — the deliberate boundary, proven end-to-end in the
  // import integration suite.
  const reversed = [...(NAUTILUS_BARS.payload as Record<string, unknown>[])].reverse();
  const mapped = okMapping(mapNautilusDataset(catalog, "nautilus.bars", reversed));
  assert.equal(mapped.records.length, 3);
  const first = mapped.records[0];
  if (first?.kind !== "bar") {
    assert.fail("first record must be a bar");
  }
  assert.equal(first.openTime, T0_MS + 2 * MINUTE_MS); // verbatim order kept
});

test("an empty batch maps to an honest empty dataset (no invented range)", () => {
  const mapped = okMapping(mapNautilusDataset(catalog, "nautilus.bars", []));
  assert.deepEqual(mapped.records, []);
  assert.deepEqual(mapped.datasetDescriptor.range, {});
  assert.equal(mapped.datasetDescriptor.datasetId, "nautilus:nautilus:nautilus.bars:empty");
  assert.equal(mapped.datasetDescriptor.granularity, "tick"); // no bar_type to derive from
});

test("multi-instrument trade batches map and import per-row (catalog partitions are per-instrument)", () => {
  const rows = [
    ...(NAUTILUS_TRADE_TICKS.payload as Record<string, unknown>[]),
    {
      instrument_id: "ETHUSD-BINANCE",
      price: 1800.5,
      size: 2,
      aggressor_side: "BUY",
      trade_id: 99,
      ts_event: "1700448030000000000",
      ts_init: "1700448030000000000",
    },
  ];
  const mapped = okMapping(mapNautilusDataset(catalog, "nautilus.trade_ticks", rows));
  assert.equal(mapped.records.length, 4);
  assert.ok(mapped.datasetDescriptor.limitations.some((limitation) => limitation.includes("multi-symbol batch")));
});
