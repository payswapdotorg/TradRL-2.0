/**
 * Public surface of the W050 `time-machine` service — the pure query
 * engine over the point-in-time contract.
 *
 * Modules (the package.json exports map is the authority):
 * - `./engine.js` — `assembleView(query, streams)`: THE GATE (W004/W027
 *   validators re-proven with errors carried verbatim; stream declarations
 *   proven against the query; the knowable-at-cutoff records selected
 *   through the observation laws; the selection sealed through the R016
 *   knowledge firewall; the deterministic view + the carried summaries);
 * - `./fidelity.js` — the W022-style deterministic-replay proofs (the A9
 *   twin + the view digest re-derivation + the firewall seal
 *   reproducibility) as `{ claim, verdict, evidence }` findings;
 * - `./validate.js` — whole-record re-validation of the assembled view.
 *
 * The point-in-time CONTRACT (query/firewall/validate types) is the
 * `tradrl-time-machine` package; this service owns the assembly.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export {
  cutoffWithinDeclaredRange,
  assembleView,
  type AssembleViewError,
  type AssembleViewErrorCode,
  type AssembleViewOutcome,
  type AssembledPointInTimeView,
  type InformationRecordStream,
  type MarketEventStream,
  type TimeMachineStream,
  type ViewStreamSummary,
} from "./engine.js";
export {
  proveViewFidelity,
  type ViewFidelityCase,
  type ViewFidelityFinding,
  type ViewFidelityReport,
} from "./fidelity.js";
export {
  validateAssembledPointInTimeView,
  type AssembledViewError as AssembledViewRevalidationError,
  type AssembledViewErrorCode as AssembledViewRevalidationErrorCode,
  type AssembledViewValidation,
} from "./validate.js";
