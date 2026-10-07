/**
 * The matching execution kernel (W014 `matching` module).
 *
 * Spec: spec/SIMULATION.md "Matching" — deterministic price-time priority
 * with mandatory partial fills; market/limit/stop/stop-limit, IOC/FOK,
 * post-only, reduce-only, cancellation/replacement.
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md C (execution behaviors) and L (causal
 * journal events for every order lifecycle).
 *
 * THE SINGLE-PATH LAW (ARCHITECTURE-LOCK.md A6/A9): the matcher never mutates
 * state directly. Every fact is first emitted as an event draft, then applied
 * to the working state through `reduceMatchingEvent` — the exact function
 * the world reducer and journal replay use. Live matching and replay are
 * bit-identical by construction.
 *
 * SEQUENCE RESERVATION: the journal assigns dense sequences (cursor+1, +2,
 * …) to the batch; the kernel reserves them up front the same way, so a
 * fill draft can cite the sequence of the `market.trade.printed` draft
 * emitted just before it (the fill causality law: orderId + marketRef of
 * the trade that generated it).
 */

import type {
  AccountId,
  CausationId,
  CorrelationId,
  FillFee,
  InstrumentId,
  LiquidityRole,
  OrderExecutionConstraints,
  OrderId,
  OrderKind,
  OrderRejectionReason,
  OrderSide,
  OrderStatus,
  ParticipantId,
  Price,
  Quantity,
  SequenceNumber,
  TimestampMs,
  TradeId,
  WorldId,
} from "tradrl-world-contracts";
import type { PendingEventDraft } from "../journal/eventJournal.js";
import { eventIdFor } from "../journal/eventJournal.js";
import {
  aggressiveLevels,
  formatScaled,
  formatQuantity,
  isMultipleOf,
  parseScaled,
  quantityScaled,
  type Scaled,
} from "../orderbook/index.js";
import type { BookState } from "../orderbook/index.js";
import { diffBookStates } from "../orderbook/index.js";
import type { BookDeltaPayload, TradePrintPayload } from "tradrl-world-contracts/time";
import { EngineInvariantError } from "../world/errors.js";
import type { Instrument } from "tradrl-world-contracts";
import type { WorldDefinition } from "../world/definition.js";
import { fillFee } from "./fees.js";
import {
  MATCHING_EVENT_SCHEMA_VERSION,
  MATCHING_PRODUCER,
  type OrderAcceptedPayload,
  type OrderCanceledPayload,
  type OrderFilledPayload,
  type OrderRejectedPayload,
  type OrderReplacedPayload,
  type OrderTriggeredPayload,
} from "./events.js";
import type { MatchingState } from "./state.js";
import { nextFillId, nextOrderId, nextTradeId, reduceMatchingEvent } from "./state.js";
import type { VenuePolicy } from "./policy.js";
import { acknowledgementAvailableAt, fillAvailableAt } from "./policy.js";

/**
 * The typed reduce-only seam. Account/portfolio state is W015's surface —
 * the venue cannot verify position effects yet, so the check arrives as a
 * typed callback the world core provides. Until W015 wires it, an absent
 * check is PERMISSIVE (structural-only enforcement, documented known
 * limitation); W015 passes the real position check through the lifecycle
 * context with no matcher change.
 */
export interface ReduceOnlyPositionCheck {
  (input: {
    readonly accountId: AccountId;
    readonly instrumentId: InstrumentId;
    readonly side: OrderSide;
  }): { readonly wouldIncreasePosition: boolean };
}

/** One planned match of an aggressive order against a resting maker. */
export interface PlannedMatch {
  readonly makerOrderId: OrderId;
  readonly price: Price;
  readonly priceScaled: Scaled;
  readonly quantity: Scaled;
}

/** A unified order submission (submit-order and replace successors). */
export interface SubmissionInput {
  readonly instrumentId: InstrumentId;
  readonly accountId: AccountId;
  readonly submittedBy: ParticipantId;
  readonly kind: OrderKind;
  readonly side: OrderSide;
  readonly quantity: Quantity;
  readonly limitPrice?: Price;
  readonly stopPrice?: Price;
  readonly constraints: OrderExecutionConstraints;
}

