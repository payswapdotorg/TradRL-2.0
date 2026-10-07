/**
 * Snapshot restore: rehydrate a world from snapshot + journal tail.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md (deterministic replay requirements —
 * restore must be EXACTLY equivalent to full replay) and "G Branch safety".
 * Spec: spec/ARCHITECTURE-LOCK.md A6/A9 — state advances ONLY by reducing
 * journaled events through the single reducer path.
 *
 * The mechanism: a strict ordered fold (the same law as journal/replay.ts)
 * that reduces records into a state — plus the W016 interception: whenever a
 * `world.snapshot.created` record is met, the state-so-far (which IS the
 * state at that snapshot's cursor) and the journal prefix are captured into
 * a full `WorldSnapshot` payload. That is what lets a REPLAYED engine (bare
 * journal restore) branch from snapshots taken before the replay: the
 * payloads are rebuilt from journaled truth with zero extra reduction.
 *
 * The faster-than-replay property: a snapshot restore starts the fold from
 * the snapshot's materialized state and reduces ONLY the tail records
 * (`reducedCount` is the honest evidence — asserted in tests), while a full
 * replay reduces every record. Equivalence holds because reduction is a pure
 * fold: fold([1..M]) ≡ fold([N+1..M], fold([1..N])) and the snapshot state
 * IS fold([1..N]).
 */

import type { SnapshotId } from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { EngineInvariantError } from "../world/errors.js";
import { isSnapshotCreatedPayload } from "../world/events.js";
import type { WorldDefinition } from "../world/definition.js";
import { reduceWorldEvent, type WorldState } from "../world/state.js";
import type { JournalRecord } from "../journal/eventJournal.js";
import { buildWorldSnapshot, type WorldSnapshot } from "./capture.js";

/** Result of folding journal records into a state (with W016 payload capture). */
export interface JournalFoldOutcome {
  readonly state: WorldState;
  /** Domain time of the last reduced record, when at least one was reduced. */
  readonly lastEventTime?: number;
  /** How many records were REDUCED (the work actually done — not carried). */
  readonly reducedCount: number;
  /** Full snapshot payloads rebuilt from `world.snapshot.created` records. */
  readonly capturedSnapshots: readonly WorldSnapshot[];
}

/**
 * Fold `records` into a state starting from `initialState`, capturing full
 * snapshot payloads when `world.snapshot.created` records are met.
 * `journalRecords` is the COMPLETE journal the records belong to (for a
 * snapshot-restore fold it is prefix + tail; the capture slices it by the
 * cursor the event itself declares).
 */
export function foldJournalIntoState(input: {
  readonly definition: WorldDefinition;
  readonly initialState: WorldState;
  readonly records: readonly JournalRecord[];
  readonly journalRecords: readonly JournalRecord[];
}): JournalFoldOutcome {
  const { definition, initialState, records, journalRecords } = input;
  let state = initialState;
  const captured: WorldSnapshot[] = [];
  for (const record of records) {
    const envelope = record.envelope;
    if (envelope.eventType === "world.snapshot.created") {
      captured.push(snapshotFromJournalEvent({ definition, state, journalRecords, envelope }));
    }
    state = reduceWorldEvent(state, record);
  }
  const last = records[records.length - 1];
  return {
    state,
    ...(last === undefined ? {} : { lastEventTime: last.envelope.occurredAt }),
    reducedCount: records.length,
    capturedSnapshots: captured,
  };
}

/**
 * Rebuild the full snapshot payload a `world.snapshot.created` event
 * describes. The event is the journaled descriptor; the state-so-far is the
 * state at the snapshot's cursor (the caller folds in order, so the state
 * BEFORE reducing this event is exactly that). The recomputed content digest
 * must equal the journaled digest — a journal that disagrees with its own
 * snapshot record is corrupt (EngineInvariantError).
 */
export function snapshotFromJournalEvent(input: {
  readonly definition: WorldDefinition;
  /** The authoritative state at the snapshot's cursor (pre-event state). */
  readonly state: WorldState;
  /** The complete journal the event belongs to (the prefix is sliced out). */
  readonly journalRecords: readonly JournalRecord[];
  readonly envelope: WorldEventEnvelope;
}): WorldSnapshot {
  const { definition, state, journalRecords, envelope } = input;
  const payload = envelope.payload;
  if (!isSnapshotCreatedPayload(payload)) {
    throw new EngineInvariantError(
      `event ${String(envelope.eventId)}: malformed world.snapshot.created payload`,
    );
  }
  if (payload.journalCursor !== envelope.sequence - 1) {
    throw new EngineInvariantError(
      `snapshot event ${String(envelope.eventId)} declares cursor ${String(payload.journalCursor)} but sits at sequence ${String(envelope.sequence)}`,
    );
  }
  const prefix = journalRecords.slice(0, payload.journalCursor);
  const snapshot = buildWorldSnapshot({
    definition,
    state,
    records: prefix,
    snapshotId: payload.snapshotId,
    createdAt: payload.createdAt,
    ...(payload.parentSnapshotId === undefined ? {} : { parentSnapshotId: payload.parentSnapshotId }),
  });
  if (snapshot.descriptor.digest !== payload.digest) {
    throw new EngineInvariantError(
      `journaled snapshot digest mismatch for ${String(payload.snapshotId)}: ` +
        `event says ${payload.digest}, journal prefix recomputes ${snapshot.descriptor.digest}`,
    );
  }
  return snapshot;
}

/** Look up a captured payload by snapshot id (convenience over the fold outcome). */
export function findCapturedSnapshot(
  outcome: JournalFoldOutcome,
  snapshotId: SnapshotId,
): WorldSnapshot | undefined {
  return outcome.capturedSnapshots.find((snapshot) => snapshot.descriptor.snapshotId === snapshotId);
}
