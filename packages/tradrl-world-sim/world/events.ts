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
 * World Alpha skeleton events (closed set — additions go through a deliberate
 * engine change, mirrored in tests):
 * - world.annotation.added — CommandPort.addAnnotation applied
 * - world.scenario.set — CommandPort.setScenario applied
 */

import type {
  AnnotationId,
  InstrumentId,
  ParticipantId,
  ProducerId,
  RegimeScheduleEntry,
  TimestampMs,
} from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";

/** Schema version stamped on every engine event. */
export const ENGINE_EVENT_SCHEMA_VERSION = "tradrl-world-sim.events@1";

/** The producer identity for world-core events. */
export const WORLD_CORE_PRODUCER = "world-core" as ProducerId;

/** Closed set of engine lifecycle event types (journal eventType values). */
export const ENGINE_EVENT_TYPES = ["world.annotation.added", "world.scenario.set"] as const;

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

export type EngineEventPayload = AnnotationAddedPayload | ScenarioSetPayload;

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