/** Mutable planning context for one command batch. */
export class MatchContext {
  readonly worldId: WorldId;
  readonly definition: WorldDefinition;
  readonly instrument: Instrument;
  readonly policy: VenuePolicy;
  readonly simulationTime: TimestampMs;
  readonly causationId: CausationId;
  readonly correlationId: CorrelationId;
  readonly reduceOnlyCheck?: ReduceOnlyPositionCheck;
  working: MatchingState;
  drafts: PendingEventDraft[] = [];
  private reservedSequence: SequenceNumber;

  constructor(input: {
    readonly definition: WorldDefinition;
    readonly instrument: Instrument;
    readonly policy: VenuePolicy;
    readonly matching: MatchingState;
    readonly simulationTime: TimestampMs;
    readonly nextSequence: SequenceNumber;
    readonly causationId: CausationId;
    readonly correlationId: CorrelationId;
    readonly reduceOnlyCheck?: ReduceOnlyPositionCheck;
  }) {
    this.worldId = input.definition.scope.worldId;
    this.definition = input.definition;
    this.instrument = input.instrument;
    this.policy = input.policy;
    this.simulationTime = input.simulationTime;
    this.causationId = input.causationId;
    this.correlationId = input.correlationId;
    this.working = input.matching;
    this.reservedSequence = input.nextSequence;
    this.reduceOnlyCheck = input.reduceOnlyCheck;
  }

  get book(): BookState {
    const book = this.working.books[String(this.instrument.instrumentId)];
    if (book === undefined) {
      throw new EngineInvariantError(
        `no book for instrument ${String(this.instrument.instrumentId)}`,
      );
    }
    return book;
  }

  order(orderId: OrderId) {
    const order = this.working.orders.find((candidate) => candidate.orderId === orderId);
    if (order === undefined) {
      throw new EngineInvariantError(`planning references unknown order ${String(orderId)}`);
    }
    return order;
  }

  /**
   * Emit one event: reserve its sequence, build the draft, then apply the
   * would-be sealed envelope to the working state through the reducer (the
   * single-path law). Returns the reserved sequence.
   */
  emit(eventType: string, payload: unknown, availableAt?: TimestampMs): SequenceNumber {
    const sequence = this.reservedSequence;
    this.reservedSequence = (sequence + 1) as SequenceNumber;
    const draft: PendingEventDraft = {
      eventType,
      occurredAt: this.simulationTime,
      ...(availableAt === undefined ? {} : { availableAt }),
      causationId: this.causationId,
      correlationId: this.correlationId,
      producer: MATCHING_PRODUCER,
      schemaVersion: MATCHING_EVENT_SCHEMA_VERSION,
      payload,
    };
    this.drafts.push(draft);
    this.working = reduceMatchingEvent(this.working, {
      worldId: this.worldId,
      sequence,
      eventId: eventIdFor(this.worldId, sequence),
      eventType,
      occurredAt: draft.occurredAt,
      ...(availableAt === undefined ? {} : { availableAt }),
      causationId: draft.causationId,
      correlationId: draft.correlationId,
      producer: draft.producer,
      schemaVersion: draft.schemaVersion,
      payload: draft.payload,
    });
    return sequence;
  }

  nextOrderId(): OrderId {
    return nextOrderId(this.worldId, this.working);
  }

  nextFillId(): string {
    return nextFillId(this.worldId, this.working);
  }

  nextTradeId(): TradeId {
    return nextTradeId(this.worldId, this.working);
  }

  ackAvailableAt(): TimestampMs | undefined {
    return acknowledgementAvailableAt(this.policy, this.simulationTime);
  }

  fillAvailableAt(): TimestampMs | undefined {
    return fillAvailableAt(this.policy, this.simulationTime);
  }
}

/** One planned aggressive walk against the current book (read-only). */
export function planAggressive(
  ctx: MatchContext,
  takerSide: OrderSide,
  quantity: Scaled,
  limitScaled?: Scaled,
): { readonly matches: readonly PlannedMatch[]; readonly remainder: Scaled } {
  const matches: PlannedMatch[] = [];
  let remaining = quantity;
  for (const level of aggressiveLevels(ctx.book, takerSide, limitScaled)) {
    if (remaining === 0n) break;
    for (const entry of level.entries) {
      if (remaining === 0n) break;
      const fillQuantity = remaining < entry.remaining ? remaining : entry.remaining;
      matches.push({
        makerOrderId: entry.orderId,
        price: level.price,
        priceScaled: level.priceScaled,
        quantity: fillQuantity,
      });
      remaining -= fillQuantity;
    }
  }
  return { matches, remainder: remaining };
}

