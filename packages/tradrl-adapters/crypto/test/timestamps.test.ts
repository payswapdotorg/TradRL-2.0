/**
 * Tests for the timestamp unit laws (W026 `tradrl-adapters-crypto`): the
 * epoch-ms / epoch-s / ISO-8601 conventions, the loud sanity window that
 * catches the classic unit swaps, and the strict UTC ISO parse with
 * microsecond truncation and component round-trip rejection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRYPTO_EPOCH_CEILING_MS,
  CRYPTO_EPOCH_CEILING_SECONDS,
  CRYPTO_EPOCH_FLOOR_MS,
  CRYPTO_EPOCH_FLOOR_SECONDS,
  epochMsFromIso8601Utc,
  epochMsFromMs,
  epochMsFromSeconds,
} from "../timestamps.js";
import { T0 } from "./fixtures.js";

test("epoch-ms: valid milliseconds pass through verbatim (never rescaled)", () => {
  const result = epochMsFromMs(T0, "f");
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.ms, T0);
});

test("epoch-ms: a SECONDS value in an ms field lands in 1970 and is rejected loudly", () => {
  const result = epochMsFromMs(1_700_448_000, "f");
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.violation.kind, "timestamp-out-of-range");
  assert.match(result.violation.detail, /1_700_448_000|1700448000/);
  assert.match(result.violation.detail, /unit swap/);
});

test("epoch-ms: garbage above the ceiling is rejected (ms read as s lands in the 56th millennium)", () => {
  const result = epochMsFromMs(1_700_448_000_000_000, "f");
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.violation.kind, "timestamp-out-of-range");
});

test("epoch-ms: non-numbers are malformed, never coerced", () => {
  for (const garbage of ["1700448000000", null, undefined, Number.NaN, Infinity]) {
    const result = epochMsFromMs(garbage, "f");
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.violation.kind, "malformed-record");
  }
});

test("epoch-ms: the sanity window is inclusive at both edges", () => {
  assert.equal(epochMsFromMs(CRYPTO_EPOCH_FLOOR_MS, "f").ok, true);
  assert.equal(epochMsFromMs(CRYPTO_EPOCH_FLOOR_MS - 1, "f").ok, false);
  assert.equal(epochMsFromMs(CRYPTO_EPOCH_CEILING_MS, "f").ok, true);
  assert.equal(epochMsFromMs(CRYPTO_EPOCH_CEILING_MS + 1, "f").ok, false);
});

test("epoch-s: valid seconds convert explicitly (×1000) to milliseconds", () => {
  const result = epochMsFromSeconds(1_700_448_000, "f");
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.ms, 1_700_448_000_000);
});

test("epoch-s: a MILLISECONDS value in a seconds field is the classic trap and is rejected", () => {
  const result = epochMsFromSeconds(1_700_448_000_000, "f");
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.violation.kind, "timestamp-out-of-range");
  assert.match(result.violation.detail, /milliseconds value/);
});

test("epoch-s: fractional seconds are malformed (the documented convention is whole seconds)", () => {
  const result = epochMsFromSeconds(1_700_448_000.5, "f");
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.violation.kind, "malformed-record");
});

test("epoch-s: the seconds window is inclusive at both edges", () => {
  assert.equal(epochMsFromSeconds(CRYPTO_EPOCH_FLOOR_SECONDS, "f").ok, true);
  assert.equal(epochMsFromSeconds(CRYPTO_EPOCH_FLOOR_SECONDS - 1, "f").ok, false);
  assert.equal(epochMsFromSeconds(CRYPTO_EPOCH_CEILING_SECONDS, "f").ok, true);
  assert.equal(epochMsFromSeconds(CRYPTO_EPOCH_CEILING_SECONDS + 1, "f").ok, false);
});

test("iso-8601: the documented Z form parses exactly, microseconds truncated to ms", () => {
  const micro = epochMsFromIso8601Utc("2023-11-20T02:40:01.123456Z", "f");
  assert.equal(micro.ok, true);
  assert.ok(micro.ok);
  assert.equal(micro.ms, 1_700_448_001_123);
  const none = epochMsFromIso8601Utc("2023-11-20T02:40:01Z", "f");
  assert.ok(none.ok);
  assert.equal(none.ms, 1_700_448_001_000);
  const milli = epochMsFromIso8601Utc("2023-11-20T02:40:01.123Z", "f");
  assert.ok(milli.ok);
  assert.equal(milli.ms, 1_700_448_001_123);
});

test("iso-8601: truncation rounds DOWN deterministically (.999999 -> 999ms)", () => {
  const result = epochMsFromIso8601Utc("2023-11-20T02:40:01.999999Z", "f");
  assert.ok(result.ok);
  assert.equal(result.ms, 1_700_448_001_999);
});

test("iso-8601: non-Z offsets and non-strings are malformed — the offset is never guessed", () => {
  for (const garbage of [
    "2023-11-20T02:40:01.123456+00:00",
    "2023-11-20T02:40:01.123456",
    "2023-11-20 02:40:01Z",
    "2023-11-20",
    1_700_448_000_000,
    null,
  ]) {
    const result = epochMsFromIso8601Utc(garbage, "f");
    assert.equal(result.ok, false, `expected rejection: '${String(garbage)}'`);
    assert.ok(!result.ok);
    assert.equal(result.violation.kind, "malformed-record");
  }
});

test("iso-8601: rolled-over components fail the round-trip and are malformed", () => {
  for (const garbage of [
    "2023-13-01T00:00:00Z", // month 13
    "2023-02-31T00:00:00Z", // Feb 31
    "2023-11-20T24:00:00Z", // hour 24
    "2023-11-20T23:59:60Z", // leap second
  ]) {
    const result = epochMsFromIso8601Utc(garbage, "f");
    assert.equal(result.ok, false, `expected rejection: '${garbage}'`);
  }
});

test("iso-8601: instants outside the sanity window are out-of-range", () => {
  const preBitcoin = epochMsFromIso8601Utc("2008-12-31T23:59:59Z", "f");
  assert.ok(!preBitcoin.ok);
  assert.equal(preBitcoin.violation.kind, "timestamp-out-of-range");
});
