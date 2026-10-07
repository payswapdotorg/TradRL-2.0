/**
 * The close-position seam (W015 `portfolio` module): CommandPort
 * close-position applied as a venue MARKET order for the open quantity —
 * the position reduces through the exact W014 matching path (fees, latency,
 * causal fills), never a synthetic balance edit.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" (the apply stage may
 * delegate: this seam synthesizes the submission and hands it to the
 * matching seam), spec/ACCEPTANCE-WORLD-ALPHA.md C (position update via
 * execution), spec/DOMAIN-MODEL.md (positions from fills).
 *
 * POLICY (documented, deterministic):
 * - The synthesized order is a reduce-only IOC MARKET order for |quantity|:
 *   market because a close must not rest; IOC because any unfilled
 *   remainder cancels (a close into an empty/halted book is the venue's
 *   honest answer — the ack journals the attempt and the cancellation);
 *   reduce-only because the direction is inherently closing.
 * - A flat position (or none) rejects at domain rules with the typed
 *   `no-open-position` code — there is nothing to close.
 * - Causality: the synthesized order's events cite the close-position
 *   command id (commandId IS the causation identity — engine convention).
 */

import type { CommandRejection, ClosePositionCommand, SubmitOrderCommand } from "tradrl-world-contracts";
import { applyMatchingCommand, type MatchingCommandContext, type MatchingCommandOutcome } from "../matching/index.js";
import { formatSignedMoney } from "./decimal.js";
import { positionOf, type PortfolioState } from "./state.js";

/** The open signed quantity of one (account, instrument) ledger, or none. */
export function openQuantityOf(
  portfolio: PortfolioState,
  accountId: string,
  instrumentId: string,
): { readonly quantity: string; readonly side: "long" | "short" } | undefined {
  const record = positionOf(portfolio, accountId as never, instrumentId as never);
  if (record === undefined || record.quantity === 0n) {
    return undefined;
  }
  return {
    quantity: formatSignedMoney(record.quantity > 0n ? record.quantity : -record.quantity),
    side: record.quantity > 0n ? "long" : "short",
  };
}

/**
 * Apply a close-position command: locate the open position, synthesize the
 * reducing market submission, delegate to the matching seam. Returns the
 * matcher's drafts or the typed rejection.
 */
export function applyClosePosition(
  command: ClosePositionCommand,
  ctx: {
    readonly portfolio: PortfolioState;
    readonly matching: MatchingCommandContext;
  },
): MatchingCommandOutcome {
  const open = openQuantityOf(ctx.portfolio, String(command.accountId), String(command.instrumentId));
  if (open === undefined) {
    const rejection: CommandRejection = {
      stage: "domain-rules",
      code: "no-open-position",
      message:
        `account ${String(command.accountId)} has no open position in ` +
        `${String(command.instrumentId)} — nothing to close`,
    };
    return { kind: "rejected", rejection };
  }
  const submission: SubmitOrderCommand = {
    kind: "submit-order",
    commandId: command.commandId,
    worldId: command.worldId,
    issuedBy: command.issuedBy,
    issuedAt: command.issuedAt,
    ...(command.correlationId === undefined ? {} : { correlationId: command.correlationId }),
    accountId: command.accountId,
    instrumentId: command.instrumentId,
    submission: {
      kind: "market",
      side: open.side === "long" ? "sell" : "buy",
      quantity: open.quantity as never,
      constraints: { timeInForce: "IOC", reduceOnly: true },
    },
  };
  return applyMatchingCommand(submission, ctx.matching);
}
