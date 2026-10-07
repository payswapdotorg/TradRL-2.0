/**
 * The observed-view firewall laws (W033): fail-closed on every axis of
 * "beyond the grant", and the view digest's determinism (the W028 chain
 * discipline — the citation commits to the whole observation).
 *
 * Run: ../../node_modules/.bin/tsx --test test/observedView.test.ts
 * (from packages/cognitive-substrate).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { validateObservedView, viewDigestOf } from "../index.js";
import type { SubstrateErrorCode } from "../index.js";
import {
  book,
  observedView,
  portfolio,
  position,
  quote,
  riskState,
  trade,
  INSTRUMENT,
  LATER,
  OTHER_INSTRUMENT,
  WORLD,
} from "./fixtures.js";

type ViewOutcome = { readonly ok: true } | { readonly ok: false; readonly errors: readonly { code: string }[] };

function codes(outcome: ViewOutcome): readonly string[] {
  assert.equal(outcome.ok, false);
  if (outcome.ok) return [];
  return outcome.errors.map((one) => one.code);
}

test("the default fixture view is inside its own grant (ok)", () => {
  assert.deepEqual(validateObservedView(observedView()), { ok: true });
});

test("a non-finite asOf fails closed", () => {
  const outcome = validateObservedView(observedView({ asOf: Number.NaN as never }));
  assert.deepEqual(codes(outcome), ["non-finite-as-of"]);
});

test("content for an unadmitted observation kind is a typed error (never silently seen)", () => {
  const outcome = validateObservedView(
    observedView({
      observations: ["market-quote", "own-positions"],
      trades: [trade("4800")],
    }),
  );
  assert.deepEqual(codes(outcome), ["observation-kind-not-in-view"]);
  assert.match(String(outcome.ok === false ? outcome.errors[0]?.message : ""), /market-trades/);
});

test("market content outside the view's instruments is a typed error", () => {
  const outcome = validateObservedView(
    observedView({ quotes: [quote("4799.75", "4800.25", undefined, OTHER_INSTRUMENT)] }),
  );
  assert.deepEqual(codes(outcome), ["instrument-not-in-view"]);
});

test("own-state for another account is a typed error", () => {
  const foreign = observedView({
    ownPositions: [{ ...position("2"), accountId: "account-someone-else" as never }],
  });
  assert.deepEqual(codes(validateObservedView(foreign)), ["account-mismatch"]);

  const foreignPortfolio = observedView({
    portfolio: { ...portfolio(), accountId: "account-someone-else" as never },
  });
  assert.deepEqual(codes(validateObservedView(foreignPortfolio)), ["account-mismatch"]);

  const foreignRisk = observedView({
    riskState: { ...riskState(), accountId: "account-someone-else" as never },
  });
  assert.deepEqual(codes(validateObservedView(foreignRisk)), ["account-mismatch"]);
});

test("content from another world is a typed error", () => {
  const outcome = validateObservedView(
    observedView({
      ownPositions: [{ ...position("2"), worldId: "world-elsewhere" as never }],
    }),
  );
  assert.deepEqual(codes(outcome), ["world-mismatch"]);
});

test("future-dated content is a typed error (A7: no future data, per family)", () => {
  const futureQuote = validateObservedView(observedView({ quotes: [quote("1", "2", LATER)] }));
  assert.deepEqual(codes(futureQuote), ["future-dated-content"]);

  const futureTrade = validateObservedView(observedView({ trades: [trade("4800", LATER, 9)] }));
  assert.deepEqual(codes(futureTrade), ["future-dated-content"]);

  const futureBook = validateObservedView(observedView({ books: [book("1", "2", LATER)] }));
  assert.deepEqual(codes(futureBook), ["future-dated-content"]);

  const futurePortfolio = validateObservedView(observedView({ portfolio: portfolio(LATER) }));
  assert.deepEqual(codes(futurePortfolio), ["future-dated-content"]);

  const futureRisk = validateObservedView(observedView({ riskState: riskState(LATER) }));
  assert.deepEqual(codes(futureRisk), ["future-dated-content"]);

  const futurePosition = validateObservedView(
    observedView({ ownPositions: [position("1", LATER)] }),
  );
  assert.deepEqual(codes(futurePosition), ["future-dated-content"]);
});

test("an artifact not yet available is refused (the canonical A7 predicate, reused)", () => {
  const artifact = {
    artifactId: "artifact-late" as never,
    worldId: WORLD as never,
    source: "fixture-wire",
    createdAt: 1 as never,
    availableAt: LATER,
    scope: "news",
    provenance: { producer: "fixture-wire" as never, recordedAt: 1 as never },
    version: "1",
    payload: { headline: "not yet" },
  };
  const outcome = validateObservedView(observedView({ artifacts: [artifact] }));
  assert.deepEqual(codes(outcome), ["artifact-not-available"]);
});

test("malformed decimals are typed errors (exponent form is not contract-boundary text)", () => {
  const exponent = validateObservedView(observedView({ quotes: [quote("4.8e3", "4800.25")] }));
  assert.deepEqual(codes(exponent), ["malformed-decimal"]);

  const badTrade = validateObservedView(observedView({ trades: [trade("4800.25.1")] }));
  assert.deepEqual(codes(badTrade), ["malformed-decimal"]);

  const badPosition = validateObservedView(observedView({ ownPositions: [position("±2")] }));
  assert.deepEqual(codes(badPosition), ["malformed-decimal"]);

  const badBook = validateObservedView(observedView({ books: [book("4800.25", "01")] }));
  assert.deepEqual(codes(badBook), ["malformed-decimal"]);
});

test("duplicate projections for the same instrument are typed errors", () => {
  const duplicateQuotes = observedView({
    quotes: [quote("4799.75", "4800.25"), quote("4799.50", "4800.50")],
  });
  assert.deepEqual(codes(validateObservedView(duplicateQuotes)), ["duplicate-projection"]);

  const duplicateBooks = observedView({
    books: [book("4799.75", "4800.25"), book("4799.50", "4800.50")],
  });
  assert.deepEqual(codes(validateObservedView(duplicateBooks)), ["duplicate-projection"]);
});

test("signed P&L and short quantities are legal canonical decimals", () => {
  const outcome = validateObservedView(
    observedView({
      ownPositions: [position("-3")],
      portfolio: portfolio(),
    }),
  );
  assert.deepEqual(outcome, { ok: true });
});

test("viewDigestOf: same content ⇒ same digest; any change ⇒ a different digest (A9)", () => {
  const first = observedView();
  const same = observedView();
  assert.equal(viewDigestOf(first), viewDigestOf(same));

  const changed = observedView({ quotes: [quote("4799.50", "4800.50")] });
  assert.notEqual(viewDigestOf(first), viewDigestOf(changed));

  const laterAsOf = observedView({ asOf: LATER });
  assert.notEqual(viewDigestOf(first), viewDigestOf(laterAsOf));
});

test("viewDigestOf: key order never matters (canonical serialization)", () => {
  const first = observedView();
  const reordered = {
    worldId: first.worldId,
    quotes: first.quotes,
    observations: first.observations,
    asOf: first.asOf,
    instruments: [INSTRUMENT],
    accountId: first.accountId,
    participantId: first.participantId,
    bodyId: first.bodyId,
    trades: first.trades,
    ownPositions: first.ownPositions,
    ownOrders: first.ownOrders,
  };
  assert.equal(viewDigestOf(first), viewDigestOf(reordered as never));
});

test("every firewall error names its field and an exact message (loud, never silent)", () => {
  const outcome = validateObservedView(
    observedView({ quotes: [quote("4.8e3", "4800.25", LATER, OTHER_INSTRUMENT)] }),
  );
  assert.ok(!outcome.ok);
  const seen = outcome.errors.map((one: { code: SubstrateErrorCode; field?: string }) => [one.code, one.field]);
  assert.deepEqual(seen, [
    ["instrument-not-in-view", "quotes[0]"],
    ["future-dated-content", "quotes[0].asOf"],
    ["malformed-decimal", "quotes[0].bid"],
  ]);
});
