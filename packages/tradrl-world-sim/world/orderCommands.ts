/**
 * The order-family command application (the W014/W015 world seams): the
 * `apply domain rules` stage for submit-order / replace-order /
 * cancel-order / close-position.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" (the apply stage
 * delegates to the typed seams), spec/ARCHITECTURE-LOCK.md A13 (the
 * pre-trade gates are runtime controls, never prompt text),
 * spec/DOMAIN-MODEL.md (positions come from fills — a close routes through
 * the venue, never a balance edit).
 *
 * Split out of lifecycle.ts when W015's pre-trade stage pushed it past the
 * repo's 400-line max-lines law (the same precedent as W014's
 * matching/state.ts → reducer.ts + marketFacts.ts): validate/authorize and
 * the world-ops drafts stay in lifecycle.ts; this module owns everything
 * that routes through the venue.
 *
 * THE W015 PRE-TRADE STAGE (documented domain-check order):
 * - submit-order: account acceptance (margin/buying power, canShort) then
 *   the risk gate (declared limits, typed RiskCheckOutcome evidence) BEFORE
 *   the venue sees the submission; rejections are typed values — nothing is
 *   journaled, nothing mutates.
 * - replace-order: the successor submission is a NEW exposure — gated after
 *   the ownership check (the seam still owns the unauthorized rejection;
 *   the gate only runs for the issuer's own orders).
 * - cancel-order: straight to the venue (cancelling frees margin/risk).
 * - close-position: the position closes through the venue — a reduce-only
 *   IOC MARKET order for the open quantity (real fills, real fees, real
 *   causality). A close cannot increase exposure, so the pre-trade gate
 *   does not apply (a drawdown-breached account may always reduce).
 */

import type {
  CancelOrderCommand,
  ClosePositionCommand,
  CommandRejection,
  OrderKind,
  ReplaceOrderCommand,
  SubmitOrderCommand,
} from "tradrl-world-contracts";
import { applyMatchingCommand, successorInputOf } from "../matching/index.js";
import { computeAccountFinancials, ledgerOf } from "../account/index.js";
import { applyClosePosition } from "../portfolio/index.js";
import { runPreTradeChecks } from "../risk/index.js";
import type { LifecycleContext, LifecycleOutcome } from "./lifecycle.js";

/** The submission facts the W015 pre-trade checks evaluate. */
interface PreTradeOrderInput {
  readonly accountId: string;
  readonly instrumentId: string;
  readonly kind: OrderKind;
  readonly side: "buy" | "sell";
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly stopPrice?: string;
}

/**
 * The W015 pre-trade checks for one submission against the live financial
 * state (account acceptance + risk gate). Unknown accounts/instruments
 * return undefined — validate owns those rejections. Structural problems
 * pass through — the venue prechecks own those.
 */
function preTradeRejection(
  order: PreTradeOrderInput,
  ctx: LifecycleContext,
): CommandRejection | undefined {
  const financial = ctx.state.financial;
  const ledger = ledgerOf(financial.accounts, order.accountId as never);
  const book = ctx.state.matching.books[String(order.instrumentId)];
  if (ledger === undefined || book === undefined) {
    return undefined;
  }
  const positions = financial.portfolio.positions.filter(
    (record) => String(record.accountId) === order.accountId,
  );
  const financials = computeAccountFinancials(ledger, positions);
  return runPreTradeChecks({
    ledger,
    financials,
    positions,
    risk: financial.risk,
    book,
    order,
  });
}

/** The W014 matching-seam context the engine builds for one command. */
function matchingContext(ctx: LifecycleContext) {
  return {
    definition: ctx.definition,
    matching: ctx.state.matching,
    simulationTime: ctx.simulationTime,
    nextSequence: ctx.nextSequence,
    ...(ctx.reduceOnlyCheck === undefined ? {} : { reduceOnlyCheck: ctx.reduceOnlyCheck }),
  };
}

/**
 * Apply one order-family command: the W015 pre-trade stage (where it
 * applies) then the typed W014 matching seam. Returns the matcher's event
 * drafts or the typed rejection.
 */
export function applyOrderCommand(
  command: SubmitOrderCommand | ReplaceOrderCommand | CancelOrderCommand | ClosePositionCommand,
  ctx: LifecycleContext,
): LifecycleOutcome {
  switch (command.kind) {
    case "submit-order": {
      // THE W015 PRE-TRADE STAGE: account acceptance + risk gate before the
      // venue sees the submission (A13 runtime controls; rejections are
      // typed values — nothing is journaled, nothing mutates).
      const rejected = preTradeRejection(
        {
          accountId: command.accountId,
          instrumentId: command.instrumentId,
          kind: command.submission.kind,
          side: command.submission.side,
          quantity: command.submission.quantity,
          ...(command.submission.limitPrice === undefined
            ? {}
            : { limitPrice: command.submission.limitPrice }),
          ...(command.submission.stopPrice === undefined
            ? {}
            : { stopPrice: command.submission.stopPrice }),
        },
        ctx,
      );
      if (rejected !== undefined) {
        return { kind: "rejected", rejection: rejected };
      }
      return applyMatchingCommand(command, matchingContext(ctx));
    }
    case "replace-order": {
      // The successor submission is a NEW exposure: gate it after the
      // ownership check (the seam still owns the unauthorized rejection —
      // the gate only runs for the issuer's own orders).
      const target = ctx.state.matching.orders.find((order) => order.orderId === command.orderId);
      const participant = ctx.definition.participants.find(
        (candidate) => candidate.participantId === command.issuedBy,
      );
      if (target !== undefined && participant !== undefined && participant.accountId === target.accountId) {
        const successor = successorInputOf(target, command);
        if (!("reason" in successor)) {
          const rejected = preTradeRejection(
            {
              accountId: successor.accountId,
              instrumentId: successor.instrumentId,
              kind: successor.kind,
              side: successor.side,
              quantity: successor.quantity,
              ...(successor.limitPrice === undefined ? {} : { limitPrice: successor.limitPrice }),
              ...(successor.stopPrice === undefined ? {} : { stopPrice: successor.stopPrice }),
            },
            ctx,
          );
          if (rejected !== undefined) {
            return { kind: "rejected", rejection: rejected };
          }
        }
      }
      return applyMatchingCommand(command, matchingContext(ctx));
    }
    case "cancel-order":
      return applyMatchingCommand(command, matchingContext(ctx));
    case "close-position":
      // W015: the position closes through the venue — a reducing IOC market
      // order (real fills, real fees, real causality), never a balance edit.
      // A close cannot increase exposure, so the pre-trade gate does not
      // apply (a drawdown-breached account may always reduce).
      return applyClosePosition(command, {
        portfolio: ctx.state.financial.portfolio,
        matching: matchingContext(ctx),
      });
  }
}
