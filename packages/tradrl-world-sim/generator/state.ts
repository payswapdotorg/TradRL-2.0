/**
 * The market-generator state slice (W017 `generator` module).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — state mutates ONLY by reducing
 * journaled events — and A9 — the live generator and journal replay advance
 * this state through the EXACT same reducer (single-path law; world/state.ts
 * delegates generator event types here, exactly like it delegates matching
 * event types to the W014 reducer).
 *
 * The slice owns the two facts the generator's own events assert:
 * - `market.regime.changed` → the regime window in force (the last
 *   announcement; windows that end into a schedule gap leave it in place —
 *   the payload taxonomy has no "no regime" target, documented honestly);
 * - `market.quote.updated` → verified against the authoritative book at the
 *   event's stream position (like the W014 book-delta verification: a quote
 *   event that disagrees with the book is journal corruption and fails
 *   closed with EngineInvariantError).
 */

import type { RegimeKind, TimestampMs } from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { QuoteUpdatePayload } from "tradrl-world-contracts/time";
import { bestLevel, formatScaled, parseScaled } from "../orderbook/index.js";
import type { BookState } from "../orderbook/index.js";
import type { MatchingState } from "../matching/state.js";
import { EngineInvariantError } from "../world/errors.js";
import { isQuoteUpdatePayload, isRegimeChangePayload } from "./events.js";

/** The regime in force per the last `market.regime.changed` event. */
export interface ActiveRegime {
  readonly regime: RegimeKind;
  /** Simulation time the announcement carried (the boundary time). */
  readonly since: TimestampMs;
  /** The schedule-entry parameters the announcement carried, when present. */
  readonly parameters?: Readonly<Record<string, number>>;
}

/** The authoritative market-generator slice of the world state. */
export interface MarketGeneratorState {
  readonly activeRegime?: ActiveRegime;
}

/** The initial (pre-announcement) generator state. */
export function initialMarketGeneratorState(): MarketGeneratorState {
  return Object.freeze({});
}

function reduceRegimeChange(
  state: MarketGeneratorState,
  payload: { readonly to: RegimeKind; readonly parameters?: Readonly<Record<string, number>> },
  envelope: WorldEventEnvelope,
): MarketGeneratorState {
  const active: ActiveRegime = {
    regime: payload.to,
    since: envelope.occurredAt,
    ...(payload.parameters === undefined ? {} : { parameters: payload.parameters }),
  };
  return Object.freeze({ ...state, activeRegime: active });
}

/** Aggregate remaining quantity of one book level, on the internal scale. */
function levelTotal(level: { readonly entries: readonly { readonly remaining: bigint }[] }): bigint {
  let total = 0n;
  for (const entry of level.entries) total += entry.remaining;
  return total;
}

/**
 * Verify a `market.quote.updated` payload against the authoritative book at
 * this stream position: every present field must agree with the book's
 * top-of-book (absent fields must be absent in the book). The generator
 * derives quotes from the live book, so live journals verify by
 * construction; a disagreement is a corrupt/foreign journal (fail closed).
 */
function verifyQuoteAgainstBook(
  payload: QuoteUpdatePayload,
  book: BookState,
  envelope: WorldEventEnvelope,
): void {
  const bestBid = bestLevel(book, "buy");
  const bestAsk = bestLevel(book, "sell");
  const expectBid = bestBid === undefined ? undefined : bestBid.price;
  const expectBidSize = bestBid === undefined ? undefined : formatScaled(levelTotal(bestBid), 12);
  const expectAsk = bestAsk === undefined ? undefined : bestAsk.price;
  const expectAskSize = bestAsk === undefined ? undefined : formatScaled(levelTotal(bestAsk), 12);
  const fields: readonly [string, unknown, unknown][] = [
    ["bid", payload.bid, expectBid],
    ["bidSize", payload.bidSize, expectBidSize],
    ["ask", payload.ask, expectAsk],
    ["askSize", payload.askSize, expectAskSize],
    ["last", payload.last, book.lastTradePrice],
  ];
  for (const [field, actual, expected] of fields) {
    if (actual === undefined) {
      if (expected !== undefined) {
        throw new EngineInvariantError(
          `quote event ${String(envelope.eventId)} omits ${field} but the book has ${String(expected)}`,
        );
      }
      continue;
    }
    if (expected === undefined || parseScaled(actual as never) !== parseScaled(expected as never)) {
      throw new EngineInvariantError(
        `quote event ${String(envelope.eventId)} ${field} ${String(actual)} disagrees with the book ` +
          `(expected ${String(expected)})`,
      );
    }
  }
}

/**
 * Reduce one generator-state event. Pure; the single way this slice ever
 * advances — live (right after the engine journals the generator's drafts)
 * and replay alike.
 */
export function reduceMarketGeneratorEvent(
  state: MarketGeneratorState | undefined,
  matching: MatchingState,
  envelope: WorldEventEnvelope,
): MarketGeneratorState {
  const current = state ?? initialMarketGeneratorState();
  switch (envelope.eventType) {
    case "market.regime.changed": {
      if (!isRegimeChangePayload(envelope.payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed market.regime.changed`,
        );
      }
      return reduceRegimeChange(current, envelope.payload, envelope);
    }
    case "market.quote.updated": {
      if (!isQuoteUpdatePayload(envelope.payload)) {
        throw new EngineInvariantError(
          `event ${String(envelope.eventId)}: malformed market.quote.updated`,
        );
      }
      const book = matching.books[String(envelope.payload.instrumentId)];
      if (book === undefined) {
        throw new EngineInvariantError(
          `quote event ${String(envelope.eventId)}: no book for instrument ${String(envelope.payload.instrumentId)}`,
        );
      }
      verifyQuoteAgainstBook(envelope.payload, book, envelope);
      return current;
    }
    default:
      throw new EngineInvariantError(
        `market-generator reducer cannot reduce event type '${envelope.eventType}'`,
      );
  }
}
