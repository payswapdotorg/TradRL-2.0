/**
 * The bar/tick convention checks (W022): the W021 interval and A7
 * availability claims, verified against the REAL adapter surfaces.
 *
 * Claims verified here:
 * 4. `bar-interval-convention` — `ts_event` is the interval START; the close
 *    is DERIVED from the bar_type step×aggregation; irregular aggregations
 *    REQUIRE a declared granularityMs (never invented); a contradicting
 *    declared granularity is a loud mismatch; bar_type parses from the RIGHT
 *    (dashed symbols) with every part validated against the documented sets.
 * 5. `bar-availability-at-close` — `ts_init` maps to `availableAt` and is
 *    boundary-checked to never precede the bar's close (A7, at mapping time).
 * 6. `tick-availability-boundary` — trade/quote `ts_init` maps to
 *    `availableAt` and is boundary-checked against `ts_event` (A7).
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
import {
  barRow,
  CLEAN_BARS,
  MINUTE_MS,
  MINUTE_NS,
  nsOf,
  quoteRow,
  T0_MS,
  T0_NS,
  tradeRow,
} from "./fixtures.js";

/** Property: the mapped record is a bar with the exact expected open/close times. */
function barIntervalIs(openMs: number, closeMs: number) {
  return (record: HistoricalRecord): string | undefined => {
    if (record.kind !== "bar") {
      return `expected a bar record, got '${record.kind}'`;
    }
    if (record.openTime !== openMs || record.closeTime !== closeMs) {
      return `bar interval [${String(record.openTime)}, ${String(record.closeTime)}) is not the derived [${String(openMs)}, ${String(closeMs)})`;
    }
    return undefined;
  };
}

/** Property: the mapped record is a bar whose availableAt is exactly the expected ms. */
function barAvailableAtIs(expectedMs: number) {
  return (record: HistoricalRecord): string | undefined => {
    if (record.kind !== "bar") {
      return `expected a bar record, got '${record.kind}'`;
    }
    if (record.availableAt !== expectedMs) {
      return `bar availableAt ${String(record.availableAt)} is not the expected ${String(expectedMs)}`;
    }
    return undefined;
  };
}

/** Property: the mapped record is a tick whose availableAt is exactly the expected ms. */
function tickAvailableAtIs(expectedMs: number) {
  return (record: HistoricalRecord): string | undefined => {
    if (record.kind !== "trade" && record.kind !== "quote") {
      return `expected a trade/quote record, got '${record.kind}'`;
    }
    if (record.availableAt !== expectedMs) {
      return `tick availableAt ${String(record.availableAt)} is not the expected ${String(expectedMs)}`;
    }
    return undefined;
  };
}

