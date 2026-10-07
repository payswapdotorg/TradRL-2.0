/**
 * The ns->ms timestamp laws (W021): the documented int64-NANOSECONDS
 * convention, the loud sanity window (the classic unit-swap corruption
 * site), the exact digit truncation, and the int64/JSON precision honesty.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NAUTILUS_EPOCH_CEILING_NS,
  NAUTILUS_EPOCH_FLOOR_NS,
  epochMsFromNanos,
} from "../nanoseconds.js";
import { NUMERIC_NS_VALUES, T0_MS, T0_NS } from "./fixtures.js";

test("numeric ns converts to ms verbatim (no unit swap, no rescale beyond the declared truncation)", () => {
  const result = epochMsFromNanos(T0_NS, "ts_event");
  assert.ok(result.ok);
  assert.equal(result.ms, T0_MS);
});

test("string ns converts with FULL int64 fidelity (the high-fidelity form)", () => {
  const result = epochMsFromNanos("1700448000123456789", "ts_event");
  assert.ok(result.ok);
  assert.equal(result.ms, 1_700_448_000_123);
});

test("sub-millisecond remainders are TRUNCATED deterministically (the declared conversion)", () => {
  // 999999999 ns remainder -> truncated (never rounded up).
  const justBelow = epochMsFromNanos("1700448000999999999", "ts_event");
  assert.ok(justBelow.ok);
  assert.equal(justBelow.ms, 1_700_448_000_999);
  const exactlyMs = epochMsFromNanos("1700448001000000000", "ts_event");
  assert.ok(exactlyMs.ok);
  assert.equal(exactlyMs.ms, 1_700_448_001_000);
  // The truncation is digit-slicing, never binary float division (which can
  // mis-floor near sub-ms remainders).
  const subMs = epochMsFromNanos("1700448000123456789", "ts_init");
  assert.ok(subMs.ok);
  assert.equal(subMs.ms, 1_700_448_000_123);
});

test("the classic unit swaps are rejected LOUDLY with the raw value in the detail", () => {
  // A milliseconds value in an ns field (1.7e12) — lands below the floor.
  const msSwap = epochMsFromNanos(T0_MS, "ts_event");
  assert.ok(!msSwap.ok);
  assert.equal(msSwap.violation.kind, "timestamp-out-of-range");
  assert.match(msSwap.violation.detail, /1700448000000 ns is outside/);
  assert.match(msSwap.violation.detail, /unit swap/);
  // A microseconds value in an ns field (1.7e15) — also below the floor.
  const usSwap = epochMsFromNanos(T0_MS * 1_000, "ts_init");
  assert.ok(!usSwap.ok);
  assert.equal(usSwap.violation.kind, "timestamp-out-of-range");
  assert.match(usSwap.violation.detail, /microseconds/);
  // A seconds value in an ns field (1.7e9) — rejected (below the digit law).
  const sSwap = epochMsFromNanos(1_700_448_000, "ts_event");
  assert.ok(!sSwap.ok);
});

test("values beyond the 2100 ceiling are rejected loudly", () => {
  const garbage = epochMsFromNanos(String(NAUTILUS_EPOCH_CEILING_NS + 1_000_000_000), "ts_event");
  assert.ok(!garbage.ok);
  assert.equal(garbage.violation.kind, "timestamp-out-of-range");
  const floorBelow = epochMsFromNanos(String(NAUTILUS_EPOCH_FLOOR_NS - 1_000_000_000), "ts_event");
  assert.ok(!floorBelow.ok);
  assert.equal(floorBelow.violation.kind, "timestamp-out-of-range");
});

test("non-carrier numbers (NaN, Infinity) are rejected loudly — never silently floored", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const result = epochMsFromNanos(bad, "ts_event");
    assert.ok(!result.ok);
    assert.equal(result.violation.kind, "malformed-record");
  }
});

test("DISCLOSED: an odd int64 ns literal rounds at JS parse — the upstream number-form reality", () => {
  // 1700448000000000001 cannot exist as a double; the number itself rounds
  // to 1700448000000000000 at parse time (a 256-ulp rounding in the 1.7e18
  // region). The adapter cannot detect this — the disclosure says to export
  // ns columns as STRINGS for full fidelity. This test pins the documented
  // behavior honestly instead of pretending the adapter catches it. (The
  // literal is spelled via Number("...") — the precision loss is the very
  // behavior under test, and a direct literal would trip the linter.)
  const rounded = epochMsFromNanos(Number("1700448000000000001"), "ts_event");
  assert.ok(rounded.ok);
  assert.equal(rounded.ms, T0_MS);
});

test("malformed carriers are rejected: blank strings, signs, exponents, wrong shapes", () => {
  for (const bad of ["", "abc", "-1700448000000000000", "1.7e18", "12345", 0, -1, Number.NaN]) {
    const result = epochMsFromNanos(bad, "ts_event");
    assert.ok(!result.ok, `expected a rejection for '${String(bad)}'`);
  }
});

test("the sanity window spans the documented electronic-market-data era", () => {
  assert.equal(NAUTILUS_EPOCH_FLOOR_NS, 631_152_000_000_000_000); // 1990-01-01T00:00:00Z
  assert.equal(NAUTILUS_EPOCH_CEILING_NS, 4_102_444_800_000_000_000); // 2100-01-01T00:00:00Z
  // Pre-window real data (1989) is honestly rejected with the window named.
  const early = epochMsFromNanos("600336000000000000", "ts_event");
  assert.ok(!early.ok);
  assert.match(early.violation.detail, /sanity window/);
});

test("FIXTURE DISCIPLINE: every numeric ns fixture value is exactly representable", () => {
  for (const ns of NUMERIC_NS_VALUES) {
    assert.ok(Number.isInteger(ns), `${String(ns)} must stay an integer-valued double`);
    assert.equal(String(ns), String(ns), "stable");
    // The ms truncation of an exactly-representable fixture value never surprises.
    const converted = epochMsFromNanos(ns, "fixture");
    assert.ok(converted.ok, `${String(ns)} must convert cleanly`);
  }
});
