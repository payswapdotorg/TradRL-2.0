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
 * W015 SEAM (the financial stage, additive on the W013/W014 stages):
 * - submit-order / replace-order pass the W015 pre-trade checks AFTER
 *   validate/authorize and BEFORE the venue: the account acceptance check
 *   (margin/buying power, canShort) then the risk gate (declared limits,
 *   typed RiskCheckOutcome evidence). Structural problems pass through to
 *   the venue's own prechecks (the documented domain-check order).
 * - close-position applies as a reducing IOC market order through the W014
 *   matching seam (positions reduce via real fills — never a balance edit).
 * - Implemented since W013/W014: add-annotation, set-scenario and the
 *   order commands through the typed matching seam (world/orderCommands.ts).
 * W016 SEAMS: create-snapshot / branch-world are real — the snapshot seam
 *   captures the world at the current journal position (content-addressed)
 *   and the branch seam validates the source snapshot and drafts the
 *   parent-journaled branch record. Every command kind is implemented; the
 *   validate stage lives in world/validate.ts (the W015 split).
 */

import type {
  AuthorizeCommandResult,
  CommandRejection,
  ParticipantId,
  SequenceNumber,
  WorldCommand,
} from "tradrl-world-contracts";
import type { CausationId, CorrelationId, TimestampMs } from "tradrl-world-contracts";
import type { SimulationTimeMs } from "tradrl-world-contracts/time";
import type { EventJournal, PendingEventDraft } from "../journal/eventJournal.js";
import type { ReduceOnlyPositionCheck } from "../matching/index.js";
import type { CancelOrderCommand, ClosePositionCommand, ReplaceOrderCommand, SubmitOrderCommand } from "tradrl-world-contracts";
import type { CreateSnapshotCommand, SnapshotId } from "tradrl-world-contracts";
import type { WorldSnapshot } from "../snapshot/capture.js";
import { applyCreateSnapshotCommand } from "../snapshot/seam.js";
import type { SnapshotCommandContext } from "../snapshot/seam.js";
import { applyBranchWorldCommand } from "../branch/seam.js";
import type { BranchCommandContext } from "../branch/seam.js";
import { applyOrderCommand } from "./orderCommands.js";
import { validateCommand } from "./validate.js";
export { validateCommand } from "./validate.js";
export type { ValidateCommandResult } from "tradrl-world-contracts";
import {
  ENGINE_EVENT_SCHEMA_VERSION,
  WORLD_CORE_PRODUCER,
} from "./events.js";
import type { AnnotationAddedPayload, ScenarioSetPayload } from "./events.js";
import type { WorldDefinition } from "./definition.js";
import { EngineInvariantError } from "./errors.js";
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
  /**
   * W016 seam: the authoritative journal — required by the snapshot/branch
   * seams (cursor, prefix records). Supplied by the engine; a direct
   * lifecycle caller that omits it gets a typed invariant error when the
   * command kind needs it.
   */
  readonly journal?: EventJournal;
  /**
   * W016 seam: full snapshot payloads available in this engine session —
   * required by the branch seam (the engine supplies them; replay rebuilds
   * them from journaled truth).
   */
  readonly snapshotPayloads?: ReadonlyMap<SnapshotId, WorldSnapshot>;
}

/** The outcome of the lifecycle before the engine journals/reduces/acks. */
export type LifecycleOutcome =
  | { readonly kind: "applied"; readonly drafts: readonly PendingEventDraft[] }
  | { readonly kind: "rejected"; readonly rejection: CommandRejection };

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
 * those events — single path with replay); the order family (submit/
 * replace/cancel/close) routes through the W014/W015 seams in
 * orderCommands.ts; unimplemented kinds return the honest typed stub
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
    case "replace-order":
    case "cancel-order":
    case "close-position":
      // THE ORDER FAMILY (W014/W015 seams): the pre-trade stage then the
      // venue — see world/orderCommands.ts for the documented domain-check
      // order (close-position never passes the gate: it only ever reduces).
      return applyOrderCommand(
        command as CancelOrderCommand | ClosePositionCommand | ReplaceOrderCommand | SubmitOrderCommand,
        ctx,
      );
    case "create-snapshot": {
      // THE W016 SNAPSHOT SEAM: capture the world at the current journal
      // position (content-addressed) and draft its journaled descriptor.
      if (ctx.journal === undefined) {
        throw new EngineInvariantError(
          "create-snapshot requires the lifecycle context journal (engine-supplied; direct lifecycle callers must provide one)",
        );
      }
      return applyCreateSnapshotCommand(command as CreateSnapshotCommand, ctx as SnapshotCommandContext);
    }
    case "branch-world": {
      // THE W016 BRANCH SEAM: validate the source snapshot and draft the
      // parent-journaled branch record with complete lineage facts. The
      // child engine is created by the engine when this command acks.
      if (ctx.journal === undefined || ctx.snapshotPayloads === undefined) {
        throw new EngineInvariantError(
          "branch-world requires the lifecycle context journal and snapshot payloads (engine-supplied; direct lifecycle callers must provide them)",
        );
      }
      return applyBranchWorldCommand(command, ctx as BranchCommandContext);
    }
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
