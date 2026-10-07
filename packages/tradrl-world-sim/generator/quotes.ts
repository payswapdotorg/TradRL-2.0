/**
 * Quote derivation of the generator (W017): the top-of-book quote as a
 * projection of the AUTHORITATIVE book — the generator never fabricates
 * prices; a quote event is honest evidence of what the real matching state
 * says (spec/DOMAIN-MODEL.md "Ownership": the book is the venue's truth).
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md B — "quote changes" from the
 * deterministic market generator; W004 contracts (`QuoteUpdatePayload`).
 */

import type { Instrument, Price, Quantity } from "tradrl-world-contracts";
import type { QuoteUpdatePayload } from "tradrl-world-contracts/time";
import { bestLevel, formatScaled, parseScaled } from "../orderbook/index.js";
import type { BookState } from "../orderbook/index.js";
import type { Scaled } from "../orderbook/index.js";

/** The raw top-of-book facts of one book (undefined sides are one-sided). */
export interface TopOfBook {
  readonly bid?: Price;
  readonly bidSize?: Quantity;
  readonly ask?: Price;
  readonly askSize?: Quantity;
  readonly last?: Price;
}

/** Aggregate remaining quantity of one book level, on the internal scale. */
function levelTotal(level: { readonly entries: readonly { readonly remaining: Scaled }[] }): Scaled {
  let total = 0n;
  for (const entry of level.entries) total += entry.remaining;
  return total;
}

/** The top-of-book facts of the authoritative book. */
export function topOfBook(book: BookState): TopOfBook {
  const bestBid = bestLevel(book, "buy");
  const bestAsk = bestLevel(book, "sell");
  return {
    ...(bestBid === undefined
      ? {}
      : {
          bid: bestBid.price,
          bidSize: formatScaled(levelTotal(bestBid), 12) as Quantity,
        }),
    ...(bestAsk === undefined
      ? {}
      : {
          ask: bestAsk.price,
          askSize: formatScaled(levelTotal(bestAsk), 12) as Quantity,
        }),
    ...(book.lastTradePrice === undefined ? {} : { last: book.lastTradePrice }),
  };
}

/** Build the W004 `market.quote.updated` payload from the book. */
export function quotePayloadOf(instrumentId: Instrument["instrumentId"], book: BookState): QuoteUpdatePayload {
  const top = topOfBook(book);
  return {
    type: "market.quote.updated",
    instrumentId,
    ...(top.bid === undefined ? {} : { bid: top.bid }),
    ...(top.bidSize === undefined ? {} : { bidSize: top.bidSize }),
    ...(top.ask === undefined ? {} : { ask: top.ask }),
    ...(top.askSize === undefined ? {} : { askSize: top.askSize }),
    ...(top.last === undefined ? {} : { last: top.last }),
  };
}

/** Structural equality of two quotes (field-wise, undefined-aware). */
export function sameQuote(a: TopOfBook | undefined, b: TopOfBook | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return (
    a.bid === b.bid &&
    a.bidSize === b.bidSize &&
    a.ask === b.ask &&
    a.askSize === b.askSize &&
    a.last === b.last
  );
}

/** Round a scaled value onto the tick grid (deterministic: half up). */
export function snapToTick(value: Scaled, tick: Scaled): Scaled {
  return (value + tick / 2n) / tick * tick;
}

/** Snap a plain number onto the instrument's tick grid (deterministic). */
export function snapNumberToTick(value: number, instrument: Instrument): Scaled {
  return snapToTick(parseScaled(`${value.toFixed(12)}` as never), parseScaled(instrument.tickSize));
}
/** How a regime's market makers derive their reference price. */
export type ReferenceMode = "tape" | "anchor";

/**
 * The market-maker reference price for a turn.
 *
 * - `"tape"` (trend/high-volatility/low-liquidity/shock/halt-reopen): the
 *   mark blends the quoted mid with the last printed trade — every printed
 *   trade moves the reference half-way toward the tape, so directional
 *   aggressive flow walks the quotes (drift emerges from real matching).
 * - `"anchor"` (mean-reversion): the declared `anchorPrice` — quotes stay
 *   pinned around the anchor and the tape oscillates inside the band.
 *
 * Fallbacks (both modes): one-sided books follow the quoted side, then the
 * last trade, then the declared anchor. Undefined when nothing is known —
 * the market maker waits, never fabricating a price.
 */
export function referencePriceOf(
  book: BookState,
  instrument: Instrument,
  anchorPrice: number | undefined,
  mode: ReferenceMode = "tape",
): Scaled | undefined {
  const tick = parseScaled(instrument.tickSize);
  const bestBid = bestLevel(book, "buy");
  const bestAsk = bestLevel(book, "sell");
  const last = book.lastTradePrice === undefined ? undefined : parseScaled(book.lastTradePrice);
  if (mode === "anchor" && anchorPrice !== undefined) {
    return snapNumberToTick(anchorPrice, instrument);
  }
  if (bestBid !== undefined && bestAsk !== undefined) {
    const mid = (bestBid.priceScaled + bestAsk.priceScaled) / 2n;
    return last === undefined ? snapToTick(mid, tick) : snapToTick((mid + last) / 2n, tick);
  }
  if (bestBid !== undefined) {
    return bestBid.priceScaled;
  }
  if (bestAsk !== undefined) {
    return bestAsk.priceScaled;
  }
  if (last !== undefined) {
    return snapToTick(last, tick);
  }
  if (anchorPrice !== undefined) {
    return snapNumberToTick(anchorPrice, instrument);
  }
  return undefined;
}

/** Format a scaled price as canonical decimal text. */
export function formatPrice(scaled: Scaled): Price {
  return formatScaled(scaled, 12) as Price;
}
