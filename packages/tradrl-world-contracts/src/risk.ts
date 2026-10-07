/**
 * Risk contracts: limits, gates and check outcomes.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — "Risk, authorization, venue policy
 * and execution gates are runtime controls, not model prompt instructions."
 * Spec: spec/REQUIREMENTS.md R024 — runtime authority cannot be bypassed by
 * models.
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md D — risk is part of financial state.
 *
 * These contracts make risk gates *typed runtime controls*: every order
 * passes through named gates whose limits and outcomes are first-class
 * values, so no participant (human, endogenous or model-driven) can route
 * around them.
 */

import type { AccountId, WorldId } from "./ids.js";
import type { Money, Quantity, Ratio, TimestampMs } from "./primitives.js";

/** Named risk gates enforced by the runtime (A13: outside prompts). */
export type RiskGateId =
  | "buying-power"
  | "order-size"
  | "position-limit"
  | "leverage"
  | "gross-exposure"
  | "drawdown";

/** Limits for the risk gates. Unset limits are not enforced. */
export interface RiskLimits {
  readonly maxOrderQuantity?: Quantity;
  /** Absolute (unsigned) position quantity cap per instrument. */
  readonly maxPositionQuantity?: Quantity;
  readonly maxLeverage?: Ratio;
  readonly maxGrossExposure?: Money;
  readonly maxDrawdown?: Money;
  /** Buying-power floor that must survive after an order. */
  readonly minBuyingPowerAfterOrder?: Money;
}

/** A limit breach observed at runtime. */
export interface RiskBreach {
  readonly gate: RiskGateId;
  readonly detail: string;
  readonly occurredAt: TimestampMs;
}

/** Authoritative risk state for one account (projections consume it). */
export interface RiskState {
  readonly accountId: AccountId;
  readonly worldId: WorldId;
  readonly limits: RiskLimits;
  readonly breaches: readonly RiskBreach[];
  readonly asOf: TimestampMs;
}

/**
 * Outcome of running one risk gate: either it passed, or it failed with the
 * limit, the requested value and a human-readable message. Failed gates are
 * the authority — rejections cite them (R024).
 */
export type RiskCheckOutcome =
  | { readonly gate: RiskGateId; readonly passed: true }
  | {
      readonly gate: RiskGateId;
      readonly passed: false;
      readonly limit: string;
      readonly requested: string;
      readonly message: string;
    };
