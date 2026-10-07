/**
 * The reduce-only position check (W015 `risk` module) — the W014 typed seam
 * (matching/matcher.ts `ReduceOnlyPositionCheck`) wired to REAL positions.
 *
 * Spec: spec/SIMULATION.md "Matching" (reduce-only), spec/ARCHITECTURE-
 * LOCK.md A13. The venue-side check is DIRECTIONAL (the W014 seam contract
 * receives the account, instrument and side — no quantity): a reduce-only
 * buy on a non-negative position would increase it; a reduce-only sell on
 * a non-positive position would increase it; on a flat position every side
 * would open one. A reduce-only order larger than the opposite position
 * can therefore still flip the position (the quantity-blind venue seam —
 * documented W014 known limitation, visible here for the record; W015's
 * pre-trade gate sizes the full order but the seam's own rejection is the
 * authority for the reduce-only flag).
 */

import type { ReduceOnlyPositionCheck } from "../matching/index.js";
import { positionOf, type PortfolioState } from "../portfolio/index.js";

/**
 * Build the reduce-only check over the live portfolio state. The world
 * engine constructs one per command from the authoritative state.
 */
export function createReduceOnlyCheck(portfolio: PortfolioState): ReduceOnlyPositionCheck {
  return ({ accountId, instrumentId, side }) => {
    const record = positionOf(portfolio, accountId, instrumentId);
    const quantity = record?.quantity ?? 0n;
    return {
      wouldIncreasePosition:
        side === "buy" ? quantity >= 0n : quantity <= 0n,
    };
  };
}
