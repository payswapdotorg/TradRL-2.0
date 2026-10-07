/**
 * Public surface of the W027 `tradrl-information` package — research/news/
 * event information import.
 *
 * Spec: spec/WORK-ITEMS.md W027, spec/ARCHITECTURE-LOCK.md A7 (information
 * boundary — availability is part of the record), A9 (determinism),
 * spec/SIMULATION.md "Fidelity declarations", spec/WORLD-PROTOCOL.md
 * "Event envelope", spec/ARCHITECTURE.md §7 "Information world".
 *
 * Layering (each module stands alone):
 * - `./descriptor.js` — information dataset fidelity-declaration laws;
 * - `./records.js` — pure record helpers (guards, event-time basis, decimal
 *   text law, explicit deterministic sort);
 * - `./validate.js` — the complete import validator (typed violations,
 *   collected, never silently dropped);
 * - `./adapters.js` — record → artifact + W004-envelope event draft mapping
 *   (one shared payload; the W028 identity) + the definition-surface
 *   projection `toDefinitionInformationArtifacts`;
 * - `./loader.js` — the deterministic loader (artifacts + drafts + sealed
 *   records + W004 digest);
 * - `./errors.js` — the typed error taxonomy.
 *
 * The record/descriptor/payload CONTRACTS live in the
 * `tradrl-world-contracts/information-data` export (W027's contracts
 * surface); this package owns the import logic. No fetching: real feeds
 * arrive through future provider adapters.
 */

export {
  INFORMATION_RECORD_KINDS,
  isInformationRecordKind,
  validateInformationDatasetDescriptor,
} from "./descriptor.js";
export {
  InformationImportError,
  type InformationImportErrorKind,
  type InformationViolation,
} from "./errors.js";
export {
  buildInformationImportContext,
  informationRecordToArtifactAndDraft,
  toDefinitionInformationArtifacts,
  type InformationImportContext,
  type RecordSymbolMap,
} from "./adapters.js";
export {
  isAnalystNoteRecord,
  isEventRecord,
  isNewsItemRecord,
  isResearchReportRecord,
  isCanonicalDecimalText,
  sortInformationRecords,
} from "./records.js";
export {
  loadInformationDataset,
  type InformationImportOutcome,
  type InformationImportSummary,
} from "./loader.js";
export {
  validateInformationImport,
  type InformationImportInput,
  type InformationValidation,
} from "./validate.js";
