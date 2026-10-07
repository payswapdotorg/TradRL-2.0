/**
 * Event envelope contracts for the ordered world journal.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope":
 * worldId, sequence, eventId, eventType, occurredAt, availableAt (when
 * applicable), causationId, correlationId, producer, schemaVersion, payload.
 * "Sequence is monotonic within a world."
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — world changes emit ordered events.
 */

import type {
  CausationId,
  CorrelationId,
  EventId,
  ProducerId,
  WorldId,
} from "./ids.js";
import type { SequenceNumber, TimestampMs } from "./primitives.js";

/**
 * The canonical world event envelope. `availableAt` is optional and present
 * only when applicable (A7: artifacts/events with delayed availability).
 */
export interface WorldEventEnvelope<TPayload = unknown> {
  readonly worldId: WorldId;
  readonly sequence: SequenceNumber;
  readonly eventId: EventId;
  /**
   * Opaque event type name. Typed event-taxonomies (market events, engine
   * lifecycle events) are owned by their producer packages (W004/W013) —
   * the envelope is the transport-independent shell.
   */
  readonly eventType: string;
  readonly occurredAt: TimestampMs;
  readonly availableAt?: TimestampMs;
  readonly causationId: CausationId;
  readonly correlationId: CorrelationId;
  readonly producer: ProducerId;
  readonly schemaVersion: string;
  readonly payload: TPayload;
}

/** Query for journal/evidence event lookups. */
export interface EventQuery {
  readonly from?: TimestampMs;
  readonly to?: TimestampMs;
  readonly types?: readonly string[];
  readonly limit?: number;
}

/** A slice of the event timeline returned by `QueryPort.getTimeline`. */
export interface TimelineSlice {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
  readonly events: readonly WorldEventEnvelope[];
  readonly hasMore: boolean;
}

/**
 * Provenance record for one event (EvidencePort.getProvenance).
 * No private model chain-of-thought is ever stored (ARCHITECTURE.md §10).
 */
export interface ProvenanceRecord {
  readonly subjectEventId: EventId;
  readonly producer: ProducerId;
  readonly inputs: readonly ProvenanceInput[];
  readonly recordedAt: TimestampMs;
}

/** One provenance input reference. */
export interface ProvenanceInput {
  readonly kind: "command" | "event" | "artifact" | "snapshot";
  readonly ref: string;
}
