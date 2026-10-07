/**
 * Catalog instrument mapping (W021 `tradrl-adapters-nautilus`).
 *
 * NautilusTrader's documented instrument convention: every instrument is an
 * `InstrumentId` of the form `<SYMBOL>-<VENUE>` (e.g. "BTCUSDT-BINANCE" —
 * spot — or "BTCUSDT-PERP-BINANCE" — a perpetual whose SYMBOL itself carries
 * a suffix; the LAST dash-separated token is always the venue).
 *
 * The mapping is a DECLARATION owned by whoever constructs the catalog
 * descriptor (a world defines its instruments; the adapter never invents
 * one). Resolution is total and honest: an instrument_id without a declared
 * world instrument is a typed `unknown-instrument` violation — the record is
 * never dropped, never mapped to a placeholder.
 */

import type { InstrumentId } from "tradrl-world-contracts";
import type { RecordSymbolMap } from "tradrl-data";
import type { NautilusMappingViolation } from "./errors.js";

/** NautilusTrader InstrumentId ("<SYMBOL>-<VENUE>") -> world instrument. */
export type NautilusInstrumentTable = Readonly<Record<string, InstrumentId>>;

/** Typed outcome of resolving one NautilusTrader instrument_id. */
export type InstrumentResolution =
  | { readonly ok: true; readonly instrumentId: InstrumentId }
  | { readonly ok: false; readonly violation: NautilusMappingViolation };

/** Is the value a non-blank string? */
export function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The documented InstrumentId shape: at least "<SYMBOL>-<VENUE>" (one dash),
 * with the venue as the LAST token. A value without a dash cannot be a
 * NautilusTrader InstrumentId and is rejected with the convention named —
 * structural honesty before any table lookup.
 */
export function isInstrumentIdShape(value: unknown): value is string {
  return isNonBlank(value) && /^[^\s-]+(-[^\s-]+)+$/.test(value);
}

/**
 * Resolve a documented instrument_id against the catalog's declared table.
 * Shape failures and unknown ids are typed violations — never silently
 * dropped, never defaulted.
 */
export function resolveNautilusInstrument(
  table: NautilusInstrumentTable,
  instrumentId: string,
): InstrumentResolution {
  if (!isInstrumentIdShape(instrumentId)) {
    return {
      ok: false,
      violation: {
        kind: "unknown-instrument",
        detail:
          `'${String(instrumentId)}' is not the documented InstrumentId form <SYMBOL>-<VENUE> ` +
          `(e.g. "BTCUSDT-BINANCE") — the venue is the last dash-separated token`,
      },
    };
  }
  const mapped = table[instrumentId];
  if (mapped === undefined) {
    return {
      ok: false,
      violation: {
        kind: "unknown-instrument",
        detail:
          `no world instrument mapping for instrument_id '${instrumentId}' — declare it in the ` +
          `catalog's instrument table (unmapped instruments are never silently dropped)`,
      },
    };
  }
  if (!isNonBlank(mapped)) {
    return {
      ok: false,
      violation: {
        kind: "unknown-instrument",
        detail: `instrument mapping for instrument_id '${instrumentId}' is blank`,
      },
    };
  }
  return { ok: true, instrumentId: mapped };
}

/**
 * The catalog's declared table in the W020 `RecordSymbolMap` shape (the
 * import input field). Same data, no transformation — the adapter's table IS
 * the import's symbol map.
 */
export function instrumentMapOf(table: NautilusInstrumentTable): RecordSymbolMap {
  return table;
}

/** The declared instrument ids, sorted (deterministic inventory). */
export function declaredInstruments(table: NautilusInstrumentTable): readonly string[] {
  return Object.keys(table).sort();
}
