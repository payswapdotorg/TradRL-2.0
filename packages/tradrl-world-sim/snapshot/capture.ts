/**
 * Snapshot capture, content addressing and verification — the W016
 * `snapshot` module core.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Snapshots" — immutable, self-describing; it
 * includes world definition, clock, engine/version, seed, market/account/
 * participant/information state and journal cursor.
 * Spec: spec/ARCHITECTURE-LOCK.md A8 (rewind = immutable snapshot + branch,
 * never destructive mutation), A9 (determinism — the snapshot digest is a
 * pure function of journaled truth).
 * Spec: spec/DOMAIN-MODEL.md "Ownership" — Snapshot → branch origin.
 *
 * Content addressing: the descriptor's `digest` is the established engine
 * hashing pattern (`stableDigest` — canonical JSON, sorted keys, undefined
 * omitted, FNV-1a) over the WHOLE snapshot content minus the digest itself,
 * so two structurally equal snapshots always share a digest, and any change
 * to definition, state, clock position, journal prefix or lineage-anchoring
 * identity changes it. The payload additionally carries the journal PREFIX
 * records up to the cursor, which makes the snapshot a COMPLETE restorable
 * capture: snapshot + journal tail ≡ full replay (proved in snapshot/test).
 *
 * Determinism: the digest covers only domain truth — definition, seed,
 * engine/version, state at the cursor, the simulation-time position, the
 * W004 journal digest and the prefix records. Wall time, clock status/speed
 * (session state) and live caches never enter.
 */

import type { SequenceNumber, SnapshotId, TimestampMs } from "tradrl-world-contracts";
import type { SnapshotDescriptor, WorldId } from "tradrl-world-contracts";
import type { EventStreamDigest } from "tradrl-world-contracts/time";
import { eventStreamDigest } from "tradrl-world-contracts/time";
import type { JournalRecord } from "../journal/eventJournal.js";
import { ENGINE_ID, ENGINE_VERSION, type WorldDefinition } from "../world/definition.js";
import { EngineInvariantError } from "../world/errors.js";
import { stableDigest } from "../world/hashing.js";
import type { WorldState } from "../world/state.js";
import { serializeWorldState, type WorldStatePayload } from "./stateCodec.js";

/**
 * A complete, restorable snapshot of one world at a journal cursor: the
 * protocol-level descriptor (W003 `SnapshotDescriptor` — the port-visible
 * handle) plus the engine-owned payload a restore/branch needs.
 */
export interface WorldSnapshot {
  readonly descriptor: SnapshotDescriptor;
  readonly engine: string;
  readonly engineVersion: string;
  readonly worldDefinitionVersion: string;
  readonly seed: string;
  /** The full world definition the run is a function of (self-describing). */
  readonly definition: WorldDefinition;
  /** The authoritative state at the cursor, serialized canonically. */
  readonly state: WorldStatePayload;
  /**
   * The clock position the snapshot pins: the simulation-time axis at
   * capture (= descriptor.createdAt, the journaled occurredAt of the
   * snapshot event). Status/speed/wall axes are session state and are
   * deliberately NOT part of the snapshot (A7/A9 — wall time never enters
   * journaled content).
   */
  readonly clock: { readonly simulationTime: TimestampMs };
  /** The W004 digest of the prefix records [1..cursor] (verification anchor). */
  readonly journalDigest: EventStreamDigest;
  /**
   * The journal prefix itself — the authoritative history up to the cursor.
   * Records are immutable and shared by reference with the engine's journal;
   * they make restore-with-tail EXACTLY equivalent to full replay.
   */
  readonly records: readonly JournalRecord[];
}

/** The snapshot content that the content-addressed digest covers. */
export type WorldSnapshotContent = Omit<WorldSnapshot, "descriptor"> & {
  readonly descriptor: Omit<SnapshotDescriptor, "digest">;
};

