/**
 * The four order commands' lifecycles (W024) — the command router plus the
 * validate → authorize → apply domain rules → mutate → emit paths for
 * submit / cancel / replace / close-position.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle"; spec/SIMULATION.md
 * "Matching" (price-time priority, partial fills mandatory, market/limit/
 * stop/stop-limit, IOC/FOK/post-only/reduce-only); spec/ARCHITECTURE-LOCK.md
 * A6 (ordered events) + A13 (venue policy gates are runtime controls).
 *
 * DECLARED POLICIES (README.md — deterministic, tested, never silent):
 * - market orders fill against available liquidity; the venue cancels any
 *   unfilled remainder (`ioc-remainder`);
 * - resting limits keep time priority by arrival; replace = cancel + fresh
 *   successor (priority re-earned; `replacedByOrderId` chains); replacing a
 *   stop-family order re-arms the successor;
 * - buying power is the declared PRE-TRADE approximation (quantity ×
 *   reference price + estimated taker fee + fixed fee, leverage 1); exact
 *   cash mutation happens on fills (./ledger.ts);
 * - an order's `submittedAt` is the command's `issuedAt` (the actor's
 *   decision time) while fills occur at venue ARRIVAL time — the gap between
 *   decision and execution is the reactive-market latency semantic.
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  AccountId,
  CancelOrderCommand,
  ClosePositionCommand,
  CommandResult,
  InstrumentId,
  OrderId,
  OrderSubmission,
  ReplaceOrderCommand,
  SubmitOrderCommand,
  TimestampMs,
  WorldCommand,
} from "tradrl-world-contracts";
import { formatQuantity, parseScaled } from "./book.js";
import { estimateFillFee, fixedFeeOf } from "./ledger.js";
import { orderAcceptedEvent } from "./events.js";
import {
  ackOf,
  contextOf,
  fixed,
  projectOrder,
  rejectAt,
  rejectWith,
  WORKING,
  type ExecutionContext,
  type MutableOrder,
  type Scratch,
  type VenueCore,
} from "./execution.js";
import { applyFills, emitOrderState, runStopCascade } from "./matching.js";
import type { ExecutionOutcome } from "./execution.js";

/** Run one order command through the full lifecycle. */
export function executeOrderCommand(core: VenueCore, command: WorldCommand, ctx: ExecutionContext): ExecutionOutcome {
  if (core.hasSeenCommandId(String(command.commandId))) {
    return {
      result: rejectAt("validate", "duplicate-command", `commandId ${String(command.commandId)} was already processed`),
      events: [],
      touchedOwners: [],
      touchedInstruments: [],
      newTrades: [],
    };
  }
  core.recordCommandId(String(command.commandId));
  const scratch: Scratch = { events: [], touchedOwners: new Set(), touchedInstruments: new Set(), newTrades: [] };
  let result: CommandResult;
  switch (command.kind) {
    case "submit-order":
      result = submitOrder(core, command, ctx, scratch);
      break;
    case "cancel-order":
      result = cancelOrder(core, command, ctx, scratch);
      break;
    case "replace-order":
      result = replaceOrder(core, command, ctx, scratch);
      break;
    case "close-position":
      result = closePosition(core, command, ctx, scratch);
      break;
    default:
      result = rejectAt("validate", "malformed-command", `${(command as { kind: string }).kind} is not an order command (the kernel routes admin commands itself)`);
      break;
  }
  return {
    result,
    events: scratch.events,
    touchedOwners: [...scratch.touchedOwners].map((id) => id as AccountId),
    touchedInstruments: [...scratch.touchedInstruments].map((id) => id as InstrumentId),
    newTrades: scratch.newTrades,
  };
}

// --- submit -------------------------------------------------------------------

