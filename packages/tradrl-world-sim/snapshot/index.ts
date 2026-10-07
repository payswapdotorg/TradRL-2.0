/**
 * Public surface of the W016 engine `snapshot` module.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Snapshots" (immutable, self-describing),
 * spec/ARCHITECTURE-LOCK.md A8/A9, spec/ACCEPTANCE-WORLD-ALPHA.md
 * (deterministic replay, branch safety). Consumed by the world engine
 * (command seam, restore paths) and by W016's branch module; the branch
 * module (`../branch/index.js`) composes snapshot + lineage.
 */

export {
  buildWorldSnapshot,
  descriptorOf,
  snapshotContentOf,
  snapshotDigestOf,
  snapshotIdFor,
  verifyWorldSnapshot,
  type BuildSnapshotInput,
  type SnapshotVerification,
  type SnapshotVerificationProblem,
  type WorldSnapshot,
  type WorldSnapshotContent,
} from "./capture.js";
export {
  foldJournalIntoState,
  findCapturedSnapshot,
  snapshotFromJournalEvent,
  type JournalFoldOutcome,
} from "./restore.js";
export { hydrateWorldState, serializeWorldState, type WorldStatePayload } from "./stateCodec.js";
export { applyCreateSnapshotCommand, type SnapshotCommandContext } from "./seam.js";
