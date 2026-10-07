/**
 * The portfolio state slice (W015 `portfolio` module): the per-account
 * position ledger, advanced ONLY by reducing journaled events — the W014
 * fills that trade and the W014 trade prints that mark.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6/A9 — the same reducer advances live
 * state (right after append) and replay state (in stored order); state is a
 * pure function of (world definition, journal), so replay is bit-identical.
 * Spec: spec/DOMAIN-MODEL.md "Ownership" — World Engine → authoritative
 * live state; spec/REQUIREMENTS.md R023 (causal portfolio updates: every
 * position change is caused by a journaled `matching.order.filled`).
 *
 * Consumed events (the closed set this slice reduces — no new event types:
 * the W014 matching taxonomy is the causal truth):
 * - `matching.order.filled` — the fill updates the (account, instrument)
 *   position: quantity, average entry, realized/unrealized P&L, mark.
 * - `market.trade.printed` — mark-to-market refresh: every open position in
 *   that instrument re-marks at the printed price (unrealized P&L follows
 *   the world's market state).
 */

import type { AccountId, InstrumentId } from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { isOrderFilledPayload } from "../matching/index.js";
import {
  applyFillToPosition,
  remarkPosition,
  type FillInput,
  type PositionRecord,
} from "./positions.js";

/** Event types the financial slices reduce (subset of the W014 taxonomy). */
export const FINANCIAL_EVENT_TYPES: readonly string[] = [
  "matching.order.filled",
  "market.trade.printed",
];

/** Type guard: does this event type advance the financial slices? */
export function isFinancialEventType(eventType: string): boolean {
  return FINANCIAL_EVENT_TYPES.includes(eventType);
}

/**
 * The portfolio state: one position ledger per account. Records persist
 * after closing (lifetime realized P&L is the audit trail; projections
 * filter to open quantities).
 */
export interface PortfolioState {
  /** Deterministic insertion order — never reordered, only updated in place. */
  readonly positions: readonly PositionRecord[];
}

/** Build the initial portfolio state (no positions until the first fill). */
export function initialPortfolioState(): PortfolioState {
  return { positions: [] };
}

/** Locate the position record of one (account, instrument) ledger. */
export function positionOf(
  state: PortfolioState,
  accountId: AccountId,
  instrumentId: InstrumentId,
): PositionRecord | undefined {
  return state.positions.find(
    (record) => record.accountId === accountId && record.instrumentId === instrumentId,
  );
}

/** Replace (or append) one record, keeping deterministic order. */
function withPosition(state: PortfolioState, record: PositionRecord): PortfolioState {
  const index = state.positions.findIndex(
    (candidate) => candidate.accountId === record.accountId && candidate.instrumentId === record.instrumentId,
  );
  if (index === -1) {
    return { positions: [...state.positions, record] };
  }
  return { positions: state.positions.map((candidate, i) => (i === index ? record : candidate)) };
}

/**
 * Reduce one journaled event into the portfolio state. `orderSideOf` looks
 * the fill's order side up in the matching slice's order registry (the fill
 * payload carries no side — the order does; the matcher always journals the
 * order before its fills, so the registry is authoritative venue truth and
 * a missing order means a corrupt journal — the resolver fails closed).
 */
export function reducePortfolioEvent(
  state: PortfolioState,
  envelope: WorldEventEnvelope,
  orderSideOf: (orderId: string) => "buy" | "sell",
): PortfolioState {
  switch (envelope.eventType) {
    case "matching.order.filled": {
      if (!isOrderFilledPayload(envelope.payload)) {
        return state;
      }
      const payload = envelope.payload;
      const previous = positionOf(state, payload.accountId, payload.instrumentId);
      const fill: FillInput = {
        accountId: payload.accountId,
        instrumentId: payload.instrumentId,
        side: orderSideOf(payload.orderId),
        price: payload.price,
        quantity: payload.quantity,
        quoteCurrency: payload.fee.currency,
        occurredAt: envelope.occurredAt,
      };
      const { record } = applyFillToPosition(previous, fill, envelope.worldId);
      return withPosition(state, record);
    }
    case "market.trade.printed": {
      const payload = envelope.payload as { instrumentId?: unknown; price?: unknown };
      if (typeof payload?.instrumentId !== "string" || typeof payload?.price !== "string") {
        return state;
      }
      const instrumentId = payload.instrumentId as InstrumentId;
      const price = payload.price;
      let changed = false;
      const positions = state.positions.map((record) => {
        if (record.instrumentId !== instrumentId) {
          return record;
        }
        changed = true;
        return remarkPosition(record, price, envelope.occurredAt);
      });
      return changed ? { positions } : state;
    }
    default:
      return state;
  }
}
