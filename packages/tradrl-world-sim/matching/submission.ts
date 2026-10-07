/**
 * Submission, stop-trigger and order-lifecycle orchestration (W014
 * `matching` module) — the deterministic domain rules the command
 * lifecycle's `apply domain rules` stage delegates to through the seam
 * (`seam.ts`).
 *
 * Spec: spec/SIMULATION.md "Matching" — market/limit/stop/stop-limit, IOC/
 * FOK, post-only, reduce-only, cancellation/replacement; partial fills are
 * mandatory. Spec: spec/ACCEPTANCE-WORLD-ALPHA.md C.
 *
 * DOMAIN-CHECK ORDER (deterministic, part of the contract):
 *  1. instrument-not-tradable, 2. order-kind-not-supported,
 *  3. market-halted / market-closed, 4. invalid-price (tick grid),
 *  5. invalid-quantity (lot grid), 6. reduce-only-would-increase-position
 *  (the W015 seam), 7. post-only-would-take, 8. fok-unfillable.
 * Stops skip 7–8 at submission: a stop does not execute on submission —
 * those checks run at TRIGGER time and reject the (already working) order
 * with a `matching.order.rejected` event.
 *
 * SEMANTICS MATRIX (order kind × TIF × policy):
 * - market: never rests; unfilled remainder cancels (ioc-remainder) under
 *   every TIF; FOK requires full immediate fillability.
 * - limit GTC: crosses at maker prices, remainder rests at its limit;
 *   limit IOC: remainder cancels; limit FOK: all-or-nothing at submission.
 * - stop/stop-limit: accepted as ARMED (never resting at acceptance);
 *   trigger when a printed trade crosses the stop price (buy ≥, sell ≤);
 *   stop executes as market, stop-limit as a limit order (which may rest).
 * - post-only: a submission that would take (cross) liquidity is rejected;
 *   market+post-only always rejects (a market order takes by definition).
 * - market orders cannot rest and stop orders cannot partially fill while
 *   armed (documented simplifications, mirrored in tests).
 */

import type {
  OrderId,
  OrderRejectionReason,
  Price,
  Quantity,
} from "tradrl-world-contracts";
import { isTerminalOrderStatus } from "tradrl-world-contracts";
import { isMultipleOf, parseScaled, quantityScaled } from "../orderbook/index.js";
import type { Scaled } from "../orderbook/index.js";
import {
  emitAccepted,
  emitCanceled,
  emitOrderRejected,
  emitTriggered,
  executeTakerPlan,
  planAggressive,
  wouldCross,
  type MatchContext,
  type SubmissionInput,
} from "./matcher.js";
import type { ArmedStop } from "./state.js";

/** A domain-rule rejection for a submission attempt. */
export interface PrecheckRejection {
  readonly reason: OrderRejectionReason;
  readonly message: string;
}

function reject(reason: OrderRejectionReason, message: string): PrecheckRejection {
  return { reason, message };
}

function parseGridPrice(price: Price | undefined, tick: Scaled, what: string): Scaled | PrecheckRejection {
  if (price === undefined) {
    return reject("invalid-price", `${what} is required`);
  }
  let scaled: Scaled;
  try {
    scaled = parseScaled(price);
  } catch {
    return reject("invalid-price", `${what} '${String(price)}' is not canonical decimal text`);
  }
  if (scaled <= 0n) {
    return reject("invalid-price", `${what} '${String(price)}' must be positive`);
  }
  if (!isMultipleOf(scaled, tick)) {
    return reject("invalid-price", `${what} '${String(price)}' is not a multiple of the tick size`);
  }
  return scaled;
}

/**
 * The submission prechecks (checks 1–8 above). Returns the first failure or
 * undefined when the venue can accept the submission. Pure read over the
 * working state — nothing is emitted.
 */