function submitOrder(core: VenueCore, command: SubmitOrderCommand, ctx: ExecutionContext, scratch: Scratch): CommandResult {
  const instrument = core.instruments.get(String(command.instrumentId));
  if (instrument === undefined) {
    return rejectWith(core, command, ctx, scratch, "validate", "unknown-instrument", `instrument ${String(command.instrumentId)} is not listed`);
  }
  const participant = core.definition.participants.find((p) => String(p.participantId) === String(command.issuedBy));
  if (participant === undefined) {
    return rejectWith(core, command, ctx, scratch, "validate", "unknown-participant", `participant ${String(command.issuedBy)} is not registered`);
  }
  if (String(participant.accountId) !== String(command.accountId)) {
    return rejectWith(core, command, ctx, scratch, "validate", "unknown-account", `participant ${String(command.issuedBy)} does not trade account ${String(command.accountId)}`);
  }
  if (String(command.worldId) !== String(core.worldId)) {
    return rejectWith(core, command, ctx, scratch, "validate", "unknown-world", `command carries worldId ${String(command.worldId)}`);
  }
  const venue = core.venueOfInstrument.get(String(command.instrumentId))!;
  const account = core.definition.accounts.find((a) => String(a.accountId) === String(command.accountId));
  if (account === undefined || !account.permissions.canTrade) {
    return rejectWith(core, command, ctx, scratch, "authorize", "account-not-tradable", `account ${String(command.accountId)} is not registered or may not trade`);
  }
  if (!instrument.tradable || instrument.tradingState !== "open") {
    return rejectWith(core, command, ctx, scratch, "domain-rules", instrument.tradable ? "market-closed" : "instrument-not-tradable", `instrument ${String(instrument.instrumentId)} is not tradable now (${instrument.tradingState})`);
  }
  if (!venue.allowedOrderKinds.includes(command.submission.kind)) {
    return rejectWith(core, command, ctx, scratch, "validate", "order-kind-not-supported", `venue ${String(venue.venueId)} does not accept ${command.submission.kind} orders`);
  }
  const submission = command.submission;
  const quantity = parseScaled(String(submission.quantity));
  const tick = parseScaled(String(instrument.tickSize))!;
  const lot = parseScaled(String(instrument.lotSize))!;
  if (quantity === undefined || quantity <= 0n || quantity % lot !== 0n) {
    return rejectWith(core, command, ctx, scratch, "validate", "invalid-quantity", `quantity ${String(submission.quantity)} is not a positive lot multiple (${String(instrument.lotSize)})`);
  }
  const needsLimit = submission.kind === "limit" || submission.kind === "stop-limit";
  const needsStop = submission.kind === "stop" || submission.kind === "stop-limit";
  const limit = submission.limitPrice === undefined ? undefined : parseScaled(String(submission.limitPrice));
  if (needsLimit && limit === undefined) {
    return rejectWith(core, command, ctx, scratch, "validate", "invalid-price", `${submission.kind} orders require a limitPrice`);
  }
  if (limit !== undefined && (limit <= 0n || limit % tick !== 0n)) {
    return rejectWith(core, command, ctx, scratch, "validate", "invalid-price", `limitPrice ${String(submission.limitPrice)} is not a positive tick multiple (${String(instrument.tickSize)})`);
  }
  const stop = submission.stopPrice === undefined ? undefined : parseScaled(String(submission.stopPrice));
  if (needsStop && stop === undefined) {
    return rejectWith(core, command, ctx, scratch, "validate", "invalid-price", `${submission.kind} orders require a stopPrice`);
  }
  if (stop !== undefined && (stop <= 0n || stop % tick !== 0n)) {
    return rejectWith(core, command, ctx, scratch, "validate", "invalid-price", `stopPrice ${String(submission.stopPrice)} is not a positive tick multiple (${String(instrument.tickSize)})`);
  }

  const book = core.books.get(String(command.instrumentId))!;
  if (submission.constraints.postOnly === true && submission.kind === "limit" && book.wouldCross(submission.side, limit!)) {
    return rejectWith(core, command, ctx, scratch, "domain-rules", "post-only-would-take", `the post-only limit at ${String(submission.limitPrice)} would take liquidity at the current book`);
  }
  if (submission.constraints.reduceOnly === true) {
    const position = core.ledgers.get(String(command.accountId))!.positionOf(command.instrumentId)?.quantity ?? 0n;
    const increasing = submission.side === "buy" ? position >= 0n : position <= 0n;
    const magnitude = position < 0n ? -position : position;
    if (increasing || quantity > magnitude) {
      return rejectWith(core, command, ctx, scratch, "domain-rules", "reduce-only-would-increase-position", `the account's offsettable position is ${formatQuantity(magnitude, instrument)} — the order would increase it`);
    }
  }
  if (submission.side === "buy") {
    const reference = limit ?? book.bestAsk()?.price;
    if (reference !== undefined) {
      const notional = (quantity * reference) / 10n ** 12n;
      const fee = estimateFillFee(notional, "taker", venue.feeSchedule) + fixedFeeOf(venue.feeSchedule);
      const cash = core.ledgers.get(String(command.accountId))!.cashScaled();
      if (cash < notional + fee) {
        return rejectWith(core, command, ctx, scratch, "domain-rules", "insufficient-buying-power", `estimated cost ${notional.toString()} + fee ${fee.toString()} exceeds cash ${cash.toString()}`);
      }
    }
  }

  const executable = submission.kind === "market" || submission.kind === "limit";
  const plan = executable
    ? book.planMatch({ side: submission.side, quantity, ...(limit === undefined ? {} : { limitPrice: limit }) })
    : undefined;
  if (plan !== undefined && submission.constraints.timeInForce === "FOK" && plan.remainder > 0n) {
    return rejectWith(core, command, ctx, scratch, "domain-rules", "fok-unfillable", "the book cannot fill the whole quantity immediately (FOK)");
  }

  const order: MutableOrder = {
    orderId: core.nextOrderId(),
    worldId: core.worldId,
    instrumentId: command.instrumentId,
    accountId: command.accountId,
    submittedBy: command.issuedBy,
    kind: submission.kind,
    side: submission.side,
    quantity: submission.quantity,
    filledQuantity: formatQuantity(0n, instrument),
    ...(limit === undefined ? {} : { limitPrice: submission.limitPrice }),
    ...(stop === undefined ? {} : { stopPrice: submission.stopPrice }),
    constraints: submission.constraints,
    status: "accepted",
    submittedAt: command.issuedAt,
    updatedAt: ctx.now,
    armed: STOP_FAMILY(submission.kind),
  };
  core.markOrder(order);
  scratch.touchedOwners.add(String(order.accountId));

  const acceptedStamp = ctx.nextStamp();
  scratch.events.push(orderAcceptedEvent(
    contextOf({ worldId: core.worldId, venue, now: ctx.now, causationId: ctx.causationId, correlationId: ctx.correlationId, availableAt: (ctx.now + venue.latency.acknowledgementMs) as TimestampMs, stamper: fixed(acceptedStamp.sequence, acceptedStamp.eventId) }),
    { order: projectOrder(order) },
  ));

  if (plan !== undefined && plan.fills.length > 0) {
    applyFills(core, order, plan.fills, ctx, scratch, ctx.causationId);
    scratch.touchedInstruments.add(String(command.instrumentId));
    runStopCascade(core, command.instrumentId, ctx, scratch);
  }
  const filled = parseScaled(String(order.filledQuantity)) ?? 0n;
  const remainder = quantity - filled;
  if (remainder > 0n) {
    if (submission.kind === "market" || submission.constraints.timeInForce === "IOC") {
      order.status = "canceled";
      order.cancelReason = "ioc-remainder";
      order.updatedAt = ctx.now;
      emitOrderState(core, order, [], ctx, scratch, ctx.causationId);
    } else if (submission.kind === "limit") {
      book.place({ orderId: order.orderId, side: order.side, price: limit!, quantity: remainder, accountId: order.accountId, participantId: order.submittedBy, arrivalSeq: 0 });
      scratch.touchedInstruments.add(String(command.instrumentId));
    }
  }
  return ackOf(command.commandId, core.worldId, ctx.now, scratch.events);
}