/** The bar-interval claim (4). */
function barIntervalFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const dtype = dtypeOf(catalog, "nautilus.bars");
  const quote = quoteDeclaration("nautilus.bars.dtypeNotes", dtype?.notes ?? [], ["interval start", "derived"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "bar-interval-convention",
      title: "bar ts_event=interval start, close derived",
      declaredIn: "nautilus.bars.dtypeNotes",
      needles: ["interval start", "derived"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "interval-1-minute-derived",
      describe: "a 1-MINUTE bar maps to [T0, T0+60000) — the interval derived from the bar_type",
      expectation: expectMappedRecord("openTime T0, closeTime T0+60000", barIntervalIs(T0_MS, T0_MS + MINUTE_MS)),
      observe: () => observeMapping(catalog, "nautilus.bars", CLEAN_BARS[0]),
    },
    {
      id: "interval-5-minute-multiplies-step",
      describe: "a 5-MINUTE bar maps to [T0, T0+300000) — the step multiplies the unit",
      expectation: expectMappedRecord("openTime T0, closeTime T0+300000", barIntervalIs(T0_MS, T0_MS + 5 * MINUTE_MS)),
      observe: () =>
        observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-BINANCE-5-MINUTE-LAST-EXTERNAL", ts_init: T0_NS + 5 * MINUTE_NS })),
    },
    {
      id: "interval-1-hour-derived",
      describe: "a 1-HOUR bar maps to [T0, T0+3600000)",
      expectation: expectMappedRecord("openTime T0, closeTime T0+3600000", barIntervalIs(T0_MS, T0_MS + 3_600_000)),
      observe: () =>
        observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-BINANCE-1-HOUR-LAST-EXTERNAL", ts_init: T0_NS + 3_600_000_000_000 })),
    },
    {
      id: "interval-1-day-derived",
      describe: "a 1-DAY bar maps to [T0, T0+86400000)",
      expectation: expectMappedRecord("openTime T0, closeTime T0+86400000", barIntervalIs(T0_MS, T0_MS + 86_400_000)),
      observe: () =>
        observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-BINANCE-1-DAY-LAST-EXTERNAL", ts_init: T0_NS + 86_400_000_000_000 })),
    },
    {
      id: "interval-irregular-requires-declared-granularity",
      describe: "an irregular 100-VOLUME aggregation without a declared granularityMs is rejected — the length is never invented",
      expectation: expectRejectedWith("a loud 'missing-field' rejection naming granularityMs", "missing-field", "granularityMs"),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-BINANCE-100-VOLUME-LAST-INTERNAL" })),
    },
    {
      id: "interval-irregular-uses-declared-granularity",
      describe: "an irregular aggregation WITH a declared granularityMs 60000 maps to [T0, T0+60000)",
      expectation: expectMappedRecord("openTime T0, closeTime T0+60000", barIntervalIs(T0_MS, T0_MS + MINUTE_MS)),
      observe: () =>
        observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-BINANCE-100-VOLUME-LAST-INTERNAL", ts_init: T0_NS + MINUTE_NS }), { granularityMs: MINUTE_MS }),
    },
    {
      id: "interval-declared-granularity-contradiction-loud",
      describe: "a 1-MINUTE bar with a contradicting declared granularityMs 300000 is a loud interval-length-mismatch",
      expectation: expectRejectedWith("a loud 'interval-length-mismatch' rejection", "interval-length-mismatch", "derives a 60000ms interval"),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow(), { granularityMs: 300_000 }),
    },
    {
      id: "interval-bar-type-parses-from-the-right",
      describe: "a dashed-symbol instrument (BTCUSDT-PERP-BINANCE) parses from the RIGHT — the symbol keeps its own dash",
      expectation: expectMappedRecord("the mapped bar's symbol is exactly BTCUSDT-PERP-BINANCE", (record) => {
        if (record.kind !== "bar") {
          return `expected a bar record, got '${record.kind}'`;
        }
        return record.symbol === "BTCUSDT-PERP-BINANCE"
          ? undefined
          : `bar symbol '${record.symbol}' is not the right-parsed BTCUSDT-PERP-BINANCE`;
      }),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-PERP-BINANCE-1-MINUTE-LAST-EXTERNAL" })),
    },
    {
      id: "interval-unknown-aggregation-loud",
      describe: "an undocumented aggregation token is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming the documented aggregation", "malformed-record", "documented aggregation"),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-BINANCE-1-MINUTES-LAST-EXTERNAL" })),
    },
    {
      id: "interval-unknown-price-type-loud",
      describe: "an undocumented price_type token is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming the documented price type", "malformed-record", "documented price type"),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-BINANCE-1-MINUTE-LASTX-EXTERNAL" })),
    },
    {
      id: "interval-zero-step-loud",
      describe: "a zero step is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection of the step", "malformed-record", "positive integer"),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-BINANCE-0-MINUTE-LAST-EXTERNAL" })),
    },
    {
      id: "interval-short-bar-type-loud",
      describe: "a 4-token bar_type (no specification) is a loud malformed-record rejection",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection naming the 5-token form", "malformed-record", "at least 5 dash-separated tokens"),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ bar_type: "BTCUSDT-1-MINUTE-LAST" })),
    },
  ];
  return findingOf({
    claimId: "bar-interval-convention",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** The bar A7 claim (5). */
function barAvailabilityFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const dtype = dtypeOf(catalog, "nautilus.bars");
  const quote = quoteDeclaration("nautilus.bars.dtypeNotes", dtype?.notes ?? [], ["never precede the bar's close"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "bar-availability-at-close",
      title: "bar ts_init→availableAt ≥ close (A7)",
      declaredIn: "nautilus.bars.dtypeNotes",
      needles: ["never precede the bar's close"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "bar-availability-equals-close-maps",
      describe: "ts_init == close maps (the boundary is inclusive) with availableAt == closeTime",
      expectation: expectMappedRecord("availableAt == T0+60000", barAvailableAtIs(T0_MS + MINUTE_MS)),
      observe: () => observeMapping(catalog, "nautilus.bars", CLEAN_BARS[0]),
    },
    {
      id: "bar-availability-before-close-loud",
      describe: "ts_init 30s into a 60s bar (before the close) is a loud availability-boundary rejection",
      expectation: expectRejectedWith("a loud 'availability-boundary' rejection naming A7", "availability-boundary", "precedes the event-time basis"),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ ts_init: T0_NS + 30_000_000_000 })),
    },
    {
      id: "bar-availability-delayed-preserved",
      describe: "ts_init AFTER the close (delayed availability) maps with availableAt preserved verbatim",
      expectation: expectMappedRecord("availableAt == T0+120000", barAvailableAtIs(T0_MS + 2 * MINUTE_MS)),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ ts_init: T0_NS + 2 * MINUTE_NS })),
    },
  ];
  return findingOf({
    claimId: "bar-availability-at-close",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** The tick A7 claim (6). */
function tickAvailabilityFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const dtype = dtypeOf(catalog, "nautilus.trade_ticks");
  const quote = quoteDeclaration("nautilus.trade_ticks.dtypeNotes", dtype?.notes ?? [], ["never precede ts_event"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "tick-availability-boundary",
      title: "tick ts_init→availableAt ≥ ts_event (A7)",
      declaredIn: "nautilus.trade_ticks.dtypeNotes",
      needles: ["never precede ts_event"],
    });
  }
  const cases: readonly FidelityCase[] = [
    {
      id: "trade-availability-equals-event-maps",
      describe: "trade ts_init == ts_event maps (inclusive boundary) with availableAt == the event time",
      expectation: expectMappedRecord("availableAt == T0 (the 0.5ms remainder truncates to the same ms)", tickAvailableAtIs(T0_MS)),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ ts_event: nsOf(T0_MS), ts_init: nsOf(T0_MS) })),
    },
    {
      id: "trade-availability-before-event-loud",
      describe: "trade ts_init 4s BEFORE ts_event is a loud availability-boundary rejection",
      expectation: expectRejectedWith("a loud 'availability-boundary' rejection naming A7", "availability-boundary", "precedes the event-time basis"),
      observe: () => observeMapping(catalog, "nautilus.trade_ticks", tradeRow({ ts_event: nsOf(T0_MS + 5000), ts_init: nsOf(T0_MS + 1000) })),
    },
    {
      id: "quote-availability-before-event-loud",
      describe: "quote ts_init before ts_event is a loud availability-boundary rejection",
      expectation: expectRejectedWith("a loud 'availability-boundary' rejection naming A7", "availability-boundary", "precedes the event-time basis"),
      observe: () => observeMapping(catalog, "nautilus.quote_ticks", quoteRow({ ts_event: nsOf(T0_MS + 5000), ts_init: nsOf(T0_MS) })),
    },
    {
      id: "quote-availability-delayed-preserved",
      describe: "quote ts_init after ts_event (delayed) maps with availableAt preserved verbatim",
      expectation: expectMappedRecord("availableAt == T0+5000", tickAvailableAtIs(T0_MS + 5000)),
      observe: () => observeMapping(catalog, "nautilus.quote_ticks", quoteRow({ ts_init: nsOf(T0_MS + 5000) })),
    },
  ];
  return findingOf({
    claimId: "tick-availability-boundary",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** Verify the bar/tick convention claims (4-6) against one catalog (crash-isolated per claim). */
export function verifyDtypeConventions(catalog: NautilusCatalogDescriptor): readonly FidelityFinding[] {
  return [
    guardedFinding("bar-interval-convention", () => barIntervalFinding(catalog)),
    guardedFinding("bar-availability-at-close", () => barAvailabilityFinding(catalog)),
    guardedFinding("tick-availability-boundary", () => tickAvailabilityFinding(catalog)),
  ];
}
