/**
 * The command lifecycle: validate → authorize → apply domain rules →
 * (the engine then mutates state by reducing the journaled events, publishes
 * projections and acks).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" and "Ports".
 * Spec: spec/ARCHITECTURE-LOCK.md A6 (event-driven truth), A13 (risk/
 * authorization/venue gates are runtime controls, never prompt text),
 * A15 + spec/ACCEPTANCE-WORLD-ALPHA.md K (typed denials).
 *
 * W014 SEAM (the honest boundary after W013+ W014):
 * - Implemented for real: add-annotation, set-scenario (world-core facts)
 *   and submit-order / cancel-order / replace-order through the typed
 *   matching seam (matching/seam.ts) — order kinds × TIF × policies are the
 *   matcher's domain (matching/submission.ts documents the matrix).
 * - Typed not-implemented-in-skeleton rejections at the domain-rules stage:
 *   close-position (W014 matching + W015 portfolio/risk), create-snapshot /
 *   branch-world (W016 snapshot/branch engine).
 */

import type {
  AuthorizeCommandResult,
  CommandRejection,
  CommandValidationErrorCode,
  OrderKind,
  ParticipantId,
  SequenceNumber,
  TimeInForce,
  ValidateCommandResult,
  WorldCommand,
} from "tradrl-world-contracts";
import type { CausationId, CorrelationId, TimestampMs } from "tradrl-world-contracts";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import type { PendingEventDraft } from "../journal/eventJournal.js";
import { applyMatchingCommand } from "../matching/index.js";
import type { ReduceOnlyPositionCheck } from "../matching/index.js";
import type { CancelOrderCommand, ReplaceOrderCommand, SubmitOrderCommand } from "tradrl-world-contracts";
import {
  ENGINE_EVENT_SCHEMA_VERSION,
  WORLD_CORE_PRODUCER,
} from "./events.js";
import type { AnnotationAddedPayload, ScenarioSetPayload } from "./events.js";
import type { WorldDefinition } from "./definition.js";
import { nextAnnotationId, type WorldState } from "./state.js";

/** What the lifecycle stages see (a read-only slice of the engine). */
export interface LifecycleContext {
  readonly definition: WorldDefinition;
  readonly state: WorldState;
  /** Current clock position — stamps emitted events (occurredAt). */
  readonly simulationTime: SimulationTimeMs;
  /**
   * W014 seam: the sequence the journal will assign this command's first
   * draft (cursor + 1). The matcher reserves dense sequences for its batch
   * so fill drafts can cite the trade events that generated them.
   */
  readonly nextSequence: SequenceNumber;
  /**
   * W015 seam: the reduce-only position check (absent ⇒ permissive — the
   * venue cannot verify position effects until the account engine wires
   * this callback; documented known limitation).
   */
  readonly reduceOnlyCheck?: ReduceOnlyPositionCheck;
}

/** The outcome of the lifecycle before the engine journals/reduces/acks. */
export type LifecycleOutcome =
  | { readonly kind: "applied"; readonly drafts: readonly PendingEventDraft[] }
  | { readonly kind: "rejected"; readonly rejection: CommandRejection };

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

/**
 * The `authorize` stage. World Alpha skeleton matrix:
 * - order-family commands and close-position: the participant may only act
 *   through their declared account (permission-denied otherwise) and the
 *   account must be tradable (account-not-tradable);
 * - world-ops (annotation/scenario/snapshot/branch): every declared
 *   participant is authorized;
 * - live-execution-not-permitted never fires here: World Alpha has no
 *   live-only command to deny (the code is reserved for the A14/K fail-closed
 *   boundary; `liveExecutionAllowed` is the literal false in every account).
 */
export function authorizeCommand(
  command: WorldCommand,
  ctx: LifecycleContext,
): AuthorizeCommandResult {
  const participant = ctx.definition.participants.find(
    (p) => p.participantId === command.issuedBy,
  );
  if (participant === undefined) {
    return {
      ok: false,
      denial: { code: "unauthorized-participant", message: "issuedBy is not a declared participant" },
    };
  }
  if (command.kind === "submit-order" || command.kind === "close-position") {
    if (command.accountId !== participant.accountId) {
      return {
        ok: false,
        denial: {
          code: "permission-denied",
          message: `participant ${String(command.issuedBy)} may only act through their declared account ${String(participant.accountId)}`,
        },
      };
    }
    const account = ctx.definition.accounts.find((a) => a.accountId === command.accountId);
    if (account === undefined) {
      return {
        ok: false,
        denial: { code: "account-not-tradable", message: "account is not declared" },
      };
    }
    if (account.permissions.canTrade === false) {
      return {
        ok: false,
        denial: {
          code: "account-not-tradable",
          message: `account ${String(account.accountId)} has canTrade=false`,
        },
      };
    }
  }
  return { ok: true };
}

