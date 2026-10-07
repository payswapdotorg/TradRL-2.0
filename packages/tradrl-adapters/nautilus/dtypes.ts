/**
 * NautilusTrader catalog/dtype descriptors (W021 `tradrl-adapters-nautilus`).
 *
 * A catalog descriptor is a DECLARATION, never a reader: this baseline
 * performs NO parquet/nautilus_trader IO — the dtype record shapes are the
 * documented ones (see `docs`), the payloads arrive as recorded JSON rows,
 * and the acquisition declaration says so honestly
 * (`parquetCatalog: "not-implemented"` is enforced by
 * `validateNautilusCatalog`; the real nautilus_trader catalog reader is a TL
 * action item per spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md).
 *
 * Each dtype models ONE documented NautilusTrader historical data type:
 * Bar, TradeTick, QuoteTick (the mappable three) and OrderBookDelta (the
 * honest unmappable declaration — a book delta is a level-change event, not
 * a top-of-book observation; mapping it would require reconstructing book
 * state, which this baseline never guesses).
 */

import type { HistoricalRecordKind } from "tradrl-world-contracts/data";
import type { NautilusMappingViolation } from "./errors.js";
import type { NautilusInstrumentTable } from "./instruments.js";
import { isNonBlank } from "./instruments.js";

/** What a dtype maps onto; "unmappable" is an honest declaration, not a stub. */
export type DtypeOutputKind = HistoricalRecordKind | "unmappable";

/** Where the dtype row carries its instrument_id. */
export type InstrumentLocation = "record" | "bar-type";

/** One documented NautilusTrader data type, as a declaration. */
export interface NautilusDtypeDescriptor {
  /** Stable dtype id, "nautilus.<dtype>" (e.g. "nautilus.bars"). */
  readonly dtypeId: string;
  /** The documented class name (e.g. "TradeTick"). */
  readonly dtypeName: string;
  readonly outputKind: DtypeOutputKind;
  /** The documented dtype field names (human-facing declaration). */
  readonly documentedFields: readonly string[];
  /** Doc labels of the timestamp-bearing fields (all int64 nanoseconds). */
  readonly timestampFields: readonly string[];
  /**
   * The documented record order inside one catalog partition: ascending by
   * event time. Residual order garbage is caught loudly at the W020 import
   * boundary (`out-of-order-records`) — this adapter never re-sorts
   * ascending data behind the importer's back.
   */
  readonly recordOrder: "ascending";
  readonly instrumentLocation: InstrumentLocation;
  /** Declared conversions and per-dtype known gaps (honest notes). */
  readonly notes: readonly string[];
}

/** Acquisition declaration — honest about what this baseline does not do. */
export interface NautilusAcquisitionDeclaration {
  /** LAW: the baseline reads no parquet catalog. A catalog claiming otherwise is invalid. */
  readonly parquetCatalog: "not-implemented";
  /** The acquisition model the real reader layer will implement. */
  readonly intendedModel: string;
  readonly note: string;
}

/** Fidelity declaration — what the adapter preserves, and its known gaps. */
export interface NautilusFidelityDeclaration {
  readonly gives: readonly string[];
  readonly knownGaps: readonly string[];
  /** Deterministic declared conversions (never silent reinterpretations). */
  readonly conventions: readonly string[];
}

/** A NautilusTrader historical data catalog as an import source (declaration, not a reader). */
export interface NautilusCatalogDescriptor {
  readonly catalogId: string;
  /** Human-facing label (e.g. "NautilusTrader fixture catalog"). */
  readonly label: string;
  /** The public documentation the dtype shapes were transcribed from. */
  readonly docs: {
    readonly source: string;
    readonly shapeSnapshotDate: string;
    readonly note: string;
  };
  readonly instruments: NautilusInstrumentTable;
  readonly dtypes: readonly NautilusDtypeDescriptor[];
  readonly acquisition: NautilusAcquisitionDeclaration;
  readonly fidelity: NautilusFidelityDeclaration;
}

/** Look up one dtype of a catalog by id. */
export function dtypeOf(
  catalog: NautilusCatalogDescriptor,
  dtypeId: string,
): NautilusDtypeDescriptor | undefined {
  return catalog.dtypes.find((dtype) => dtype.dtypeId === dtypeId);
}

