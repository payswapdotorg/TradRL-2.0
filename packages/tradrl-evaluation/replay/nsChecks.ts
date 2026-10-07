/**
 * The ns-convention checks (W022): the three W021 timestamp claims, each
 * verified by the harness's own adversarial fixtures against the REAL
 * adapter single-record surface (`mapNautilusRecord`).
 *
 * Claims verified here:
 * 1. `ns-to-ms-exact-digit-truncation` — ns converts to epoch-ms by EXACT
 *    DIGIT TRUNCATION (never binary division, never rounding); scoped by the
 *    adapter's disclosed sub-millisecond truncation limitation → PARTIAL.
 * 2. `ns-sanity-window-1990-2100` — a loud sanity window rejects the classic
 *    ns/µs/ms/s unit-swap corruptions with the raw value in the detail, and
 *    maps the INCLUSIVE window edges (no over-rejection of 1990/2099 data).
 * 3. `int64-carrier-fidelity` — string digit carriers preserve full int64
 *    fidelity; number carriers are held to the integer-valued law; the
 *    JSON-parsing rounding reality is DISCLOSED (undetectable by the
 *    adapter's own words) → PARTIAL while disclosed.
 */

import type { NautilusCatalogDescriptor } from "tradrl-adapters-nautilus/dtypes";
import type { HistoricalRecord } from "tradrl-world-contracts/data";
import { findingOf, type FidelityFinding } from "./findings.js";
import { quoteDeclaration, undeclaredFinding, limitationDisclosure, guardedFinding } from "./claims.js";
import {
  expectMappedRecord,
  expectRejectedWith,
  observeMapping,
  runCases,
  type FidelityCase,
} from "./cases.js";
import {
  barRow,
  CEILING_MINUS_MINUTE_NS,
  FLOOR_PLUS_MINUTE_NS,
  MAX_REMAINDER_BAR_INIT_NS,
  MAX_REMAINDER_NS,
  MS_IN_NS_FIELD,
  S_IN_NS_FIELD,
  SUB_MS_BAR_INIT_NS,
  SUB_MS_NS,
  T0_MS,
  US_IN_NS_FIELD,
  WINDOW_CEILING_NS,
  WINDOW_FLOOR_NS,
} from "./fixtures.js";

const CONVENTIONS_LABEL = "nautilus.fidelity.conventions";

/** Property: the mapped record is a bar whose openTime is exactly the expected ms. */
function barOpenTimeIs(expectedMs: number, because: string) {
  return (record: HistoricalRecord): string | undefined => {
    if (record.kind !== "bar") {
      return `expected a bar record, got '${record.kind}'`;
    }
    if (record.openTime !== expectedMs) {
      return `bar openTime ${String(record.openTime)} is not the exact-digit truncation ${String(expectedMs)} (${because})`;
    }
    return undefined;
  };
}

