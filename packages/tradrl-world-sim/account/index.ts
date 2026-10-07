/**
 * Public surface of the W015 `account` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine └─ accounts`).
 * The account ledger is the authoritative balance/margin truth; the
 * acceptance checks are the A13 runtime controls the command lifecycle
 * consults before the venue (matching seam) sees a submission.
 */

export {
  formatLedgerMoney,
  initialAccountLedgerState,
  ledgerOf,
  projectBalances,
  reduceAccountLedgerEvent,
  type AccountLedger,
  type AccountLedgerState,
} from "./state.js";
export {
  computeAccountFinancials,
  formatFinancials,
  marginForPosition,
  notionalForPosition,
  projectAccount,
  type AccountFinancials,
} from "./margin.js";
export {
  checkOrderAcceptance,
  sizingReferencePrice,
  worstCaseMarketPrice,
  type OrderAcceptanceInput,
  type OrderAcceptanceOutcome,
} from "./acceptance.js";
