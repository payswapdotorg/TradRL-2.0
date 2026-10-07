/**
 * Fee computation for fills (W014 `matching` module).
 *
 * Spec: spec/ARCHITECTURE.md §6 — "It models partial fills, fees, latency
 * hooks, deterministic matching and rejection reasons."
 * Spec: spec/REQUIREMENTS.md R022 (explicit fees — the venue fee schedule is
 * a runtime control, never prompt text: ARCHITECTURE-LOCK.md A13).
 *
 * Policy (deterministic, documented):
 * - a fill's fee is `notional × rateBps / 10_000` where notional is
 *   `fillPrice × fillQuantity`, computed with ONE half-up rounding at 8
 *   fractional digits (the decimal kernel's `mulDivHalfUp`, never binary
 *   floats — DOMAIN-MODEL.md "Financial precision");
 * - the maker side is charged `makerRateBps`, the taker side
 *   `takerRateBps` (W003 `FeeSchedule`); the applied rate is recorded on the
 *   fill for auditability;
 * - the optional per-order `fixedFee` is charged exactly once per order, on
 *   its FIRST fill (a per-order fee must land somewhere; the first fill
 *   carries it).
 */

import type { CurrencyCode, FeeSchedule, FillFee, LiquidityRole, Price, Quantity } from "tradrl-world-contracts";
import { formatScaled, mulDivHalfUp, parseScaled } from "../orderbook/index.js";

/** Fee amounts are quantized to 8 fractional digits (canonical text). */
export const FEE_DECIMALS = 8;

// notional = price × quantity carries 24 fractional digits on the internal
// scale (12 × 12); fee = notional × bps / 10^4, quantized straight to the
// 8-digit fee scale in one rounding: price×qty×bps / (10^4 × 10^16).
const FEE_DIVISOR = 10n ** 20n;

/** Compute the fee for one fill (maker or taker) from the venue schedule. */
export function fillFee(input: {
  readonly schedule: FeeSchedule;
  readonly currency: CurrencyCode;
  readonly price: Price;
  readonly quantity: Quantity;
  readonly liquidity: LiquidityRole;
  readonly isFirstFillOfOrder: boolean;
}): FillFee {
  const rateBps = input.liquidity === "maker" ? input.schedule.makerRateBps : input.schedule.takerRateBps;
  const notionalScaled = parseScaled(input.price) * parseScaled(input.quantity);
  let amountScaled = mulDivHalfUp(notionalScaled, BigInt(Math.trunc(rateBps)), FEE_DIVISOR);
  if (input.isFirstFillOfOrder && input.schedule.fixedFee !== undefined) {
    amountScaled += parseScaled(input.schedule.fixedFee);
  }
  return {
    currency: input.currency,
    amount: formatScaled(amountScaled, FEE_DECIMALS) as Quantity,
    liquidity: input.liquidity,
    rateBps,
  };
}

/** Total fee across fills (quote currency, canonical text). */
export function totalFeeAmount(amounts: readonly string[]): string {
  let total = 0n;
  for (const amount of amounts) total += parseScaled(amount);
  return formatScaled(total, FEE_DECIMALS);
}
