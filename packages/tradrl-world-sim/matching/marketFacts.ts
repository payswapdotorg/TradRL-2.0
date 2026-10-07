/**
 * Market-fact reductions (W014 `matching` module) — the reducer cases for
 * the market events the matcher emits or consumes: `market.trade.printed`
 * (the public tape + the stop-trigger reference), `market.book.delta`
 * (verification of this engine's own projections) and
 * `market.halted`/`market.reopened` (the book's trading-state transitions).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6/A9 — these are stages of the single
 * reduction path (reducer.ts dispatches here); live matching and replay
 * share them exactly.
 *
 * Book-delta law: `market.book.delta` events produced by THIS engine
 * (producer `matching-engine`) are projections of facts already reduced —
 * the reducer verifies them against the queue-derived book and throws on
 * mismatch (journal corruption). Foreign delta events belong to the market
 * generator (W017) and fail closed here.
 */

import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { BookDeltaPayload, TradePrintPayload } from "tradrl-world-contracts/time";
import { haltBook, parseScaled, reopenBook, withLastTradePrice } from "../orderbook/index.js";
import { EngineInvariantError } from "../world/errors.js";
import { MATCHING_PRODUCER } from "./events.js";
import { bookOf, withBook, type MatchingState, type TradeRecord } from "./state.js";

function reduceTradePrint(
  state: MatchingState,
  payload: TradePrintPayload,
  envelope: WorldEventEnvelope,
): MatchingState {
  if (
    typeof payload?.tradeId !== "string" ||
    typeof payload.instrumentId !== "string" ||
    typeof payload.price !== "string" ||
    typeof payload.quantity !== "string" ||
    (payload.aggressorSide !== "buy" && payload.aggressorSide !== "sell")
  ) {
    throw new EngineInvariantError(
      `event ${String(envelope.eventId)}: malformed market.trade.printed`,
    );
  }
  const trade: TradeRecord = {
    tradeId: payload.tradeId,
    worldId: envelope.worldId,
    instrumentId: payload.instrumentId,
    price: payload.price,
    quantity: payload.quantity,
    aggressorSide: payload.aggressorSide,
    occurredAt: envelope.occurredAt,
    sequence: envelope.sequence,
    ...(envelope.availableAt === undefined ? {} : { availableAt: envelope.availableAt }),
  };
  return withBook(
    { ...state, trades: [...state.trades, trade] },
    payload.instrumentId,
    withLastTradePrice(bookOf(state, payload.instrumentId), payload.price),
  );
}

function verifyBookDelta(
  state: MatchingState,
  payload: BookDeltaPayload,
  envelope: WorldEventEnvelope,
): MatchingState {
  if (envelope.producer !== MATCHING_PRODUCER) {
    throw new EngineInvariantError(
      "foreign market.book.delta events are the market generator's surface (W017), not reducible here",
    );
  }
  if (!Array.isArray(payload?.operations) || typeof payload.instrumentId !== "string") {
    throw new EngineInvariantError(
      `event ${String(envelope.eventId)}: malformed market.book.delta`,
    );
  }
  const book = bookOf(state, payload.instrumentId);
  for (const operation of payload.operations) {
    const levels = operation.side === "bid" ? book.bids : book.asks;
    const priceKey = parseScaled(operation.price);
    const level = levels.find((candidate) => candidate.priceScaled === priceKey);
    if (operation.op === "remove") {
      if (level !== undefined) {
        throw new EngineInvariantError(
          `book delta removes live level ${operation.price} (${String(envelope.eventId)})`,
        );
      }
      continue;
    }
    if (level === undefined) {
      throw new EngineInvariantError(
        `book delta sets missing level ${operation.price} (${String(envelope.eventId)})`,
      );
    }
    let total = 0n;
    for (const entry of level.entries) total += entry.remaining;
    if (total !== parseScaled(operation.quantity) || level.entries.length !== operation.orderCount) {
      throw new EngineInvariantError(
        `book delta disagrees with the book at ${operation.price} (${String(envelope.eventId)})`,
      );
    }
  }
  return state;
}

function reduceHaltOrReopen(state: MatchingState, scope: unknown, halted: boolean): MatchingState {
  const target = scope as { kind?: string; instrumentId?: unknown; venueId?: unknown };
  const books: Record<string, MatchingState["books"][string]> = { ...state.books };
  for (const [key, book] of Object.entries(books)) {
    const matches =
      target?.kind === "instrument"
        ? String(book.instrumentId) === String(target.instrumentId)
        : String(book.venueId) === String(target.venueId);
    if (matches) {
      books[key] = halted ? haltBook(book) : reopenBook(book);
    }
  }
  return { ...state, books };
}

export { reduceHaltOrReopen, reduceTradePrint, verifyBookDelta };
