/**
 * Portfolio identity + close-position command builders — W011 (pure).
 *
 * The W010 `orderTicket.ts` identity/command pattern applied to the
 * financial surfaces: the trader identity is COMPOSITION CONFIG (opaque W003
 * ids, never parsed), the alpha attachment convention
 * (`runtime/engineAttachment.ts`: `participant-trader-<worldId>` /
 * `account-trader-<worldId>`), and the positions surface's Close action
 * terminates at the REAL `command.closePosition` — a typed CommandPort call
 * whose value (ack with journal cursor, or typed rejection code) is always
 * the verdict that matters (ARCHITECTURE-LOCK A4/A15: human and agent
 * actions terminate at the same CommandPort).
 */

import type {
  ClosePositionCommand,
  CommandId,
  CommandResult,
  ParticipantId,
  AccountId,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";

/** The trader identity the financial surfaces project/act as. */
export interface PortfolioIdentity {
  readonly participantId: ParticipantId;
  readonly accountId: AccountId;
}

/** Identity or a per-worldId resolver (the alpha attachment convention). */
export type PortfolioIdentitySpec = PortfolioIdentity | ((worldId: string) => PortfolioIdentity);

/**
 * The alpha world convention (runtime/engineAttachment.ts): the human
 * trader's participant/account, derived from the pane's opaque worldId.
 */
export function alphaTraderPortfolioIdentity(worldId: string): PortfolioIdentity {
  return {
    participantId: `participant-trader-${worldId}` as ParticipantId,
    accountId: `account-trader-${worldId}` as AccountId,
  };
}

export const ALPHA_TRADER_PORTFOLIO_IDENTITY: PortfolioIdentitySpec =
  alphaTraderPortfolioIdentity;

/** Resolve the identity spec for one pane world. */
export function resolvePortfolioIdentity(
  spec: PortfolioIdentitySpec,
  worldId: string,
): PortfolioIdentity {
  return typeof spec === "function" ? spec(worldId) : spec;
}

/** Fresh UI command id (unique per submission, never parsed). */
export function newPortfolioCommandId(prefix: string): CommandId {
  const entropy = Math.random().toString(36).slice(2, 10);
  return `ui-${prefix}-${Date.now().toString(36)}-${entropy}` as CommandId;
}

/** Build the real ClosePositionCommand for one instrument's position. */
export function buildClosePositionCommand(input: {
  readonly identity: PortfolioIdentity;
  readonly worldId: string;
  readonly instrumentId: string;
  readonly commandId: CommandId;
  readonly issuedAt: TimestampMs;
}): ClosePositionCommand {
  return {
    kind: "close-position",
    commandId: input.commandId,
    worldId: input.worldId as WorldId,
    issuedBy: input.identity.participantId,
    issuedAt: input.issuedAt,
    accountId: input.identity.accountId,
    instrumentId: input.instrumentId as never,
  };
}

/** A displayed command outcome (engine typed value or thrown error). */
export interface PortfolioCommandOutcomeCapsule {
  readonly kind: "acked" | "rejected" | "error";
  readonly text: string;
  readonly code?: string;
}

/** Describe an engine CommandResult for display (typed value, never a guess). */
export function describePortfolioCommandOutcome(result: CommandResult): PortfolioCommandOutcomeCapsule {
  if (result.status === "acked") {
    return {
      kind: "acked",
      text: `close-position acked · journal cursor ${String(result.ack.journalCursor)} · ${result.ack.commandId}`,
    };
  }
  return {
    kind: "rejected",
    code: result.rejection.code,
    text: `close-position rejected (${result.rejection.stage}) · ${result.rejection.code}`,
  };
}

/** Describe a thrown command error (transport/typed remote error). */
export function describePortfolioCommandError(error: unknown): PortfolioCommandOutcomeCapsule {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "Error";
  return { kind: "error", text: `${name}: ${message}` };
}