const OUTPUT_KINDS: readonly string[] = ["bar", "trade", "quote", "unmappable"];
const INSTRUMENT_LOCATIONS: readonly string[] = ["record", "bar-type"];

function stringArrayProblems(
  values: readonly string[],
  label: string,
  problems: string[],
): void {
  if (values.length === 0) {
    problems.push(`${label} must be a non-empty array`);
  } else if (!values.every(isNonBlank)) {
    problems.push(`${label}: every entry must be a non-blank string`);
  }
}

/**
 * Validate a catalog descriptor structurally. Returns every problem as
 * `invalid-catalog` violations (empty list = valid). Honest-declaration laws
 * enforced: the acquisition claim must stay "not-implemented", the
 * instrument table must be non-empty with non-blank mappings, dtype ids must
 * be unique and their conventions well-formed.
 */
export function validateNautilusCatalog(
  catalog: NautilusCatalogDescriptor,
): readonly NautilusMappingViolation[] {
  const problems: string[] = [];
  if (typeof catalog !== "object" || catalog === null) {
    return [{ kind: "invalid-catalog", detail: "catalog must be an object" }];
  }
  if (!isNonBlank(catalog.catalogId)) {
    problems.push("catalogId must be a non-blank string");
  }
  if (!isNonBlank(catalog.label)) {
    problems.push("label must be a non-blank string");
  }
  if (typeof catalog.docs !== "object" || catalog.docs === null) {
    problems.push("docs must be an object");
  } else {
    if (!isNonBlank(catalog.docs.source)) problems.push("docs.source must be a non-blank string");
    if (!isNonBlank(catalog.docs.shapeSnapshotDate)) {
      problems.push("docs.shapeSnapshotDate must be a non-blank string");
    }
    if (!isNonBlank(catalog.docs.note)) problems.push("docs.note must be a non-blank string");
  }
  const instrumentEntries = Object.entries(catalog.instruments ?? {});
  if (instrumentEntries.length === 0) {
    problems.push("instruments must declare at least one instrument_id -> instrument mapping");
  }
  for (const [instrumentId, mapped] of instrumentEntries) {
    if (!isNonBlank(instrumentId) || !isNonBlank(mapped)) {
      problems.push(
        `instruments: '${String(instrumentId)}' -> '${String(mapped)}' must both be non-blank`,
      );
    }
  }
  if (!Array.isArray(catalog.dtypes) || catalog.dtypes.length === 0) {
    problems.push("dtypes must be a non-empty array");
  } else {
    const seen = new Set<string>();
    for (const dtype of catalog.dtypes) {
      if (typeof dtype !== "object" || dtype === null) {
        problems.push("dtypes: every entry must be an object");
        continue;
      }
      if (!isNonBlank(dtype.dtypeId)) {
        problems.push("dtypes: dtypeId must be a non-blank string");
      } else if (seen.has(dtype.dtypeId)) {
        problems.push(`dtypes: duplicate dtype id '${dtype.dtypeId}'`);
      }
      seen.add(String(dtype.dtypeId));
      if (!isNonBlank(dtype.dtypeName)) {
        problems.push(`dtype '${String(dtype.dtypeId)}': dtypeName must be a non-blank string`);
      }
      if (!OUTPUT_KINDS.includes(String(dtype.outputKind))) {
        problems.push(
          `dtype '${String(dtype.dtypeId)}': unknown outputKind '${String(dtype.outputKind)}'`,
        );
      }
      if (dtype.recordOrder !== "ascending") {
        problems.push(
          `dtype '${String(dtype.dtypeId)}': recordOrder must be 'ascending' (the documented catalog partition order)`,
        );
      }
      if (!INSTRUMENT_LOCATIONS.includes(String(dtype.instrumentLocation))) {
        problems.push(
          `dtype '${String(dtype.dtypeId)}': unknown instrumentLocation '${String(dtype.instrumentLocation)}'`,
        );
      }
      stringArrayProblems(dtype.documentedFields ?? [], `dtype '${String(dtype.dtypeId)}': documentedFields`, problems);
      stringArrayProblems(dtype.timestampFields ?? [], `dtype '${String(dtype.dtypeId)}': timestampFields`, problems);
      stringArrayProblems(dtype.notes ?? [], `dtype '${String(dtype.dtypeId)}': notes`, problems);
    }
  }
  if (typeof catalog.acquisition !== "object" || catalog.acquisition === null) {
    problems.push("acquisition must be an object");
  } else {
    if (catalog.acquisition.parquetCatalog !== "not-implemented") {
      problems.push(
        "acquisition.parquetCatalog must be 'not-implemented' — the W021 baseline reads no parquet catalog " +
          "(the real nautilus_trader reader is a TL action item; a catalog descriptor may not claim it)",
      );
    }
    if (!isNonBlank(catalog.acquisition.intendedModel)) {
      problems.push("acquisition.intendedModel must be a non-blank string");
    }
    if (!isNonBlank(catalog.acquisition.note)) {
      problems.push("acquisition.note must be a non-blank string");
    }
  }
  if (typeof catalog.fidelity !== "object" || catalog.fidelity === null) {
    problems.push("fidelity must be an object");
  } else {
    stringArrayProblems(catalog.fidelity.gives ?? [], "fidelity.gives", problems);
    stringArrayProblems(catalog.fidelity.knownGaps ?? [], "fidelity.knownGaps", problems);
    stringArrayProblems(catalog.fidelity.conventions ?? [], "fidelity.conventions", problems);
  }
  return problems.map((detail) => ({ kind: "invalid-catalog", detail }) as const);
}

