/**
 * Public surface of the W020 `tradrl-data` package — historical
 * dataset/event import.
 *
 * Spec: spec/WORK-ITEMS.md W020, spec/ARCHITECTURE-LOCK.md A7 (information
 * boundary — availability is part of the record), A9 (determinism),
 * spec/SIMULATION.md "Fidelity declarations", spec/WORLD-PROTOCOL.md
 * "Event envelope".
 *
 * Layering (each module stands alone):
 * - `./descriptor.js` — dataset fidelity-declaration laws;
 * - `./records.js` — pure record helpers (event-time basis, extent, decimal
 *   text law, explicit deterministic sort);
 * - `./validate.js` — the complete import validator (typed violations,
 *   collected, never silently dropped);
 * - `./adapters.js` — record → W004-envelope event draft mapping;
 * - `./loader.js` — the deterministic loader (drafts + sealed records +
 *   W004 digest);
 * - `./errors.js` — the typed error taxonomy.
 *
 * The record/descriptor/payload CONTRACTS live in the
 * `tradrl-world-contracts/data` export (W020's contracts surface); this
 * package owns the import logic. No fetching: real datasets arrive through
 * W021 (Nautilus) and W026 (crypto providers).
 */

export {
  HISTORICAL_RECORD_KINDS,
  isHistoricalRecordKind,
  validateDatasetDescriptor,
} from "./descriptor.js";
export {
  DatasetImportError,
  type DatasetImportErrorKind,
  type DatasetViolation,
} from "./errors.js";
export {
  buildImportEventContext,
  historicalRecordToEventDraft,
  type ImportEventContext,
  type RecordSymbolMap,
} from "./adapters.js";
export {
  compareCanonicalDecimalText,
  historicalRecordEventTime,
  historicalRecordExtent,
  isCanonicalDecimalText,
  isHistoricalBarRecord,
  isHistoricalQuoteRecord,
  isHistoricalTradeRecord,
  sortHistoricalRecords,
} from "./records.js";
export {
  loadHistoricalDataset,
  type HistoricalImportOutcome,
  type HistoricalImportSummary,
} from "./loader.js";
export {
  validateHistoricalImport,
  type DatasetValidation,
  type HistoricalImportInput,
} from "./validate.js";
