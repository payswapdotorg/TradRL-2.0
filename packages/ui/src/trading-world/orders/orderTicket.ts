/**
 * Order ticket form model — W010 (pure, framework-free).
 *
 * Spec: spec/WORK-ITEMS.md W010 ("order-entry ticket: kind market/limit/
 * stop/stop-limit; side buy/sell; quantity; price(s); TIF constraints …
 * submitting through client.command.submitOrder"); spec/ARCHITECTURE-LOCK.md
 * A6/A13 (the venue is the authority — this model only prepares an honest
 * submission and STRUCTURAL pre-submit feedback; it never replaces the
 * engine's typed verdict); spec/WORLD-PROTOCOL.md "Command lifecycle".
 *
 * FORM DISCIPLINE (work order W010): the ticket only offers what the world's
 * venue allows. The venue policy is COMPOSITION CONFIG (the alpha venue
 * declaration: all four kinds, GTC/IOC/FOK) — kinds/TIFs the policy forbids
 * are surfaced as problems ("venue does not accept …"), rendered as honestly
 * disabled options with reasons, never silently removed.
 *
 * DECIMAL DISCIPLINE: the structural mirrors here follow the W003 contract
 * boundary law — canonical decimal text (`/^(0|[1-9][0-9]*)(\.[0-9]+)?$/`,
 * ≤12 fractional digits), exact tick/lot multiples checked on the same
 * 12-decimal fixed-point scale the engine uses. These are PRE-SUBMIT hints
 * only; the engine's typed VALUE (acked or rejected with a typed code) is
 * always the verdict that matters (never wire errors, never fabricated
 * state).
 */