function STOP_FAMILY(kind: OrderSubmission["kind"]): boolean {
  return kind === "stop" || kind === "stop-limit";
}

// --- cancel / replace / close ---------------------------------------------------

function workingOrderOf(core: VenueCore, command: WorldCommand, ctx: ExecutionContext, scratch: Scratch, orderId: OrderId): { order: MutableOrder } | { problem: CommandResult } {
  const order = core.orders.get(String(orderId));
  if (order === undefined) {
    return { problem: rejectWith(core, command, ctx, scratch, "validate", "unknown-order", `order ${String(orderId)} does not exist`) };
  }
  if (String(order.submittedBy) !== String(command.issuedBy)) {
    return { problem: rejectWith(core, command, ctx, scratch, "authorize", "unauthorized", `order ${String(orderId)} belongs to ${String(order.submittedBy)}`) };
  }
  if (!WORKING.includes(order.status)) {
    return { problem: rejectWith(core, command, ctx, scratch, "domain-rules", "order-not-modifiable", `order ${String(orderId)} is ${order.status}`) };
  }
  return { order };
}

function cancelOrder(core: VenueCore, command: CancelOrderCommand, ctx: ExecutionContext, scratch: Scratch): CommandResult {
  const found = workingOrderOf(core, command, ctx, scratch, command.orderId);
  if ("problem" in found) return found.problem;
  const order = found.order;
  if (order.kind === "limit" && order.limitPrice !== undefined) {
    core.books.get(String(order.instrumentId))!.cancel(order.orderId);
    scratch.touchedInstruments.add(String(order.instrumentId));
  }
  order.status = "canceled";
  order.cancelReason = "user-request";
  order.armed = false;
  order.updatedAt = ctx.now;
  scratch.touchedOwners.add(String(order.accountId));
  emitOrderState(core, order, [], ctx, scratch, ctx.causationId);
  return ackOf(command.commandId, core.worldId, ctx.now, scratch.events);
}

