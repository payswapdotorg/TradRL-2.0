/**
 * The W016 branch command seam — the typed boundary the world core's
 * command lifecycle calls for `branch-world` (the W014 matching-seam
 * pattern, applied to branching).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A8 — branching, never destructive rewind:
 * the command validates the source snapshot, allocates the deterministic
 * branch world id and drafts the `world.branch.created` event journaled on
 * the PARENT world. The child engine itself is created by the parent ENGINE
 * when the command acks (engine.ts) from the very same event plus the
 * snapshot payload — one journal record, one creation path.
 *
 * Domain-rule rejections (typed, closed set for W016):
 * - unknown-snapshot — the id was never journaled by this world;
 * - snapshot-not-restorable — the descriptor is journaled but the full
 *   payload is not available in this engine session (replay rebuilds
 *   payloads from journaled truth, so in practice this guards foreign
 *   hand-built stores);
 * - snapshot-engine-mismatch — the snapshot was taken by a different
 *   engine/version whose state this engine cannot honestly rehydrate.
 */

import type { BranchWorldCommand, SnapshotId } from "tradrl-world-contracts";
import type { CausationId, CorrelationId, TimestampMs } from "tradrl-world-contracts";
import type { EventJournal } from "../journal/eventJournal.js";
import type { WorldSnapshot } from "../snapshot/capture.js";
import { ENGINE_ID, ENGINE_VERSION } from "../world/definition.js";
import {
  ENGINE_EVENT_SCHEMA_VERSION,
  WORLD_CORE_PRODUCER,
} from "../world/events.js";
import type { LifecycleContext, LifecycleOutcome } from "../world/lifecycle.js";
import { branchWorldIdFor } from "./definition.js";

/** What the branch seam needs beyond the plain lifecycle context. */
export type BranchCommandContext = LifecycleContext & {
  /** The parent's authoritative journal (branch point evidence). */
  readonly journal: EventJournal;
  /** Full snapshot payloads available in this engine session. */
  readonly snapshotPayloads: ReadonlyMap<SnapshotId, WorldSnapshot>;
};

function branchRejected(code: string, message: string): LifecycleOutcome {
  return { kind: "rejected", rejection: { stage: "domain-rules", code, message } };
}

/**
 * Apply a `branch-world` command: resolve the source snapshot, allocate the
 * child world id deterministically (event-registry position + 1) and draft
 * the `world.branch.created` event carrying the complete lineage facts
 * (parent world id, snapshot digest, branch point sequence).
 */
export function applyBranchWorldCommand(
  command: BranchWorldCommand,
  ctx: BranchCommandContext,
): LifecycleOutcome {
  const definition = ctx.definition;
  const parentWorldId = definition.scope.worldId;
  const sourceSnapshotId = command.sourceSnapshotId;

  if (!ctx.state.snapshots.some((summary) => summary.snapshotId === sourceSnapshotId)) {
    return branchRejected(
      "unknown-snapshot",
      `snapshot ${String(sourceSnapshotId)} was never taken in world ${String(parentWorldId)}`,
    );
  }
  const snapshot = ctx.snapshotPayloads.get(sourceSnapshotId);
  if (snapshot === undefined) {
    return branchRejected(
      "snapshot-not-restorable",
      `snapshot ${String(sourceSnapshotId)} is journaled but its full payload is not restorable in this engine session`,
    );
  }
  if (
    snapshot.descriptor.worldId !== parentWorldId ||
    snapshot.engine !== ENGINE_ID ||
    snapshot.engineVersion !== ENGINE_VERSION
  ) {
    return branchRejected(
      "snapshot-engine-mismatch",
      `snapshot ${String(sourceSnapshotId)} belongs to ${snapshot.engine}@${snapshot.engineVersion} ` +
        `world ${String(snapshot.descriptor.worldId)}; this engine is ${ENGINE_ID}@${ENGINE_VERSION} ` +
        `world ${String(parentWorldId)}`,
    );
  }

  const payload = {
    type: "world.branch.created" as const,
    branchWorldId: branchWorldIdFor(parentWorldId, ctx.state.branches.length + 1),
    parentWorldId,
    sourceSnapshotId,
    snapshotDigest: snapshot.descriptor.digest!,
    branchPointSequence: snapshot.descriptor.journalCursor,
    configuration: command.configuration ?? {},
    engine: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    seed: definition.seed,
    createdAt: ctx.simulationTime as TimestampMs,
    issuedBy: command.issuedBy,
    createdViaCommand: command.commandId,
  };
  return {
    kind: "applied",
    drafts: [
      {
        eventType: "world.branch.created",
        occurredAt: ctx.simulationTime as TimestampMs,
        causationId: command.commandId as unknown as CausationId,
        correlationId: (command.correlationId ?? command.commandId) as unknown as CorrelationId,
        producer: WORLD_CORE_PRODUCER,
        schemaVersion: ENGINE_EVENT_SCHEMA_VERSION,
        payload,
      },
    ],
  };
}
