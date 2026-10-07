/**
 * Shared deterministic fixtures for the W021 `tradrl-adapters-nautilus`
 * tests — recorded-shape stand-ins for the documented NautilusTrader dtype
 * rows (Bar, TradeTick, QuoteTick, OrderBookDelta).
 *
 * HONESTY LABELING (work-order law): every fixture carries a
 * `FixtureProvenance` naming the dtype, the documentation source and the
 * shape-snapshot date. The payloads are HAND-AUTHORED to the documented
 * dtype shapes (value realism, structural fidelity) — they are NOT real
 * catalog exports; the W021 baseline performs no parquet IO by design. A
 * meta-test asserts every fixture stays labeled.
 *
 * INT64 PRECISION DISCIPLINE (the `./nanoseconds.js` law): epoch ns exceeds
 * double safe-integer range, so every NUMERIC ns fixture value is exactly
 * representable (an ms value ≡ 0 mod 4 scaled by 10^6 — test-enforced);
 * sub-millisecond cases use the full-fidelity STRING ns form.
 *
 * Fixed base time: 2023-11-20T02:40:00Z (epoch ms 1700448000000 — the same
 * base the W026/W031 fixtures use).
 */

import type { InstrumentId, Price, Quantity, TimestampMs } from "tradrl-world-contracts";
import type { DatasetId } from "tradrl-world-contracts/data";
import type { NautilusInstrumentTable } from "../instruments.js";
import assert from "node:assert/strict";

/** W026/W031-fixture-style typed literal helpers (brands are casts, never lies). */
export function at(ms: number): TimestampMs {
  return ms as TimestampMs;
}

export function price(text: string): Price {
  return text as Price;
}

export function qty(text: string): Quantity {
  return text as Quantity;
}

export function datasetIdOf(text: string): DatasetId {
  return text as DatasetId;
}

/** The declared instrument table (the catalog's world mapping). */
export const NAUTILUS_INSTRUMENTS: NautilusInstrumentTable = {
  "BTCUSDT-BINANCE": "instrument-btcusdt" as InstrumentId,
  "ETHUSD-BINANCE": "instrument-ethusdt" as InstrumentId,
};

/** Fixture base time (2023-11-20T02:40:00Z): ms and its ns scale. */
export const T0_MS = 1_700_448_000_000;
export const T0_NS = 1_700_448_000_000_000_000;
export const MINUTE_MS = 60_000;
export const MINUTE_NS = 60_000_000_000;
export const SECOND_NS = 1_000_000_000;

/**
 * Narrow a `{ ok: true | false }` union to its ok branch (node:test style —
 * `assert.ok(x.ok)` narrows the property, not the parent).
 */
export function assertOkMapping<T extends { readonly ok: boolean }>(
  result: T,
): asserts result is Exclude<T, { readonly ok: false }> {
  if (!result.ok) {
    assert.fail(`expected an ok result, got: ${JSON.stringify(result)}`);
  }
}

/** The labeling record every fixture must carry (never blank — meta-tested). */
export interface FixtureProvenance {
  readonly dtypeId: string;
  readonly dtypeName: string;
  readonly docSource: string;
  readonly shapeSnapshotDate: string;
  readonly note: string;
}

/** One labeled fixture: provenance + hand-authored documented-shape payload. */
export interface LabeledFixture {
  readonly provenance: FixtureProvenance;
  readonly payload: unknown;
}

const NAUTILUS_DOCS =
  "NautilusTrader documentation (nautilustrader.io/docs) — data types (Bar, TradeTick, QuoteTick dtypes) " +
  "and the Parquet Data Catalog";
const HAND_AUTHORED =
  "hand-authored to the documented dtype shape on the snapshot date — not a real catalog export " +
  "(the W021 baseline performs no parquet IO)";
const SNAPSHOT_DATE = "2026-10-07";

/**
 * Bars (BTCUSDT-BINANCE, 1-MINUTE-LAST-EXTERNAL): three contiguous
 * one-minute bars. ts_event is the interval start, ts_init the close (the
 * declared wrangler convention); OHLCV are float64 columns.
 */