function replaceOrder(core: VenueCore, command: ReplaceOrderCommand, ctx: ExecutionContext, scratch: Scratch): CommandResult {
  const found = workingOrderOf(core, command, ctx, scratch, command.orderId);
  if ("problem" in found) return found.problem;
  const old = found.order;
  const instrument = core.instruments.get(String(old.instrumentId))!;
  const tick = parseScaled(String(instrument.tickSize))!;
  const lot = parseScaled(String(instrument.lotSize))!;
  const oldFilled = parseScaled(String(old.filledQuantity)) ?? 0n;
  if (command.limitPrice !== undefined) {
    const limit = parseScaled(String(command.limitPrice));
    if (limit === undefined || limit <= 0n || limit % tick !== 0n) {
      return rejectWith(core, command, ctx, scratch, "validate", "invalid-price", `limitPrice ${String(command.limitPrice)} is not a positive tick multiple`);
    }
  }
  if (command.quantity !== undefined) {
    const quantity = parseScaled(String(command.quantity));
    if (quantity === undefined || quantity <= 0n || quantity % lot !== 0n || quantity < oldFilled) {
      return rejectWith(core, command, ctx, scratch, "validate", "invalid-quantity", `quantity ${String(command.quantity)} is not a positive lot multiple ≥ the filled ${String(old.filledQuantity)}`);
    }
  }
  const newLimit = command.limitPrice ?? old.limitPrice;
  const newQuantity = command.quantity ?? old.quantity;
  const newQuantityScaled = parseScaled(String(newQuantity))!;
  const constraints = command.constraints ?? old.constraints;
  const book = core.books.get(String(old.instrumentId))!;
  if (constraints.postOnly === true && old.kind === "limit" && newLimit !== undefined) {
    const hypothetical = book.planMatch({ side: old.side, quantity: newQuantityScaled - oldFilled, limitPrice: parseScaled(String(newLimit)) });
    if (hypothetical.fills.length > 0) {
      return rejectWith(core, command, ctx, scratch, "domain-rules", "post-only-would-take", `the replacement at ${String(newLimit)} would take liquidity at the current book`);
    }
  }

  if (old.kind === "limit" && old.limitPrice !== undefined) {
    book.cancel(old.orderId);
    scratch.touchedInstruments.add(String(old.instrumentId));
  }
  old.status = "replaced";
  old.armed = false;
  old.updatedAt = ctx.now;
  const successor: MutableOrder = {
    orderId: core.nextOrderId(),
    worldId: old.worldId,
    instrumentId: old.instrumentId,
    accountId: old.accountId,
    submittedBy: old.submittedBy,
    kind: old.kind,
    side: old.side,
    quantity: newQuantity,
    filledQuantity: formatQuantity(0n, instrument),
    ...(newLimit === undefined ? {} : { limitPrice: newLimit }),
    ...(command.stopPrice === undefined ? (old.stopPrice === undefined ? {} : { stopPrice: old.stopPrice }) : { stopPrice: command.stopPrice }),
    constraints,
    status: "accepted",
    submittedAt: ctx.now,
    updatedAt: ctx.now,
    armed: STOP_FAMILY(old.kind),
  };
  old.replacedByOrderId = successor.orderId;
  core.markOrder(successor);
  scratch.touchedOwners.add(String(old.accountId));
  scratch.touchedInstruments.add(String(old.instrumentId));
  emitOrderState(core, old, [], ctx, scratch, ctx.causationId);
  const venue = core.venueOfInstrument.get(String(old.instrumentId))!;
  const acceptedStamp = ctx.nextStamp();
  scratch.events.push(orderAcceptedEvent(
    contextOf({ worldId: core.worldId, venue, now: ctx.now, causationId: ctx.causationId, correlationId: ctx.correlationId, availableAt: (ctx.now + venue.latency.acknowledgementMs) as TimestampMs, stamper: fixed(acceptedStamp.sequence, acceptedStamp.eventId) }),
    { order: projectOrder(successor) },
  ));
  if (successor.kind === "limit" && successor.limitPrice !== undefined) {
    const plan = book.planMatch({ side: successor.side, quantity: newQuantityScaled, limitPrice: parseScaled(String(successor.limitPrice)) });
    if (plan.fills.length > 0) {
      applyFills(core, successor, plan.fills, ctx, scratch, ctx.causationId);
      runStopCascade(core, old.instrumentId, ctx, scratch);
    }
    const filled = parseScaled(String(successor.filledQuantity)) ?? 0n;
    if (filled < newQuantityScaled) {
      book.place({ orderId: successor.orderId, side: successor.side, price: parseScaled(String(successor.limitPrice))!, quantity: newQuantityScaled - filled, accountId: successor.accountId, participantId: successor.submittedBy, arrivalSeq: 0 });
    }
  }
  return ackOf(command.commandId, core.worldId, ctx.now, scratch.events);
}