/** Would an aggressive order of `side` cross the book right now? */
export function wouldCross(
  ctx: MatchContext,
  side: OrderSide,
  limitScaled?: Scaled,
): boolean {
  return aggressiveLevels(ctx.book, side, limitScaled).length > 0;
}

function feeFor(
  ctx: MatchContext,
  price: Price,
  quantity: Scaled,
  liquidity: LiquidityRole,
  isFirstFillOfOrder: boolean,
): FillFee {
  return fillFee({
    schedule: ctx.policy.feeSchedule,
    currency: ctx.instrument.quoteCurrency,
    price,
    quantity: formatQuantity(quantity),
    liquidity,
    isFirstFillOfOrder,
  });
}

/**
 * Execute a planned aggressive walk: per match, print the public trade,
 * then the taker fill, then the maker fill — every fill citing the trade
 * (tradeId + the trade event's reserved sequence). The taker order must
 * already exist in the working state (accepted); maker orders are located
 * by id.
 */
export function executeTakerPlan(
  ctx: MatchContext,
  takerOrderId: OrderId,
  takerSide: OrderSide,
  filledBefore: Scaled,
  matches: readonly PlannedMatch[],
): void {
  const instrumentId = ctx.instrument.instrumentId;
  const accountId = ctx.order(takerOrderId).accountId;
  let cumulative = filledBefore;
  for (const match of matches) {
    const tradeId = ctx.nextTradeId();
    const tradePrint: TradePrintPayload = {
      type: "market.trade.printed",
      tradeId,
      instrumentId,
      price: match.price,
      quantity: formatQuantity(match.quantity),
      aggressorSide: takerSide,
    };
    const tradeSequence = ctx.emit("market.trade.printed", tradePrint, ctx.fillAvailableAt());

    cumulative += match.quantity;
    const takerStatus: OrderStatus = isTakerComplete(ctx, takerOrderId, cumulative)
      ? "filled"
      : "partially-filled";
    const takerFill: OrderFilledPayload = {
      type: "matching.order.filled",
      orderId: takerOrderId,
      instrumentId,
      accountId,
      fillId: ctx.nextFillId() as never,
      price: match.price,
      quantity: formatQuantity(match.quantity),
      fee: feeFor(ctx, match.price, match.quantity, "taker", cumulative === match.quantity),
      liquidity: "taker",
      marketRef: { tradeId, sequence: tradeSequence },
      cumulativeFilledQuantity: formatQuantity(cumulative),
      status: takerStatus,
    };
    ctx.emit("matching.order.filled", takerFill, ctx.fillAvailableAt());

    const makerOrder = ctx.order(match.makerOrderId);
    const makerCumulative = parseScaled(makerOrder.filledQuantity) + match.quantity;
    const makerStatus: OrderStatus =
      makerCumulative === parseScaled(makerOrder.quantity) ? "filled" : "partially-filled";
    const makerFill: OrderFilledPayload = {
      type: "matching.order.filled",
      orderId: match.makerOrderId,
      instrumentId,
      accountId: makerOrder.accountId,
      fillId: ctx.nextFillId() as never,
      price: match.price,
      quantity: formatQuantity(match.quantity),
      fee: feeFor(
        ctx,
        match.price,
        match.quantity,
        "maker",
        parseScaled(makerOrder.filledQuantity) === 0n,
      ),
      liquidity: "maker",
      marketRef: { tradeId, sequence: tradeSequence },
      cumulativeFilledQuantity: formatQuantity(makerCumulative),
      status: makerStatus,
    };
    ctx.emit("matching.order.filled", makerFill, ctx.fillAvailableAt());
  }
}

function isTakerComplete(ctx: MatchContext, takerOrderId: OrderId, cumulative: Scaled): boolean {
  return cumulative === parseScaled(ctx.order(takerOrderId).quantity);
}

/**
 * Emit `matching.order.accepted` with the anticipated resting quantity —
 * the reducer places exactly that remainder on the book, so an order that
 * partially crosses and then rests never appears as takeable liquidity.
 */
