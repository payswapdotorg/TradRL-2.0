/**
 * Command contracts: typed command envelopes, the command lifecycle result
 * shapes (validate → authorize → apply domain rules → ack) and per-method
 * payloads for the CommandPort.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle":
 *   command → validate → authorize → apply domain rules → mutate authoritative
 *   state → emit ordered events → append journal → publish projections → ack.
 * Spec: spec/REQUIREMENTS.md R011 (typed auditable commands).
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md K — explicit typed denial for
 * live-only actions.
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — human and AI terminate at the same
 * CommandPort.
 */

import type {
  AccountId,
  CommandId,
  CorrelationId,
  EventId,
  InstrumentId,
  OrderId,
  ParticipantId,
  SnapshotId,
  WorldId,
} from "./ids.js";
import type {
  Price,
  Quantity,
  SequenceNumber,
  TimestampMs,
} from "./primitives.js";
import type {
  BranchConfiguration,
  ScenarioDefinition,
} from "./world.js";
import type {
  OrderExecutionConstraints,
  OrderKind,
  OrderRejectionReason,
  OrderSide,
} from "./orders.js";

/** Fields shared by every world command. */
export interface CommandBase {
  readonly commandId: CommandId;
  readonly worldId: WorldId;
  readonly issuedBy: ParticipantId;
  readonly issuedAt: TimestampMs;
  readonly correlationId?: CorrelationId;
}

/** Order submission payload (used by SubmitOrderCommand). */
export interface OrderSubmission {
  readonly kind: OrderKind;
  readonly side: OrderSide;
  readonly quantity: Quantity;
  readonly limitPrice?: Price;
  readonly stopPrice?: Price;
  readonly constraints: OrderExecutionConstraints;
}

export interface SubmitOrderCommand extends CommandBase {
  readonly kind: "submit-order";
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  readonly submission: OrderSubmission;
}

export interface CancelOrderCommand extends CommandBase {
  readonly kind: "cancel-order";
  readonly orderId: OrderId;
  readonly reason?: string;
}

export interface ReplaceOrderCommand extends CommandBase {
  readonly kind: "replace-order";
  readonly orderId: OrderId;
  /** Replace fields; unset fields keep their current values. */
  readonly quantity?: Quantity;
  readonly limitPrice?: Price;
  readonly stopPrice?: Price;
  readonly constraints?: OrderExecutionConstraints;
}

export interface ClosePositionCommand extends CommandBase {
  readonly kind: "close-position";
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
}

export interface AddAnnotationCommand extends CommandBase {
  readonly kind: "add-annotation";
  readonly instrumentId?: InstrumentId;
  readonly at: TimestampMs;
  readonly text: string;
}

export interface CreateSnapshotCommand extends CommandBase {
  readonly kind: "create-snapshot";
  readonly label?: string;
}

export interface BranchWorldCommand extends CommandBase {
  readonly kind: "branch-world";
  readonly sourceSnapshotId: SnapshotId;
  readonly configuration?: BranchConfiguration;
}

export interface SetScenarioCommand extends CommandBase {
  readonly kind: "set-scenario";
  readonly scenario: ScenarioDefinition;
}

/** Union of all world commands (R011: typed, auditable). */
export type WorldCommand =
  | SubmitOrderCommand
  | CancelOrderCommand
  | ReplaceOrderCommand
  | ClosePositionCommand
  | AddAnnotationCommand
  | CreateSnapshotCommand
  | BranchWorldCommand
  | SetScenarioCommand;

// --- lifecycle result shapes ---------------------------------------------------

/** Stages of the command lifecycle that can reject. */
export type CommandLifecycleStage = "validate" | "authorize" | "domain-rules";

/** Structured validation error. */
export interface CommandValidationError {
  readonly code: CommandValidationErrorCode;
  readonly message: string;
  readonly field?: string;
}

/** Validation error codes (closed set, World Alpha). */
export type CommandValidationErrorCode =
  | "malformed-command"
  | "unknown-world"
  | "unknown-instrument"
  | "unknown-account"
  | "unknown-order"
  | "unknown-participant"
  | "duplicate-command";

/** Result of the `validate` stage. */
export type ValidateCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly CommandValidationError[] };

/**
 * Typed authorization denial. `live-execution-not-permitted` is the explicit
 * typed denial for live-only actions (acceptance K).
 */
export type AuthorizationDenialCode =
  | "unauthorized-participant"
  | "permission-denied"
  | "account-not-tradable"
  | "live-execution-not-permitted";

/** Authorization denial (the `authorize` stage). */
export interface AuthorizationDenial {
  readonly code: AuthorizationDenialCode;
  readonly message: string;
}

/** Result of the `authorize` stage. */
export type AuthorizeCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly denial: AuthorizationDenial };

/** Failure of the `apply domain rules` stage. */
export interface DomainRuleFailure {
  readonly rule: OrderRejectionReason;
  readonly message: string;
}

/** Result of the `apply domain rules` stage. */
export type ApplyDomainRulesResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: DomainRuleFailure };

/** Command acknowledgement (terminal `ack` step of the lifecycle). */
export interface CommandAck {
  readonly commandId: CommandId;
  readonly worldId: WorldId;
  readonly acceptedAt: TimestampMs;
  /** Ordered events emitted by applying this command. */
  readonly resultingEventIds: readonly EventId[];
  /** Journal position after appending this command's records. */
  readonly journalCursor: SequenceNumber;
}

/** Rejection with the stage that produced it. */
export interface CommandRejection {
  readonly stage: CommandLifecycleStage;
  readonly code: string;
  readonly message: string;
}

/** The result every CommandPort method returns. */
export type CommandResult =
  | { readonly status: "acked"; readonly ack: CommandAck }
  | { readonly status: "rejected"; readonly rejection: CommandRejection };
