/**
 * The exchange process (W024) — the venue's public surface: the shared
 * mutable core (books, ledgers, order/trade/fill registers, stamps) plus the
 * projections the operator client serves, and the command router that stamps
 * the per-command book-updated events after ./execution.ts applies a command.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — the router runs the
 * command through ./execution.ts's full lifecycle, then appends the
 * per-instrument book-updated events (one per touched instrument — the A6
 * projection-batching law); the kernel journals the ordered set.
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — every market projection is read AS OF
 * a simulation time: trades are availableAt-firewalled (`occurredAt +
 * fillPropagationMs`), books/quotes/orders serve current venue state at the
 * clock position, portfolio marks are last-trade-else-mid (the declared mark
 * policy). Spec: A10/A17 — this venue is the adapter's own engine behind the
 * World Protocol; the canonical W014 engine is NOT imported (engine
 * independence; the reuse story is in README.md).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  Account,
  AccountId,
  EventId,
  Fill,
  Instrument,
  InstrumentId,
  Order,
  OrderBookSnapshot,
  Participant,
  Portfolio,
  Quote,
  RiskState,
  RiskLimits,
  SequenceNumber,
  TimestampMs,
  Trade,
  VenueId,
  WorldCommand,
} from "tradrl-world-contracts";
import { formatPrice, formatQuantity, parseScaled, type Scaled } from "./book.js";
import { halfUpScaled, riskStateOf } from "./ledger.js";
import type { AbidesVenueConfig, AbidesWorldDefinition } from "./definition.js";
import {
  bookUpdatedEvent,
  fixedStamper,
  type EventContext,
} from "./events.js";
import {
  createVenueRegisters,
  projectOrder,
  type ExecutionContext,
  type ExecutionOutcome,
  type MutableOrder,
  type TradeRecord,
  type VenueCore,
} from "./execution.js";
import { executeOrderCommand } from "./orders.js";

export type { ExecutionOutcome } from "./execution.js";

/** The per-command context the kernel hands the venue. */
export interface VenueCommandContext extends ExecutionContext {}

/** The exchange process (the venue). Projections take the read time (A7). */
export interface ExchangeProcess {
  /** Run the full lifecycle for one order command (synchronous, ordered events). */
  process(command: WorldCommand, context: VenueCommandContext): ExecutionOutcome;
  /**
   * The venue's stamp authority — ONE monotonic counter for every event the
   * venue (or the kernel, as the venue's sole driver) emits. The kernel routes
   * its own operator/world events and every {@link ExecutionContext} through
   * this counter so the world journal's sequences stay unique and monotonic.
   */
  nextStamp(): { readonly sequence: SequenceNumber; readonly eventId: EventId };
  instrumentOf(instrumentId: InstrumentId): Instrument;
  quoteOf(instrumentId: InstrumentId, asOf: TimestampMs): Quote;
  bookOf(instrumentId: InstrumentId, depth: number | undefined, asOf: TimestampMs): OrderBookSnapshot;
  tradesOf(instrumentId: InstrumentId, query: { from?: TimestampMs; to?: TimestampMs; limit?: number } | undefined, asOf: TimestampMs): readonly Trade[];
  ordersOf(query: { accountId?: AccountId; instrumentId?: InstrumentId; statuses?: readonly Order["status"][] } | undefined): readonly Order[];
  fillsOf(accountId: AccountId): readonly Fill[];
  portfolioOf(accountId: AccountId, asOf: TimestampMs): Portfolio;
  riskOf(accountId: AccountId, asOf: TimestampMs): RiskState;
  venueConfigOf(instrumentId: InstrumentId): AbidesVenueConfig;
  readonly venueIds: readonly VenueId[];
  readonly accounts: readonly Account[];
  readonly participants: readonly Participant[];
}