function notImplemented(operation: string, detail: string): LifecycleOutcome {
  return {
    kind: "rejected",
    rejection: { stage: "domain-rules", code: "not-implemented-in-skeleton", message: `${operation} ${detail}` },
  };
}

function draft(
  command: WorldCommand,
  ctx: LifecycleContext,
  eventType: string,
  payload: AnnotationAddedPayload | ScenarioSetPayload,
): PendingEventDraft {
  return {
    eventType,
    occurredAt: ctx.simulationTime as TimestampMs,
    // An uncorrelated command correlates with itself (the envelope contract
    // has no optional correlation slot).
    // commandId IS the causation identity for command-caused events; the
    // brands differ only to keep unrelated ids apart (double-cast is the
    // engine's canonical crossing point).
    causationId: command.commandId as unknown as CausationId,
    correlationId: (command.correlationId ?? command.commandId) as unknown as CorrelationId,
    producer: WORLD_CORE_PRODUCER,
    schemaVersion: ENGINE_EVENT_SCHEMA_VERSION,
    payload,
  };
}

/**
 * The `apply domain rules` stage. Implemented kinds return the ordered event
 * drafts the engine will journal (the mutation itself happens by reducing
 * those events — single path with replay); order commands delegate to the
 * typed matching seam; unimplemented kinds return the honest typed stub
 * rejection naming the owning work order.
 */
export function applyCommand(command: WorldCommand, ctx: LifecycleContext): LifecycleOutcome {
  switch (command.kind) {
    case "add-annotation": {
      const payload: AnnotationAddedPayload = {
        type: "world.annotation.added",
        annotationId: nextAnnotationId(ctx.definition.scope.worldId, ctx.state),
        issuedBy: command.issuedBy as ParticipantId,
        ...(command.instrumentId === undefined ? {} : { instrumentId: command.instrumentId }),
        at: command.at as TimestampMs,
        text: command.text,
      };
      return { kind: "applied", drafts: [draft(command, ctx, "world.annotation.added", payload)] };
    }
    case "set-scenario": {
      const payload: ScenarioSetPayload = {
        type: "world.scenario.set",
        issuedBy: command.issuedBy as ParticipantId,
        ...(command.scenario.label === undefined ? {} : { label: command.scenario.label }),
        entries: command.scenario.entries,
      };
      return { kind: "applied", drafts: [draft(command, ctx, "world.scenario.set", payload)] };
    }
    case "submit-order":
    case "cancel-order":
    case "replace-order": {
      // THE W014 SEAM: the world core hands order commands to the matching
      // engine (typed contract in matching/seam.ts). The engine journals the
      // returned drafts and reduces them through the same reducer the
      // matcher advanced its working copy through.
      return applyMatchingCommand(command as SubmitOrderCommand | CancelOrderCommand | ReplaceOrderCommand, {
        definition: ctx.definition,
        matching: ctx.state.matching,
        simulationTime: ctx.simulationTime,
        nextSequence: ctx.nextSequence,
        ...(ctx.reduceOnlyCheck === undefined ? {} : { reduceOnlyCheck: ctx.reduceOnlyCheck }),
      });
    }
    case "close-position":
      return notImplemented(
        "close-position:",
        "requires positions and financial state (W015: packages/tradrl-world-sim/portfolio) plus matching (W014); the W013 skeleton implements the command lifecycle, not the domain rules",
      );
    case "create-snapshot":
    case "branch-world":
      return notImplemented(
        `${command.kind}:`,
        "requires the snapshot/branch engine (W016: packages/tradrl-world-sim/snapshot, branch); history stays immutable and journaled in the skeleton",
      );
  }
}

/**
 * Run validate → authorize → apply. Returns either the event draft to
 * journal or the typed rejection with the failing stage. The ENGINE then
 * appends, reduces state, publishes projections and acks
 * (spec/WORLD-PROTOCOL.md "Command lifecycle").
 */
export function runCommandLifecycle(
  command: WorldCommand,
  ctx: LifecycleContext,
): LifecycleOutcome {
  const validation = validateCommand(command, ctx);
  if (!validation.ok) {
    // The rejection code is the first error; the message carries all of them.
    const first = validation.errors[0]!;
    return {
      kind: "rejected",
      rejection: {
        stage: "validate",
        code: first.code,
        message: validation.errors.map((e) => e.message).join("; "),
      },
    };
  }
  const authorization = authorizeCommand(command, ctx);
  if (!authorization.ok) {
    return {
      kind: "rejected",
      rejection: {
        stage: "authorize",
        code: authorization.denial.code,
        message: authorization.denial.message,
      },
    };
  }
  return applyCommand(command, ctx);
}
