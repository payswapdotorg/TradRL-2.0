/**
 * The venue execution engine's shared core (W024) — the mutable order/trade
 * record types, the venue core contract every lifecycle phase codes against,
 * the lifecycle result helpers (typed rejections, acks, the command-rejected
 * event), the one-shot fixed stamper, the event context, and the opening
 * registers.
 *
 * The lifecycles themselves live in ./orders.ts (submit / cancel / replace /
 * close-position: the validate → authorize → apply domain rules paths); the
 * two-phase matching application and the armed-stop cascade live in
 * ./matching.ts. This module owns what both share, and nothing else.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle"; spec/SIMULATION.md
 * "Matching"; spec/ARCHITECTURE-LOCK.md A6 (ordered events — every envelope
 * is stamped from ONE monotonic counter, the venue's `nextStamp`, driven by
 * the kernel).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  AccountId,
  CausationId,
  CommandId,
  CommandRejection,
  CommandResult,
  CorrelationId,
  EventId,
  Fill,
  Instrument,
  InstrumentId,
  Order,
  OrderId,
  OrderSide,
  OrderSubmission,
  Participant,
  Price,
  Quantity,
  SequenceNumber,
  TimestampMs,
  Trade,
  TradeId,
  WorldCommand,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import type { AbidesVenueConfig, AbidesWorldDefinition } from "./definition.js";
import { createLimitOrderBook, parseScaled, type LimitOrderBook } from "./book.js";
import { createAccountLedger, type AccountLedger } from "./ledger.js";
import { commandRejectedEvent, type EventContext } from "./events.js";

/** Internal mutable order record (projected immutably on read). */
export interface MutableOrder {
  readonly orderId: OrderId;
  readonly worldId: WorldId;
  readonly instrumentId: InstrumentId;
  readonly accountId: AccountId;
  readonly submittedBy: Participant["participantId"];
  kind: OrderSubmission["kind"];
  side: OrderSide;
  quantity: Quantity;
  filledQuantity: Quantity;
  limitPrice?: Price;
  stopPrice?: Price;
  constraints: OrderSubmission["constraints"];
  status: Order["status"];
  readonly submittedAt: TimestampMs;
  updatedAt?: TimestampMs;
  cancelReason?: Order["cancelReason"];
  replacedByOrderId?: OrderId;
  /** Internal: stop-family arming flag (a triggered stop-limit rests DISARMED). */
  armed: boolean;
}

/** The internal trade record: the public trade + availability + event id. */
export interface TradeRecord {
  readonly trade: Trade;
  readonly availableAt: TimestampMs;
  readonly eventId: string;
}

/** The venue's shared mutable core (created and owned by ./exchange.ts). */
export interface VenueCore {
  readonly worldId: WorldId;
  readonly definition: AbidesWorldDefinition;
  readonly instruments: ReadonlyMap<string, Instrument>;
  readonly venueOfInstrument: ReadonlyMap<string, AbidesVenueConfig>;
  readonly ledgers: ReadonlyMap<string, AccountLedger>;
  readonly books: ReadonlyMap<string, LimitOrderBook>;
  readonly orders: ReadonlyMap<string, MutableOrder>;
  readonly orderSequence: readonly string[];
  tradesOf(instrumentId: string): readonly TradeRecord[];
  fillsOf(accountId: string): readonly Fill[];
  riskLimitsOf(accountId: string): Record<string, unknown>;
  nextStamp(): { sequence: SequenceNumber; eventId: EventId };
  nextOrderId(): OrderId;
  nextTradeId(): TradeId;
  nextFillId(): string;
  recordTrade(instrumentId: string, record: TradeRecord): void;
  recordFill(accountId: string, fill: Fill): void;
  markOrder(order: MutableOrder): void;
  hasSeenCommandId(commandId: string): boolean;
  recordCommandId(commandId: string): void;
}

/** One processed order command (what the kernel propagates). */
export interface ExecutionOutcome {
  readonly result: CommandResult;
  readonly events: readonly WorldEventEnvelope[];
  readonly touchedOwners: readonly AccountId[];
  readonly touchedInstruments: readonly InstrumentId[];
  readonly newTrades: readonly Trade[];
}

/** The per-command execution context (the kernel owns the stamps). */
export interface ExecutionContext {
  readonly now: TimestampMs;
  readonly causationId: CausationId;
  readonly correlationId: CorrelationId;
  readonly nextStamp: () => { sequence: SequenceNumber; eventId: EventId };
}

/** The mutable scratch of one command's lifecycle (events + touched sets). */
export interface Scratch {
  readonly events: WorldEventEnvelope[];
  readonly touchedOwners: Set<string>;
  readonly touchedInstruments: Set<string>;
  readonly newTrades: Trade[];
}

/** Order statuses that still admit lifecycle transitions (the working set). */
export const WORKING: readonly Order["status"][] = ["accepted", "partially-filled"];

function rejectAt(stage: CommandRejection["stage"], code: string, message: string): CommandResult {
  return { status: "rejected", rejection: { stage, code, message } };
}