import type {
  AccountId,
  CancelOrderCommand,
  CommandId,
  CorrelationId,
  InstrumentId,
  OrderExecutionConstraints,
  OrderKind,
  OrderRejectionReason,
  OrderSide,
  ParticipantId,
  Price,
  Quantity,
  ReplaceOrderCommand,
  SubmitOrderCommand,
  TimeInForce,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";

// --- venue policy (composition config; the alpha venue declaration) ----------

/**
 * What the ticket may offer. Mirrors the venue declaration of the attached
 * world (engineAttachment.ts: allowedOrderKinds + the contracts' TIF union).
 * The engine still enforces the real venue policy on every submission
 * (`order-kind-not-supported` is its typed verdict, never ours).
 */
export interface OrderTicketVenuePolicy {
  /** Venue name for honest labels ("alpha-sim-venue"). */
  readonly label: string;
  /** Order kinds the venue accepts (subset of the W003 OrderKind union). */
  readonly allowedOrderKinds: readonly OrderKind[];
  /** Time-in-force values the venue accepts. */
  readonly allowedTimeInForce: readonly TimeInForce[];
}

/** The alpha venue declaration (all four kinds, all three TIFs). */
export const ALPHA_VENUE_POLICY: OrderTicketVenuePolicy = {
  label: "alpha-sim-venue",
  allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
  allowedTimeInForce: ["GTC", "IOC", "FOK"],
};

export const ORDER_TICKET_KINDS: readonly OrderKind[] = [
  "market",
  "limit",
  "stop",
  "stop-limit",
];
export const ORDER_TICKET_SIDES: readonly OrderSide[] = ["buy", "sell"];
export const ORDER_TICKET_TIFS: readonly TimeInForce[] = ["GTC", "IOC", "FOK"];

// --- identity (composition config; opaque ids, never parsed) -----------------

/** The trader identity the ticket submits as (opaque W003 ids). */
export interface OrderTicketIdentity {
  readonly participantId: ParticipantId;
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
}

/** Identity or a per-worldId resolver (the alpha attachment convention). */
export type OrderTicketIdentitySpec =
  | OrderTicketIdentity
  | ((worldId: string) => OrderTicketIdentity);

/**
 * The alpha world convention (runtime/engineAttachment.ts): the human
 * trader's participant/account and the ES-like instrument, derived from the
 * pane's opaque worldId. Composition may override with explicit ids.
 */
export function alphaTraderIdentity(worldId: string): OrderTicketIdentity {
  return {
    participantId: `participant-trader-${worldId}` as ParticipantId,
    accountId: `account-trader-${worldId}` as AccountId,
    instrumentId: `instrument-es-${worldId}` as InstrumentId,
  };
}

export const ALPHA_TRADER_IDENTITY: OrderTicketIdentitySpec = alphaTraderIdentity;

/** Resolve the identity spec for one pane world. */
export function resolveOrderTicketIdentity(
  spec: OrderTicketIdentitySpec,
  worldId: string,
): OrderTicketIdentity {
  return typeof spec === "function" ? spec(worldId) : spec;
}

// --- form state ----------------------------------------------------------------

/** Editable ticket state (raw input text; validation is separate). */
export interface OrderTicketFormState {
  readonly kind: OrderKind;
  readonly side: OrderSide;
  readonly quantity: string;
  readonly limitPrice: string;
  readonly stopPrice: string;
  readonly timeInForce: TimeInForce;
  readonly postOnly: boolean;
  readonly reduceOnly: boolean;
}

/** The initial ticket: a resting GTC limit buy, one lot. */
export function createDefaultOrderTicketFormState(): OrderTicketFormState {
  return {
    kind: "limit",
    side: "buy",
    quantity: "1",
    limitPrice: "",
    stopPrice: "",
    timeInForce: "GTC",
    postOnly: false,
    reduceOnly: false,
  };
}

/** Field ids the problems anchor to (rendering groups by these). */
export type OrderTicketField =
  | "kind"
  | "side"
  | "quantity"
  | "limitPrice"
  | "stopPrice"
  | "timeInForce"
  | "postOnly"
  | "reduceOnly"
  | "form";

/** One structural pre-submit problem (displayed, never silent). */
export interface OrderTicketProblem {
  readonly field: OrderTicketField;
  readonly message: string;
}

/** Instrument facts for structural validation (from query.getInstrument). */
export interface OrderTicketInstrumentFacts {
  readonly tickSize: string;
  readonly lotSize: string;
  readonly tradingState: string;
  readonly tradable: boolean;
}

// --- decimal mirrors (W003 canonical decimal text; 12-dp fixed point) --------

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const DECIMAL_SCALE = 12;
const SCALE = 10n ** BigInt(DECIMAL_SCALE);

type Scaled = bigint;

function parseDecimalText(text: string): Scaled | undefined {
  if (typeof text !== "string" || !DECIMAL_PATTERN.test(text)) {
    return undefined;
  }
  const dot = text.indexOf(".");
  const whole = dot < 0 ? text : text.slice(0, dot);
  const fraction = dot < 0 ? "" : text.slice(dot + 1);
  if (fraction.length > DECIMAL_SCALE) {
    return undefined;
  }
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(DECIMAL_SCALE, "0"));
}

function isExactMultipleOf(value: Scaled, unit: Scaled): boolean {
  return unit > 0n && value % unit === 0n;
}

/** True for canonical, parseable positive decimal text. */
export function isCanonicalPositiveDecimal(text: string): boolean {
  const scaled = parseDecimalText(text);
  return scaled !== undefined && scaled > 0n;
}

// --- structural validation -----------------------------------------------------

function kindRequiresLimitPrice(kind: OrderKind): boolean {
  return kind === "limit" || kind === "stop-limit";
}

function kindRequiresStopPrice(kind: OrderKind): boolean {
  return kind === "stop" || kind === "stop-limit";
}

/**
 * Structural pre-submit validation. Checks the venue policy, the required
 * price fields per kind, canonical decimal text, tick/lot multiples (when
 * instrument facts are available) and the post-only/market conflict.
 *
 * This NEVER replaces the engine's verdict: an empty problem list means "no
 * known structural objection" — the submission still goes through the real
 * CommandPort and surfaces the engine's typed VALUE.
 */
