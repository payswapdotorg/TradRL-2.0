/**
 * The pre-trade risk gate (W015 `risk` module): the typed runtime control
 * every submission passes before the venue sees it (ARCHITECTURE-LOCK.md
 * A13 — risk authority lives outside prompts; REQUIREMENTS.md R024).
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md C (rejection), D (risk),
 * spec/DOMAIN-MODEL.md "Financial precision" — every limit comparison is
 * exact scaled arithmetic; the RiskCheckOutcome contract carries the
 * limit/requested values as canonical decimal text.
 *
 * GATE MATRIX (deterministic evaluation order; unset limits are not
 * enforced — the W003 law):
 * 1. order-size       — requested quantity ≤ maxOrderQuantity.
 * 2. position-limit   — projected |position quantity| ≤ maxPositionQuantity
 *                       (the projection uses the full order quantity: the
 *                       gate runs before anything rests or fills).
 * 3. gross-exposure   — projected gross notional ≤ maxGrossExposure
 *                       (incremental: + |Δposition| × reference price on
 *                       exposure-increasing orders; the reference price
 *                       follows the account acceptance policy).
 * 4. leverage         — projected gross / equity ≤ maxLeverage.
 * 5. buying-power     — (marginAvailable − requiredMargin) × leverage ≥
 *                       minBuyingPowerAfterOrder.
 * 6. drawdown         — an exposure-increasing order is refused while the
 *                       account's current drawdown exceeds maxDrawdown (a
 *                       risk-reducing order — a close — is never refused
 *                       by the drawdown gate).
 *
 * The gate NEVER mutates state and NEVER journals (rejections are typed
 * CommandResult values; breaches are recorded by the risk reducer when
 * journaled events move an account past a limit — see risk/state.ts).
 */

import type { RiskCheckOutcome, RiskGateId } from "tradrl-world-contracts";
import type { OrderKind, OrderSide } from "tradrl-world-contracts";
import { aggressiveLevels, mulDivHalfUp, parseScaled, type BookState, type Scaled } from "../orderbook/index.js";
import { absScaled, formatSignedMoney } from "../portfolio/index.js";
import type { PositionRecord } from "../portfolio/index.js";
import type { AccountFinancials } from "../account/index.js";
import type { RiskRuntimeState } from "./state.js";
import { ratioToScaled } from "./limits.js";

const SCALE = 10n ** 12n;

/** The submission facts the risk gate evaluates. */
export interface RiskGateInput {
  readonly accountId: string;
  readonly instrumentId: string;
  readonly kind: OrderKind;
  readonly side: OrderSide;
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly stopPrice?: string;
}

/** The gate outcome: every DECLARED gate evaluated, in matrix order. */
export interface PreTradeRiskOutcome {
  readonly passed: boolean;
  readonly outcomes: readonly RiskCheckOutcome[];
  /** The first failing outcome (undefined when passed). */
  readonly failure?: RiskCheckOutcome & { readonly passed: false };
}

function failed(
  gate: RiskGateId,
  limit: string,
  requested: string,
  message: string,
): RiskCheckOutcome & { readonly passed: false } {
  return { gate, passed: false, limit, requested, message };
}

/** Projected signed position quantity after the submission (exact). */
export function projectedQuantity(
  positions: readonly PositionRecord[],
  input: RiskGateInput,
  quantity: Scaled,
): Scaled {
  const record = positions.find(
    (candidate) =>
      String(candidate.accountId) === input.accountId &&
      String(candidate.instrumentId) === input.instrumentId,
  );
  const current = record?.quantity ?? 0n;
  return current + (input.side === "buy" ? quantity : -quantity);
}

/**
 * Run the pre-trade risk gate for one submission against the live state.
 * Structurally broken submissions (unparseable quantity/prices) pass
 * through — the venue's own prechecks own those rejections (the documented
 * domain-check order).
 */
