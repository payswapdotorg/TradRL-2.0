/**
 * Instrument-table laws (W021): the documented "<SYMBOL>-<VENUE>"
 * InstrumentId shape, typed resolution against the declared table, and the
 * W020 symbol-map projection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { InstrumentId } from "tradrl-world-contracts";
import {
  declaredInstruments,
  instrumentMapOf,
  isInstrumentIdShape,
  resolveNautilusInstrument,
} from "../instruments.js";
import type { NautilusInstrumentTable } from "../instruments.js";
import { NAUTILUS_INSTRUMENTS } from "./fixtures.js";

test("the documented InstrumentId shape: <SYMBOL>-<VENUE>, venue last", () => {
  assert.ok(isInstrumentIdShape("BTCUSDT-BINANCE"));
  assert.ok(isInstrumentIdShape("BTCUSDT-PERP-BINANCE")); // symbol suffix + venue
  assert.ok(isInstrumentIdShape("EUR/USD-SIM")); // FX-style symbol with its own slash
  assert.ok(!isInstrumentIdShape("BTCUSDTBINANCE")); // no venue
  assert.ok(!isInstrumentIdShape(""));
  assert.ok(!isInstrumentIdShape("-BINANCE"));
  assert.ok(!isInstrumentIdShape("BTCUSDT-"));
});

test("declared instruments resolve; unmapped ids are typed rejections (never dropped)", () => {
  const ok = resolveNautilusInstrument(NAUTILUS_INSTRUMENTS, "BTCUSDT-BINANCE");
  assert.ok(ok.ok);
  assert.equal(ok.instrumentId, "instrument-btcusdt");
  const unknown = resolveNautilusInstrument(NAUTILUS_INSTRUMENTS, "ETHUSDT-KRAKEN");
  assert.ok(!unknown.ok);
  assert.equal(unknown.violation.kind, "unknown-instrument");
  assert.match(unknown.violation.detail, /declare it in the catalog's instrument table/);
});

test("shape violations name the documented convention (before any table lookup)", () => {
  const noVenue = resolveNautilusInstrument(NAUTILUS_INSTRUMENTS, "BTCUSDTBINANCE");
  assert.ok(!noVenue.ok);
  assert.equal(noVenue.violation.kind, "unknown-instrument");
  assert.match(noVenue.violation.detail, /<SYMBOL>-<VENUE>/);
  const blank = resolveNautilusInstrument(NAUTILUS_INSTRUMENTS, " ");
  assert.ok(!blank.ok);
  assert.equal(blank.violation.kind, "unknown-instrument");
});

test("a blank mapping is a typed rejection (a world instrument is never blank)", () => {
  const table: NautilusInstrumentTable = { "BTCUSDT-BINANCE": "" as InstrumentId };
  const result = resolveNautilusInstrument(table, "BTCUSDT-BINANCE");
  assert.ok(!result.ok);
  assert.equal(result.violation.kind, "unknown-instrument");
  assert.match(result.violation.detail, /blank/);
});

test("the table IS the W020 symbol map (same data, no transformation)", () => {
  assert.deepEqual(instrumentMapOf(NAUTILUS_INSTRUMENTS), {
    "BTCUSDT-BINANCE": "instrument-btcusdt",
    "ETHUSD-BINANCE": "instrument-ethusdt",
  });
  assert.deepEqual(declaredInstruments(NAUTILUS_INSTRUMENTS), [
    "BTCUSDT-BINANCE",
    "ETHUSD-BINANCE",
  ]);
});
