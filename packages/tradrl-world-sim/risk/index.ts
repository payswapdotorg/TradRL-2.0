/**
 * Public surface of the W015 `risk` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine └─ risk`).
 * The pre-trade gate is the A13 runtime control the command lifecycle
 * consults; the risk state reducer records breaches from journaled events
 * only (deterministic replay law).
 */

export {
  hasAnyLimit,
  ratioToScaled,
  resolveRiskLimits,
  validateRiskLimits,
  type RiskLimitsByAccount,
} from "./limits.js";
export {
  breachesOf,
  initialRiskRuntimeState,
  reduceRiskEvent,
  type AccountRiskBreach,
  type RiskRuntimeState,
} from "./state.js";
export { projectRiskState } from "./projection.js";
export {
  projectedQuantity,
  runPreTradeRiskGate,
  type PreTradeRiskOutcome,
  type RiskGateInput,
} from "./gate.js";
export { createReduceOnlyCheck } from "./reduceOnly.js";
export { runPreTradeChecks } from "./preTrade.js";
