/**
 * The trade/quote/decimal checks (W022): the W021 dtype-value claims.
 *
 * Claims verified here:
 * 7. `aggressor-side-mapping` — the documented 'BUY'/'SELL' aggressor_side
 *    maps to buy/sell; anything else (or nothing) is a loud rejection — the
 *    side is required by the W004 trade payload and never fabricated.
 * 8. `trade-id-forms` — the int64 catalog form becomes the W020 tradeId;
 *    the legacy string export form is accepted verbatim; corrupted ids
 *    (non-safe integers, negatives, blanks) are loud rejections.
 * 9. `quote-no-last` — the documented QuoteTick carries no last-trade price:
 *    the mapped quote record NEVER has a `last`, not even when a stray
 *    foreign field tries to sneak one in.
 * 10. `float64-canonical-decimal` — float64 columns convert to canonical
 *     decimal text via the shortest round-trip representation; exponent
 *     forms, >12 fraction digits, signs, NaN and Infinity are rejected
 *     loudly — never silently rounded.
 */

import type { NautilusCatalogDescriptor } from "tradrl-adapters-nautilus/dtypes";
import { dtypeOf } from "tradrl-adapters-nautilus/dtypes";
import type { HistoricalRecord } from "tradrl-world-contracts/data";
import { findingOf, type FidelityFinding } from "./findings.js";
import { quoteDeclaration, undeclaredFinding, guardedFinding } from "./claims.js";
import {
  expectMappedRecord,
  expectRejectedWith,
  observeMapping,
  runCases,
  type FidelityCase,
} from "./cases.js";
import { barRow, quoteRow, tradeRow } from "./fixtures.js";

/** Property: the mapped trade's field equals the expected value. */
function tradeFieldIs(field: "aggressorSide" | "tradeId", expected: string) {
  return (record: HistoricalRecord): string | undefined => {
    if (record.kind !== "trade") {
      return `expected a trade record, got '${record.kind}'`;
    }
    if (record[field] !== expected) {
      return `trade ${field} '${String(record[field])}' is not the expected '${expected}'`;
    }
    return undefined;
  };
}

/** Property: the mapped quote carries NO own `last` property at all. */
function quoteHasNoLast(record: HistoricalRecord): string | undefined {
  if (record.kind !== "quote") {
    return `expected a quote record, got '${record.kind}'`;
  }
  return Object.hasOwn(record, "last")
    ? `the mapped quote carries a 'last' (${String(record.last)}) — the documented QuoteTick has none, and none may be invented`
    : undefined;
}

/** Property: the mapped record's decimal text field equals the expected canonical text. */
function decimalFieldIs(
  kind: "bar" | "trade" | "quote",
  field: string,
  expected: string,
): (record: HistoricalRecord) => string | undefined {
  return (record) => {
    if (record.kind !== kind) {
      return `expected a ${kind} record, got '${record.kind}'`;
    }
    const value = (record as unknown as Record<string, unknown>)[field];
    if (value !== expected) {
      return `${kind} ${field} '${String(value)}' is not the canonical decimal '${expected}'`;
    }
    return undefined;
  };
}