export function precheckSubmission(
  ctx: MatchContext,
  input: SubmissionInput,
): PrecheckRejection | undefined {
  if (ctx.instrument.tradable === false) {
    return reject("instrument-not-tradable", `instrument ${String(input.instrumentId)} is not tradable`);
  }
  if (!ctx.policy.allowedOrderKinds.includes(input.kind)) {
    return reject(
      "order-kind-not-supported",
      `venue ${String(ctx.policy.venueId)} does not accept ${input.kind} orders`,
    );
  }
  if (ctx.book.tradingState === "halted") {
    return reject("market-halted", `trading in ${String(input.instrumentId)} is halted`);
  }
  if (ctx.book.tradingState !== "open") {
    return reject("market-closed", `trading in ${String(input.instrumentId)} is ${ctx.book.tradingState}`);
  }
  const tick = parseScaled(ctx.instrument.tickSize);
  const lot = parseScaled(ctx.instrument.lotSize);
  if (input.kind === "limit" || input.kind === "stop-limit") {
    const limit = parseGridPrice(input.limitPrice, tick, "limitPrice");
    if (typeof limit === "object" && "reason" in limit) return limit;
  }
  if (input.kind === "stop" || input.kind === "stop-limit") {
    const stop = parseGridPrice(input.stopPrice, tick, "stopPrice");
    if (typeof stop === "object" && "reason" in stop) return stop;
  }
  let quantity: Scaled;
  try {
    quantity = quantityScaled(input.quantity);
  } catch {
    return reject("invalid-quantity", `quantity '${String(input.quantity)}' is not canonical decimal text`);
  }
  if (quantity <= 0n || !isMultipleOf(quantity, lot)) {
    return reject("invalid-quantity", `quantity '${String(input.quantity)}' is not a positive multiple of the lot size`);
  }
  if (input.constraints.reduceOnly === true && ctx.reduceOnlyCheck !== undefined) {
    const verdict = ctx.reduceOnlyCheck({
      accountId: input.accountId,
      instrumentId: input.instrumentId,
      side: input.side,
    });
    if (verdict.wouldIncreasePosition) {
      return reject(
        "reduce-only-would-increase-position",
        `a reduce-only ${input.side} would increase the position of ${String(input.accountId)} in ${String(input.instrumentId)}`,
      );
    }
  }
  const isStop = input.kind === "stop" || input.kind === "stop-limit";
  if (!isStop && input.constraints.postOnly === true) {
    if (input.kind === "market") {
      return reject("post-only-would-take", "a post-only market order takes by definition");
    }
    const limitScaled = parseScaled(input.limitPrice!);
    if (wouldCross(ctx, input.side, limitScaled)) {
      return reject(
        "post-only-would-take",
        `post-only ${input.side} limit ${String(input.limitPrice)} would cross the book`,
      );
    }
  }
  if (!isStop && input.constraints.timeInForce === "FOK") {
    const limitScaled = input.kind === "limit" ? parseScaled(input.limitPrice!) : undefined;
    const plan = planAggressive(ctx, input.side, quantityScaled(input.quantity), limitScaled);
    if (plan.remainder > 0n) {
      return reject(
        "fok-unfillable",
        `FOK ${input.side} ${String(input.quantity)} cannot fill immediately at ${limitScaled === undefined ? "market" : String(input.limitPrice)}`,
      );
    }
  }
  return undefined;
}

/**
 * Execute an accepted submission (prechecks already passed): accept the
 * order, walk the book for market/limit kinds (printing trades and fills),
 * handle the TIF remainder, then evaluate the stop cascade. Stop kinds arm
 * at acceptance and wait for a trigger.
 */
export function executeSubmission(
  ctx: MatchContext,
  input: SubmissionInput,
  orderId: OrderId,
): void {
  if (input.kind === "stop" || input.kind === "stop-limit") {
    emitAccepted(ctx, input, orderId, 0n);
    return;
  }
  const limitScaled = input.kind === "limit" ? parseScaled(input.limitPrice!) : undefined;
  const quantity = quantityScaled(input.quantity);
  const plan = planAggressive(ctx, input.side, quantity, limitScaled);
  const rests = input.kind === "limit" && input.constraints.timeInForce === "GTC";
  emitAccepted(ctx, input, orderId, rests ? plan.remainder : 0n);
  if (plan.matches.length > 0) {
    executeTakerPlan(ctx, orderId, input.side, 0n, plan.matches);
  }
  if (plan.remainder > 0n && (input.kind === "market" || input.constraints.timeInForce === "IOC")) {
    // market orders never rest; IOC cancels its unfilled remainder
    emitCanceled(ctx, orderId, "ioc-remainder");
  }
  if (plan.matches.length > 0) {
    evaluateStopCascade(ctx);
  }
}

/**
 * Evaluate armed stops on this instrument against the last printed trade
 * price, cascading: each pass triggers every armed stop whose price is
 * crossed (in arming order), executes them, then re-evaluates — trades
 * printed by triggered stops can trigger more. Terminates because every
 * trigger disarms its stop.
 */
