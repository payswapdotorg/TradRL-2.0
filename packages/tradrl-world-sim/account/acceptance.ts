/**
 * The order acceptance checks (W015 `account` module): the account-side
 * pre-trade gate — margin/buying power per the domain model, plus the
 * canShort permission on positions that would end short.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — authorization, venue policy and
 * execution gates are runtime controls, never prompt text.
 * Spec: spec/ARCHITECTURE.md §5 (buying power, margin, leverage,
 * permissions), spec/DOMAIN-MODEL.md "Financial precision".
 *
 * POLICY (documented, deterministic — the incremental-margin model):
 * - The check sizes the order's WORST-CASE position effect: the projected
 *   signed quantity vs the current one. A reduction (|projected| ≤
 *   |current|) never requires margin — it frees some — and always accepts.
 * - The reference price for the incremental notional:
 *     limit / stop-limit → the limit price (a buy pays at most its limit);
 *     stop              → the stop price (the documented trigger estimate —
 *                          a triggered stop executes as market; sizing at
 *                          the stop is the deterministic estimate);
 *     market            → the worst-case book walk: the deepest opposite
 *                          level the order would touch (empty book ⇒ no
 *                          reference ⇒ zero fillable exposure — market
 *                          orders never rest — so the check passes).
 * - requiredMargin = (|projected| − |current|) × referencePrice / leverage
 *   (ONE half-up rounding; leverage is a validated integer).
 * - The order accepts iff requiredMargin ≤ marginAvailable (equity-based,
 *   negative availability honestly rejects).
 * - A projected SHORT position on a canShort=false account rejects (the
 *   sell that would flip the account short is an account permission, not a
 *   venue rule).
 *
 * Structural problems (unparseable quantity/prices) do NOT reject here —
 * the venue's own prechecks own those rejections; the acceptance gate only
 * fires on well-formed submissions.
 */

import type { AccountId, InstrumentId, OrderKind, OrderSide } from "tradrl-world-contracts";
import { aggressiveLevels, mulDivHalfUp, parseScaled, type BookState, type Scaled } from "../orderbook/index.js";
import { absScaled, formatSignedMoney } from "../portfolio/index.js";
import type { PositionRecord } from "../portfolio/index.js";
import type { AccountFinancials } from "./margin.js";

const SCALE = 10n ** 12n;

/** The order facts the account acceptance checks need. */
export interface OrderAcceptanceInput {
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  readonly kind: OrderKind;
  readonly side: OrderSide;
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly stopPrice?: string;
}

/** The typed acceptance outcome (a runtime control, R024/A13). */
export type OrderAcceptanceOutcome =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly code: "insufficient-buying-power" | "account-cannot-short";
      readonly message: string;
      readonly requiredMargin: string;
      readonly marginAvailable: string;
    };

/** Worst-case price a market order of `quantity` would touch on this book. */
export function worstCaseMarketPrice(
  book: BookState,
  side: OrderSide,
  quantity: Scaled,
): Scaled | undefined {
  const levels = aggressiveLevels(book, side, undefined);
  if (levels.length === 0) {
    return undefined;
  }
  let remaining = quantity;
  for (const level of levels) {
    let levelTotal = 0n;
    for (const entry of level.entries) {
      levelTotal += entry.remaining;
    }
    if (levelTotal >= remaining) {
      return level.priceScaled;
    }
    remaining -= levelTotal;
  }
  return levels[levels.length - 1]!.priceScaled;
}

/**
 * The reference price for sizing one submission (the documented policy in
 * the module header). `undefined` means "no price can size this order"
 * (market into an empty book) — zero fillable exposure.
 */
export function sizingReferencePrice(
  book: BookState,
  input: OrderAcceptanceInput,
  quantity: Scaled,
): Scaled | undefined {
  if (input.kind === "limit" || input.kind === "stop-limit") {
    return input.limitPrice === undefined ? undefined : parseScaled(input.limitPrice);
  }
  if (input.kind === "stop") {
    return input.stopPrice === undefined ? undefined : parseScaled(input.stopPrice);
  }
  return worstCaseMarketPrice(book, input.side, quantity);
}

/**
 * Run the account acceptance checks for one submission against the live
 * financial state. Pure; deterministic; never rejects structurally-broken
 * submissions (the venue prechecks own those).
 */
export function checkOrderAcceptance(input: {
  readonly ledger: { readonly leverage: number; readonly baseCurrency: string; readonly permissions: { readonly canShort: boolean } };
  readonly financials: AccountFinancials;
  readonly positions: readonly PositionRecord[];
  readonly book: BookState;
  readonly order: OrderAcceptanceInput;
}): OrderAcceptanceOutcome {
  const { order } = input;
  let quantity: Scaled;
  try {
    quantity = parseScaled(order.quantity);
  } catch {
    return { accepted: true };
  }
  if (quantity <= 0n) {
    return { accepted: true };
  }

  const position = input.positions.find(
    (record) =>
      record.accountId === order.accountId && record.instrumentId === order.instrumentId,
  );
  const current = position?.quantity ?? 0n;
  const projected = current + (order.side === "buy" ? quantity : -quantity);

  if (projected < 0n && !input.ledger.permissions.canShort) {
    return {
      accepted: false,
      code: "account-cannot-short",
      message:
        `a ${order.side} of ${order.quantity} would leave account ${String(order.accountId)} ` +
        `short in ${String(order.instrumentId)} (canShort=false)`,
      requiredMargin: "0",
      marginAvailable: formatSignedMoney(input.financials.marginAvailable),
    };
  }

  const projectedAbs = absScaled(projected);
  const currentAbs = absScaled(current);
  if (projectedAbs <= currentAbs) {
    return { accepted: true }; // a pure reduction — margin is freed, never required
  }

  let reference: Scaled | undefined;
  try {
    reference = sizingReferencePrice(input.book, order, quantity);
  } catch {
    return { accepted: true }; // malformed prices are the venue's rejection
  }
  if (reference === undefined) {
    return { accepted: true }; // market into an empty book: no fillable exposure
  }

  const requiredMargin = mulDivHalfUp(
    projectedAbs - currentAbs,
    reference,
    SCALE * BigInt(input.ledger.leverage),
  );
  if (requiredMargin <= input.financials.marginAvailable) {
    return { accepted: true };
  }
  return {
    accepted: false,
    code: "insufficient-buying-power",
    message:
      `order requires margin ${formatSignedMoney(requiredMargin)} ` +
      `(${order.kind} ${order.side} ${order.quantity} at reference ` +
      `${formatSignedMoney(reference)}, leverage ${String(input.ledger.leverage)}) ` +
      `but account ${String(order.accountId)} has ${formatSignedMoney(input.financials.marginAvailable)} available`,
    requiredMargin: formatSignedMoney(requiredMargin),
    marginAvailable: formatSignedMoney(input.financials.marginAvailable),
  };
}
