/**
 * End-to-end integration tests (W021): every mappable dtype batch maps
 * through `mapNautilusDataset` and imports through the REAL W020
 * `loadHistoricalDataset` — journal-ready drafts, sealed records and the
 * determinism digest — proving the adapter feeds the W020 import surface
 * exactly. Also proves the deliberate boundary: residual ordering garbage
 * surfaces as the W020 typed `out-of-order-records` rejection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorldId } from "tradrl-world-contracts";
import {
  DatasetImportError,
  loadHistoricalDataset,
  validateHistoricalImport,
} from "tradrl-data";
import { nautilusTraderCatalog } from "../dtypes.js";
import { mapNautilusDataset } from "../mapping.js";
import type { NautilusDatasetMapping } from "../mapping.js";
import {
  MINUTE_MS,
  NAUTILUS_BARS,
  NAUTILUS_BARS_STRING_NS,
  NAUTILUS_BARS_WITH_HOLE,
  NAUTILUS_INSTRUMENTS,
  NAUTILUS_QUOTE_TICKS,
  NAUTILUS_TRADE_TICKS,
  NAUTILUS_TRADE_STRING_ID,
  T0_MS,
} from "./fixtures.js";

const WORLD = "world-w021-tests" as WorldId;
const catalog = nautilusTraderCatalog(NAUTILUS_INSTRUMENTS);

function okMapping(mapping: NautilusDatasetMapping): Exclude<NautilusDatasetMapping, { ok: false }> {
  if (!mapping.ok) {
    assert.fail(`expected an ok mapping, got: ${mapping.violations.map((v) => v.detail).join("; ")}`);
  }
  return mapping;
}

test("bars -> W020 import: bar events at the CLOSE-time basis, half-open intervals, A7 availability", () => {
  const mapping = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.records.length, 3);
  assert.equal(outcome.summary.barCount, 3);
  assert.deepEqual(outcome.summary.symbols, ["BTCUSDT-BINANCE"]);
  const first = outcome.records[0]!;
  assert.equal(first.envelope.eventType, "market.bar.closed");
  assert.equal(first.envelope.producer, "historical-data-import");
  // The event-time basis of a bar is its CLOSE time (the W020 A7 law).
  assert.equal(first.envelope.occurredAt, T0_MS + MINUTE_MS);
  assert.equal(first.recordedAt, T0_MS + MINUTE_MS);
  const payload = first.envelope.payload as {
    type: string;
    instrumentId: string;
    interval: { start: number; end: number };
  };
  assert.equal(payload.type, "market.bar.closed");
  assert.equal(payload.instrumentId, "instrument-btcusdt");
  assert.deepEqual(payload.interval, { start: T0_MS, end: T0_MS + MINUTE_MS });
  // ts_init (the bar close) became the envelope's availableAt (A7: part of
  // the record, never invented).
  assert.equal(first.envelope.availableAt, T0_MS + MINUTE_MS);
  assert.equal(outcome.digest.eventCount, 3);
  assert.match(String(outcome.digest.eventChecksum), /^[0-9a-f]{8}$/);
});

test("trade ticks -> W020 import: trade prints with the DECLARED aggressor sides and source ids", () => {
  const mapping = okMapping(
    mapNautilusDataset(catalog, "nautilus.trade_ticks", NAUTILUS_TRADE_TICKS.payload),
  );
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.tradeCount, 3);
  const sides = outcome.records.map(
    (record) => (record.envelope.payload as { aggressorSide: string }).aggressorSide,
  );
  assert.deepEqual(sides, ["sell", "buy", "sell"]);
  const ids = outcome.records.map(
    (record) => (record.envelope.payload as { tradeId: string }).tradeId,
  );
  assert.deepEqual(ids, ["20930421", "20930422", "20930423"]);
  const first = outcome.records[0]!.envelope;
  assert.equal(first.eventType, "market.trade.printed");
  assert.equal(first.occurredAt, T0_MS);
});

test("the legacy string trade_id imports too (uniqueness across the batch)", () => {
  const mapping = okMapping(
    mapNautilusDataset(catalog, "nautilus.trade_ticks", NAUTILUS_TRADE_STRING_ID.payload),
  );
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.tradeCount, 1);
  assert.equal(
    (outcome.records[0]!.envelope.payload as { tradeId: string }).tradeId,
    "legacy-id-0001",
  );
});

test("quote ticks -> W020 import: an honest top-of-book observation with NO last", () => {
  const mapping = okMapping(
    mapNautilusDataset(catalog, "nautilus.quote_ticks", NAUTILUS_QUOTE_TICKS.payload),
  );
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.quoteCount, 3);
  const payload = outcome.records[0]!.envelope.payload as Record<string, unknown>;
  assert.equal(payload.type, "market.quote.updated");
  assert.equal(payload.bid, "48000.1");
  assert.equal(payload.bidSize, "3");
  assert.equal(payload.ask, "48000.3");
  assert.equal(payload.askSize, "5");
  assert.equal("last" in payload, false);
});

test("string-ns bars import (the full-fidelity form, sub-ms truncated)", () => {
  const mapping = okMapping(
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS_STRING_NS.payload),
  );
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.barCount, 1);
  assert.equal(outcome.records[0]!.envelope.occurredAt, T0_MS + 123 + MINUTE_MS);
});

test("the hole batch imports WITH its detected gap declared (honest fidelity)", () => {
  const mapping = okMapping(
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS_WITH_HOLE.payload),
  );
  assert.equal(mapping.datasetDescriptor.knownGaps.length, 1);
  const outcome = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  assert.equal(outcome.summary.barCount, 2);
});

test("every happy batch also passes the W020 pre-import validator directly", () => {
  const batches = [
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload),
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS_WITH_HOLE.payload),
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS_STRING_NS.payload),
    mapNautilusDataset(catalog, "nautilus.trade_ticks", NAUTILUS_TRADE_TICKS.payload),
    mapNautilusDataset(catalog, "nautilus.trade_ticks", NAUTILUS_TRADE_STRING_ID.payload),
    mapNautilusDataset(catalog, "nautilus.quote_ticks", NAUTILUS_QUOTE_TICKS.payload),
  ];
  for (const mapping of batches) {
    const ok = okMapping(mapping);
    const validation = validateHistoricalImport({
      worldId: WORLD,
      descriptor: ok.datasetDescriptor,
      records: [...ok.records],
      symbolMap: ok.symbolMap,
    });
    assert.deepEqual(
      validation,
      { ok: true },
      `dtype ${ok.dtype.dtypeId} must be W020-valid`,
    );
  }
});

test("BOUNDARY: residual order garbage surfaces as the W020 typed rejection (not re-validated here)", () => {
  // A newest-first batch passed to an ascending-declared dtype: the adapter
  // keeps the documented order and the W020 import rejects it loudly — the
  // deliberate boundary.
  const reversed = [...(NAUTILUS_BARS.payload as unknown[])].reverse();
  const mapping = okMapping(mapNautilusDataset(catalog, "nautilus.bars", reversed));
  assert.equal(mapping.records.length, 3);
  assert.throws(
    () =>
      loadHistoricalDataset({
        worldId: WORLD,
        descriptor: mapping.datasetDescriptor,
        records: [...mapping.records],
        symbolMap: mapping.symbolMap,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DatasetImportError);
      assert.equal(error.violations[0]?.kind, "out-of-order-records");
      return true;
    },
  );
});

test("A9 END-TO-END: two independent imports of the same batch are bit-identical", () => {
  const mapping = okMapping(
    mapNautilusDataset(catalog, "nautilus.trade_ticks", NAUTILUS_TRADE_TICKS.payload),
  );
  const one = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  const two = loadHistoricalDataset({
    worldId: WORLD,
    descriptor: JSON.parse(JSON.stringify(mapping.datasetDescriptor)),
    records: JSON.parse(JSON.stringify(mapping.records)),
    symbolMap: mapping.symbolMap,
  });
  assert.equal(one.digest.eventChecksum, two.digest.eventChecksum);
  assert.equal(one.digest.eventCount, two.digest.eventCount);
  assert.equal(JSON.stringify(one.records), JSON.stringify(two.records));
});