export function validateOrderTicketForm(
  state: OrderTicketFormState,
  options: {
    readonly policy: OrderTicketVenuePolicy;
    readonly instrument?: OrderTicketInstrumentFacts;
  },
): readonly OrderTicketProblem[] {
  const problems: OrderTicketProblem[] = [];
  const { policy, instrument } = options;

  if (!policy.allowedOrderKinds.includes(state.kind)) {
    problems.push({
      field: "kind",
      message: `venue ${policy.label} does not accept ${state.kind} orders`,
    });
  }
  if (!policy.allowedTimeInForce.includes(state.timeInForce)) {
    problems.push({
      field: "timeInForce",
      message: `venue ${policy.label} does not accept ${state.timeInForce} orders`,
    });
  }

  const tick = instrument === undefined ? undefined : parseDecimalText(instrument.tickSize);
  const lot = instrument === undefined ? undefined : parseDecimalText(instrument.lotSize);

  // Required/forbidden price fields per kind (mirrors the engine's rules:
  // "limitPrice is required", "cannot set a limit price on a market order").
  if (kindRequiresLimitPrice(state.kind)) {
    const limit = parseDecimalText(state.limitPrice);
    if (state.limitPrice.length === 0 || limit === undefined) {
      problems.push({
        field: "limitPrice",
        message: `${state.kind} requires a limit price (canonical decimal text, e.g. 4800.25)`,
      });
    } else if (limit <= 0n) {
      problems.push({ field: "limitPrice", message: "limit price must be positive" });
    } else if (tick !== undefined && !isExactMultipleOf(limit, tick)) {
      problems.push({
        field: "limitPrice",
        message: `limit price ${state.limitPrice} is not a multiple of the tick size ${instrument?.tickSize ?? "?"}`,
      });
    }
  } else if (state.limitPrice.length > 0) {
    problems.push({
      field: "limitPrice",
      message: `a ${state.kind} order cannot carry a limit price`,
    });
  }

  if (kindRequiresStopPrice(state.kind)) {
    const stop = parseDecimalText(state.stopPrice);
    if (state.stopPrice.length === 0 || stop === undefined) {
      problems.push({
        field: "stopPrice",
        message: `${state.kind} requires a stop price (canonical decimal text, e.g. 4800.00)`,
      });
    } else if (stop <= 0n) {
      problems.push({ field: "stopPrice", message: "stop price must be positive" });
    } else if (tick !== undefined && !isExactMultipleOf(stop, tick)) {
      problems.push({
        field: "stopPrice",
        message: `stop price ${state.stopPrice} is not a multiple of the tick size ${instrument?.tickSize ?? "?"}`,
      });
    }
  } else if (state.stopPrice.length > 0) {
    problems.push({
      field: "stopPrice",
      message: `a ${state.kind} order cannot carry a stop price`,
    });
  }

  const quantity = parseDecimalText(state.quantity);
  if (state.quantity.length === 0 || quantity === undefined) {
    problems.push({
      field: "quantity",
      message: "quantity is required (canonical decimal text, e.g. 3)",
    });
  } else if (quantity <= 0n) {
    problems.push({ field: "quantity", message: "quantity must be positive" });
  } else if (lot !== undefined && !isExactMultipleOf(quantity, lot)) {
    problems.push({
      field: "quantity",
      message: `quantity ${state.quantity} is not a positive multiple of the lot size ${instrument?.lotSize ?? "?"}`,
    });
  }

  if (state.postOnly && state.kind === "market") {
    problems.push({
      field: "postOnly",
      message:
        "a post-only market order takes by definition — the venue rejects it (post-only-would-take)",
    });
  }
  if (instrument !== undefined && instrument.tradable === false) {
    problems.push({
      field: "form",
      message: "the instrument is not tradable (instrument-not-tradable)",
    });
  }
  if (instrument !== undefined && instrument.tradingState !== "open") {
    problems.push({
      field: "form",
      message: `trading state is ${instrument.tradingState} — the venue rejects submissions while not open`,
    });
  }
  return problems;
}

// --- command builders ----------------------------------------------------------

/** Fresh, collision-safe command ids for UI-issued commands. */
export function newUiCommandId(prefix: string): CommandId {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `cmd-${prefix}-${random}` as CommandId;
}