/** The truncation claim (1): exact digits, never rounding. */
function truncationFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const quote = quoteDeclaration(CONVENTIONS_LABEL, catalog.fidelity.conventions, ["epoch-ms explicitly"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "ns-to-ms-exact-digit-truncation",
      title: "ns→ms by exact digit truncation",
      declaredIn: CONVENTIONS_LABEL,
      needles: ["epoch-ms explicitly"],
    });
  }
  const limitation = limitationDisclosure({
    claimId: "ns-to-ms-exact-digit-truncation",
    knownGaps: catalog.fidelity.knownGaps,
    needles: ["sub-millisecond precision is TRUNCATED"],
  });
  const cases: readonly FidelityCase[] = [
    {
      id: "trunc-sub-ms-remainder-dropped",
      describe: "a 19-digit string ns value with a 23456789ns remainder truncates to ...123, never rounds to ...124",
      expectation: expectMappedRecord(
        "openTime is the exact-digit truncation 1700448000123",
        barOpenTimeIs(1_700_448_000_123, "the sub-ms remainder 23456789ns must be dropped, not rounded"),
      ),
      observe: () =>
        observeMapping(catalog, "nautilus.bars", barRow({ ts_event: SUB_MS_NS, ts_init: SUB_MS_BAR_INIT_NS })),
    },
    {
      id: "trunc-max-remainder-still-drops",
      describe: "the maximal ...999999ns remainder truncates DOWN (...999), never carries into the next ms",
      expectation: expectMappedRecord(
        "openTime is the exact-digit truncation 1700448000999",
        barOpenTimeIs(1_700_448_000_999, "a 999999ns remainder must not carry into the millisecond"),
      ),
      observe: () =>
        observeMapping(catalog, "nautilus.bars", barRow({ ts_event: MAX_REMAINDER_NS, ts_init: MAX_REMAINDER_BAR_INIT_NS })),
    },
    {
      id: "trunc-numeric-carrier-exact",
      describe: "an exactly-representable numeric ns carrier converts identically",
      expectation: expectMappedRecord(
        `openTime is exactly ${String(T0_MS)}`,
        barOpenTimeIs(T0_MS, "the numeric carrier of an exactly-representable ns value"),
      ),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow()),
    },
  ];
  return findingOf({
    claimId: "ns-to-ms-exact-digit-truncation",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: [...runCases(cases), limitation.caseVerdict],
    ...(limitation.quote === undefined ? {} : { limitation: limitation.quote }),
  });
}

/** The sanity-window claim (2): loud on unit swaps, inclusive at the edges. */
function windowFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const quote = quoteDeclaration(CONVENTIONS_LABEL, catalog.fidelity.conventions, ["loud sanity window"]);
  if (quote === undefined) {
    return undeclaredFinding({
      claimId: "ns-sanity-window-1990-2100",
      title: "the loud 1990..2100 ns sanity window",
      declaredIn: CONVENTIONS_LABEL,
      needles: ["loud sanity window"],
    });
  }
  const rejected = (
    id: string,
    describe: string,
    value: unknown,
    needle: string = "sanity window",
  ): FidelityCase => ({
    id,
    describe,
    expectation: expectRejectedWith(
      `a loud 'timestamp-out-of-range' rejection naming the sanity window (${needle})`,
      "timestamp-out-of-range",
      needle,
    ),
    observe: () => observeMapping(catalog, "nautilus.bars", barRow({ ts_event: value })),
  });
  const malformed = (id: string, describe: string, value: unknown, needle: string): FidelityCase => ({
    id,
    describe,
    expectation: expectRejectedWith(`a loud 'malformed-record' rejection (${needle})`, "malformed-record", needle),
    observe: () => observeMapping(catalog, "nautilus.bars", barRow({ ts_event: value })),
  });
  const cases: readonly FidelityCase[] = [
    rejected("window-reject-ms-in-ns", "a MILLISECONDS value in the ns field (2023 epoch-ms -> 1970-01) is rejected loudly", MS_IN_NS_FIELD),
    rejected("window-reject-ms-in-ns-as-string", "the same ms-in-ns corruption in STRING digit form is rejected loudly", "1700448000000"),
    rejected("window-reject-us-in-ns", "a MICROSECONDS value in the ns field is rejected loudly", US_IN_NS_FIELD),
    rejected("window-reject-s-in-ns", "a SECONDS value in the ns field is rejected loudly", S_IN_NS_FIELD),
    rejected("window-reject-garbage-above-ceiling", "garbage above the ceiling is rejected with the unit-applied-twice hint", "5000000000000000000", "unit applied twice"),
    {
      id: "window-floor-edge-maps",
      describe: "a bar opening exactly at the 1990-01-01T00:00:00Z floor still maps (the window is inclusive — no over-rejection)",
      expectation: expectMappedRecord("openTime is exactly 631152000000 (the floor)", barOpenTimeIs(631_152_000_000, "the inclusive window floor")),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ ts_event: WINDOW_FLOOR_NS, ts_init: FLOOR_PLUS_MINUTE_NS })),
    },
    {
      id: "window-ceiling-edge-maps",
      describe: "a bar closing exactly at the 2100-01-01T00:00:00Z ceiling still maps (inclusive edge)",
      expectation: expectMappedRecord("openTime is exactly 4102444740000 (ceiling − 1 minute)", barOpenTimeIs(4_102_444_740_000, "the inclusive window ceiling")),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ ts_event: CEILING_MINUS_MINUTE_NS, ts_init: WINDOW_CEILING_NS })),
    },
    malformed(
      "window-reject-non-integer-number",
      "a non-integer number carrier (1.7e15 + 0.5 — genuinely corrupted, below the window) is rejected as malformed, never floored",
      1_700_448_000_000_000.5,
      "integer-valued",
    ),
    malformed("window-reject-exponent-form", "a number whose printed form is exponent notation (1e21) is rejected as malformed", 1e21, "canonical integer digits"),
    malformed("window-reject-short-digit-string", "a 9-digit ns string (below the 10-digit canonical minimum) is rejected as malformed", "123456789", "canonical integer digits"),
    malformed("window-reject-20-digit-string", "a 20-digit ns string (above the 19-digit int64 maximum) is rejected as malformed", "12345678901234567890", "canonical integer digits"),
  ];
  return findingOf({
    claimId: "ns-sanity-window-1990-2100",
    claim: quote.text,
    declaredIn: quote.declaredIn,
    cases: runCases(cases),
  });
}

