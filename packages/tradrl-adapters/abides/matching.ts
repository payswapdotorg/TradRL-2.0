/**
 * The two-phase matching application (W024) — fills, trades, ledgers, order
 * records and events applied for one planned match, plus the armed-stop
 * cascade.
 *
 * Spec: spec/SIMULATION.md "Matching" (price-time priority, mandatory
 * partial fills) and "Orders" (stops arm OFF the book and trigger on the
 * last trade price); spec/ARCHITECTURE-LOCK.md A6 (ordered events — trades,
 * order states and books are journaled in one deterministic order).
 *
 * DECLARED POLICIES (README.md — deterministic, tested, never silent):
 * - one trade per (aggressor × resting) fill pair, stamped with its own
 *   sequence which the fills embed as `marketRef`/`sequence`/`eventId`;
 * - fills mutate the venue's ledgers EXACTLY (./ledger.ts) and are recorded
 *   per account;
 * - stops arm off the book and trigger on the LAST trade price crossing the
 *   stop (buy: trade ≥ stop; sell: trade ≤ stop); a triggered stop executes
 *   as a market order, a triggered stop-limit as a limit order (a GTC
 *   remainder rests, DISARMED); triggers cascade in order-id order, each
 *   causally chained to the triggering trade's event id, guarded by
 *   STOP_CASCADE_LIMIT (an event storm fails closed).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  CausationId,
  Fill,
  InstrumentId,
  TimestampMs,
  Trade,
} from "tradrl-world-contracts";
import { formatParticipantDecimal } from "tradrl-market-participants/decimal";
import { formatPrice, formatQuantity, parseScaled, type PlannedFill, type Scaled } from "./book.js";
import type { LedgerFill } from "./ledger.js";
import { orderStateEvent, tradePrintedEvent } from "./events.js";
import { contextOf, fixed, projectOrder, WORKING, type ExecutionContext, type MutableOrder, type Scratch, type VenueCore } from "./execution.js";

const STOP_CASCADE_LIMIT = 10_000;

/** Apply one match plan: trades, fills, ledgers, order records, events. */
export function applyFills(core: VenueCore, aggressor: MutableOrder, fills: readonly PlannedFill[], ctx: ExecutionContext, scratch: Scratch, causationId: CausationId): void {
  const instrumentId = String(aggressor.instrumentId);
  const instrument = core.instruments.get(instrumentId)!;
  const venue = core.venueOfInstrument.get(instrumentId)!;
  const book = core.books.get(instrumentId)!;
  for (const planned of fills) {
    const resting = core.orders.get(String(planned.restingOrderId));
    if (resting === undefined || !WORKING.includes(resting.status)) {
      continue; // invariant: plans are built against current venue state
    }
    const tradeStamp = core.nextStamp();
    const tradeId = core.nextTradeId();
    const availableAt = (ctx.now + venue.latency.fillPropagationMs) as TimestampMs;
    const aggressorFirstFill = (parseScaled(String(aggressor.filledQuantity)) ?? 0n) === 0n;
    const restingFirstFill = (parseScaled(String(resting.filledQuantity)) ?? 0n) === 0n;
    const aggressorLedger = core.ledgers.get(String(aggressor.accountId))!;
    const restingLedger = core.ledgers.get(String(resting.accountId))!;

    const aggressorEconomics = aggressorLedger.applyFill({
      fill: ledgerFillOf(aggressor, planned, "taker"),
      instrument,
      at: ctx.now,
      feeSchedule: venue.feeSchedule,
      applyFixedFee: aggressorFirstFill,
    });
    const restingEconomics = restingLedger.applyFill({
      fill: ledgerFillOf(resting, planned, "maker"),
      instrument,
      at: ctx.now,
      feeSchedule: venue.feeSchedule,
      applyFixedFee: restingFirstFill,
    });

    const buildFill = (order: MutableOrder, fillId: string, fee: Scaled, liquidity: "maker" | "taker"): Fill => ({
      fillId: fillId as never,
      worldId: core.worldId,
      orderId: order.orderId,
      instrumentId: order.instrumentId,
      accountId: order.accountId,
      side: order.side,
      price: formatPrice(planned.price, instrument),
      quantity: formatQuantity(planned.quantity, instrument),
      fee: {
        currency: instrument.quoteCurrency,
        amount: formatParticipantDecimal(fee, 2) as never,
        liquidity,
        rateBps: liquidity === "taker" ? venue.feeSchedule.takerRateBps : venue.feeSchedule.makerRateBps,
      },
      liquidity,
      occurredAt: ctx.now,
      availableAt,
      marketRef: { tradeId, sequence: tradeStamp.sequence },
      sequence: tradeStamp.sequence,
      eventId: tradeStamp.eventId as never,
    });
    const aggressorFill = buildFill(aggressor, core.nextFillId(), aggressorEconomics.fee, "taker");
    const restingFill = buildFill(resting, core.nextFillId(), restingEconomics.fee, "maker");

    const aggressorQty = (parseScaled(String(aggressor.filledQuantity)) ?? 0n) + planned.quantity;
    aggressor.filledQuantity = formatQuantity(aggressorQty, instrument);
    aggressor.status = aggressorQty === parseScaled(String(aggressor.quantity)) ? "filled" : "partially-filled";
    aggressor.updatedAt = ctx.now;
    const restingQty = (parseScaled(String(resting.filledQuantity)) ?? 0n) + planned.quantity;
    resting.filledQuantity = formatQuantity(restingQty, instrument);
    resting.status = restingQty === parseScaled(String(resting.quantity)) ? "filled" : "partially-filled";
    resting.updatedAt = ctx.now;

    const trade: Trade = {
      tradeId,
      worldId: core.worldId,
      instrumentId: instrument.instrumentId,
      price: formatPrice(planned.price, instrument),
      quantity: formatQuantity(planned.quantity, instrument),
      aggressorSide: aggressor.side,
      occurredAt: ctx.now,
      sequence: tradeStamp.sequence,
    };
    core.recordTrade(instrumentId, { trade, availableAt, eventId: tradeStamp.eventId });
    scratch.events.push(tradePrintedEvent(
      contextOf({ worldId: core.worldId, venue, now: ctx.now, causationId, correlationId: ctx.correlationId, availableAt, stamper: fixed(tradeStamp.sequence, tradeStamp.eventId) }),
      { trade, aggressorFill, restingFill },
    ));
    scratch.events.push(orderStateEvent(
      contextOf({ worldId: core.worldId, venue, now: ctx.now, causationId, correlationId: ctx.correlationId, availableAt, stamper: { stamp: ctx.nextStamp } }),
      { order: projectOrder(resting), fills: [restingFill] },
    ));
    scratch.events.push(orderStateEvent(
      contextOf({ worldId: core.worldId, venue, now: ctx.now, causationId, correlationId: ctx.correlationId, availableAt, stamper: { stamp: ctx.nextStamp } }),
      { order: projectOrder(aggressor), fills: [aggressorFill] },
    ));
    core.recordFill(String(aggressor.accountId), aggressorFill);
    core.recordFill(String(resting.accountId), restingFill);
    scratch.touchedOwners.add(String(aggressor.accountId));
    scratch.touchedOwners.add(String(resting.accountId));
    scratch.newTrades.push(trade);
  }
  book.applyFills({ fills, remainder: 0n });
}