export const NAUTILUS_DOCS_SOURCE =
  "NautilusTrader documentation (nautilustrader.io/docs) — data types (Bar, TradeTick, QuoteTick dtypes) " +
  "and the Parquet Data Catalog";

export const NAUTILUS_SNAPSHOT_DATE = "2026-10-07";

const HAND_AUTHORED_NOTE =
  "dtype field names and shapes transcribed from the published reference as of the snapshot date; " +
  "this package's fixtures are hand-authored to those shapes, not real catalog exports";

/** The dtype set of the baseline catalog (the mappable three + the honest unmappable fourth). */
export function baselineDtypes(): readonly NautilusDtypeDescriptor[] {
  return [
    {
      dtypeId: "nautilus.bars",
      dtypeName: "Bar",
      outputKind: "bar",
      documentedFields: ["bar_type", "open", "high", "low", "close", "volume", "ts_event", "ts_init"],
      timestampFields: ["ts_event (int64 ns)", "ts_init (int64 ns)"],
      recordOrder: "ascending",
      instrumentLocation: "bar-type",
      notes: [
        "bar_type is '<instrument_id>-<step>-<aggregation>-<price_type>-<specification>'; parsed from the RIGHT (the instrument_id itself contains a dash)",
        "ts_event is the bar's interval start (the exchange-kline wrangler convention); the interval END is derived from the bar_type step+aggregation",
        "ts_init (object initialization) maps to availableAt — validated to never precede the bar's close (the A7 boundary)",
        "irregular aggregations (TICK/VOLUME/NOTIONAL/DOLLAR/OPEN_INTEREST) carry no derivable interval length — the mapping context must declare granularityMs",
      ],
    },
    {
      dtypeId: "nautilus.trade_ticks",
      dtypeName: "TradeTick",
      outputKind: "trade",
      documentedFields: [
        "instrument_id",
        "price",
        "size",
        "aggressor_side",
        "trade_id",
        "ts_event",
        "ts_init",
      ],
      timestampFields: ["ts_event (int64 ns)", "ts_init (int64 ns)"],
      recordOrder: "ascending",
      instrumentLocation: "record",
      notes: [
        "aggressor_side is the documented 'BUY'/'SELL' string — mapped verbatim to buy/sell",
        "trade_id (int64 catalog dtype; the legacy string export form is accepted verbatim) becomes the W020 tradeId",
        "ts_init (object initialization) maps to availableAt — validated to never precede ts_event (the A7 boundary)",
      ],
    },
    {
      dtypeId: "nautilus.quote_ticks",
      dtypeName: "QuoteTick",
      outputKind: "quote",
      documentedFields: [
        "instrument_id",
        "bid_price",
        "ask_price",
        "bid_size",
        "ask_size",
        "ts_event",
        "ts_init",
      ],
      timestampFields: ["ts_event (int64 ns)", "ts_init (int64 ns)"],
      recordOrder: "ascending",
      instrumentLocation: "record",
      notes: [
        "the documented QuoteTick carries NO last-trade price — the W020 quote record's `last` is never invented",
        "ts_init (object initialization) maps to availableAt — validated to never precede ts_event (the A7 boundary)",
      ],
    },
    {
      dtypeId: "nautilus.order_book_deltas",
      dtypeName: "OrderBookDelta",
      outputKind: "unmappable",
      documentedFields: ["instrument_id", "action", "order_book_action", "order", "flags", "sequence", "ts_event", "ts_init"],
      timestampFields: ["ts_event (int64 ns)", "ts_init (int64 ns)"],
      recordOrder: "ascending",
      instrumentLocation: "record",
      notes: [
        "UNMAPPABLE in this baseline: a book delta is a level-change event, not a top-of-book observation; mapping it would require reconstructing book state (a later work order) — never guessed here",
      ],
    },
  ];
}

