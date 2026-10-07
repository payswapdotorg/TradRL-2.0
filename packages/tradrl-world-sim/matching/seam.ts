/**
 * THE TYPED SEAM between the world core (W013 `world/lifecycle.ts`) and the
 * matching engine (W014 `matching/`) — the single integration point.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — the world core's
 * `apply domain rules` stage delegates submit-order/cancel-order/
 * replace-order here; the engine then journals the returned drafts, reduces
 * state through the SAME reducer the matcher used, publishes projections
 * and acks (A6). Spec: spec/ARCHITECTURE-LOCK.md A13 — venue policy and
 * execution gates are runtime controls.
 *
 * SEAM CONTRACT:
 * - INPUT: the static definition (instruments + optional venues), the
 *   current matching state (order registry, books, fills, trades, armed
 *   stops), the command's simulation time, the NEXT journal sequence
 *   (sequence reservation: the matcher's drafts will be sealed at
 *   nextSequence, nextSequence+1, … so fills can cite trade sequences),
 *   and the optional reduce-only position check (W015 wires it later —
 *   absent means permissive/structural-only, a documented limitation).
 * - OUTPUT: either the ordered event drafts to journal (the state was
 *   already advanced on the matcher's working copy through the same
 *   reducer replay uses — the engine's reduce is the authority), or a
 *   typed domain-rules rejection (nothing journaled).
 *
 * The world core passes `state.matching` here; `world/state.ts` embeds the
 * matching slice and delegates reduction of matching/market event types to
 * `reduceMatchingEvent` — see matching/state.ts for the single-path law.
 */

import type {
  CancelOrderCommand,
  CommandRejection,
  OrderId,
  ReplaceOrderCommand,
  SequenceNumber,
  SubmitOrderCommand,
  TimestampMs,
} from "tradrl-world-contracts";
import type { PendingEventDraft } from "../journal/eventJournal.js";
import type { Instrument } from "tradrl-world-contracts";
import type { WorldDefinition } from "../world/definition.js";
import type { CausationId, CorrelationId } from "tradrl-world-contracts";
import {
  MatchContext,
  emitBookDelta,
  emitCanceled,
  emitReplaced,
  type ReduceOnlyPositionCheck,
  type SubmissionInput,
} from "./matcher.js";
import { resolveVenuePolicy } from "./policy.js";
import type { MatchingState } from "./state.js";
import {
  executeSubmission,
  precheckSubmission,
  successorInputOf,
  type PrecheckRejection,
} from "./submission.js";

/** What the world core hands the matcher for one order command. */
export interface MatchingCommandContext {
  readonly definition: WorldDefinition;
  readonly matching: MatchingState;
  readonly simulationTime: TimestampMs;
  /** The sequence the journal will assign the first draft of this batch. */
  readonly nextSequence: SequenceNumber;
  /** The W015 reduce-only seam (absent ⇒ permissive, structural-only). */
  readonly reduceOnlyCheck?: ReduceOnlyPositionCheck;
}

/** The outcome shape the world lifecycle consumes (structuralLifecycleOutcome). */
export type MatchingCommandOutcome =
  | { readonly kind: "applied"; readonly drafts: readonly PendingEventDraft[] }
  | { readonly kind: "rejected"; readonly rejection: CommandRejection };

function domainRejection(precheck: PrecheckRejection): MatchingCommandOutcome {
  return {
    kind: "rejected",
    rejection: { stage: "domain-rules", code: precheck.reason, message: precheck.message },
  };
}

function contextFor(
  command: SubmitOrderCommand | CancelOrderCommand | ReplaceOrderCommand,
  base: MatchingCommandContext,
  instrument: Instrument,
): MatchContext {
  return new MatchContext({
    definition: base.definition,
    instrument,
    policy: resolveVenuePolicy(base.definition, instrument),
    matching: base.matching,
    simulationTime: base.simulationTime,
    nextSequence: base.nextSequence,
    // commandId IS the causation identity for command-caused events; the
    // brands differ only to keep unrelated ids apart (engine convention).
    causationId: command.commandId as unknown as CausationId,
    correlationId: (command.correlationId ?? command.commandId) as unknown as CorrelationId,
    ...(base.reduceOnlyCheck === undefined ? {} : { reduceOnlyCheck: base.reduceOnlyCheck }),
  });
}

function instrumentOf(base: MatchingCommandContext, instrumentId: Instrument["instrumentId"]): Instrument {
  // existence is validated upstream (validate stage: unknown-instrument)
  const instrument = base.definition.instruments.find(
    (candidate) => candidate.instrumentId === instrumentId,
  );
  if (instrument === undefined) {
    throw new Error(`matching seam: instrument ${String(instrumentId)} vanished after validation`);
  }
  return instrument;
}

function findOrder(ctx: MatchContext, orderId: OrderId) {
  const order = ctx.working.orders.find((candidate) => candidate.orderId === orderId);
  if (order === undefined) {
    throw new Error(`matching seam: order ${String(orderId)} vanished after validation`);
  }
  return order;
}

