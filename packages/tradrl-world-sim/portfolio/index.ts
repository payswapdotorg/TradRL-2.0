/**
 * Public surface of the W015 `portfolio` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine └─ portfolio`).
 * The position ledger is the financial truth the account margin model and
 * the risk gates consume; every position change is caused by a journaled
 * W014 event (R023) and reduced through the single-path law (A6/A9).
 */

export {
  MONEY_DECIMALS,
  absScaled,
  compareDecimalText,
  formatSignedMoney,
  isCanonicalSignedMoney,
  parseSignedMoney,
  signedMulDivHalfUp,
  sumScaled,
} from "./decimal.js";
export {
  applyFillToPosition,
  isOpenPosition,
  projectPosition,
  remarkPosition,
  type FillInput,
  type PositionRecord,
  type PositionUpdate,
} from "./positions.js";
export {
  FINANCIAL_EVENT_TYPES,
  initialPortfolioState,
  isFinancialEventType,
  positionOf,
  reducePortfolioEvent,
  type PortfolioState,
} from "./state.js";
export {
  pnlBreakdownOf,
  projectPortfolio,
  type PortfolioFinancialInputs,
} from "./aggregate.js";
export { applyClosePosition, openQuantityOf } from "./closePosition.js";
