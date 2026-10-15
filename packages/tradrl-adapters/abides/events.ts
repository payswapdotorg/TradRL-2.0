/**
 * The ABIDES adapter event taxonomy (W024) — the ordered WorldEvents the
 * exchange process emits (A6), in the canonical envelope.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Event envelope": worldId, sequence, eventId,
 * eventType, occurredAt, availableAt (when applicable), causationId,
 * correlationId, producer, schemaVersion, payload — "Sequence is monotonic
 * within a world". Spec: spec/ARCHITECTURE-LOCK.md A7 — `availableAt` is the
 * earliest legal observation time; here it is not decorative: the kernel
 * schedules every remote actor's observation message AT the event's
 * `availableAt + that actor's from-venue latency` (./kernel.ts), so the A7
 * firewall is enforced structurally by the message flow itself.
 *
 * AVAILABILITY LAW (declared, uniform — README.md):
 * - order acknowledgments (accept/reject/cancel/replace) propagate at
 *   `occurredAt + venue.latency.acknowledgementMs` (the canonical
 *   `VenueLatency` contract, reused);
 * - trades, fills, book and quote market data propagate at
 *   `occurredAt + venue.latency.fillPropagationMs`;
 * - operator/world events (annotation, snapshot, world-created) carry no
 *   delayed availability (availableAt = occurredAt).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  CausationId,
  CorrelationId,
  EventId,
  Fill,
  InstrumentId,
  Order,
  OrderBookSnapshot,
  ProducerId,
  SequenceNumber,
  SnapshotDescriptor,
  TimestampMs,
  Trade,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";

/** The adapter's event schema version (bumped on any payload shape change). */
export const ABIDES_SCHEMA_VERSION = "abides-adapter@1";

/** Allocates the world's monotonic sequence + event ids (owned by the kernel). */
export interface AbidesEventStamper {
  stamp(): { readonly sequence: SequenceNumber; readonly eventId: EventId };
}

/**
 * A one-shot stamper returning a PRE-ALLOCATED stamp — for payloads that
 * must embed their own sequence (trades embed the world sequence of their
 * trade event; book snapshots embed the sequence of their book-updated
 * event). The envelope and its payload therefore share one sequence.
 */
export function fixedStamper(stamp: {
  readonly sequence: SequenceNumber;
  readonly eventId: EventId;
}): AbidesEventStamper {
  let used = false;
  return {
    stamp() {
      if (used) {
        throw new Error("[abides:events] fixedStamper reused (one stamp per envelope — invariant)");
      }
      used = true;
      return stamp;
    },
  };
}

// --- payload types ---------------------------------------------------------------

export interface WorldCreatedPayload {
  readonly definitionDigest: string;
}

export interface OrderAcceptedPayload {
  readonly order: Order;
}

export interface CommandRejectedPayload {
  readonly commandId: string;
  readonly stage: "validate" | "authorize" | "domain-rules";
  readonly code: string;
  readonly message: string;
}

export interface TradePrintedPayload {
  readonly trade: Trade;
  readonly aggressorFill: Fill;
  readonly restingFill: Fill;
}

export interface OrderStatePayload {
  readonly order: Order;
  readonly fills: readonly Fill[];
}

export interface BookUpdatedPayload {
  readonly instrumentId: InstrumentId;
  readonly book: OrderBookSnapshot;
}

export interface AnnotationAddedPayload {
  readonly at: TimestampMs;
  readonly text: string;
  readonly instrumentId?: InstrumentId;
}

export interface SnapshotCreatedPayload {
  readonly descriptor: SnapshotDescriptor;
}

// --- envelope building --------------------------------------------------------------

/** Everything one event needs except its payload and type name. */
export interface EventContext {
  readonly worldId: WorldId;
  readonly stamper: AbidesEventStamper;
  readonly occurredAt: TimestampMs;
  readonly causationId: CausationId;
  readonly correlationId: CorrelationId;
  readonly producer: ProducerId;
  /** The propagation delay already resolved by the caller (availability law above). */
  readonly availableAt?: TimestampMs;
}

/** Build one envelope in the canonical shape (sequence monotonic via the stamper). */
function envelope<TPayload>(
  context: EventContext,
  eventType: string,
  payload: TPayload,
): WorldEventEnvelope<TPayload> {
  const { sequence, eventId } = context.stamper.stamp();
  return {
    worldId: context.worldId,
    sequence,
    eventId,
    eventType,
    occurredAt: context.occurredAt,
    ...(context.availableAt === undefined ? {} : { availableAt: context.availableAt }),
    causationId: context.causationId,
    correlationId: context.correlationId,
    producer: context.producer,
    schemaVersion: ABIDES_SCHEMA_VERSION,
    payload,
  };
}

/** The ordered event type names (the producer-owned taxonomy). */
export const ABIDES_EVENT_TYPES = {
  worldCreated: "abides.world-created",
  orderAccepted: "abides.order-accepted",
  commandRejected: "abides.command-rejected",
  tradePrinted: "abides.trade-printed",
  orderState: "abides.order-state",
  bookUpdated: "abides.book-updated",
  annotationAdded: "abides.annotation-added",
  snapshotCreated: "abides.snapshot-created",
} as const;

export function worldCreatedEvent(
  context: EventContext,
  payload: WorldCreatedPayload,
): WorldEventEnvelope<WorldCreatedPayload> {
  return envelope(context, ABIDES_EVENT_TYPES.worldCreated, payload);
}

export function orderAcceptedEvent(
  context: EventContext,
  payload: OrderAcceptedPayload,
): WorldEventEnvelope<OrderAcceptedPayload> {
  return envelope(context, ABIDES_EVENT_TYPES.orderAccepted, payload);
}

export function commandRejectedEvent(
  context: EventContext,
  payload: CommandRejectedPayload,
): WorldEventEnvelope<CommandRejectedPayload> {
  return envelope(context, ABIDES_EVENT_TYPES.commandRejected, payload);
}

export function tradePrintedEvent(
  context: EventContext,
  payload: TradePrintedPayload,
): WorldEventEnvelope<TradePrintedPayload> {
  return envelope(context, ABIDES_EVENT_TYPES.tradePrinted, payload);
}

export function orderStateEvent(
  context: EventContext,
  payload: OrderStatePayload,
): WorldEventEnvelope<OrderStatePayload> {
  return envelope(context, ABIDES_EVENT_TYPES.orderState, payload);
}

export function bookUpdatedEvent(
  context: EventContext,
  payload: BookUpdatedPayload,
): WorldEventEnvelope<BookUpdatedPayload> {
  return envelope(context, ABIDES_EVENT_TYPES.bookUpdated, payload);
}

export function annotationAddedEvent(
  context: EventContext,
  payload: AnnotationAddedPayload,
): WorldEventEnvelope<AnnotationAddedPayload> {
  return envelope(context, ABIDES_EVENT_TYPES.annotationAdded, payload);
}

export function snapshotCreatedEvent(
  context: EventContext,
  payload: SnapshotCreatedPayload,
): WorldEventEnvelope<SnapshotCreatedPayload> {
  return envelope(context, ABIDES_EVENT_TYPES.snapshotCreated, payload);
}