/** Create the exchange process from the VALIDATED world definition. */
export function createExchangeProcess(definition: AbidesWorldDefinition): ExchangeProcess {
  const worldId = definition.worldId;
  const { ledgers, books, instruments, venueOfInstrument } = createVenueRegisters(definition);
  const orders = new Map<string, MutableOrder>();
  const orderSequence: string[] = [];
  const trades = new Map<string, TradeRecord[]>();
  const fills = new Map<string, Fill[]>();
  const bookSeq = new Map<string, SequenceNumber>();
  const seenCommandIds = new Set<string>();
  for (const instrument of definition.instruments) {
    trades.set(String(instrument.instrumentId), []);
    bookSeq.set(String(instrument.instrumentId), 0 as SequenceNumber);
  }
  for (const account of definition.accounts) {
    fills.set(String(account.accountId), []);
  }

  let orderCounter = 0;
  let tradeCounter = 0;
  let fillCounter = 0;
  let stampCounter = 0;

  const core: VenueCore = {
    worldId,
    definition,
    instruments,
    venueOfInstrument,
    ledgers,
    books,
    orders,
    orderSequence,
    tradesOf: (instrumentId) => trades.get(instrumentId) ?? [],
    fillsOf: (accountId) => fills.get(accountId) ?? [],
    riskLimitsOf: (accountId) => (definition.accountRiskLimits?.[accountId] ?? {}) as Record<string, unknown>,
    nextStamp: () => ({ sequence: (stampCounter += 1) as SequenceNumber, eventId: `evt-${String(stampCounter)}` as EventId }),
    nextOrderId: () => `order-${String(orderCounter += 1)}` as never,
    nextTradeId: () => `trade-${String(tradeCounter += 1)}` as never,
    nextFillId: () => `fill-${String(fillCounter += 1)}`,
    recordTrade: (instrumentId, record) => { trades.get(instrumentId)?.push(record); },
    recordFill: (accountId, fill) => { fills.get(accountId)?.push(fill); },
    markOrder: (order) => {
      orders.set(String(order.orderId), order);
      orderSequence.push(String(order.orderId));
    },
    hasSeenCommandId: (commandId) => seenCommandIds.has(commandId),
    recordCommandId: (commandId) => { seenCommandIds.add(commandId); },
  };

  /** The venue producer context for the router's book-updated events. */
  const bookContext = (venue: AbidesVenueConfig, ctx: ExecutionContext, availableAt: TimestampMs, stamper: EventContext["stamper"]): EventContext => ({
    worldId,
    stamper,
    occurredAt: ctx.now,
    availableAt,
    causationId: ctx.causationId,
    correlationId: ctx.correlationId,
    producer: `abides-exchange:${String(venue.venueId)}` as never,
  });

  return {
    venueIds: definition.venues.map((venue) => venue.venueId),
    accounts: definition.accounts,
    participants: definition.participants,
    nextStamp() {
      return core.nextStamp();
    },
    venueConfigOf(instrumentId) {
      const venue = venueOfInstrument.get(String(instrumentId));
      if (venue === undefined) {
        throw new Error(`[abides:exchange] unknown instrument ${String(instrumentId)}`);
      }
      return venue;
    },
    process(command, ctx) {
      const outcome = executeOrderCommand(core, command, ctx);
      const events = [...outcome.events];
      // Book-updated per touched instrument (aggregate projection — A6).
      for (const instrumentId of outcome.touchedInstruments) {
        const venue = venueOfInstrument.get(String(instrumentId))!;
        const stamp = core.nextStamp();
        bookSeq.set(String(instrumentId), stamp.sequence);
        const snapshot = snapshotOf(String(instrumentId), undefined, ctx.now, stamp.sequence);
        events.push(bookUpdatedEvent(bookContext(venue, ctx, (ctx.now + venue.latency.fillPropagationMs) as TimestampMs, fixedStamper(stamp)), {
          instrumentId: instrumentId as InstrumentId,
          book: snapshot,
        }));
      }
      return { ...outcome, events };
    },
    instrumentOf(instrumentId) {
      const instrument = instruments.get(String(instrumentId));
      if (instrument === undefined) {
        throw new Error(`[abides:exchange] unknown instrument ${String(instrumentId)}`);
      }
      return instrument;
    },
    quoteOf(instrumentId, asOf) {
      const book = requireBook(instrumentId);
      const instrument = instruments.get(String(instrumentId))!;
      const tape = trades.get(String(instrumentId))!;
      const bid = book.bestBid();
      const ask = book.bestAsk();
      const last = tape.length > 0 ? tape[tape.length - 1]!.trade.price : undefined;
      return {
        instrumentId,
        ...(bid === undefined ? {} : { bid: formatPrice(bid.price, instrument), bidSize: formatQuantity(bid.quantity, instrument) }),
        ...(ask === undefined ? {} : { ask: formatPrice(ask.price, instrument), askSize: formatQuantity(ask.quantity, instrument) }),
        ...(last === undefined ? {} : { last }),
        asOf,
      };
    },
    bookOf(instrumentId, depth, asOf) {
      const book = requireBook(instrumentId);
      const { bids, asks } = book.depth(depth);
      return {
        instrumentId,
        asOf,
        sequence: bookSeq.get(String(instrumentId)) ?? (0 as SequenceNumber),
        bids,
        asks,
      };
    },
    tradesOf(instrumentId, query, asOf) {
      const tape = trades.get(String(instrumentId));
      if (tape === undefined) {
        throw new Error(`[abides:exchange] unknown instrument ${String(instrumentId)}`);
      }
      let rows = tape.filter((record) => Number(record.availableAt) <= Number(asOf)).map((record) => record.trade);
      if (query?.from !== undefined) rows = rows.filter((t) => Number(t.occurredAt) >= Number(query.from));
      if (query?.to !== undefined) rows = rows.filter((t) => Number(t.occurredAt) <= Number(query.to));
      return query?.limit === undefined ? rows : rows.slice(-Math.max(0, query.limit));
    },
    ordersOf(query) {
      let rows = orderSequence.map((id) => projectOrder(orders.get(id)!));
      if (query?.accountId !== undefined) rows = rows.filter((o) => String(o.accountId) === String(query.accountId));
      if (query?.instrumentId !== undefined) rows = rows.filter((o) => String(o.instrumentId) === String(query.instrumentId));
      if (query?.statuses !== undefined) rows = rows.filter((o) => query.statuses!.includes(o.status));
      return rows;
    },
    fillsOf(accountId) {
      return fills.get(String(accountId)) ?? [];
    },
    portfolioOf(accountId, asOf) {
      const ledger = ledgers.get(String(accountId));
      if (ledger === undefined) {
        throw new Error(`[abides:exchange] unknown account ${String(accountId)}`);
      }
      // The ledger's portfolio contract is keyed by the branded InstrumentId
      // (positions live in that namespace); serve a branded-keyed view of the
      // venue's string-keyed registers.
      const brandedInstruments = new Map<InstrumentId, Instrument>();
      for (const instrument of instruments.values()) {
        brandedInstruments.set(instrument.instrumentId, instrument);
      }
      return ledger.portfolio({ accountId, worldId, instruments: brandedInstruments, marks: currentMarks(), asOf });
    },
    riskOf(accountId, asOf) {
      if (!ledgers.has(String(accountId))) {
        throw new Error(`[abides:exchange] unknown account ${String(accountId)}`);
      }
      return riskStateOf({
        accountId,
        worldId,
        limits: (definition.accountRiskLimits?.[String(accountId)] ?? {}) as RiskLimits,
        asOf,
      });
    },
  };

  function requireBook(instrumentId: InstrumentId) {
    const book = books.get(String(instrumentId));
    if (book === undefined) {
      throw new Error(`[abides:exchange] unknown instrument ${String(instrumentId)}`);
    }
    return book;
  }

  function snapshotOf(instrumentId: string, depth: number | undefined, asOf: TimestampMs, sequence: SequenceNumber): OrderBookSnapshot {
    const { bids, asks } = books.get(instrumentId)!.depth(depth);
    return { instrumentId: instruments.get(instrumentId)!.instrumentId, asOf, sequence, bids, asks };
  }

  /** Marks: last trade price, else book mid (the declared mark policy). */
  function currentMarks(): Map<InstrumentId, Scaled> {
    const marks = new Map<InstrumentId, Scaled>();
    for (const [id, tape] of trades.entries()) {
      if (tape.length > 0) {
        marks.set(instruments.get(id)!.instrumentId, parseScaled(String(tape[tape.length - 1]!.trade.price))!);
        continue;
      }
      const book = books.get(id)!;
      const bid = book.bestBid();
      const ask = book.bestAsk();
      if (bid !== undefined && ask !== undefined) {
        marks.set(instruments.get(id)!.instrumentId, halfUpScaled(bid.price + ask.price, 2n));
      }
    }
    return marks;
  }
}