/** Inputs for `buildWorldSnapshot` (capture at the current journal position). */
export interface BuildSnapshotInput {
  readonly definition: WorldDefinition;
  /** The authoritative state at the cursor (BEFORE any snapshot event). */
  readonly state: WorldState;
  /** The journal prefix records [1..cursor]. */
  readonly records: readonly JournalRecord[];
  readonly snapshotId: SnapshotId;
  /** Domain time of the capture (the snapshot event's occurredAt). */
  readonly createdAt: TimestampMs;
  readonly parentSnapshotId?: SnapshotId;
}

/** Content of a snapshot without its digest (the addressable bytes). */
export function snapshotContentOf(snapshot: WorldSnapshot): WorldSnapshotContent {
  const { digest: _digest, ...descriptor } = snapshot.descriptor;
  return { ...snapshot, descriptor };
}

/** The content-addressed digest of snapshot content (W016 hashing pattern). */
export function snapshotDigestOf(content: WorldSnapshotContent): string {
  return stableDigest(content);
}

/**
 * Build a complete snapshot. The cursor is derived from the prefix
 * (`records.length` — the journal's dense-sequence law makes cursor and
 * record count agree); the digest is computed over the whole content minus
 * the digest itself.
 */
export function buildWorldSnapshot(input: BuildSnapshotInput): WorldSnapshot {
  const { definition, state, records, snapshotId, createdAt } = input;
  const cursor = records.length as SequenceNumber;
  const last = records[records.length - 1];
  if (last !== undefined && last.envelope.sequence !== cursor) {
    throw new EngineInvariantError(
      `snapshot prefix is not dense: last sequence ${String(last.envelope.sequence)} ≠ record count ${String(cursor)}`,
    );
  }
  const content: WorldSnapshotContent = {
    descriptor: {
      snapshotId,
      worldId: definition.scope.worldId,
      ...(input.parentSnapshotId === undefined ? {} : { parentSnapshotId: input.parentSnapshotId }),
      createdAt,
      journalCursor: cursor,
    } as WorldSnapshotContent["descriptor"],
    engine: ENGINE_ID,
    engineVersion: ENGINE_VERSION,
    worldDefinitionVersion: definition.worldDefinitionVersion,
    seed: definition.seed,
    definition,
    state: serializeWorldState(state),
    clock: { simulationTime: createdAt },
    journalDigest: eventStreamDigest(records.map((record) => record.envelope)),
    records,
  };
  return { ...content, descriptor: { ...content.descriptor, digest: snapshotDigestOf(content) } };
}

/** Structural verification problems reported by `verifyWorldSnapshot`. */
export type SnapshotVerificationProblem =
  | "digest-mismatch"
  | "cursor-record-count-mismatch"
  | "journal-digest-mismatch";

/** Result of verifying a snapshot against its own content. */
export type SnapshotVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: readonly SnapshotVerificationProblem[] };

/**
 * Verify a snapshot is self-consistent: the content-addressed digest matches
 * the descriptor, the cursor agrees with the prefix record count, and the
 * stored journal digest is the true W004 digest of the prefix. A tampered
 * snapshot fails loudly instead of restoring.
 */
export function verifyWorldSnapshot(snapshot: WorldSnapshot): SnapshotVerification {
  const problems: SnapshotVerificationProblem[] = [];
  const content = snapshotContentOf(snapshot);
  if (snapshotDigestOf(content) !== snapshot.descriptor.digest) {
    problems.push("digest-mismatch");
  }
  if (snapshot.descriptor.journalCursor !== snapshot.records.length) {
    problems.push("cursor-record-count-mismatch");
  }
  const trueDigest = eventStreamDigest(snapshot.records.map((record) => record.envelope));
  if (
    trueDigest.eventChecksum !== snapshot.journalDigest.eventChecksum ||
    trueDigest.eventCount !== snapshot.journalDigest.eventCount
  ) {
    problems.push("journal-digest-mismatch");
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/** Project the protocol-level descriptor of a stored snapshot. */
export function descriptorOf(snapshot: WorldSnapshot): SnapshotDescriptor {
  return snapshot.descriptor;
}

/** Canonical deterministic snapshot id for a world's n-th snapshot. */
export function snapshotIdFor(worldId: WorldId, count: number): SnapshotId {
  return `snap:${String(worldId)}:${String(count)}` as SnapshotId;
}