function ackOf(commandId: CommandId, worldId: WorldId, now: TimestampMs, events: readonly WorldEventEnvelope[]): CommandResult {
  return {
    status: "acked",
    ack: {
      commandId,
      worldId,
      acceptedAt: now,
      resultingEventIds: events.map((event) => event.eventId),
      journalCursor: events.length > 0 ? events[events.length - 1]!.sequence : (0 as SequenceNumber),
    },
  };
}

/**
 * Emit the command-rejected event + return the typed rejection (the loud
 * outcome of a failed lifecycle stage — a typed result, never a throw).
 */
export function rejectWith(
  core: VenueCore,
  command: WorldCommand,
  ctx: ExecutionContext,
  scratch: Scratch,
  stage: CommandRejection["stage"],
  code: string,
  message: string,
): CommandResult {
  const instrumentId = "instrumentId" in command ? String(command.instrumentId) : undefined;
  const venue = instrumentId !== undefined ? core.venueOfInstrument.get(instrumentId) : undefined;
  const effective = venue ?? core.definition.venues[0]!;
  const stamp = ctx.nextStamp();
  scratch.events.push(commandRejectedEvent(
    contextOf({
      worldId: core.worldId,
      venue: effective,
      now: ctx.now,
      causationId: ctx.causationId,
      correlationId: ctx.correlationId,
      availableAt: (ctx.now + effective.latency.acknowledgementMs) as TimestampMs,
      stamper: fixed(stamp.sequence, stamp.eventId),
    }),
    { commandId: String(command.commandId), stage, code, message },
  ));
  return rejectAt(stage, code, message);
}

/** The immutable projection of one mutable order record. */
export function projectOrder(order: MutableOrder): Order {
  return {
    orderId: order.orderId,
    worldId: order.worldId,
    instrumentId: order.instrumentId,
    accountId: order.accountId,
    submittedBy: order.submittedBy,
    kind: order.kind,
    side: order.side,
    quantity: order.quantity,
    filledQuantity: order.filledQuantity,
    ...(order.limitPrice === undefined ? {} : { limitPrice: order.limitPrice }),
    ...(order.stopPrice === undefined ? {} : { stopPrice: order.stopPrice }),
    constraints: order.constraints,
    status: order.status,
    submittedAt: order.submittedAt,
    ...(order.updatedAt === undefined ? {} : { updatedAt: order.updatedAt }),
    ...(order.cancelReason === undefined ? {} : { cancelReason: order.cancelReason }),
    ...(order.replacedByOrderId === undefined ? {} : { replacedByOrderId: order.replacedByOrderId }),
  };
}

/** One-shot fixed stamper (trades/books embed their own sequence). */
export function fixed(sequence: SequenceNumber, eventId: EventId): EventContext["stamper"] {
  let used = false;
  return {
    stamp() {
      if (used) throw new Error("[abides:execution] fixed stamper reused (invariant)");
      used = true;
      return { sequence, eventId };
    },
  };
}

/** The event context for one envelope (producer = the venue). */
export function contextOf(input: {
  readonly worldId: WorldId;
  readonly venue: AbidesVenueConfig;
  readonly now: TimestampMs;
  readonly causationId: CausationId;
  readonly correlationId: CorrelationId;
  readonly availableAt: TimestampMs;
  readonly stamper: EventContext["stamper"];
}): EventContext {
  return {
    worldId: input.worldId,
    stamper: input.stamper,
    occurredAt: input.now,
    availableAt: input.availableAt,
    causationId: input.causationId,
    correlationId: input.correlationId,
    producer: `abides-exchange:${String(input.venue.venueId)}` as never,
  };
}

/** The venue's opening registers (ledgers, books, lookups) from the definition. */
export function createVenueRegisters(definition: AbidesWorldDefinition): {
  ledgers: Map<string, AccountLedger>;
  books: Map<string, LimitOrderBook>;
  instruments: Map<string, Instrument>;
  venueOfInstrument: Map<string, AbidesVenueConfig>;
} {
  const instruments = new Map<string, Instrument>();
  const venueOfInstrument = new Map<string, AbidesVenueConfig>();
  const books = new Map<string, LimitOrderBook>();
  const venues = new Map<string, AbidesVenueConfig>(definition.venues.map((venue) => [String(venue.venueId), venue]));
  for (const instrument of definition.instruments) {
    const id = String(instrument.instrumentId);
    instruments.set(id, instrument);
    const venue = venues.get(String(instrument.venueId));
    if (venue === undefined) {
      throw new Error(`[abides:execution] instrument ${id} names unregistered venue ${String(instrument.venueId)} (validated upstream — invariant)`);
    }
    venueOfInstrument.set(id, venue);
    books.set(id, createLimitOrderBook(instrument));
  }
  const ledgers = new Map<string, AccountLedger>();
  for (const account of definition.accounts) {
    ledgers.set(String(account.accountId), createAccountLedger({
      accountId: account.accountId,
      openingCash: parseScaled(String(account.buyingPower.amount)) ?? 0n,
      currency: account.buyingPower.currency,
    }));
  }
  return { ledgers, books, instruments, venueOfInstrument };
}

export { ackOf, rejectAt };
