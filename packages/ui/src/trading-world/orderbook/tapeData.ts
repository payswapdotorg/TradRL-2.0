/**
 * World-driven Time & Sales tape transforms — W009 (the tape half).
 *
 * Deterministic projection of the world-client `Trade` projections
 * (`query.getTrades`, the W014 trade tape behind the venue's availableAt
 * firewall) into the tape the Time & Sales surface renders: the chronological
 * prints with their true journal sequence, shown MOST RECENT FIRST. PURE
 * functions — the React surface (`./TimeAndSalesToolSurface.tsx`) only calls
 * them; nothing here touches React or the DOM.
 *
 * Laws (ARCHITECTURE-LOCK A6 + WORLD-PROTOCOL "UI projection law"):
 * - NEVER INVENT FACTS: every time/price/size/side value is the projection's
 *   own value, verbatim; rows keep their true `tradeId`/`sequence` — nothing
 *   is renumbered, aggregated or interpolated.
 * - THE PROJECTION'S ORDER IS THE TRUTH: the engine returns prints in journal
 *   order (ascending sequence — validated here, loud on violation). The tape
 *   display is the exact REVERSE of that order (newest print on top) plus a
 *   tail display window — pure presentation of the ordered list, NEVER a
 *   client-side re-sort: no price/time/tradeId sort is ever applied.
 * - WHY NO `limit` QUERY: `getTrades` slices from the OLDEST prints, so a
 *   limit would show a stale head of the tape; the surface reads the full
 *   projection and windows the most recent rows (display batching only).
 */

import { OrderBookProjectionDataError, parseDecimalText } from "./decimalText.js";

/** Minimal structural slice of the W003 `Trade` contract (the tape print). */
export interface TapeTradePrint {
  readonly tradeId: string;
  readonly price: string;
  readonly quantity: string;
  /** Aggressor side of the print (W003 OrderSide). */
  readonly aggressorSide: "buy" | "sell";
  /** Simulation-time ms when the trade occurred (W004). */
  readonly occurredAt: number;
  /** Monotonic per-world journal sequence — the tape's true order. */
  readonly sequence: number;
}

/** One tape row: the print verbatim (nothing renumbered). */
export type TapeRow = TapeTradePrint;

/** The full tape projection over the engine's trade prints. */
export interface TapeProjection {
  /** Newest-first display rows (the exact reverse of the journal order). */
  readonly rows: readonly TapeRow[];
  /** Total prints in the source projection (nothing dropped silently). */
  readonly totalPrints: number;
  /** Sequence range of the FULL source projection (journal order). */
  readonly fromSequence?: number;
  readonly toSequence?: number;
  /** Price of the newest print (the tape's "last"), when any. */
  readonly lastPrice?: string;
}

/** Options for building the tape projection. */
export interface TapeBuildOptions {
  /** Display window: how many of the most recent prints to keep (≥1). */
  readonly maxRows: number;
}

/** Validate one print (canonical decimals, finite time, lawful side). */
function assertValidPrint(trade: TapeTradePrint, index: number): void {
  const at = `Trade[${index}]`;
  if (typeof trade.tradeId !== "string" || trade.tradeId.length === 0) {
    throw new OrderBookProjectionDataError(`${at}.tradeId must be a non-empty string`);
  }
  parseDecimalText(trade.price, `${at}.price`);
  parseDecimalText(trade.quantity, `${at}.quantity`);
  if (trade.aggressorSide !== "buy" && trade.aggressorSide !== "sell") {
    throw new OrderBookProjectionDataError(
      `${at}.aggressorSide must be "buy" | "sell", got ${JSON.stringify(trade.aggressorSide)}`,
    );
  }
  if (!Number.isFinite(trade.occurredAt)) {
    throw new OrderBookProjectionDataError(
      `${at}.occurredAt ${trade.occurredAt} is not a finite simulation timestamp`,
    );
  }
  if (!Number.isFinite(trade.sequence)) {
    throw new OrderBookProjectionDataError(`${at}.sequence ${trade.sequence} is not finite`);
  }
}

/**
 * Build the tape projection from the engine's `Trade` projections.
 *
 * Deterministic algorithm: validate every print, validate the journal order
 * (sequences strictly ascending, times non-decreasing — the projection's
 * order is the truth, a violation is malformed data), window the most recent
 * `maxRows` prints, and present them newest-first (the exact reverse of the
 * journal order; no other ordering is ever applied).
 */
export function buildTimeAndSalesProjection(
  trades: readonly TapeTradePrint[],
  options: TapeBuildOptions,
): TapeProjection {
  if (!Number.isInteger(options.maxRows) || options.maxRows < 1) {
    throw new OrderBookProjectionDataError(
      `maxRows must be a positive integer, got ${options.maxRows}`,
    );
  }
  let previous: TapeTradePrint | undefined;
  for (let index = 0; index < trades.length; index += 1) {
    const trade = trades[index]!;
    assertValidPrint(trade, index);
    if (previous !== undefined) {
      // Journal order is the law: sequences strictly ascending, occurrence
      // times non-decreasing. Loud on violation — never re-sorted.
      if (!(trade.sequence > previous.sequence)) {
        throw new OrderBookProjectionDataError(
          `Trade[${index}].sequence ${trade.sequence} does not follow ` +
            `${previous.sequence} — the projection is not in journal order`,
        );
      }
      if (trade.occurredAt < previous.occurredAt) {
        throw new OrderBookProjectionDataError(
          `Trade[${index}].occurredAt ${trade.occurredAt} precedes ` +
            `${previous.occurredAt} — the projection is not chronological`,
        );
      }
    }
    previous = trade;
  }
  const window = trades.slice(Math.max(0, trades.length - options.maxRows));
  // Newest first: the exact reverse of the (validated) journal order.
  const rows = [...window].reverse();
  const first = trades[0];
  const last = trades[trades.length - 1];
  const newest = rows[0];
  return {
    rows,
    totalPrints: trades.length,
    ...(first === undefined ? {} : { fromSequence: first.sequence }),
    ...(last === undefined ? {} : { toSequence: last.sequence }),
    ...(newest === undefined ? {} : { lastPrice: newest.price }),
  };
}

/**
 * Deterministic simulation-time tape label: UTC time-of-day with milliseconds,
 * zero-padded, no locale dependencies (the same instant always formats
 * identically on every platform).
 */
export function formatTapeTimestampMs(simulationMs: number): string {
  const date = new Date(simulationMs);
  if (Number.isNaN(date.getTime())) {
    throw new OrderBookProjectionDataError(
      `timestamp ${simulationMs} is not a valid simulation instant`,
    );
  }
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  return (
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`
  );
}

/** Aggressor-side label — TEXT, never color alone (UX-DESIGN disclosure law). */
export function describeAggressorSide(side: "buy" | "sell"): "BUY" | "SELL" {
  return side === "buy" ? "BUY" : "SELL";
}