export function evaluateStopCascade(ctx: MatchContext): void {
  const instrumentId = ctx.instrument.instrumentId;
  for (;;) {
    const last = ctx.book.lastTradePrice;
    if (last === undefined) {
      return;
    }
    const lastScaled = parseScaled(last);
    const triggered = ctx.working.armedStops.filter((stop) => {
      if (stop.instrumentId !== instrumentId) {
        return false;
      }
      const stopScaled = parseScaled(stop.stopPrice);
      return stop.side === "buy" ? lastScaled >= stopScaled : lastScaled <= stopScaled;
    });
    if (triggered.length === 0) {
      return;
    }
    for (const stop of triggered) {
      executeTriggeredStop(ctx, stop, last);
    }
  }
}

function executeTriggeredStop(ctx: MatchContext, stop: ArmedStop, triggerPrice: Price): void {
  const order = ctx.order(stop.orderId);
  const tif = order.constraints.timeInForce;
  const postOnly = order.constraints.postOnly === true;
  const filledBefore = parseScaled(order.filledQuantity);
  const remaining = parseScaled(order.quantity) - filledBefore;
  const isStopLimit = order.kind === "stop-limit";
  const limitScaled = isStopLimit ? parseScaled(order.limitPrice!) : undefined;

  if (isStopLimit && postOnly && wouldCross(ctx, order.side, limitScaled)) {
    emitOrderRejected(ctx, order.orderId, "post-only-would-take", "triggered post-only stop-limit would cross");
    return;
  }
  if (!isStopLimit && postOnly) {
    emitOrderRejected(ctx, order.orderId, "post-only-would-take", "triggered post-only stop executes as a market order");
    return;
  }
  if (tif === "FOK") {
    const fokPlan = planAggressive(ctx, order.side, remaining, limitScaled);
    if (fokPlan.remainder > 0n) {
      emitOrderRejected(ctx, order.orderId, "fok-unfillable", "triggered FOK stop cannot fill immediately");
      return;
    }
  }
  const plan = planAggressive(ctx, order.side, remaining, limitScaled);
  const rests = isStopLimit && tif === "GTC";
  emitTriggered(ctx, order.orderId, {
    executionKind: isStopLimit ? "limit" : "market",
    ...(isStopLimit ? { limitPrice: order.limitPrice } : {}),
    restingQuantity: rests ? plan.remainder : 0n,
    triggerPrice,
  });
  if (plan.matches.length > 0) {
    executeTakerPlan(ctx, order.orderId, order.side, filledBefore, plan.matches);
  }
  if (plan.remainder > 0n && (!isStopLimit || tif === "IOC")) {
    emitCanceled(ctx, order.orderId, "ioc-remainder");
  }
}

/** Merge a replace command into the successor submission input. */
export function successorInputOf(
  order: {
    readonly instrumentId: SubmissionInput["instrumentId"];
    readonly accountId: SubmissionInput["accountId"];
    readonly submittedBy: SubmissionInput["submittedBy"];
    readonly kind: SubmissionInput["kind"];
    readonly side: SubmissionInput["side"];
    readonly quantity: Quantity;
    readonly limitPrice?: Price;
    readonly stopPrice?: Price;
    readonly constraints: SubmissionInput["constraints"];
  },
  replacement: {
    readonly quantity?: Quantity;
    readonly limitPrice?: Price;
    readonly stopPrice?: Price;
    readonly constraints?: SubmissionInput["constraints"];
  },
): SubmissionInput | PrecheckRejection {
  const carriesLimit = order.kind === "limit" || order.kind === "stop-limit";
  const carriesStop = order.kind === "stop" || order.kind === "stop-limit";
  if (replacement.limitPrice !== undefined && !carriesLimit) {
    return reject("invalid-price", `cannot set a limit price on a ${order.kind} order`);
  }
  if (replacement.stopPrice !== undefined && !carriesStop) {
    return reject("invalid-price", `cannot set a stop price on a ${order.kind} order`);
  }
  const limitPrice = replacement.limitPrice ?? order.limitPrice;
  const stopPrice = replacement.stopPrice ?? order.stopPrice;
  return {
    instrumentId: order.instrumentId,
    accountId: order.accountId,
    submittedBy: order.submittedBy,
    kind: order.kind,
    side: order.side,
    quantity: replacement.quantity ?? order.quantity,
    ...(limitPrice === undefined ? {} : { limitPrice }),
    ...(stopPrice === undefined ? {} : { stopPrice }),
    constraints: replacement.constraints ?? order.constraints,
  };
}