function closePosition(core: VenueCore, command: ClosePositionCommand, ctx: ExecutionContext, scratch: Scratch): CommandResult {
  const ledger = core.ledgers.get(String(command.accountId));
  if (ledger === undefined) {
    return rejectWith(core, command, ctx, scratch, "validate", "unknown-account", `account ${String(command.accountId)} is not registered`);
  }
  const position = ledger.positionOf(command.instrumentId)?.quantity ?? 0n;
  if (position === 0n) {
    return rejectWith(core, command, ctx, scratch, "domain-rules", "no-open-position", `account ${String(command.accountId)} is flat in ${String(command.instrumentId)}`);
  }
  const instrument = core.instruments.get(String(command.instrumentId))!;
  const internal: SubmitOrderCommand = {
    kind: "submit-order",
    commandId: command.commandId,
    worldId: command.worldId,
    issuedBy: command.issuedBy,
    issuedAt: command.issuedAt,
    accountId: command.accountId,
    instrumentId: command.instrumentId,
    submission: {
      kind: "market",
      side: position > 0n ? "sell" : "buy",
      quantity: formatQuantity(position < 0n ? -position : position, instrument),
      constraints: { timeInForce: "IOC" },
    } satisfies OrderSubmission,
    ...(command.correlationId === undefined ? {} : { correlationId: command.correlationId }),
  };
  return submitOrder(core, internal, ctx, scratch);
}