/**
 * The baseline NautilusTrader catalog over a declared instrument table —
 * the fixture-based stand-in for a real Parquet catalog (whose reader is a
 * TL action item; the acquisition declaration says so honestly).
 */
export function nautilusTraderCatalog(
  instruments: NautilusInstrumentTable,
): NautilusCatalogDescriptor {
  return {
    catalogId: "nautilus",
    label: "NautilusTrader historical data (documented dtype shapes)",
    docs: {
      source: NAUTILUS_DOCS_SOURCE,
      shapeSnapshotDate: NAUTILUS_SNAPSHOT_DATE,
      note: HAND_AUTHORED_NOTE,
    },
    instruments,
    dtypes: baselineDtypes(),
    acquisition: {
      parquetCatalog: "not-implemented",
      intendedModel:
        "read the NautilusTrader Parquet Data Catalog (per-dtype, per-instrument partitions) into " +
        "documented-shape JSON rows and map them through this package — the real nautilus_trader dependency " +
        "is a TL action item (spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md)",
      note:
        "fixture-based baseline: payloads are recorded/documented JSON rows; no parquet files are read and " +
        "no nautilus_trader package is imported",
    },
    fidelity: {
      gives: [
        "bars: the documented Bar dtype — bar_type + OHLCV float64 columns + ts_event/ts_init int64 ns",
        "trade ticks: the documented TradeTick dtype — instrument_id, price/size float64, aggressor_side, trade_id, ts_event/ts_init int64 ns",
        "quote ticks: the documented QuoteTick dtype — instrument_id, bid/ask price and size float64, ts_event/ts_init int64 ns",
      ],
      knownGaps: [
        "sub-millisecond precision is TRUNCATED in the ns->ms conversion (declared) — the world's TimestampMs contract carries no sub-ms digits",
        "int64 ns values exceed IEEE-754 safe-integer range: JSON NUMBER exports may round before this adapter sees them (undetectable here) — string ns digits are the full-fidelity form (disclosed)",
        "QuoteTick carries no last-trade price — the quote record's `last` is never invented",
        "irregular bar aggregations (TICK/VOLUME/NOTIONAL/DOLLAR/OPEN_INTEREST) carry no derivable interval length — the mapping context must declare granularityMs (never invented)",
        "order-book deltas are declared unmappable: the W020 quote record models a top-of-book observation, not a level-change event (mapping attempts are loud typed rejections)",
        "no parquet catalog IO in this baseline — fixtures are hand-authored to the documented dtype shapes (the real reader is a TL action item)",
      ],
      conventions: [
        "all timestamps are UNIX epoch NANOSECONDS int64 (ts_event/ts_init) — converted to epoch-ms explicitly with a loud sanity window (the classic ns/us/ms unit-swap corruption site)",
        "ts_event is the dtype's event time (bars: the interval start; trade/quote ticks: the tick time); ts_init (object initialization) maps to availableAt (A7: availability is part of the record)",
        "float64 columns convert to canonical decimal text via the shortest round-trip decimal representation (JS String()) — deterministic; exponent forms and >12 fraction digits are rejected loudly",
        "instrument_id is '<SYMBOL>-<VENUE>' (trades/quotes: a record field; bars: the bar_type's first component) — resolved against the catalog's declared instrument table",
        "aggressor_side 'BUY'/'SELL' maps to buy/sell (declared conversion); any other value is a loud malformed-record rejection",
        "catalog partitions are documented as ascending by event time — this adapter never re-sorts them; residual order garbage surfaces as the W020 typed out-of-order rejection",
      ],
    },
  };
}
