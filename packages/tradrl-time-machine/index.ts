/**
 * Public surface of the W050 `tradrl-time-machine` package — the
 * point-in-time CONTRACT.
 *
 * Modules (the package.json exports map is the authority):
 * - `./query.js` — the PointInTimeQuery as typed DATA (the declared cutoff
 *   in W004's time vocabulary, the explicit scope, the closed record-family
 *   set, the content-addressed query id);
 * - `./firewall.js` — THE KNOWLEDGE FIREWALL LAW as a typed gate
 *   (`sealView`: every record proven ≤ cutoff through its own timestamps;
 *   post-cutoff leaks refused loudly naming R016; the sealed view carries
 *   its proof and its firewall digest);
 * - `./validate.js` — whole-record re-validation (query id + firewall
 *   digest + view id RE-DERIVED from recorded data; R016 re-proven).
 *
 * The pure query ENGINE that assembles views from recorded streams is the
 * service `services/time-machine` (`time-machine`) — this package owns the
 * contract, that service owns the assembly.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export {
  TIME_MACHINE_FAMILIES,
  TIME_MACHINE_SCOPE_MEMBERS,
  POINT_IN_TIME_QUERY_ID_PREFIX,
  asPointInTimeCutoff,
  blankTimeMachineScopeMembers,
  buildPointInTimeQuery,
  isLegalCutoff,
  isTimeMachineRecordFamily,
  pointInTimeQueryIdOf,
  type PointInTimeCutoff,
  type PointInTimeQuery,
  type PointInTimeQueryError,
  type PointInTimeQueryErrorCode,
  type PointInTimeQueryId,
  type PointInTimeQueryInput,
  type PointInTimeQueryOutcome,
  type TimeMachineRecordFamily,
  type TimeMachineScope,
} from "./query.js";
export {
  KNOWLEDGE_FIREWALL_LAW,
  POINT_IN_TIME_VIEW_ID_PREFIX,
  compareViewRecords,
  firewallDigestOf,
  pointInViewIdOf,
  sealView,
  viewRecordOccurredAt,
  viewRecordObservableAt,
  type FirewallErrorCode,
  type FirewallProof,
  type FirewallProofEntry,
  type FirewallRefusal,
  type PointInTimeView,
  type PointInViewId,
  type SealViewOutcome,
  type ViewRecord,
} from "./firewall.js";
export {
  validatePointInTimeQuery,
  validatePointInTimeView,
  type PointInTimeQueryValidation,
  type PointInTimeViewValidation,
  type PointInViewError,
  type PointInViewErrorCode,
} from "./validate.js";
