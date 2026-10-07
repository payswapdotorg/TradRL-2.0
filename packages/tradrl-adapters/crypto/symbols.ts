/**
 * Provider symbol mapping (W026 `tradrl-adapters-crypto`).
 *
 * Spec: spec/WORK-ITEMS.md W026 — "Symbol mapping: exchange-native symbol ->
 * the world instrument convention, declared per provider (honest: unmapped
 * symbols are a typed error, never silently dropped)".
 *
 * The mapping is a DECLARATION owned by whoever constructs the provider
 * descriptor (a world defines its instruments; the adapter never invents an
 * instrument). Resolution is total and honest: an exchange symbol without a
 * declared instrument is a typed `unknown-symbol` violation — the record is
 * never dropped, never mapped to a placeholder.
 */

import type { InstrumentId } from "tradrl-world-contracts";
import type { RecordSymbolMap } from "tradrl-data";
import type { CryptoMappingViolation } from "./errors.js";

/** Exchange-native symbol -> world instrument, declared per provider. */
export type CryptoSymbolTable = Readonly<Record<string, InstrumentId>>;

/** Typed outcome of resolving one exchange symbol. */
export type SymbolResolution =
  | { readonly ok: true; readonly instrumentId: InstrumentId }
  | { readonly ok: false; readonly violation: CryptoMappingViolation };

/** Is the value a non-blank string? */
export function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolve an exchange-native symbol against the provider's declared table.
 * Unknown or blank-mapped symbols are typed violations — never silently
 * dropped, never defaulted.
 */
export function resolveProviderSymbol(
  table: CryptoSymbolTable,
  symbol: string,
): SymbolResolution {
  if (!isNonBlank(symbol)) {
    return {
      ok: false,
      violation: {
        kind: "unknown-symbol",
        detail: `symbol must be a non-blank string, got '${String(symbol)}'`,
      },
    };
  }
  const instrumentId = table[symbol];
  if (instrumentId === undefined) {
    return {
      ok: false,
      violation: {
        kind: "unknown-symbol",
        detail:
          `no instrument mapping for exchange symbol '${symbol}' — declare it in the ` +
          `provider's symbol table (unmapped symbols are never silently dropped)`,
      },
    };
  }
  if (!isNonBlank(instrumentId)) {
    return {
      ok: false,
      violation: {
        kind: "unknown-symbol",
        detail: `instrument mapping for exchange symbol '${symbol}' is blank`,
      },
    };
  }
  return { ok: true, instrumentId };
}

/**
 * The provider's declared table in the W020 `RecordSymbolMap` shape (the
 * import input field). Same data, no transformation — the adapter's table IS
 * the import's symbol map.
 */
export function symbolMapOf(table: CryptoSymbolTable): RecordSymbolMap {
  return table;
}

/** The declared exchange symbols, sorted (deterministic inventory). */
export function declaredSymbols(table: CryptoSymbolTable): readonly string[] {
  return Object.keys(table).sort();
}