/** The int64 carrier claim (3): full fidelity in-scope, disclosed out of scope. */
function carrierFinding(catalog: NautilusCatalogDescriptor): FidelityFinding {
  const quote = quoteDeclaration("nautilus.fidelity.knownGaps", catalog.fidelity.knownGaps, ["safe-integer range"]);
  const limitation = limitationDisclosure({
    claimId: "int64-carrier-fidelity",
    knownGaps: catalog.fidelity.knownGaps,
    needles: ["safe-integer range", "undetectable"],
  });
  const cases: readonly FidelityCase[] = [
    {
      id: "string-carrier-full-fidelity",
      describe: "a 19-digit STRING ns carrier preserves the full int64 value through the ms conversion",
      expectation: expectMappedRecord("openTime is exactly 1700448000123 (all 19 digits honored)", barOpenTimeIs(1_700_448_000_123, "the full-fidelity string carrier")),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ ts_event: SUB_MS_NS, ts_init: SUB_MS_BAR_INIT_NS })),
    },
    {
      id: "number-carrier-exact-representable",
      describe: "an exactly-representable numeric carrier maps to the identical ms value",
      expectation: expectMappedRecord(`openTime is exactly ${String(T0_MS)}`, barOpenTimeIs(T0_MS, "the numeric carrier law")),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow()),
    },
    {
      id: "number-carrier-non-integer-rejected",
      describe: "a non-integer numeric carrier (1.7e15 + 0.5 — the corrupted form) is rejected loudly, never floored",
      expectation: expectRejectedWith("a loud 'malformed-record' rejection of the non-integer carrier", "malformed-record", "integer-valued"),
      observe: () => observeMapping(catalog, "nautilus.bars", barRow({ ts_event: 1_700_448_000_000_000.5 })),
    },
  ];
  return findingOf({
    claimId: "int64-carrier-fidelity",
    claim: quote?.text ?? "int64 ns carrier fidelity — NOT DECLARED by the adapter at verification time",
    declaredIn: quote?.declaredIn ?? "nautilus.fidelity.knownGaps",
    cases: [...runCases(cases), limitation.caseVerdict],
    ...(limitation.quote === undefined ? {} : { limitation: limitation.quote }),
  });
}

/** Verify the three ns-convention claims against one catalog (crash-isolated per claim). */
export function verifyNsConventions(catalog: NautilusCatalogDescriptor): readonly FidelityFinding[] {
  return [
    guardedFinding("ns-to-ms-exact-digit-truncation", () => truncationFinding(catalog)),
    guardedFinding("ns-sanity-window-1990-2100", () => windowFinding(catalog)),
    guardedFinding("int64-carrier-fidelity", () => carrierFinding(catalog)),
  ];
}
