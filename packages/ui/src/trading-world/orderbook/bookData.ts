/**
 * World-driven DOM ladder transforms — W009 (the order-book half).
 *
 * Deterministic projection of the world-client `OrderBookSnapshot` projection
 * (`query.getOrderBook`, the W014 venue truth) into the ladder the DOM surface
 * renders: per-level price/size/order-count, CUMULATIVE DEPTH per side
 * (computed from the snapshot's actual levels, exact decimal arithmetic), and
 * the spread/mid around the top of book. PURE functions — the React surface
 * (`./OrderBookToolSurface.tsx`) only calls them; nothing here touches React
 * or the DOM.
 *
 * Laws (ARCHITECTURE-LOCK A6 + WORLD-PROTOCOL "UI projection law"):
 * - NEVER INVENT FACTS: every price/size/order-count is the snapshot's own
 *   canonical text, verbatim; cumulative depth and totals are exact sums of
 *   those levels (BigInt-scaled — no float artifacts); the spread/mid derive
 *   only from the real best bid/ask. An empty book stays EMPTY (no seeded
 *   ladder, no guessed levels).
 * - NEVER RE-SORT: the snapshot's side order IS the venue truth (bids best
 *   (highest) first, asks best (lowest) first — the W003 convention). The
 *   projection VALIDATES that order and fails with a typed error on
 *   violation; it never reorders levels client-side.
 */

import {
  addDecimalText,
  compareDecimalParts,
  decimalPlacesOf,
  formatDecimalParts,
  halveDecimalText,
  OrderBookProjectionDataError,
  parseDecimalText,
  subtractDecimalText,
  type DecimalParts,
} from "./decimalText.js";

/**
 * Structural mirror of the W003 `InstrumentId` opaque brand (the W007
 * `ChartInstrumentId` pattern): the ladder treats instrument identity as an
 * opaque query key while the port call sites stay type-checked against the
 * real branded signature.
 */
export type OrderBookInstrumentId = string & { readonly __brand: "InstrumentId" };

/**
 * Minimal structural slice of the W003 `BookLevel` contract. Structural (not
 * imported): the real branded types are assignable to it, so contracts drift
 * breaks the surface's call site at compile time (W006 shim rationale).
 */
export interface BookLevelProjection {
  /** Canonical decimal text (W003 Price). */
  readonly price: string;
  /** Canonical decimal text (W003 Quantity). */
  readonly quantity: string;
  readonly orderCount?: number;
}

/** Minimal structural slice of the W003 `OrderBookSnapshot` contract. */
export interface OrderBookSnapshotProjection {
  readonly instrumentId: string;
  /** Simulation-time ms of the observation (W004; the book's own `asOf`). */
  readonly asOf: number;
  /** Journal sequence of the snapshot (monotonic venue truth). */
  readonly sequence: number;
  /** Bid levels, best (highest) first — the W003 convention. */
  readonly bids: readonly BookLevelProjection[];
  /** Ask levels, best (lowest) first — the W003 convention. */
  readonly asks: readonly BookLevelProjection[];
}

/** One ladder row: the level verbatim plus its cumulative depth. */
export interface DomLadderRow {
  readonly price: string;
  readonly quantity: string;
  readonly orderCount?: number;
  /** Exact sum of this side's quantities from the best level through here. */
  readonly cumulative: string;
}

/** One side of the ladder (levels stay best-first, the snapshot's order). */
export interface DomLadderSide {
  readonly levels: readonly DomLadderRow[];
  /** Exact total resting quantity of the whole side. */
  readonly totalQuantity: string;
}

/** The full DOM ladder projection over one book snapshot. */
export interface DomLadderProjection {
  readonly instrumentId: string;
  readonly asOf: number;
  readonly sequence: number;
  readonly bids: DomLadderSide;
  readonly asks: DomLadderSide;
  readonly bestBid?: DomLadderRow;
  readonly bestAsk?: DomLadderRow;
  /** `ask − bid` (exact decimal text) when both sides have liquidity. */
  readonly spread?: string;
  /** `(bid + ask) / 2` (exact decimal text) when both sides have liquidity. */
  readonly mid?: string;
  /** Total number of levels (bids + asks) in the source snapshot. */
  readonly levelCount: number;
  /** Decimal places derived from the observed canonical price text. */
  readonly priceDisplayPrecision: number;
}