export function runPreTradeRiskGate(input: {
  readonly risk: RiskRuntimeState;
  readonly financials: AccountFinancials;
  readonly leverage: number;
  readonly positions: readonly PositionRecord[];
  readonly book: BookState;
  readonly order: RiskGateInput;
}): PreTradeRiskOutcome {
  const limits = input.risk.limits[input.order.accountId] ?? {};
  const outcomes: RiskCheckOutcome[] = [];

  let quantity: Scaled;
  try {
    quantity = parseScaled(input.order.quantity);
  } catch {
    return { passed: true, outcomes };
  }
  if (quantity <= 0n) {
    return { passed: true, outcomes };
  }

  // 1. order-size
  if (limits.maxOrderQuantity !== undefined) {
    const limit = parseScaled(limits.maxOrderQuantity);
    outcomes.push(
      quantity <= limit
        ? { gate: "order-size", passed: true }
        : failed(
            "order-size",
            String(limits.maxOrderQuantity),
            input.order.quantity,
            `order quantity ${input.order.quantity} exceeds maxOrderQuantity ${String(limits.maxOrderQuantity)}`,
          ),
    );
  }

  // 2. position-limit (projected |quantity|)
  if (limits.maxPositionQuantity !== undefined) {
    const projected = absScaled(projectedQuantity(input.positions, input.order, quantity));
    const limit = parseScaled(limits.maxPositionQuantity);
    outcomes.push(
      projected <= limit
        ? { gate: "position-limit", passed: true }
        : failed(
            "position-limit",
            String(limits.maxPositionQuantity),
            formatSignedMoney(projected),
            `projected position quantity ${formatSignedMoney(projected)} exceeds maxPositionQuantity ${String(limits.maxPositionQuantity)}`,
          ),
    );
  }

  // the incremental exposure model (gates 3–5 share it)
  const projected = projectedQuantity(input.positions, input.order, quantity);
  const projectedAbs = absScaled(projected);
  const currentRecord = input.positions.find(
    (candidate) =>
      String(candidate.accountId) === input.order.accountId &&
      String(candidate.instrumentId) === input.order.instrumentId,
  );
  const currentAbs = absScaled(currentRecord?.quantity ?? 0n);
  const increasesExposure = projectedAbs > currentAbs;
  let reference: Scaled | undefined;
  try {
    if (input.order.kind === "limit" || input.order.kind === "stop-limit") {
      reference = input.order.limitPrice === undefined ? undefined : parseScaled(input.order.limitPrice);
    } else if (input.order.kind === "stop") {
      reference = input.order.stopPrice === undefined ? undefined : parseScaled(input.order.stopPrice);
    } else {
      reference = worstCaseMarketReference(input.book, input.order.side, quantity);
    }
  } catch {
    reference = undefined;
  }
  const deltaQuantity = increasesExposure && reference !== undefined ? projectedAbs - currentAbs : 0n;
  const incrementalNotional = deltaQuantity === 0n || reference === undefined
    ? 0n
    : mulDivHalfUp(deltaQuantity, reference, SCALE);
  const projectedGross = input.financials.grossExposure + incrementalNotional;
  const requiredMargin = incrementalNotional === 0n
    ? 0n
    : mulDivHalfUp(incrementalNotional, 1n, BigInt(input.leverage));

  // 3. gross-exposure
  if (limits.maxGrossExposure !== undefined) {
    const limit = parseScaled(limits.maxGrossExposure.amount);
    outcomes.push(
      projectedGross <= limit
        ? { gate: "gross-exposure", passed: true }
        : failed(
            "gross-exposure",
            String(limits.maxGrossExposure.amount),
            formatSignedMoney(projectedGross),
            `projected gross exposure ${formatSignedMoney(projectedGross)} exceeds maxGrossExposure ${String(limits.maxGrossExposure.amount)}`,
          ),
    );
  }

  // 4. leverage
  if (limits.maxLeverage !== undefined) {
    const limit = ratioToScaled(limits.maxLeverage);
    let breach = false;
    let requested = "0";
    if (input.financials.equity <= 0n) {
      breach = projectedGross > 0n;
      requested = projectedGross > 0n ? "∞" : "0";
    } else {
      const leverageScaledValue = mulDivHalfUp(projectedGross, SCALE, input.financials.equity);
      requested = formatSignedMoney(leverageScaledValue);
      breach = leverageScaledValue > limit;
    }
    outcomes.push(
      breach
        ? failed(
            "leverage",
            String(limits.maxLeverage),
            requested,
            `projected leverage ${requested} exceeds maxLeverage ${String(limits.maxLeverage)}`,
          )
        : { gate: "leverage", passed: true },
    );
  }

  // 5. buying-power floor after the order
  if (limits.minBuyingPowerAfterOrder !== undefined) {
    const afterOrder =
      (input.financials.marginAvailable - requiredMargin) * BigInt(input.leverage);
    const limit = parseScaled(limits.minBuyingPowerAfterOrder.amount);
    outcomes.push(
      afterOrder >= limit
        ? { gate: "buying-power", passed: true }
        : failed(
            "buying-power",
            String(limits.minBuyingPowerAfterOrder.amount),
            formatSignedMoney(afterOrder),
            `buying power after the order ${formatSignedMoney(afterOrder)} falls below the floor ${String(limits.minBuyingPowerAfterOrder.amount)}`,
          ),
    );
  }

  // 6. drawdown (refuses exposure-increasing orders while breached)
  if (limits.maxDrawdown !== undefined) {
    const peak = input.risk.peakEquity[input.order.accountId] ?? 0n;
    const drawdown = peak > input.financials.equity ? peak - input.financials.equity : 0n;
    const limit = parseScaled(limits.maxDrawdown.amount);
    const breached = drawdown > limit;
    outcomes.push(
      !breached || !increasesExposure
        ? { gate: "drawdown", passed: true }
        : failed(
            "drawdown",
            String(limits.maxDrawdown.amount),
            formatSignedMoney(drawdown),
            `account drawdown ${formatSignedMoney(drawdown)} exceeds maxDrawdown ${String(limits.maxDrawdown.amount)}; risk-increasing orders are refused until it recovers`,
          ),
    );
  }

  const failure = outcomes.find(
    (outcome): outcome is RiskCheckOutcome & { readonly passed: false } => outcome.passed === false,
  );
  return { passed: failure === undefined, outcomes, ...(failure === undefined ? {} : { failure }) };
}

function worstCaseMarketReference(
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
