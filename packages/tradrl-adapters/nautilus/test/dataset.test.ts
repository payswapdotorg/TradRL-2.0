/**
 * Dataset-descriptor honesty laws (W021): the derived range (computed, not
 * claimed), bar-hole detection (declared, not invented), the honest
 * limitations channel, and the deterministic dataset id.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { HistoricalRecord } from "tradrl-world-contracts/data";
import {
  buildNautilusDatasetDescriptor,
  deriveNautilusDatasetId,
  detectBarHoles,
} from "../dataset.js";
import { dtypeOf, nautilusTraderCatalog } from "../dtypes.js";
import { mapNautilusDataset } from "../mapping.js";
import {
  BAR_ROWS,
  MINUTE_MS,
  NAUTILUS_BARS,
  NAUTILUS_BARS_WITH_HOLE,
  NAUTILUS_INSTRUMENTS,
  NAUTILUS_QUOTE_TICKS,
  T0_MS,
  at,
  price,
  qty,
} from "./fixtures.js";

const catalog = nautilusTraderCatalog(NAUTILUS_INSTRUMENTS);
const barsDtype = dtypeOf(catalog, "nautilus.bars")!;
const quoteDtype = dtypeOf(catalog, "nautilus.quote_ticks")!;

function okMapping(result: ReturnType<typeof mapNautilusDataset>) {
  if (!result.ok) {
    assert.fail(`expected an ok mapping, got: ${result.violations.map((v) => v.detail).join("; ")}`);
  }
  return result;
}

test("the range is DERIVED from the records (min/max extent — never claimed beyond)", () => {
  const mapped = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  assert.equal(mapped.datasetDescriptor.range.from, T0_MS);
  // Bar extent ends at the last close (T0 + 3 minutes).
  assert.equal(mapped.datasetDescriptor.range.to, T0_MS + 3 * MINUTE_MS);
});

test("bar holes are DETECTED and declared as known gaps (declared, not invented)", () => {
  const mapped = okMapping(
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS_WITH_HOLE.payload),
  );
  const { knownGaps } = mapped.datasetDescriptor;
  assert.equal(knownGaps.length, 1);
  assert.equal(knownGaps[0]?.from, T0_MS + MINUTE_MS);
  assert.equal(knownGaps[0]?.to, T0_MS + 2 * MINUTE_MS);
  assert.match(knownGaps[0]?.reason ?? "", /adapter-detected sequence hole/);
  // No holes in the contiguous fixture.
  const contiguous = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  assert.deepEqual(contiguous.datasetDescriptor.knownGaps, []);
});

test("detectBarHoles skips multi-symbol batches (the honest limitation)", () => {
  const bar = (symbol: string, openTime: number): HistoricalRecord =>
    ({
      kind: "bar",
      symbol,
      openTime: at(openTime),
      closeTime: at(openTime + MINUTE_MS),
      open: price("1"),
      high: price("1"),
      low: price("1"),
      close: price("1"),
      volume: qty("1"),
    }) as HistoricalRecord;
  const multiSymbol = [bar("A-X", T0_MS), bar("B-X", T0_MS)];
  assert.deepEqual(detectBarHoles(multiSymbol), []);
  // A same-symbol gap still declares.
  const singleSymbolGap = [bar("A-X", T0_MS), bar("A-X", T0_MS + 5 * MINUTE_MS)];
  assert.equal(detectBarHoles(singleSymbolGap).length, 1);
});

test("the limitations channel carries the catalog's known gaps + the baseline disclosure", () => {
  const mapped = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  const limitations = mapped.datasetDescriptor.limitations.join(" | ");
  assert.match(limitations, /TRUNCATED/); // ns->ms truncation disclosed
  assert.match(limitations, /safe-integer/); // int64/JSON precision disclosed
  assert.match(limitations, /no parquet catalog IO/);
  assert.match(limitations, /TL action item/);
  // Quote batches carry the no-last gap.
  const quotes = okMapping(
    mapNautilusDataset(catalog, "nautilus.quote_ticks", NAUTILUS_QUOTE_TICKS.payload),
  );
  assert.match(quotes.datasetDescriptor.limitations.join(" | "), /last-trade price/);
});

test("the source declaration labels the dtype, the provider and the doc snapshot", () => {
  const mapped = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  const { source } = mapped.datasetDescriptor;
  assert.equal(source.provider, "nautilus");
  assert.match(source.name, /Bar \(nautilus\.bars\)/);
  assert.equal(source.format, "ohlcv-bars");
  assert.match(source.obtained ?? "", /doc snapshot 2026-10-07/);
  assert.equal(mapped.datasetDescriptor.recordKinds.length, 1);
});

test("the derived dataset id is deterministic and span-sensitive", () => {
  const bars = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  const id = deriveNautilusDatasetId(catalog, barsDtype, bars.records);
  assert.equal(
    id,
    `nautilus:nautilus:nautilus.bars:${String(T0_MS + MINUTE_MS)}-${String(T0_MS + 3 * MINUTE_MS)}`,
  );
  // A different span yields a different id (never a collision); a middle
  // hole keeps the span — the id stays honest about what it derives from.
  const firstBarOnly = okMapping(
    mapNautilusDataset(catalog, "nautilus.bars", [BAR_ROWS[0]]),
  );
  assert.notEqual(id, deriveNautilusDatasetId(catalog, barsDtype, firstBarOnly.records));
  const holeBatch = okMapping(
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS_WITH_HOLE.payload),
  );
  assert.equal(id, deriveNautilusDatasetId(catalog, barsDtype, holeBatch.records));
  assert.equal(deriveNautilusDatasetId(catalog, barsDtype, []), "nautilus:nautilus:nautilus.bars:empty");
});

test("granularity: bars derive the bar_type label; tick dtypes say 'tick'", () => {
  const bars = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  assert.equal(bars.datasetDescriptor.granularity, "1m");
  const quotes = okMapping(
    mapNautilusDataset(catalog, "nautilus.quote_ticks", NAUTILUS_QUOTE_TICKS.payload),
  );
  assert.equal(quotes.datasetDescriptor.granularity, "tick");
  // A context override wins (concatenated partitions declare their label).
  const overridden = okMapping(
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload, { granularity: "custom" }),
  );
  assert.equal(overridden.datasetDescriptor.granularity, "custom");
});

test("the determinism default is honest for a fixture batch and overridable (A9)", () => {
  const bars = okMapping(mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload));
  assert.deepEqual(bars.datasetDescriptor.determinism, { kind: "deterministic" });
  const declared = okMapping(
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload, {
      determinism: { kind: "nondeterministic", sources: ["live-catalog-export"] },
    }),
  );
  assert.deepEqual(declared.datasetDescriptor.determinism, {
    kind: "nondeterministic",
    sources: ["live-catalog-export"],
  });
  const named = okMapping(
    mapNautilusDataset(catalog, "nautilus.bars", NAUTILUS_BARS.payload, {
      datasetId: "nautilus:custom-id" as never,
    }),
  );
  assert.equal(named.datasetDescriptor.datasetId, "nautilus:custom-id");
});

test("building a descriptor directly for an unmappable dtype is an internal invariant error", () => {
  const unmappable = dtypeOf(catalog, "nautilus.order_book_deltas")!;
  assert.throws(
    () =>
      buildNautilusDatasetDescriptor({
        catalog,
        dtype: unmappable,
        records: [],
        granularity: "tick",
      }),
    /unmappable dtype/,
  );
});

test("quote dtype builds a descriptor with point-extent range", () => {
  const quotes = okMapping(
    mapNautilusDataset(catalog, "nautilus.quote_ticks", NAUTILUS_QUOTE_TICKS.payload),
  );
  assert.equal(quotes.datasetDescriptor.recordKinds[0], "quote");
  assert.equal(quotes.datasetDescriptor.range.from, T0_MS);
  assert.equal(quotes.datasetDescriptor.range.to, T0_MS + 15_000);
  assert.deepEqual(quotes.datasetDescriptor.knownGaps, []);
  // The dtype descriptor itself is carried through (provenance).
  assert.equal(quotes.dtype.dtypeName, "QuoteTick");
  assert.equal(quoteDtype.dtypeId, "nautilus.quote_ticks");
});