/** The aggressor-side claim (7). */
function aggressorFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const quote = quoteDeclaration("nautilus.fidelity.conventions", catalog.fidelity.conventions, ["aggressor_side 'BUY'/'SELL' maps to buy/sell"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "aggressor-side-mapping",
      title: "aggressor_side BUY/SELL → buy/sell",
      declaredIn: "nautilus.fidelity.conventions",
      needles: ["aggressor_side 'BUY'/'SELL' maps to buy/sell"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "aggressor-buy-maps",
      describe: "aggressor_side 'BUY' maps to 'buy' verbatim",
      expectation: expectMappedRecord("aggressorSide == 'buy'", tradeFieldIs("aggressorSide", "buy")),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow()),
    },
    {
      id: "aggressor-sell-maps",
      describe: "aggressor_side 'SELL' maps to 'sell' verbatim",
      expectation: expectMappedRecord("aggressorSide == 'sell'", tradeFieldIs("aggressorSide", "sell")),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ aggressor_side: "SELL" })),
    },
    {
      id: "aggressor-lowercase-loud",
      describe: "a lowercase 'buy' (shape drift) is a loud malformed-record rejection naming the documented form",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming 'BUY' or 'SELL'", "malformed-record", "'BUY' or 'SELL'"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ aggressor_side: "buy" })),
    },
    {
      id: "aggressor-unknown-loud",
      describe: "an unknown side value is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming 'BUY' or 'SELL'", "malformed-record", "'BUY' or 'SELL'"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ aggressor_side: "UNKNOWN" })),
    },
    {
      id: "aggressor-absent-loud",
      describe: "an absent aggressor_side is a loud missing-field rejection (never fabricated)",
      expectation: expectRejectedWith("a loud 'missing-field' rejection (the W004 payload requires the side)", "missing-field", "never fabricated"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ aggressor_side: undefined })),
    },
  ];
  return findingOf({
    claimId: "aggressor-side-mapping",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** The trade-id claim (8). */
function tradeIdFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const dtype = dtypeOf(catalog, "nautilus.trade_ticks");
  const quote = quoteDeclaration("nautilus.trade_ticks.dtypeNotes", dtype?.notes ?? [], ["legacy string export form"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "trade-id-forms",
      title: "trade_id int64 + legacy string forms",
      declaredIn: "nautilus.trade_ticks.dtypeNotes",
      needles: ["legacy string export form"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "trade-id-int64-form",
      describe: "the int64 catalog form (20930421) becomes the tradeId '20930421'",
      expectation: expectMappedRecord("tradeId == '20930421'", tradeFieldIs("tradeId", "20930421")),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ trade_id: 20_930_421 })),
    },
    {
      id: "trade-id-zero-accepted",
      describe: "trade_id 0 (a legitimate non-negative int64) maps to '0'",
      expectation: expectMappedRecord("tradeId == '0'", tradeFieldIs("tradeId", "0")),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ trade_id: 0 })),
    },
    {
      id: "trade-id-legacy-string-verbatim",
      describe: "the legacy string export form is accepted verbatim",
      expectation: expectMappedRecord("tradeId == 'legacy-id-0001'", tradeFieldIs("tradeId", "legacy-id-0001")),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ trade_id: "legacy-id-0001" })),
    },
    {
      id: "trade-id-unsafe-integer-loud",
      describe: "a non-safe-integer id (2^53) is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming the safe-integer law", "malformed-record", "safe integer"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ trade_id: 2 ** 53 })),
    },
    {
      id: "trade-id-negative-loud",
      describe: "a negative id is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection", "malformed-record", "non-negative safe integer"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ trade_id: -1 })),
    },
    {
      id: "trade-id-blank-string-loud",
      describe: "a blank string id is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection", "malformed-record", "non-blank string"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ trade_id: "  " })),
    },
    {
      id: "trade-id-wrong-type-loud",
      describe: "a boolean id (a corrupt carrier) is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection", "malformed-record", "int64 catalog form"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ trade_id: true })),
    },
  ];
  return findingOf({
    claimId: "trade-id-forms",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** The quote-no-last claim (9). */
function quoteNoLastFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const dtype = dtypeOf(catalog, "nautilus.quote_ticks");
  const quote = quoteDeclaration("nautilus.quote_ticks.dtypeNotes", dtype?.notes ?? [], ["NO last-trade price"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "quote-no-last",
      title: "QuoteTick maps to a quote record with no `last`",
      declaredIn: "nautilus.quote_ticks.dtypeNotes",
      needles: ["NO last-trade price"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "quote-clean-no-last",
      describe: "a clean documented QuoteTick maps to a quote record with no `last` property at all",
      expectation: expectMappedRecord("the quote record has no own 'last' property", quoteHasNoLast),
      observe: () => observeMapping(catalog, "nautilus.quote_ticks", quoteRow()),
    },
    {
      id: "quote-stray-last-field-ignored",
      describe: "a stray foreign `last` field in the row is NOT smuggled into the mapped record (never invented)",
      expectation: expectMappedRecord("the quote record still has no own 'last' property", quoteHasNoLast),
      observe: () => observeMapping(catalog, "nautilus.quote_ticks", quoteRow({ last: 48000.2, last_price: 48000.2 })),
    },
    {
      id: "quote-crossed-book-loud",
      describe: "a crossed top of book (bid > ask) is a loud malformed-record rejection — not an observation",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection of the crossed book", "malformed-record", "crossed top of book"),
      observe: () => observeMapping(catalog, "nautilus.quote_ticks", quoteRow({ bid_price: 48000.5, ask_price: 48000.3 })),
    },
  ];
  return findingOf({
    claimId: "quote-no-last",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** The canonical-decimal claim (10). */
function decimalFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const quote = quoteDeclaration("nautilus.fidelity.conventions", catalog.fidelity.conventions, ["shortest round-trip decimal representation"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "float64-canonical-decimal",
      title: "float64 → canonical decimal (shortest round-trip)",
      declaredIn: "nautilus.fidelity.conventions",
      needles: ["shortest round-trip decimal representation"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "decimal-shortest-roundtrip",
      describe: "48000.1 converts to the canonical '48000.1' (the shortest round-trip text — never '48000.100000000001')",
      expectation: expectMappedRecord("open == '48000.1'", decimalFieldIs("bar", "open", "48000.1")),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ open: 48000.1 })),
    },
    {
      id: "decimal-integer-valued-text",
      describe: "the integer-valued 3 converts to '3' (no trailing '.0')",
      expectation: expectMappedRecord("bidSize == '3'", decimalFieldIs("quote", "bidSize", "3")),
      observe: () => observeMapping(catalog, "nautilus.quote_ticks", quoteRow({ bid_size: 3 })),
    },
    {
      id: "decimal-twelve-fraction-digits-accepted",
      describe: "a value whose shortest form has exactly 12 fraction digits is canonical",
      expectation: expectMappedRecord("price == '0.123456789012'", decimalFieldIs("trade", "price", "0.123456789012")),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ price: 0.123456789012 })),
    },
    {
      id: "decimal-exponent-form-loud",
      describe: "a value whose shortest form is exponent notation (1e-7) is a loud rejection — never re-rendered",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming the exponent form", "malformed-record", "exponent"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ price: 1e-7 })),
    },
    {
      id: "decimal-thirteen-fraction-digits-loud",
      describe: "a value whose shortest form has 15 fraction digits (beyond the 12-digit law) is a loud rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming the 12-digit law", "malformed-record", "at most 12 fraction digits"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ price: 0.123456789012345 })),
    },
    {
      id: "decimal-nan-loud",
      describe: "NaN is a loud rejection (the documented column is a finite float64)",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection of the non-finite value", "malformed-record", "finite number"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ price: Number.NaN })),
    },
    {
      id: "decimal-negative-sign-loud",
      describe: "a negative price (sign form) is a loud rejection — canonical decimal text carries no sign",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming the sign law", "malformed-record", "no sign"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ price: -48000.25 })),
    },
  ];
  return findingOf({
    claimId: "float64-canonical-decimal",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** Verify the trade/quote/decimal claims (7-10) against one catalog (crash-isolated per claim). */
export function verifyTickConventions(catalog: NautilusCatalogDescriptor): readonly FidelityFinding[] {
  return [
    guardedFinding("aggressor-side-mapping", () => aggressorFinding(catalog)),
    guardedFinding("trade-id-forms", () => tradeIdFinding(catalog)),
    guardedFinding("quote-no-last", () => quoteNoLastFinding(catalog)),
    guardedFinding("float64-canonical-decimal", () => decimalFinding(catalog)),
  ];
}
