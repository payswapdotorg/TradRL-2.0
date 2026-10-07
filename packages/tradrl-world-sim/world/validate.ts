/**
 * The `validate` lifecycle stage (structural + reference checks, W003's
 * error codes), split out of lifecycle.ts when W015's pre-trade stage pushed
 * that file past the repo's 400-line max-lines law (the same precedent as
 * W014's matching/state.ts → reducer.ts + marketFacts.ts and W015's
 * lifecycle.ts → orderCommands.ts). The stage order (validate → authorize →
 * apply) is unchanged; lifecycle.ts orchestrates.
 */

import type {
  CommandValidationErrorCode,
  OrderKind,
  TimeInForce,
  ValidateCommandResult,
  WorldCommand,
} from "tradrl-world-contracts";
import type { LifecycleContext } from "./lifecycle.js";

const ORDER_KINDS: readonly OrderKind[] = ["market", "limit", "stop", "stop-limit"];
const TIME_IN_FORCE: readonly TimeInForce[] = ["GTC", "IOC", "FOK"];

function error(code: CommandValidationErrorCode, message: string, field?: string) {
  return { code, message, ...(field === undefined ? {} : { field }) };
}

function isPositiveDecimalString(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  );
}

/** The `validate` stage: structural + reference checks (W003's error codes). */
export function validateCommand(
  command: WorldCommand,
  ctx: LifecycleContext,
): ValidateCommandResult {
  const errors: { code: CommandValidationErrorCode; message: string; field?: string }[] = [];
  const definition = ctx.definition;

  if (typeof command.commandId !== "string" || command.commandId.length === 0) {
    errors.push(error("malformed-command", "commandId must be a non-empty string", "commandId"));
  }
  if (typeof command.issuedBy !== "string" || command.issuedBy.length === 0) {
    errors.push(error("malformed-command", "issuedBy must be a non-empty string", "issuedBy"));
  }
  if (!Number.isFinite(command.issuedAt)) {
    errors.push(error("malformed-command", "issuedAt must be a finite timestamp", "issuedAt"));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (command.worldId !== definition.scope.worldId) {
    return {
      ok: false,
      errors: [error("unknown-world", `command targets ${String(command.worldId)}`)],
    };
  }

  // per-kind structural validation (malformed-command)
  switch (command.kind) {
    case "submit-order": {
      const submission = command.submission;
      if (!ORDER_KINDS.includes(submission?.kind)) {
        errors.push(error("malformed-command", "submission.kind must be an OrderKind", "submission.kind"));
      }
      if (submission?.side !== "buy" && submission?.side !== "sell") {
        errors.push(error("malformed-command", "submission.side must be buy or sell", "submission.side"));
      }
      if (!isPositiveDecimalString(submission?.quantity)) {
        errors.push(error("malformed-command", "submission.quantity must be a positive decimal string", "submission.quantity"));
      }
      if (!TIME_IN_FORCE.includes(submission?.constraints?.timeInForce)) {
        errors.push(error("malformed-command", "constraints.timeInForce must be GTC, IOC or FOK", "submission.constraints.timeInForce"));
      }
      if (submission?.kind === "limit" || submission?.kind === "stop-limit") {
        if (!isPositiveDecimalString(submission?.limitPrice)) {
          errors.push(error("malformed-command", `${submission.kind} requires a positive limitPrice`, "submission.limitPrice"));
        }
      }
      if (submission?.kind === "stop" || submission?.kind === "stop-limit") {
        if (!isPositiveDecimalString(submission?.stopPrice)) {
          errors.push(error("malformed-command", `${submission.kind} requires a positive stopPrice`, "submission.stopPrice"));
        }
      }
      break;
    }
    case "cancel-order":
    case "replace-order": {
      if (typeof command.orderId !== "string" || command.orderId.length === 0) {
        errors.push(error("malformed-command", "orderId must be a non-empty string", "orderId"));
      }
      if (command.kind === "replace-order" && command.quantity !== undefined) {
        if (!isPositiveDecimalString(command.quantity)) {
          errors.push(error("malformed-command", "quantity, when present, must be a positive decimal string", "quantity"));
        }
      }
      break;
    }
    case "close-position": {
      if (typeof command.accountId !== "string" || command.accountId.length === 0) {
        errors.push(error("malformed-command", "accountId must be a non-empty string", "accountId"));
      }
      if (typeof command.instrumentId !== "string" || command.instrumentId.length === 0) {
        errors.push(error("malformed-command", "instrumentId must be a non-empty string", "instrumentId"));
      }
      break;
    }
    case "add-annotation": {
      if (!Number.isFinite(command.at)) {
        errors.push(error("malformed-command", "at must be a finite timestamp", "at"));
      }
      if (typeof command.text !== "string" || command.text.trim().length === 0) {
        errors.push(error("malformed-command", "text must be a non-blank string", "text"));
      }
      break;
    }
    case "create-snapshot":
      break;
    case "branch-world": {
      if (typeof command.sourceSnapshotId !== "string" || command.sourceSnapshotId.length === 0) {
        errors.push(error("malformed-command", "sourceSnapshotId must be a non-empty string", "sourceSnapshotId"));
      }
      break;
    }
    case "set-scenario": {
      if (!Array.isArray(command.scenario?.entries)) {
        errors.push(error("malformed-command", "scenario.entries must be an array", "scenario.entries"));
      } else {
        for (const entry of command.scenario.entries) {
          const regime = (entry as { regime?: unknown })?.regime;
          if (
            regime !== "trend" &&
            regime !== "mean-reversion" &&
            regime !== "high-volatility" &&
            regime !== "low-liquidity" &&
            regime !== "shock" &&
            regime !== "halt-reopen"
          ) {
            errors.push(error("malformed-command", `scenario entry regime '${String(regime)}' is not a RegimeKind`, "scenario.entries.regime"));
            break;
          }
          const from = (entry as { from?: unknown })?.from;
          if (typeof from !== "number" || !Number.isFinite(from)) {
            errors.push(error("malformed-command", "scenario entry from must be finite", "scenario.entries.from"));
            break;
          }
          const to = (entry as { to?: unknown })?.to;
          if (to !== undefined && (typeof to !== "number" || !Number.isFinite(to) || (to as number) < (from as number))) {
            errors.push(error("malformed-command", "scenario entry to, when present, must be finite and not precede from", "scenario.entries.to"));
            break;
          }
        }
      }
      break;
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // reference validation against the world definition + current state
  if (!definition.participants.some((p) => p.participantId === command.issuedBy)) {
    return {
      ok: false,
      errors: [error("unknown-participant", `participant ${String(command.issuedBy)} is not declared in this world`)],
    };
  }
  if (command.kind === "submit-order" || command.kind === "close-position") {
    if (!definition.instruments.some((i) => i.instrumentId === command.instrumentId)) {
      errors.push(error("unknown-instrument", `instrument ${String(command.instrumentId)} is not declared in this world`, "instrumentId"));
    }
  }
  if (command.kind === "submit-order" || command.kind === "close-position") {
    if (!definition.accounts.some((a) => a.accountId === command.accountId)) {
      errors.push(error("unknown-account", `account ${String(command.accountId)} is not declared in this world`, "accountId"));
    }
  }
  if (command.kind === "add-annotation" && command.instrumentId !== undefined) {
    if (!definition.instruments.some((i) => i.instrumentId === command.instrumentId)) {
      errors.push(error("unknown-instrument", `instrument ${String(command.instrumentId)} is not declared in this world`, "instrumentId"));
    }
  }
  if (command.kind === "cancel-order" || command.kind === "replace-order") {
    // Unknown order ids are the honest validate-stage rejection; the
    // matcher's domain rules own order-not-modifiable (terminal targets).
    if (!ctx.state.matching.orders.some((o) => o.orderId === command.orderId)) {
      errors.push(error("unknown-order", `order ${String(command.orderId)} does not exist in this world`, "orderId"));
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  if (ctx.state.ackedCommandIds.has(command.commandId)) {
    return {
      ok: false,
      errors: [
        error("duplicate-command", `command ${String(command.commandId)} was already acknowledged`),
      ],
    };
  }
  return { ok: true };
}