function ledgerFillOf(order: MutableOrder, planned: PlannedFill, liquidity: "maker" | "taker"): LedgerFill {
  return {
    orderId: order.orderId,
    instrumentId: order.instrumentId,
    accountId: order.accountId,
    side: order.side,
    price: planned.price,
    quantity: planned.quantity,
    liquidity,
  };
}

/** Emit one order-state event (post-state + this application's fills). */
export function emitOrderState(core: VenueCore, order: MutableOrder, fills: readonly Fill[], ctx: ExecutionContext, scratch: Scratch, causationId: CausationId): void {
  const instrumentId = String(order.instrumentId);
  const venue = core.venueOfInstrument.get(instrumentId)!;
  const stamp = ctx.nextStamp();
  scratch.events.push(orderStateEvent(
    contextOf({ worldId: core.worldId, venue, now: ctx.now, causationId, correlationId: ctx.correlationId, availableAt: (ctx.now + venue.latency.fillPropagationMs) as TimestampMs, stamper: fixed(stamp.sequence, stamp.eventId) }),
    { order: projectOrder(order), fills },
  ));
}

/** The armed-stop cascade: trigger on the last trade price, in order-id order. */
export function runStopCascade(core: VenueCore, instrumentId: InstrumentId, ctx: ExecutionContext, scratch: Scratch): void {
  let guard = 0;
  for (;;) {
    const tape = core.tradesOf(String(instrumentId));
    const last = tape.length > 0 ? tape[tape.length - 1]! : undefined;
    if (last === undefined) return;
    const lastPrice = parseScaled(String(last.trade.price))!;
    const triggered = core.orderSequence
      .map((id) => core.orders.get(id)!)
      .filter((order) => order.armed && order.status === "accepted")
      .filter((order) => {
        const stopPrice = parseScaled(String(order.stopPrice))!;
        return order.side === "buy" ? lastPrice >= stopPrice : lastPrice <= stopPrice;
      });
    if (triggered.length === 0) return;
    for (const stop of triggered) {
      const causation = last.eventId as CausationId; // the triggering trade's event
      const book = core.books.get(String(instrumentId))!;
      const quantity = parseScaled(String(stop.quantity))!;
      const limit = stop.kind === "stop-limit" && stop.limitPrice !== undefined ? parseScaled(String(stop.limitPrice)) : undefined;
      const plan = book.planMatch({ side: stop.side, quantity, ...(limit === undefined ? {} : { limitPrice: limit }) });
      stop.armed = false; // a triggered stop never re-arms (invariant)
      if (plan.fills.length > 0) {
        applyFills(core, stop, plan.fills, ctx, scratch, causation);
      }
      const filled = parseScaled(String(stop.filledQuantity)) ?? 0n;
      if (filled < quantity) {
        if (stop.kind === "stop" || stop.constraints.timeInForce === "IOC") {
          stop.status = "canceled";
          stop.cancelReason = "ioc-remainder";
          stop.updatedAt = ctx.now;
        } else if (limit !== undefined) {
          book.place({ orderId: stop.orderId, side: stop.side, price: limit, quantity: quantity - filled, accountId: stop.accountId, participantId: stop.submittedBy, arrivalSeq: 0 });
        }
      }
      emitOrderState(core, stop, [], ctx, scratch, causation);
      scratch.touchedOwners.add(String(stop.accountId));
    }
    guard += 1;
    if (guard > STOP_CASCADE_LIMIT) {
      throw new Error(`[abides:execution] stop cascade exceeded ${String(STOP_CASCADE_LIMIT)} rounds on ${String(instrumentId)} (event-storm guard — fail closed)`);
    }
  }
}
