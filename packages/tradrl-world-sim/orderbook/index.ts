/**
 * Public surface of the W014 `orderbook` module.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine └─ orderbook`).
 * The book is the authoritative per-instrument limit-order structure the
 * matching engine (W014 `matching/`) executes against; the world core
 * rebuilds it during replay through these same pure functions.
 */

export {
  DECIMAL_SCALE,
  compareScaled,
  formatScaled,
  isCanonicalDecimal,
  isMultipleOf,
  mulDivHalfUp,
  parseScaled,
  type Scaled,
} from "./decimal.js";
export {
  aggressiveLevels,
  bestLevel,
  bookSnapshot,
  canonicalPrice,
  diffBookStates,
  findBookOrder,
  formatQuantity,
  haltBook,
  initialBookState,
  placeOrder,
  priceScaled,
  quantityScaled,
  reduceOrder,
  removeOrder,
  reopenBook,
  withLastTradePrice,
  type BookEntry,
  type BookLevelState,
  type BookState,
  type LocatedBookOrder,
} from "./book.js";
