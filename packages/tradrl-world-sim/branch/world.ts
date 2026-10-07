/**
 * The W016 branch world creation wrapper — the engine-surface entry for
 * hosts and tests (the CommandPort stays the single command boundary; this
 * wrapper executes `branchWorld` THROUGH the port and hands back the child
 * engine the parent created when the command acked).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Branches" and "Human/agent symmetry" —
 * human and agent actions terminate at the same CommandPort (A15 headless
 * parity: the port method alone performs the branch; this wrapper only
 * retrieves the result).
 * Spec: spec/ARCHITECTURE-LOCK.md A8 — the parent journal gains exactly one
 * append-only `world.branch.created` record; the parent's prior history and
 * the source snapshot are never touched.
 */

import type { BranchWorldCommand, CommandResult } from "tradrl-world-contracts";
import type { HeadlessWorldEngine } from "../world/engine.js";
import type { BranchLineageRecord } from "./lineage.js";
import type { WorldSnapshot } from "../snapshot/capture.js";

/** The outcome of a `branchWorld` call through a parent engine's port. */
export interface BranchWorldOutcome {
  /** The parent's CommandResult for the branch-world command. */
  readonly parent: CommandResult;
  /** The child engine the parent created on ack (undefined when rejected). */
  readonly branch: HeadlessWorldEngine | undefined;
  /** The lineage-complete branch record (undefined when rejected). */
  readonly record: BranchLineageRecord | undefined;
  /** The source snapshot payload the branch was created from. */
  readonly snapshot: WorldSnapshot | undefined;
}

/**
 * Create a branch world: submit `branchWorld` through the parent's
 * CommandPort (validate → authorize → apply → journal on the parent → the
 * parent engine creates the child from the source snapshot) and return the
 * child engine with its lineage record. A rejected command returns the typed
 * rejection and no branch.
 */
export async function branchWorld(
  parent: HeadlessWorldEngine,
  command: BranchWorldCommand,
): Promise<BranchWorldOutcome> {
  const result = await parent.command.branchWorld(command);
  if (result.status === "rejected") {
    return { parent: result, branch: undefined, record: undefined, snapshot: undefined };
  }
  const branches = parent.worldState().branches;
  const record = branches[branches.length - 1];
  const branch =
    record === undefined
      ? undefined
      : parent.branchEngines().find((engine) => engine.worldId === record.worldId);
  const snapshot =
    record === undefined ? undefined : parent.getSnapshotPayload(record.sourceSnapshotId);
  return { parent: result, branch, record, snapshot };
}