const BAR_ROWS_SOURCE: readonly Record<string, unknown>[] = [
  {
    bar_type: "BTCUSDT-BINANCE-1-MINUTE-LAST-EXTERNAL",
    open: 48000.1,
    high: 48000.6,
    low: 48000,
    close: 48000.4,
    volume: 12.5,
    ts_event: T0_NS,
    ts_init: T0_NS + MINUTE_NS,
  },
  {
    bar_type: "BTCUSDT-BINANCE-1-MINUTE-LAST-EXTERNAL",
    open: 48000.4,
    high: 48001,
    low: 48000.2,
    close: 48000.9,
    volume: 9.75,
    ts_event: T0_NS + MINUTE_NS,
    ts_init: T0_NS + 2 * MINUTE_NS,
  },
  {
    bar_type: "BTCUSDT-BINANCE-1-MINUTE-LAST-EXTERNAL",
    open: 48000.9,
    high: 48001.2,
    low: 48000.7,
    close: 48001.1,
    volume: 15.25,
    ts_event: T0_NS + 2 * MINUTE_NS,
    ts_init: T0_NS + 3 * MINUTE_NS,
  },
];

export const NAUTILUS_BARS: LabeledFixture = {
  provenance: {
    dtypeId: "nautilus.bars",
    dtypeName: "Bar",
    docSource: NAUTILUS_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: BAR_ROWS_SOURCE,
};

/**
 * Bars WITH A SEQUENCE HOLE (the middle bar missing): the adapter must
 * DETECT the hole and declare it as a known gap [T0+60s, T0+120s).
 */
export const NAUTILUS_BARS_WITH_HOLE: LabeledFixture = {
  provenance: {
    dtypeId: "nautilus.bars",
    dtypeName: "Bar",
    docSource: NAUTILUS_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [BAR_ROWS_SOURCE[0]!, BAR_ROWS_SOURCE[2]!],
};

/**
 * Bars in the full-fidelity STRING ns form (sub-millisecond remainders
 * included — truncated deterministically by the declared ns->ms law): a
 * single 1-minute bar opening at T0 + 123456789 ns.
 */
export const NAUTILUS_BARS_STRING_NS: LabeledFixture = {
  provenance: {
    dtypeId: "nautilus.bars",
    dtypeName: "Bar",
    docSource: NAUTILUS_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    {
      bar_type: "BTCUSDT-BINANCE-1-MINUTE-LAST-EXTERNAL",
      open: 48000.1,
      high: 48000.6,
      low: 48000,
      close: 48000.4,
      volume: 12.5,
      ts_event: "1700448000123456789",
      ts_init: "1700448060123456789",
    },
  ],
};

/**
 * Bars with an IRREGULAR aggregation (100-VOLUME-LAST-INTERNAL): the
 * interval length is not derivable from the bar_type — the mapping context
 * must declare granularityMs (never invented). ts_init follows the declared
 * interval (start + 60000ms).
 */
export const NAUTILUS_IRREGULAR_BARS: LabeledFixture = {
  provenance: {
    dtypeId: "nautilus.bars",
    dtypeName: "Bar",
    docSource: NAUTILUS_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    {
      bar_type: "BTCUSDT-BINANCE-100-VOLUME-LAST-INTERNAL",
      open: 48000.1,
      high: 48000.6,
      low: 48000,
      close: 48000.4,
      volume: 100,
      ts_event: T0_NS,
      ts_init: T0_NS + MINUTE_NS,
    },
  ],
};

/**
 * Trade ticks (BTCUSDT-BINANCE): three prints in ascending time order;
 * aggressor_side is the documented 'BUY'/'SELL'; trade_id the int64 catalog
 * form; ts_event/ts_init carry microsecond-scale sub-ms remainders in the
 * full-fidelity STRING ns form (ts_init = ts_event + 250 microseconds).
 */
export const NAUTILUS_TRADE_TICKS: LabeledFixture = {
  provenance: {
    dtypeId: "nautilus.trade_ticks",
    dtypeName: "TradeTick",
    docSource: NAUTILUS_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    {
      instrument_id: "BTCUSDT-BINANCE",
      price: 48000.25,
      size: 0.5,
      aggressor_side: "SELL",
      trade_id: 20_930_421,
      ts_event: "1700448000000500000",
      ts_init: "1700448000000750000",
    },
    {
      instrument_id: "BTCUSDT-BINANCE",
      price: 48000.3,
      size: 0.25,
      aggressor_side: "BUY",
      trade_id: 20_930_422,
      ts_event: "1700448010000123456",
      ts_init: "1700448010000373456",
    },
    {
      instrument_id: "BTCUSDT-BINANCE",
      price: 48000.2,
      size: 1,
      aggressor_side: "SELL",
      trade_id: 20_930_423,
      ts_event: "1700448020000987654",
      ts_init: "1700448020001237654",
    },
  ],
};

/**
 * A trade tick with the LEGACY string trade_id export form (accepted
 * verbatim per the declared convention).
 */
export const NAUTILUS_TRADE_STRING_ID: LabeledFixture = {
  provenance: {
    dtypeId: "nautilus.trade_ticks",
    dtypeName: "TradeTick",
    docSource: NAUTILUS_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    {
      instrument_id: "BTCUSDT-BINANCE",
      price: 48000.25,
      size: 0.5,
      aggressor_side: "BUY",
      trade_id: "legacy-id-0001",
      ts_event: T0_NS,
      ts_init: T0_NS + 250_000,
    },
  ],
};

/**
 * Quote ticks (BTCUSDT-BINANCE): three top-of-book observations in
 * ascending order, STRING ns times with sub-ms remainders (the documented
 * QuoteTick carries NO last-trade price).
 */
export const NAUTILUS_QUOTE_TICKS: LabeledFixture = {
  provenance: {
    dtypeId: "nautilus.quote_ticks",
    dtypeName: "QuoteTick",
    docSource: NAUTILUS_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    {
      instrument_id: "BTCUSDT-BINANCE",
      bid_price: 48000.1,
      ask_price: 48000.3,
      bid_size: 3,
      ask_size: 5,
      ts_event: "1700448000000123456",
      ts_init: "1700448000000123456",
    },
    {
      instrument_id: "BTCUSDT-BINANCE",
      bid_price: 48000.15,
      ask_price: 48000.35,
      bid_size: 2.5,
      ask_size: 4.75,
      ts_event: "1700448005000123456",
      ts_init: "1700448005000373456",
    },
    {
      instrument_id: "BTCUSDT-BINANCE",
      bid_price: 48000.05,
      ask_price: 48000.25,
      bid_size: 1.25,
      ask_size: 6.5,
      ts_event: "1700448015000987654",
      ts_init: "1700448015000987654",
    },
  ],
};

/**
 * An order-book delta row (OrderBookDelta): the honest UNMAPPABLE fixture —
 * a level-change event, not a top-of-book observation.
 */
export const NAUTILUS_ORDER_BOOK_DELTA: LabeledFixture = {
  provenance: {
    dtypeId: "nautilus.order_book_deltas",
    dtypeName: "OrderBookDelta",
    docSource: NAUTILUS_DOCS,
    shapeSnapshotDate: SNAPSHOT_DATE,
    note: HAND_AUTHORED,
  },
  payload: [
    {
      instrument_id: "BTCUSDT-BINANCE",
      action: "DELTA",
      order_book_action: "UPDATE",
      order: { order_id: 1, price: 48000.1, size: 1, side: "SELL", seq: 1 },
      flags: 0,
      sequence: 1,
      ts_event: T0_NS,
      ts_init: T0_NS + 250_000,
    },
  ],
};

/** Every numeric ns value the fixtures carry (the exact-representability guard's inventory). */
export const NUMERIC_NS_VALUES: readonly number[] = [
  T0_NS,
  T0_NS + MINUTE_NS,
  T0_NS + 2 * MINUTE_NS,
  T0_NS + 3 * MINUTE_NS,
  T0_NS + 250_000,
];

/** The Bar rows of the contiguous fixture (typed view for hole/derived tests). */
export const BAR_ROWS: readonly Record<string, unknown>[] = BAR_ROWS_SOURCE;

/** Every labeled fixture (the meta-test's inventory — keep it complete). */
export const ALL_FIXTURES: readonly LabeledFixture[] = [
  NAUTILUS_BARS,
  NAUTILUS_BARS_WITH_HOLE,
  NAUTILUS_BARS_STRING_NS,
  NAUTILUS_IRREGULAR_BARS,
  NAUTILUS_TRADE_TICKS,
  NAUTILUS_TRADE_STRING_ID,
  NAUTILUS_QUOTE_TICKS,
  NAUTILUS_ORDER_BOOK_DELTA,
];
