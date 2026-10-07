/**
 * The documented NautilusTrader QuoteTick dtype mapper (W021).
 *
 * Record shape transcribed from the published NautilusTrader data-types
 * reference (see `nautilusTraderCatalog().docs` for the snapshot label): a
 * quote row is `{ instrument_id, bid_price, ask_price, bid_size, ask_size,
 * ts_event, ts_init }` — instrument_id a string, the four price/size columns
 * float64, ts_event/ts_init int64 NANOSECONDS. NO parquet IO: the real
 * catalog reader is a TL action item.
 *
 * Declared conversions (all tested, all disclosed):
 * - the documented QuoteTick carries NO last-trade price — the W020 quote
 *   record's `last` is never invented (declared as a known gap);
 * - `ts_event` is the quote's event time; `ts_init` (object initialization)
 *   maps to `availableAt`, boundary-checked against ts_event (A7);
 * - float64 prices/sizes convert to canonical decimal text (shortest
 *   round-trip representation, deterministic).
 */

import type { HistoricalRecord } from "tradrl-world-contracts/data";
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

/** Documented QuoteTick row (field names per the dtype reference; float64 columns). */
export interface NautilusQuoteTickRow {
  readonly instrument_id: string;
  readonly bid_price: number;
  readonly ask_price: number;
  readonly bid_size: number;
  readonly ask_size: number;
  readonly ts_event: number | string;
  readonly ts_init: number | string;
}

/**
 * Map one documented QuoteTick row onto a W020 top-of-book quote record.
 * Pure; collects every violation; no field is ever invented.
 */
export function mapNautilusQuote(
  raw: unknown,
  context: NautilusRecordContext,
): NautilusRecordMapping {
  if (!isJsonObject(raw)) {
    return {
      ok: false,
      violations: [
        { kind: "malformed-record", detail: `QuoteTick row must be a JSON object, got '${typeof raw}'` },
      ],
    };
  }
  const violations: NautilusMappingViolation[] = [];
  if (typeof raw.instrument_id !== "string" || raw.instrument_id.trim().length === 0) {
    violations.push(missingField("QuoteTick instrument_id", "the documented instrument_id is required"));
  } else {
    const instrument = resolveNautilusInstrument(context.instruments, raw.instrument_id);
    if (!instrument.ok) {
      violations.push(instrument.violation);
    }
  }
  const bid = decimalOrPush("QuoteTick bid_price", raw.bid_price, violations);
  const ask = decimalOrPush("QuoteTick ask_price", raw.ask_price, violations);
  const bidSize = decimalOrPush("QuoteTick bid_size", raw.bid_size, violations);
  const askSize = decimalOrPush("QuoteTick ask_size", raw.ask_size, violations);
  if (bid !== undefined && ask !== undefined && Number(bid) > Number(ask)) {
    violations.push({
      kind: "malformed-record",
      detail: `QuoteTick: bid_price ${bid} exceeds ask_price ${ask} (a crossed top of book is not an observation)`,
    });
  }
  const timestamp = nsFieldOrPush("QuoteTick ts_event", raw.ts_event, violations);
  const availableAt = nsFieldOrPush("QuoteTick ts_init", raw.ts_init, violations);
  if (
    violations.length > 0 ||
    bid === undefined ||
    ask === undefined ||
    bidSize === undefined ||
    askSize === undefined ||
    timestamp === undefined ||
    availableAt === undefined ||
    typeof raw.instrument_id !== "string"
  ) {
    return { ok: false, violations };
  }
  const boundary = availabilityViolation("QuoteTick ts_init", availableAt, timestamp);
  if (boundary !== undefined) {
    return { ok: false, violations: [...violations, boundary] };
  }
  const record = {
    kind: "quote" as const,
    symbol: raw.instrument_id,
    timestamp,
    bid: asPrice(bid),
    bidSize: asQuantity(bidSize),
    ask: asPrice(ask),
    askSize: asQuantity(askSize),
    // `last` is deliberately absent: the documented QuoteTick dtype carries
    // no last-trade price — never invented.
    availableAt,
  };
  return { ok: true, record: record as HistoricalRecord };
}