/** Build a submit-order command from a (structurally validated) form state. */
export function buildSubmitOrderCommand(input: {
  readonly identity: OrderTicketIdentity;
  readonly worldId: string;
  readonly form: OrderTicketFormState;
  readonly commandId: CommandId;
  readonly issuedAt: TimestampMs;
  readonly correlationId?: CorrelationId;
}): SubmitOrderCommand {
  const { identity, form } = input;
  const constraints: OrderExecutionConstraints = {
    timeInForce: form.timeInForce,
    ...(form.postOnly ? { postOnly: true } : {}),
    ...(form.reduceOnly ? { reduceOnly: true } : {}),
  };
  const submission = {
    kind: form.kind,
    side: form.side,
    quantity: form.quantity as Quantity,
    ...(kindRequiresLimitPrice(form.kind) ? { limitPrice: form.limitPrice as Price } : {}),
    ...(kindRequiresStopPrice(form.kind) ? { stopPrice: form.stopPrice as Price } : {}),
    constraints,
  };
  return {
    kind: "submit-order",
    commandId: input.commandId,
    worldId: input.worldId as WorldId,
    issuedBy: identity.participantId,
    issuedAt: input.issuedAt,
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    accountId: identity.accountId,
    instrumentId: identity.instrumentId,
    submission,
  };
}

/** Build a cancel-order command for one of the trader's own orders. */
export function buildCancelOrderCommand(input: {
  readonly identity: OrderTicketIdentity;
  readonly worldId: string;
  readonly orderId: string;
  readonly commandId: CommandId;
  readonly issuedAt: TimestampMs;
  readonly reason?: string;
}): CancelOrderCommand {
  return {
    kind: "cancel-order",
    commandId: input.commandId,
    worldId: input.worldId as WorldId,
    issuedBy: input.identity.participantId,
    issuedAt: input.issuedAt,
    orderId: input.orderId as never,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
}

/**
 * Build a replace-order command. Unset fields keep their current values at
 * the engine (successorInputOf); the builder only carries explicit edits.
 */
export function buildReplaceOrderCommand(input: {
  readonly identity: OrderTicketIdentity;
  readonly worldId: string;
  readonly orderId: string;
  readonly commandId: CommandId;
  readonly issuedAt: TimestampMs;
  readonly quantity?: string;
  readonly limitPrice?: string;
  readonly stopPrice?: string;
}): ReplaceOrderCommand {
  return {
    kind: "replace-order",
    commandId: input.commandId,
    worldId: input.worldId as WorldId,
    issuedBy: input.identity.participantId,
    issuedAt: input.issuedAt,
    orderId: input.orderId as never,
    ...(input.quantity === undefined || input.quantity.length === 0
      ? {}
      : { quantity: input.quantity as Quantity }),
    ...(input.limitPrice === undefined || input.limitPrice.length === 0
      ? {}
      : { limitPrice: input.limitPrice as Price }),
    ...(input.stopPrice === undefined || input.stopPrice.length === 0
      ? {}
      : { stopPrice: input.stopPrice as Price }),
  };
}

/** Short display id (head…tail) with the full id kept in the title. */
export function shortOrderId(orderId: string): string {
  return orderId.length <= 16 ? orderId : `${orderId.slice(0, 8)}…${orderId.slice(-4)}`;
}

/** The typed rejection-reason vocabulary the surfaces display verbatim. */
export const ORDER_REJECTION_REASON_LABELS: Readonly<Record<OrderRejectionReason, string>> = {
  "invalid-price": "invalid-price",
  "invalid-quantity": "invalid-quantity",
  "insufficient-buying-power": "insufficient-buying-power",
  "risk-limit": "risk-limit",
  "market-closed": "market-closed",
  "market-halted": "market-halted",
  "instrument-not-tradable": "instrument-not-tradable",
  "order-kind-not-supported": "order-kind-not-supported",
  "post-only-would-take": "post-only-would-take",
  "reduce-only-would-increase-position": "reduce-only-would-increase-position",
  "fok-unfillable": "fok-unfillable",
  "unknown-order": "unknown-order",
  "order-not-modifiable": "order-not-modifiable",
  "duplicate-command": "duplicate-command",
  unauthorized: "unauthorized",
  "live-execution-not-permitted": "live-execution-not-permitted",
};