export function emitAccepted(
  ctx: MatchContext,
  input: SubmissionInput,
  orderId: OrderId,
  restingQuantity: Scaled,
): void {
  const payload: OrderAcceptedPayload = {
    type: "matching.order.accepted",
    orderId,
    instrumentId: input.instrumentId,
    accountId: input.accountId,
    submittedBy: input.submittedBy,
    kind: input.kind,
    side: input.side,
    quantity: input.quantity,
    ...(input.limitPrice === undefined ? {} : { limitPrice: input.limitPrice }),
    ...(input.stopPrice === undefined ? {} : { stopPrice: input.stopPrice }),
    constraints: input.constraints,
    restingQuantity: formatQuantity(restingQuantity),
    submittedAt: ctx.simulationTime,
  };
  ctx.emit("matching.order.accepted", payload, ctx.ackAvailableAt());
}

/** Emit `matching.order.canceled`. */
export function emitCanceled(
  ctx: MatchContext,
  orderId: OrderId,
  cancelReason: OrderCanceledPayload["cancelReason"],
): void {
  const order = ctx.order(orderId);
  const remaining = parseScaled(order.quantity) - parseScaled(order.filledQuantity);
  const payload: OrderCanceledPayload = {
    type: "matching.order.canceled",
    orderId,
    instrumentId: order.instrumentId,
    accountId: order.accountId,
    cancelReason,
    remainingQuantity: formatQuantity(remaining),
  };
  ctx.emit("matching.order.canceled", payload, ctx.ackAvailableAt());
}

/** Emit `matching.order.rejected` (a venue rejection of a working order). */
export function emitOrderRejected(
  ctx: MatchContext,
  orderId: OrderId,
  rejectionReason: OrderRejectionReason,
  message?: string,
): void {
  const order = ctx.order(orderId);
  const payload: OrderRejectedPayload = {
    type: "matching.order.rejected",
    orderId,
    instrumentId: order.instrumentId,
    accountId: order.accountId,
    rejectionReason,
    ...(message === undefined ? {} : { message }),
  };
  ctx.emit("matching.order.rejected", payload, ctx.ackAvailableAt());
}

/** Emit `matching.order.replaced` (superseded by a successor order). */
export function emitReplaced(ctx: MatchContext, orderId: OrderId, replacedByOrderId: OrderId): void {
  const order = ctx.order(orderId);
  const remaining = parseScaled(order.quantity) - parseScaled(order.filledQuantity);
  const payload: OrderReplacedPayload = {
    type: "matching.order.replaced",
    orderId,
    instrumentId: order.instrumentId,
    accountId: order.accountId,
    replacedByOrderId,
    remainingQuantity: formatQuantity(remaining),
  };
  ctx.emit("matching.order.replaced", payload, ctx.ackAvailableAt());
}

/** Emit `matching.order.triggered` (an armed stop began executing). */
export function emitTriggered(
  ctx: MatchContext,
  orderId: OrderId,
  input: {
    readonly executionKind: "market" | "limit";
    readonly limitPrice?: Price;
    readonly restingQuantity: Scaled;
    readonly triggerPrice: Price;
  },
): void {
  const order = ctx.order(orderId);
  const payload: OrderTriggeredPayload = {
    type: "matching.order.triggered",
    orderId,
    instrumentId: order.instrumentId,
    accountId: order.accountId,
    kind: order.kind === "stop-limit" ? "stop-limit" : "stop",
    side: order.side,
    stopPrice: order.stopPrice!,
    triggerPrice: input.triggerPrice,
    executionKind: input.executionKind,
    ...(input.limitPrice === undefined ? {} : { limitPrice: input.limitPrice }),
    restingQuantity: formatQuantity(input.restingQuantity),
  };
  ctx.emit("matching.order.triggered", payload, ctx.ackAvailableAt());
}

/** Emit the end-of-batch book delta (W004 taxonomy) when the book changed. */
export function emitBookDelta(ctx: MatchContext, before: BookState): void {
  const operations = diffBookStates(before, ctx.book);
  if (operations.length === 0) {
    return;
  }
  const payload: BookDeltaPayload = {
    type: "market.book.delta",
    instrumentId: ctx.instrument.instrumentId,
    operations,
  };
  ctx.emit("market.book.delta", payload, ctx.fillAvailableAt());
}
