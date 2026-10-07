/**
 * Public surface of the W031 `tradrl-world-cli` app.
 *
 * Layering (each module stands alone):
 * - `./args.js` — argv parsing + usage;
 * - `./errors.js` — the typed CLI error taxonomy + exit classes;
 * - `./jsonFile.js` — typed JSON file reading;
 * - `./definitionFile.js` — definition-file loading + loud validation;
 * - `./scriptFile.js` — script-file loading + validation + command building;
 * - `./datasets.js` — the `datasets` section (W020/W027 loaders);
 * - `./journalFile.js` — journal-file serialization/parsing (run↔replay);
 * - `./runner.js` — engine selection, script driving, the run report;
 * - `./replay.js` — journal restore + continuation (the W016 restore path);
 * - `./cli.js` — the testable `main(argv)` (never imported for side effects;
 *   `./entry.js` is the bin entry).
 */

export { parseCommandLine, USAGE, type CommandLine } from "./args.js";
export {
  CliError,
  engineError,
  isSimTypedError,
  type CliErrorCode,
  type CliExitCode,
} from "./errors.js";
export { readJsonFile, type JsonFileLabels } from "./jsonFile.js";
export { loadDefinitionFile, type LoadedDefinition } from "./definitionFile.js";
export {
  loadScriptFile,
  validateCommandInput,
  validateScriptEntry,
  type LoadedScript,
  type ScriptClockOperation,
  type ScriptEntry,
} from "./scriptFile.js";
export {
  loadDeclaredDatasets,
  parseDatasetDeclarations,
  type DatasetDeclaration,
  type DatasetImportEvidence,
  type LoadedDatasets,
} from "./datasets.js";
export {
  assertRecordsMatchWorld,
  definitionsEqual,
  journalFromRecords,
  parseJournalFile,
  writeJournalFile,
  type ParsedJournalFile,
} from "./journalFile.js";
export {
  buildReportCore,
  createEngineFor,
  driveScript,
  engineKindOf,
  executeRun,
  withDigest,
  type EngineKind,
  type ReportCore,
  type RunInputs,
  type RunReport,
  type ScriptOutcome,
} from "./runner.js";
export { executeReplay, type ReplayInputs, type ReplayReport, type RestoredSummary } from "./replay.js";
export { main, runMain } from "./cli.js";
