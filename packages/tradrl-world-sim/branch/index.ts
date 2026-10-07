/**
 * Public surface of the W016 engine `branch` module.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A8 (branching, never destructive rewind),
 * spec/WORLD-PROTOCOL.md "Branches", spec/ARCHITECTURE.md §8/§9,
 * spec/ACCEPTANCE-WORLD-ALPHA.md E/G. Composes the snapshot module
 * (../snapshot/index.js) with lineage, definition rescoping and genesis.
 */

export {
  branchWorldIdFor,
  withBranchWorldId,
} from "./definition.js";
export {
  branchGenesisState,
} from "./genesis.js";
export {
  childLineage,
  lineageOf,
  lineageParentId,
  lineageSubject,
  type BranchLineage,
  type BranchLineageRecord,
} from "./lineage.js";
export { applyBranchWorldCommand, type BranchCommandContext } from "./seam.js";
export { branchWorld, type BranchWorldOutcome } from "./world.js";
