/**
 * Branch lineage — the immutable ancestry chain (W016 `branch` module).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A8 — "rewind creates a child world from an
 * immutable snapshot"; "every branch records complete lineage (parent world
 * id, snapshot digest, branch point sequence)".
 * Spec: spec/WORLD-PROTOCOL.md "Branches" — a branch never modifies its
 * parent; it references the source snapshot and records its branch
 * definition (ARCHITECTURE.md §9).
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — "Branch lineage is immutable".
 *
 * `BranchRecord` is the W003 protocol contract; the engine records the
 * lineage-complete form — the contract record plus the two facts the work
 * order demands on every branch: the source snapshot's content digest and
 * the parent journal sequence the branch forked at. Structurally assignable
 * to `BranchRecord[]` wherever the ports speak the contract shape.
 */

import type { BranchRecord, WorldId } from "tradrl-world-contracts";
import type { SequenceNumber } from "tradrl-world-contracts";

/**
 * The lineage-complete branch record: the W003 `BranchRecord` plus the
 * snapshot digest and the branch point sequence. Immutable once journaled.
 */
export type BranchLineageRecord = BranchRecord & {
  /** Content-addressed digest of the source snapshot (W016). */
  readonly snapshotDigest: string;
  /** Parent journal cursor at the branch point (W016). */
  readonly branchPointSequence: SequenceNumber;
};

/**
 * The ancestry chain of a world: the branch records that produced it, in
 * creation order from the root — e.g. `[root→X, X→Y]` for grandchild Y. A
 * root world's lineage is the empty chain.
 */
export type BranchLineage = readonly BranchLineageRecord[];

/** Extend a parent's lineage with the record of a newly created child. */
export function childLineage(
  parentLineage: BranchLineage,
  record: BranchLineageRecord,
): BranchLineage {
  return [...parentLineage, record];
}

/** The world that the LAST lineage record created (the chain's subject). */
export function lineageSubject(lineage: BranchLineage): WorldId | undefined {
  return lineage[lineage.length - 1]?.worldId;
}

/** The parent of the chain's subject (undefined for a root world). */
export function lineageParentId(lineage: BranchLineage): WorldId | undefined {
  return lineage[lineage.length - 1]?.parentWorldId;
}

/**
 * The lineage chain of any world this chain can speak about: the subject
 * itself (the full chain), any ancestor (the chain up to and including the
 * record that created it), or undefined for worlds outside the chain.
 */
export function lineageOf(
  lineage: BranchLineage,
  worldId: WorldId,
): BranchLineage | undefined {
  const index = lineage.findIndex((record) => record.worldId === worldId);
  return index < 0 ? undefined : lineage.slice(0, index + 1);
}
