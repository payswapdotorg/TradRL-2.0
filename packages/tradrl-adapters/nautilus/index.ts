/**
 * Public surface of the W021 `tradrl-adapters-nautilus` package — the
 * NautilusTrader high-fidelity replay adapter.
 *
 * Spec: spec/WORK-ITEMS.md W021, spec/ARCHITECTURE-LOCK.md A7 (event time
 * and availability come from the record, never invented), A9 (deterministic
 * pure transforms), spec/SIMULATION.md "Fidelity declarations".
 *
 * Layering (each module stands alone):
 * - `./errors.js` — the typed violation taxonomy (unknown instrument,
 *   malformed record, missing field, out-of-range timestamp, A7 boundary,
 *   interval mismatch, unsupported/unmappable dtype, invalid catalog);
 * - `./nanoseconds.js` — the ns→ms timestamp laws (int64 NANOSECONDS, the
 *   documented NautilusTrader convention; loud sanity window against the
 *   classic unit swaps; exact digit truncation; the int64/JSON precision
 *   honesty disclosed);
 * - `./instruments.js` — the "<SYMBOL>-<VENUE>" instrument tables and typed
 *   resolution;
 * - `./dtypes.js` — the catalog/dtype declarations (Bar, TradeTick,
 *   QuoteTick + the honest unmappable OrderBookDelta), structural
 *   validation, and the baseline catalog factory;
 * - `./bar.js` / `./trade.js` / `./quote.js` — the three dtype mappers
 *   (documented field names, declared conversions per dtype);
 * - `./dataset.js` — W020 `DatasetDescriptor` building (derived range,
 *   adapter-detected bar holes declared as gaps, honest limitations);
 * - `./mapping.js` — the batch engine: recorded payload -> records +
 *   descriptor + symbolMap, the exact `loadHistoricalDataset` input triple.
 *
 * NO PARQUET / nautilus_trader IO: the baseline maps recorded/documented
 * JSON rows only; the real catalog reader is a TL action item (see
 * spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md — disclosed, never silently
 * claimed).
 */

export {
  type NautilusMappingErrorKind,
  type NautilusMappingViolation,
} from "./errors.js";
export {
  NAUTILUS_EPOCH_CEILING_NS,
  NAUTILUS_EPOCH_FLOOR_NS,
  type NanosecondConversion,
  epochMsFromNanos,
} from "./nanoseconds.js";
export {
  type InstrumentResolution,
  type NautilusInstrumentTable,
  declaredInstruments,
  instrumentMapOf,
  isInstrumentIdShape,
  isNonBlank,
  resolveNautilusInstrument,
} from "./instruments.js";
export {
  type DtypeOutputKind,
  type InstrumentLocation,
  type NautilusAcquisitionDeclaration,
  type NautilusCatalogDescriptor,
  type NautilusDtypeDescriptor,
  type NautilusFidelityDeclaration,
  NAUTILUS_DOCS_SOURCE,
  NAUTILUS_SNAPSHOT_DATE,
  baselineDtypes,
  dtypeOf,
  nautilusTraderCatalog,
  validateNautilusCatalog,
} from "./dtypes.js";
export {
  BAR_PRICE_TYPES,
  BAR_SPECIFICATIONS,
  IRREGULAR_AGGREGATIONS,
  type NautilusBarRow,
  type NautilusBarTypeParts,
  TIME_AGGREGATIONS,
  barGranularityLabel,
  mapNautilusBar,
  parseNautilusBarType,
} from "./bar.js";
export {
  type NautilusTradeTickRow,
  mapNautilusTrade,
} from "./trade.js";
export {
  type NautilusQuoteTickRow,
  mapNautilusQuote,
} from "./quote.js";
export {
  type NautilusDescriptorContext,
  buildNautilusDatasetDescriptor,
  deriveNautilusDatasetId,
  detectBarHoles,
} from "./dataset.js";
export {
  type NautilusDatasetContext,
  type NautilusDatasetMapping,
  type NautilusRecordContext,
  type NautilusRecordMapping,
  mapNautilusDataset,
  mapNautilusRecord,
} from "./mapping.js";
