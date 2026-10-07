/**
 * The engine's own event taxonomy and payloads — the "engine lifecycle
 * events" owned by this producer package (the envelope contract's
 * `eventType` is opaque; typed taxonomies belong to their producers).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope" + "Command lifecycle" (the
 * emit step produces ordered domain events; the envelope carries timing,
 * payloads carry facts).
 * Spec: spec/ARCHITECTURE-LOCK.md A6 (commands mutate state, emit ordered
 * events, append journal records).
 *
 * World Alpha engine events (closed set — additions go through a deliberate
 * engine change, mirrored in tests):
 * - world.annotation.added — CommandPort.addAnnotation applied
 * - world.scenario.set — CommandPort.setScenario applied
 * - world.snapshot.created — CommandPort.createSnapshot applied (W016)
 * - world.branch.created — CommandPort.branchWorld applied, journaled on the
 *   PARENT world (W016; the branch child engine is created from the source
 *   snapshot and gets its own journal)
 */

import type {
  AnnotationId,
  InstrumentId,
  ParticipantId,
  ProducerId,
  RegimeScheduleEntry,
  SequenceNumber,
  SnapshotId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type {
  BranchConfiguration,
  CommandId,
} from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";

/** Schema version stamped on every engine event. */
export const ENGINE_EVENT_SCHEMA_VERSION = "tradrl-world-sim.events@1";

/** The producer identity for world-core events. */
export const WORLD_CORE_PRODUCER = "world-core" as ProducerId;

/** Closed set of engine lifecycle event types (journal eventType values). */
export const ENGINE_EVENT_TYPES = [
  "world.annotation.added",
  "world.scenario.set",
  "world.snapshot.created",
  "world.branch.created",
] as const;

export type EngineEventType = (typeof ENGINE_EVENT_TYPES)[number];

/** Payload of `world.annotation.added`. */
export interface AnnotationAddedPayload {
  readonly type: "world.annotation.added";
  readonly annotationId: AnnotationId;
  readonly issuedBy: ParticipantId;
  readonly instrumentId?: InstrumentId;
  /** The annotated timeline point — data, not the event's own time. */
  readonly at: TimestampMs;
  readonly text: string;
}

/** Payload of `world.scenario.set`. */
export interface ScenarioSetPayload {
  readonly type: "world.scenario.set";
  readonly issuedBy: ParticipantId;
  readonly label?: string;
  readonly entries: readonly RegimeScheduleEntry[];
}

/** Payload of `world.snapshot.created` (W016): the journaled descriptor. */
export interface SnapshotCreatedPayload {
  readonly type: "world.snapshot.created";
  readonly snapshotId: SnapshotId;
  /** Journal position the snapshot captured (strictly before this event). */
  readonly journalCursor: SequenceNumber;
  /** Content-addressed digest of the full snapshot payload. */
  readonly digest: string;
  /** Domain time of the capture (== the event's occurredAt). */
  readonly createdAt: TimestampMs;
  /** The previous snapshot of the same world, when one exists. */
  readonly parentSnapshotId?: SnapshotId;
  /** Operator label (informational; carried for evidence). */
  readonly label?: string;
  readonly issuedBy: ParticipantId;
}

/** Payload of `world.branch.created` (W016), journaled on the PARENT world. */
export interface BranchCreatedPayload {
  readonly type: "world.branch.created";
  /** The new child world this event brings into existence. */
  readonly branchWorldId: WorldId;
  readonly parentWorldId: WorldId;
  readonly sourceSnapshotId: SnapshotId;
  /** Content digest of the source snapshot (lineage completeness). */
  readonly snapshotDigest: string;
  /** Parent journal cursor at the branch point (lineage completeness). */
  readonly branchPointSequence: SequenceNumber;
  /** Normalized configuration (empty object when the command omitted it). */
  readonly configuration: BranchConfiguration;
  readonly engine: string;
  readonly engineVersion: string;
  readonly seed: string;
  /** Domain time of the branch creation (== the event's occurredAt). */
  readonly createdAt: TimestampMs;
  readonly issuedBy: ParticipantId;
  /** The command id — also the envelope causationId (recorded for clarity). */
  readonly createdViaCommand: CommandId;
}

export type EngineEventPayload =
  | AnnotationAddedPayload
  | ScenarioSetPayload
  | SnapshotCreatedPayload
  | BranchCreatedPayload;

/** A journal event whose payload is an engine lifecycle payload. */
export type EngineEvent = WorldEventEnvelope<EngineEventPayload>;

const ENGINE_EVENT_TYPE_SET: ReadonlySet<string> = new Set(ENGINE_EVENT_TYPES);

/** Type guard: does this journal event belong to the engine taxonomy? */
export function isEngineEvent(envelope: WorldEventEnvelope): envelope is EngineEvent {
  return ENGINE_EVENT_TYPE_SET.has(envelope.eventType);
}

/** Structural payload guard (used by the reducer on replay). */
export function isAnnotationAddedPayload(payload: unknown): payload is AnnotationAddedPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<AnnotationAddedPayload>;
  return (
    candidate.type === "world.annotation.added" &&
    typeof candidate.annotationId === "string" &&
    typeof candidate.issuedBy === "string" &&
    typeof candidate.at === "number" &&
    Number.isFinite(candidate.at) &&
    typeof candidate.text === "string" &&
    candidate.text.length > 0
  );
}

/** Structural payload guard (used by the reducer on replay). */
export function isScenarioSetPayload(payload: unknown): payload is ScenarioSetPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<ScenarioSetPayload>;
  return (
    candidate.type === "world.scenario.set" &&
    typeof candidate.issuedBy === "string" &&
    Array.isArray(candidate.entries) &&
    candidate.entries.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as RegimeScheduleEntry).regime === "string" &&
        typeof (entry as RegimeScheduleEntry).from === "number",
    )
  );
}

/** Structural payload guard (used by the reducer and the snapshot fold on replay). */
export function isSnapshotCreatedPayload(payload: unknown): payload is SnapshotCreatedPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<SnapshotCreatedPayload>;
  return (
    candidate.type === "world.snapshot.created" &&
    typeof candidate.snapshotId === "string" &&
    candidate.snapshotId.length > 0 &&
    typeof candidate.journalCursor === "number" &&
    Number.isFinite(candidate.journalCursor) &&
    candidate.journalCursor >= 0 &&
    typeof candidate.digest === "string" &&
    candidate.digest.length > 0 &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.issuedBy === "string"
  );
}

/** Structural payload guard (used by the reducer on replay). */
export function isBranchCreatedPayload(payload: unknown): payload is BranchCreatedPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<BranchCreatedPayload>;
  return (
    candidate.type === "world.branch.created" &&
    typeof candidate.branchWorldId === "string" &&
    candidate.branchWorldId.length > 0 &&
    typeof candidate.parentWorldId === "string" &&
    typeof candidate.sourceSnapshotId === "string" &&
    typeof candidate.snapshotDigest === "string" &&
    typeof candidate.branchPointSequence === "number" &&
    Number.isFinite(candidate.branchPointSequence) &&
    typeof candidate.engine === "string" &&
    typeof candidate.engineVersion === "string" &&
    typeof candidate.seed === "string" &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.issuedBy === "string" &&
    typeof candidate.createdViaCommand === "string"
  );
}
