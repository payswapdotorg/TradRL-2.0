/**
 * The dtype/tick convention check tests (W022): the seven dtype-value claims
 * hold against the real adapter (bars, A7 boundaries, aggressor sides, trade
 * ids, quote no-last, canonical decimals).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDtypeConventions } from "../dtypeChecks.js";
import { verifyTickConventions } from "../tickChecks.js";
import { harnessCatalog } from "../index.js";

const barFindings = verifyDtypeConventions(harnessCatalog());
const tickFindings = verifyTickConventions(harnessCatalog());

test("three bar/tick-availability findings are emitted, all PASS", () => {
  assert.deepEqual(
    barFindings.map((f) => f.claimId),
    ["bar-interval-convention", "bar-availability-at-close", "tick-availability-boundary"],
  );
  for (const finding of barFindings) {
    assert.equal(finding.verdict, "PASS", `${finding.claimId}: PASS`);
    for (const verdict of finding.cases) {
      assert.equal(verdict.problem, undefined, `${finding.claimId}/${verdict.caseId}: held`);
    }
  }
});

test("the bar-interval claim covers the derived durations, the irregular declaration and the right-parsed symbol", () => {
  const finding = barFindings[0]!;
  const ids = finding.cases.map((c) => c.caseId);
  assert.deepEqual(ids, [
    "interval-1-minute-derived",
    "interval-5-minute-multiplies-step",
    "interval-1-hour-derived",
    "interval-1-day-derived",
    "interval-irregular-requires-declared-granularity",
    "interval-irregular-uses-declared-granularity",
    "interval-declared-granularity-contradiction-loud",
    "interval-bar-type-parses-from-the-right",
    "interval-unknown-aggregation-loud",
    "interval-unknown-price-type-loud",
    "interval-zero-step-loud",
    "interval-short-bar-type-loud",
  ]);
});

test("the A7 availability claims cover the inclusive boundary and the loud violations per dtype", () => {
  const barA7 = barFindings[1]!;
  assert.deepEqual(
    barA7.cases.map((c) => c.caseId),
    ["bar-availability-equals-close-maps", "bar-availability-before-close-loud", "bar-availability-delayed-preserved"],
  );
  const tickA7 = barFindings[2]!;
  assert.deepEqual(
    tickA7.cases.map((c) => c.caseId),
    ["trade-availability-equals-event-maps", "trade-availability-before-event-loud", "quote-availability-before-event-loud", "quote-availability-delayed-preserved"],
  );
  const loud = tickA7.cases.find((c) => c.caseId === "trade-availability-before-event-loud");
  assert.ok(loud);
  assert.match(loud.observed, /availability-boundary/);
});

test("four trade/quote/decimal findings are emitted, all PASS", () => {
  assert.deepEqual(
    tickFindings.map((f) => f.claimId),
    ["aggressor-side-mapping", "trade-id-forms", "quote-no-last", "float64-canonical-decimal"],
  );
  for (const finding of tickFindings) {
    assert.equal(finding.verdict, "PASS", `${finding.claimId}: PASS`);
    for (const verdict of finding.cases) {
      assert.equal(verdict.problem, undefined, `${finding.claimId}/${verdict.caseId}: held`);
    }
  }
});

test("the quote-no-last claim proves the stray `last` field is never smuggled in", () => {
  const finding = tickFindings[2]!;
  const stray = finding.cases.find((c) => c.caseId === "quote-stray-last-field-ignored");
  assert.ok(stray);
  assert.match(stray.observed, /"kind":"quote"/);
  assert.doesNotMatch(stray.observed, /"last"/);
});

test("the canonical-decimal claim names the exact shortest round-trip text in its evidence", () => {
  const finding = tickFindings[3]!;
  const shortest = finding.cases.find((c) => c.caseId === "decimal-shortest-roundtrip");
  assert.ok(shortest);
  assert.match(shortest.observed, /48000.1/);
  assert.doesNotMatch(shortest.observed, /48000\.1000000000/);
});
