/**
 * Risk limit resolution and exact ratio helpers (W015 `risk` module).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — risk limits are runtime controls,
 * never prompt text; the W003 `RiskLimits` contract is the declared shape
 * ("unset limits are not enforced").
 * Spec: spec/DOMAIN-MODEL.md "Financial precision" — limit comparisons
 * happen on exact scaled integers; the only float a `Ratio` limit ever
 * crosses is its own declaration, normalized once to a 12-digit fixed
 * point (exact for every practical ratio: the rounding error of
 * x × 10^12 is below the fixed-point resolution).
 */

import type { RiskLimits } from "tradrl-world-contracts";

/** The per-account risk limits declared by a world (W015 definition seam). */
export type RiskLimitsByAccount = Readonly<Record<string, RiskLimits>>;

/** Limits that are not declared are not enforced (the W003 law). */
export function resolveRiskLimits(
  declared: RiskLimitsByAccount | undefined,
  accountId: string,
): RiskLimits {
  return declared?.[accountId] ?? {};
}

/** True when ANY limit is declared for the account (gate runs). */
export function hasAnyLimit(limits: RiskLimits): boolean {
  return (
    limits.maxOrderQuantity !== undefined ||
    limits.maxPositionQuantity !== undefined ||
    limits.maxLeverage !== undefined ||
    limits.maxGrossExposure !== undefined ||
    limits.maxDrawdown !== undefined ||
    limits.minBuyingPowerAfterOrder !== undefined
  );
}

/** Normalize a Ratio to the 12-digit fixed point (see module header). */
export function ratioToScaled(ratio: number): bigint {
  if (!Number.isFinite(ratio) || ratio < 0) {
    throw new Error(`risk limits: ratio ${String(ratio)} must be a finite non-negative number`);
  }
  return BigInt(Math.round(ratio * 10 ** 12));
}

function isMoneyShape(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { amount?: unknown }).amount === "string" &&
    Number((value as { amount: string }).amount) >= 0
  );
}

/** Structural validation of declared limits (fail fast at engine creation). */
export function validateRiskLimits(limits: unknown, at: string): string[] {
  const errors: string[] = [];
  const candidate = limits as Partial<RiskLimits> | undefined;
  if (candidate === undefined || typeof candidate !== "object") {
    return errors;
  }
  for (const field of ["maxOrderQuantity", "maxPositionQuantity"] as const) {
    const value = candidate[field];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "string" || !(Number(value) > 0)) {
      errors.push(`${at}.${field} must be a positive decimal string when present`);
    }
  }
  if (candidate.maxLeverage !== undefined && !(candidate.maxLeverage > 0)) {
    errors.push(`${at}.maxLeverage must be positive when present`);
  }
  for (const field of [
    "maxGrossExposure",
    "maxDrawdown",
    "minBuyingPowerAfterOrder",
  ] as const) {
    const value = candidate[field];
    if (value === undefined) {
      continue;
    }
    if (!isMoneyShape(value)) {
      errors.push(`${at}.${field} must be a Money when present`);
    }
  }
  return errors;
}