/**
 * A13 runtime control the command contract cannot express (cancel/replace
 * carry no account field): the target order must belong to the issuer's
 * declared account — a participant may only modify their own orders.
 */
function assertOwnership(
  base: MatchingCommandContext,
  order: { readonly accountId: string; readonly orderId: OrderId },
  issuedBy: string,
): CommandRejection | undefined {
  const participant = base.definition.participants.find(
    (candidate) => candidate.participantId === issuedBy,
  );
  if (participant === undefined || participant.accountId !== order.accountId) {
    return {
      stage: "domain-rules",
      code: "unauthorized",
      message: `order ${String(order.orderId)} does not belong to ${String(issuedBy)}'s declared account`,
    };
  }
  return undefined;
}

function notModifiable(orderId: OrderId, status: string): CommandRejection {
  return {
    stage: "domain-rules",
    code: "order-not-modifiable",
    message: `order ${String(orderId)} is ${status} and cannot be modified`,
  };
}

function submitOrder(
  command: SubmitOrderCommand,
  base: MatchingCommandContext,
): MatchingCommandOutcome {
  const ctx = contextFor(command, base, instrumentOf(base, command.instrumentId));
  const before = ctx.book;
  const input: SubmissionInput = {
    instrumentId: command.instrumentId,
    accountId: command.accountId,
    submittedBy: command.issuedBy,
    kind: command.submission.kind,
    side: command.submission.side,
    quantity: command.submission.quantity,
    ...(command.submission.limitPrice === undefined
      ? {}
      : { limitPrice: command.submission.limitPrice }),
    ...(command.submission.stopPrice === undefined
      ? {}
      : { stopPrice: command.submission.stopPrice }),
    constraints: command.submission.constraints,
  };
  const precheck = precheckSubmission(ctx, input);
  if (precheck !== undefined) {
    return domainRejection(precheck);
  }
  executeSubmission(ctx, input, ctx.nextOrderId());
  emitBookDelta(ctx, before);
  return { kind: "applied", drafts: ctx.drafts };
}

function cancelOrder(
  command: CancelOrderCommand,
  base: MatchingCommandContext,
): MatchingCommandOutcome {
  const ctx = contextFor(command, base, instrumentOf(base, findInstrumentId(base, command.orderId)));
  const before = ctx.book;
  const order = findOrder(ctx, command.orderId);
  const ownership = assertOwnership(base, order, command.issuedBy);
  if (ownership !== undefined) {
    return { kind: "rejected", rejection: ownership };
  }
  if (order.status === "filled" || order.status === "canceled" || order.status === "rejected" || order.status === "expired" || order.status === "replaced") {
    return { kind: "rejected", rejection: notModifiable(command.orderId, order.status) };
  }
  emitCanceled(ctx, command.orderId, "user-request");
  emitBookDelta(ctx, before);
  return { kind: "applied", drafts: ctx.drafts };
}

function replaceOrder(
  command: ReplaceOrderCommand,
  base: MatchingCommandContext,
): MatchingCommandOutcome {
  const ctx = contextFor(command, base, instrumentOf(base, findInstrumentId(base, command.orderId)));
  const before = ctx.book;
  const order = findOrder(ctx, command.orderId);
  const ownership = assertOwnership(base, order, command.issuedBy);
  if (ownership !== undefined) {
    return { kind: "rejected", rejection: ownership };
  }
  if (order.status === "filled" || order.status === "canceled" || order.status === "rejected" || order.status === "expired" || order.status === "replaced") {
    return { kind: "rejected", rejection: notModifiable(command.orderId, order.status) };
  }
  const successor = successorInputOf(order, command);
  if ("reason" in successor) {
    return domainRejection(successor);
  }
  const precheck = precheckSubmission(ctx, successor);
  if (precheck !== undefined) {
    return domainRejection(precheck);
  }
  const successorOrderId = ctx.nextOrderId();
  emitReplaced(ctx, command.orderId, successorOrderId);
  executeSubmission(ctx, successor, successorOrderId);
  emitBookDelta(ctx, before);
  return { kind: "applied", drafts: ctx.drafts };
}

function findInstrumentId(base: MatchingCommandContext, orderId: OrderId): Instrument["instrumentId"] {
  const order = base.matching.orders.find((candidate) => candidate.orderId === orderId);
  if (order === undefined) {
    throw new Error(`matching seam: order ${String(orderId)} vanished after validation`);
  }
  return order.instrumentId;
}

/**
 * Apply one order command through the matching engine. Pure with respect to
 * the inputs; returns the drafts to journal or the typed rejection.
 */
export function applyMatchingCommand(
  command: SubmitOrderCommand | CancelOrderCommand | ReplaceOrderCommand,
  base: MatchingCommandContext,
): MatchingCommandOutcome {
  switch (command.kind) {
    case "submit-order":
      return submitOrder(command, base);
    case "cancel-order":
      return cancelOrder(command, base);
    case "replace-order":
      return replaceOrder(command, base);
  }
}
