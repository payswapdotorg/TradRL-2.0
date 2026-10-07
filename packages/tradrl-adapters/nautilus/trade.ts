/**
 * The documented NautilusTrader TradeTick dtype mapper (W021).
 *
 * Record shape transcribed from the published NautilusTrader data-types
 * reference (see `nautilusTraderCatalog().docs` for the snapshot label): a
 * trade row is `{ instrument_id, price, size, aggressor_side, trade_id,
 * ts_event, ts_init }` — instrument_id a string, price/size float64 columns,
 * aggressor_side the documented "BUY"/"SELL" string, trade_id int64 (the
 * legacy string export form is accepted verbatim), ts_event/ts_init int64
 * NANOSECONDS. NO parquet IO: the real catalog reader is a TL action item.
 *
 * Declared conversions (all tested, all disclosed):
 * - `aggressor_side` "BUY"/"SELL" maps to buy/sell — anything else is a loud
 *   malformed-record rejection (the W004 trade payload REQUIRES the side; it
 *   is never fabricated);
 * - `ts_event` is the trade's event time; `ts_init` (object initialization)
 *   maps to `availableAt`, boundary-checked against ts_event (A7);
 * - float64 price/size convert to canonical decimal text (shortest
 *   round-trip representation, deterministic).
 */

import type { HistoricalRecord, HistoricalTradeRecord } from "tradrl-world-contracts/data";
import type { NautilusMappingViolation } from "./errors.js";
import { resolveNautilusInstrument } from "./instruments.js";
import type { NautilusRecordContext, NautilusRecordMapping } from "./mapping.js";
import {
  asPrice,
  asQuantity,
  availabilityViolation,
  decimalOrPush,
  isJsonObject,
  missingField,
  nsFieldOrPush,
} from "./shape.js";

/** Documented TradeTick row (field names per the dtype reference; float64 columns). */
export interface NautilusTradeTickRow {
  readonly instrument_id: string;
  readonly price: number;
  readonly size: number;
  readonly aggressor_side: "BUY" | "SELL";
  readonly trade_id: number | string;
  readonly ts_event: number | string;
  readonly ts_init: number | string;
}

/**
 * Map one documented TradeTick row onto a W020 trade record. Pure; collects
 * every violation; the aggressor side is a DECLARED conversion of the
 * documented "BUY"/"SELL" value (never guessed, never defaulted).
 */
export function mapNautilusTrade(
  raw: unknown,
  context: NautilusRecordContext,
): NautilusRecordMapping {
  if (!isJsonObject(raw)) {
    return {
      ok: false,
      violations: [
        { kind: "malformed-record", detail: `TradeTick row must be a JSON object, got '${typeof raw}'` },
      ],
    };
  }
  const violations: NautilusMappingViolation[] = [];
  if (typeof raw.instrument_id !== "string" || raw.instrument_id.trim().length === 0) {
    violations.push(missingField("TradeTick instrument_id", "the documented instrument_id is required"));
  } else {
    const instrument = resolveNautilusInstrument(context.instruments, raw.instrument_id);
    if (!instrument.ok) {
      violations.push(instrument.violation);
    }
  }
  const price = decimalOrPush("TradeTick price", raw.price, violations);
  const size = decimalOrPush("TradeTick size", raw.size, violations);
  if (raw.aggressor_side === undefined) {
    violations.push(
      missingField(
        "TradeTick aggressor_side",
        "the documented aggressor_side is required (the W004 trade payload requires the side — never fabricated)",
      ),
    );
  } else if (raw.aggressor_side !== "BUY" && raw.aggressor_side !== "SELL") {
    violations.push({
      kind: "malformed-record",
      detail:
        `TradeTick aggressor_side must be the documented 'BUY' or 'SELL', got '${String(raw.aggressor_side)}'`,
    });
  }
  let tradeId: string | undefined;
  if (raw.trade_id === undefined) {
    violations.push(missingField("TradeTick trade_id", "the documented trade_id is required"));
  } else if (typeof raw.trade_id === "number") {
    if (!Number.isSafeInteger(raw.trade_id) || raw.trade_id < 0) {
      violations.push({
        kind: "malformed-record",
        detail: `TradeTick trade_id must be a non-negative safe integer, got '${String(raw.trade_id)}'`,
      });
    } else {
      tradeId = String(raw.trade_id);
    }
  } else if (typeof raw.trade_id === "string" && raw.trade_id.trim().length > 0) {
    tradeId = raw.trade_id;
  } else {
    violations.push({
      kind: "malformed-record",
      detail: `TradeTick trade_id must be the int64 catalog form or a non-blank string, got '${String(raw.trade_id)}'`,
    });
  }
  const timestamp = nsFieldOrPush("TradeTick ts_event", raw.ts_event, violations);
  const availableAt = nsFieldOrPush("TradeTick ts_init", raw.ts_init, violations);
  if (
    violations.length > 0 ||
    price === undefined ||
    size === undefined ||
    tradeId === undefined ||
    timestamp === undefined ||
    availableAt === undefined ||
    typeof raw.instrument_id !== "string"
  ) {
    return { ok: false, violations };
  }
  const boundary = availabilityViolation("TradeTick ts_init", availableAt, timestamp);
  if (boundary !== undefined) {
    return { ok: false, violations: [...violations, boundary] };
  }
  const record: HistoricalTradeRecord = {
    kind: "trade",
    symbol: raw.instrument_id,
    timestamp,
    price: asPrice(price),
    quantity: asQuantity(size),
    // Declared conversion: the documented 'BUY'/'SELL' aggressor side.
    aggressorSide: raw.aggressor_side === "BUY" ? "buy" : "sell",
    tradeId,
    availableAt,
  };
  return { ok: true, record: record as HistoricalRecord };
}
