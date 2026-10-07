/**
 * The W016 snapshot command seam — the typed boundary the world core's
 * command lifecycle calls for `create-snapshot` (the W014 matching-seam
 * pattern, applied to snapshots).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — the apply-domain-rules
 * stage returns the ordered event drafts; the engine journals, reduces,
 * publishes and acks. Spec: spec/ARCHITECTURE-LOCK.md A6 (commands emit
 * ordered domain events and append journal records — snapshot creation is
 * journaled like every other command, which is what makes the snapshot
 * registry event-derived and replay-safe), A8/A9.
 *
 * What the seam does at draft time: allocate the deterministic snapshot id
 * (world sequence position in the event-derived snapshot registry), capture
 * the complete payload (definition + state at the CURRENT cursor + the
 * journal prefix) and compute its content-addressed digest — the draft then
 * carries the full descriptor, and the engine re-derives the identical
 * payload from (state-before, journal prefix) when it registers the
 * snapshot. Same content, one path.
 */

import type { CreateSnapshotCommand } from "tradrl-world-contracts";
import type { CausationId, CorrelationId, TimestampMs } from "tradrl-world-contracts";
import type { EventJournal } from "../journal/eventJournal.js";
import {
  ENGINE_EVENT_SCHEMA_VERSION,
  WORLD_CORE_PRODUCER,
} from "../world/events.js";
import type { LifecycleContext, LifecycleOutcome } from "../world/lifecycle.js";
import { snapshotIdFor } from "./capture.js";
import { buildWorldSnapshot } from "./capture.js";

/** What the snapshot seam needs beyond the plain lifecycle context. */
export type SnapshotCommandContext = LifecycleContext & {
  /** The authoritative journal (cursor = the snapshot's journalCursor). */
  readonly journal: EventJournal;
};

/**
 * Apply a `create-snapshot` command: capture the world at the current
 * journal position and draft its `world.snapshot.created` event. The command
 * never fails at domain rules (any participant may snapshot; the world is
 * always restorable at the current cursor) — validation/authorization were
 * the earlier lifecycle stages.
 */
export function applyCreateSnapshotCommand(
  command: CreateSnapshotCommand,
  ctx: SnapshotCommandContext,
): LifecycleOutcome {
  const definition = ctx.definition;
  const worldId = definition.scope.worldId;
  const cursor = ctx.journal.getCursor();
  const records = ctx.journal.records().slice(0, cursor);
  const snapshot = buildWorldSnapshot({
    definition,
    state: ctx.state,
    records,
    snapshotId: snapshotIdFor(worldId, ctx.state.snapshots.length + 1),
    createdAt: ctx.simulationTime as TimestampMs,
    ...(ctx.state.snapshots.length === 0
      ? {}
      : { parentSnapshotId: ctx.state.snapshots[ctx.state.snapshots.length - 1]!.snapshotId }),
  });
  const payload = {
    type: "world.snapshot.created" as const,
    snapshotId: snapshot.descriptor.snapshotId,
    journalCursor: snapshot.descriptor.journalCursor,
    digest: snapshot.descriptor.digest!,
    createdAt: snapshot.descriptor.createdAt,
    ...(snapshot.descriptor.parentSnapshotId === undefined
      ? {}
      : { parentSnapshotId: snapshot.descriptor.parentSnapshotId }),
    ...(command.label === undefined ? {} : { label: command.label }),
    issuedBy: command.issuedBy,
  };
  return {
    kind: "applied",
    drafts: [
      {
        eventType: "world.snapshot.created",
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
