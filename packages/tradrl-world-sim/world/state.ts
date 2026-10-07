/**
 * The authoritative world state and its event reducer.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 (commands mutate authoritative state,
 * emit ordered events and append journal records) and A9 (determinism).
 * Spec: spec/DOMAIN-MODEL.md "Ownership" — World Engine → authoritative
 * live state; the state is advanced ONLY by reducing journaled events, so
 * live runs and journal replays advance state through the exact same code
 * path (bit-identical state — the core of deterministic replay).
 *
 * W014 seam: the order registry, fills, trades and per-instrument books
 * live in the `matching` slice (matching/state.ts). Its reducer is the
 * single reduction path — this module delegates matching/market event
 * types to it (the W013 skeleton's permanently-empty `orders` registry is
 * superseded; the matcher owns the transitions that fill it).
 */

import type {
  AnnotationId,
  CommandId,
  InstrumentId,
  ParticipantId,
  RegimeScheduleEntry,
  ScenarioDefinition,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import type { JournalRecord } from "../journal/eventJournal.js";
import { isMatchingStateEventType, initialMatchingState, reduceMatchingEvent } from "../matching/index.js";
import type { MatchingState } from "../matching/index.js";
import { ENGINE_ID, ENGINE_VERSION, type WorldDefinition } from "./definition.js";
import { EngineInvariantError } from "./errors.js";
import { isAnnotationAddedPayload, isScenarioSetPayload } from "./events.js";

/** One annotation on the world timeline (added via CommandPort.addAnnotation). */
export interface WorldAnnotation {
  readonly annotationId: AnnotationId;
  readonly issuedBy: ParticipantId;
  readonly instrumentId?: InstrumentId;
  /** The annotated timeline point — data chosen by the trader. */
  readonly at: TimestampMs;
  readonly text: string;
  /** Domain time when the annotation event occurred. */
  readonly addedAt: TimestampMs;
}

/** The authoritative world state of the engine. */
export interface WorldState {
  readonly annotations: readonly WorldAnnotation[];
  /** The scenario in force; the initial scenario comes from the definition. */
  readonly currentScenario?: ScenarioDefinition;
  /** Command ids that produced journaled events (duplicate-command law). */
  readonly ackedCommandIds: ReadonlySet<CommandId>;
  /** The W014 matching slice: orders, fills, trades, books, armed stops. */
  readonly matching: MatchingState;
}

/** The initial state derived from a world definition. */
export function initialWorldState(definition: WorldDefinition): WorldState {
  return Object.freeze({
    annotations: [],
    ...(definition.regimeSchedule === undefined
      ? {}
      : { currentScenario: { entries: definition.regimeSchedule } as ScenarioDefinition }),
    ackedCommandIds: new Set<CommandId>(),
    matching: initialMatchingState(definition),
  });
}

function withAckedCommand(state: WorldState, commandId: CommandId): WorldState {
  const acked = new Set(state.ackedCommandIds);
  acked.add(commandId);
  return Object.freeze({ ...state, ackedCommandIds: acked });
}

/**
 * The state reducer: apply one journaled event. Pure; called by the live
 * engine (right after append) and by replay (in stored order) — the single
 * way state ever advances. Matching/market event types delegate to the
 * matching reducer (the same function the live matcher advanced its working
 * copy through — the single-path law). Unknown event types or malformed
 * payloads are engine invariant violations (a journal this engine version
 * cannot reduce).
 */
export function reduceWorldEvent(state: WorldState, record: JournalRecord): WorldState {
  const envelope = record.envelope;
  const payload = envelope.payload;
  switch (envelope.eventType) {
    case "world.annotation.added": {
      if (!isAnnotationAddedPayload(payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed world.annotation.added payload`,
        );
      }
      const annotation: WorldAnnotation = {
        annotationId: payload.annotationId,
        issuedBy: payload.issuedBy,
        ...(payload.instrumentId === undefined ? {} : { instrumentId: payload.instrumentId }),
        at: payload.at,
        text: payload.text,
        addedAt: envelope.occurredAt,
      };
      return withAckedCommand(
        Object.freeze({ ...state, annotations: [...state.annotations, annotation] }),
        // the causation of every engine event is the command that caused it
        envelope.causationId as unknown as CommandId,
      );
    }
    case "world.scenario.set": {
      if (!isScenarioSetPayload(payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed world.scenario.set payload`,
        );
      }
      const scenario: ScenarioDefinition = {
        ...(payload.label === undefined ? {} : { label: payload.label }),
        entries: payload.entries as readonly RegimeScheduleEntry[],
      };
      return withAckedCommand(
        Object.freeze({ ...state, currentScenario: scenario }),
        envelope.causationId as unknown as CommandId,
      );
    }
    default: {
      if (isMatchingStateEventType(envelope.eventType)) {
        return withAckedCommand(
          Object.freeze({ ...state, matching: reduceMatchingEvent(state.matching, envelope) }),
          envelope.causationId as unknown as CommandId,
        );
      }
      throw new EngineInvariantError(
        `cannot reduce event type '${envelope.eventType}' ` +
          `(engine ${ENGINE_ID}@${ENGINE_VERSION}: this journal belongs to a later engine surface)`,
      );
    }
  }
}

/** Deterministic annotation id for the next annotation (state position + 1). */
export function nextAnnotationId(worldId: WorldId, state: WorldState): AnnotationId {
  return `ann:${String(worldId)}:${String(state.annotations.length + 1)}` as AnnotationId;
}
