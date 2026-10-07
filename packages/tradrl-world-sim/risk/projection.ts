/**
 * The W003 `RiskState` projection (W015 `risk` module): the limits in
 * force and the breach history of one account at an explicit as-of time.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md D (risk is part of financial
 * state), spec/ARCHITECTURE-LOCK.md A13 (the runtime control's read side).
 */

import type { RiskState } from "tradrl-world-contracts";
import type { TimestampMs } from "tradrl-world-contracts";
import { breachesOf, type RiskRuntimeState } from "./state.js";

/** Project the W003 `RiskState` of one account. */
export function projectRiskState(input: {
  readonly worldId: RiskState["worldId"];
  readonly accountId: RiskState["accountId"];
  readonly asOf: TimestampMs;
  readonly risk: RiskRuntimeState;
}): RiskState {
  return {
    accountId: input.accountId,
    worldId: input.worldId,
    limits: input.risk.limits[String(input.accountId)] ?? {},
    breaches: breachesOf(input.risk, String(input.accountId)),
    asOf: input.asOf,
  };
}