/** Validate + project one side into ladder rows with cumulative depth. */
function buildSide(
  side: "bid" | "ask",
  levels: readonly BookLevelProjection[],
): DomLadderSide {
  let cumulative = { units: 0n, scale: 0 };
  const rows: DomLadderRow[] = [];
  let previousPrice: DecimalParts | undefined;
  for (const level of levels) {
    const price = parseDecimalText(level.price, `BookLevel(${side}).price`);
    const quantity = parseDecimalText(level.quantity, `BookLevel(${side}).quantity`);
    if (quantity.units < 0n) {
      throw new OrderBookProjectionDataError(
        `BookLevel(${side}).quantity ${JSON.stringify(level.quantity)} is negative`,
      );
    }
    if (previousPrice !== undefined) {
      // The snapshot's side order is the venue truth (bids strictly
      // descending, asks strictly ascending, best first). A violation is
      // malformed data — loud, never silently re-sorted.
      const descending = compareDecimalParts(previousPrice, price) > 0;
      const ascending = compareDecimalParts(previousPrice, price) < 0;
      if (side === "bid" ? !descending : !ascending) {
        throw new OrderBookProjectionDataError(
          `${side} levels are not ${side === "bid" ? "descending" : "ascending"} ` +
            `by price (${formatDecimalParts(previousPrice)} then ${level.price})`,
        );
      }
    }
    previousPrice = price;
    cumulative = addDecimalText(cumulative, quantity);
    rows.push({
      price: level.price,
      quantity: level.quantity,
      ...(level.orderCount === undefined ? {} : { orderCount: level.orderCount }),
      cumulative: formatDecimalParts(cumulative),
    });
  }
  return { levels: rows, totalQuantity: formatDecimalParts(cumulative) };
}

/**
 * Build the DOM ladder projection from an `OrderBookSnapshot` projection.
 *
 * Deterministic algorithm: validate every level (canonical decimal text,
 * non-negative quantities, the W003 side ordering), accumulate the exact
 * cumulative depth from the best level outward per side, and derive the
 * spread/mid from the real best bid/ask when both sides have liquidity.
 */
export function buildDomLadderProjection(
  snapshot: OrderBookSnapshotProjection,
): DomLadderProjection {
  if (typeof snapshot.instrumentId !== "string" || snapshot.instrumentId.length === 0) {
    throw new OrderBookProjectionDataError(
      "OrderBookSnapshot.instrumentId must be a non-empty string",
    );
  }
  if (!Number.isFinite(snapshot.asOf)) {
    throw new OrderBookProjectionDataError(
      `OrderBookSnapshot.asOf ${snapshot.asOf} is not a finite simulation timestamp`,
    );
  }
  if (!Number.isFinite(snapshot.sequence)) {
    throw new OrderBookProjectionDataError(
      `OrderBookSnapshot.sequence ${snapshot.sequence} is not finite`,
    );
  }
  const bids = buildSide("bid", snapshot.bids);
  const asks = buildSide("ask", snapshot.asks);
  const bestBid = bids.levels[0];
  const bestAsk = asks.levels[0];
  const bothSides = bestBid !== undefined && bestAsk !== undefined;
  const bestBidPrice = bestBid === undefined ? undefined : parseDecimalText(bestBid.price, "bid");
  const bestAskPrice = bestAsk === undefined ? undefined : parseDecimalText(bestAsk.price, "ask");
  let spread: string | undefined;
  let mid: string | undefined;
  if (bestBidPrice !== undefined && bestAskPrice !== undefined) {
    // A crossed book (best bid ≥ best ask) is malformed venue truth — loud.
    if (compareDecimalParts(bestBidPrice, bestAskPrice) >= 0) {
      throw new OrderBookProjectionDataError(
        `the book is crossed (best bid ${bestBid!.price} ≥ best ask ${bestAsk!.price})`,
      );
    }
    spread = formatDecimalParts(subtractDecimalText(bestAskPrice, bestBidPrice));
    mid = formatDecimalParts(halveDecimalText(addDecimalText(bestBidPrice, bestAskPrice)));
  }
  const priceDisplayPrecision = [...snapshot.bids, ...snapshot.asks].reduce(
    (max, level) => Math.max(max, decimalPlacesOf(level.price)),
    0,
  );
  return {
    instrumentId: snapshot.instrumentId,
    asOf: snapshot.asOf,
    sequence: snapshot.sequence,
    bids,
    asks,
    ...(bestBid === undefined ? {} : { bestBid }),
    ...(bestAsk === undefined ? {} : { bestAsk }),
    ...(bothSides && spread !== undefined && mid !== undefined ? { spread, mid } : {}),
    levelCount: snapshot.bids.length + snapshot.asks.length,
    priceDisplayPrecision,
  };
}

/**
 * The default instrument the W009 surfaces project when the composition does
 * not bind one explicitly: the alpha-world convention
 * (`instrument-es-${worldId}`, mirroring `../runtime/engineAttachment.ts` —
 * see the drift-guard test in packages/ui/test/).
 */
export function alphaInstrumentIdForWorld(worldId: string): OrderBookInstrumentId {
  return `instrument-es-${worldId}` as OrderBookInstrumentId;
}

/** Display window of one side (the best `maxLevels` rows; batching only). */
export function windowDomLadderSide(
  side: DomLadderSide,
  maxLevels: number,
): readonly DomLadderRow[] {
  if (!Number.isInteger(maxLevels) || maxLevels < 1) {
    throw new OrderBookProjectionDataError(
      `maxLevels must be a positive integer, got ${maxLevels}`,
    );
  }
  return side.levels.slice(0, maxLevels);
}
