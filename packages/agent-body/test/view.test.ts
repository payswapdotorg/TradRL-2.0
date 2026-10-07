/**
 * The A7 observation firewall laws (W032): a Body cannot subscribe beyond
 * available-then — artifacts with `availableAt` after `asOf` are withheld
 * AND named; grants are always within the view; a broken time axis fails
 * closed.
 *
 * Run: ../../node_modules/.bin/tsx --test test/view.test.ts
 * (from packages/agent-body).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { projectBodyObservations } from "../index.js";
import type { BodyObservationRequest } from "../index.js";
import {
  INSTRUMENT_ES,
  INSTRUMENT_NQ,
  LATER,
  NEWS_EARLY,
  NEWS_LATE,
  START,
  fixtureArtifacts,
  traderView,
} from "./fixtures.js";

function request(overrides: Partial<BodyObservationRequest> = {}): BodyObservationRequest {
  return {
    asOf: START as never,
    kinds: ["market-quote", "market-book", "information-artifacts"],
    artifacts: [NEWS_EARLY, NEWS_LATE],
    ...overrides,
  };
}

test("an artifact is observable exactly from its availableAt (the A7 law)", () => {
  const grant = projectBodyObservations(traderView(), request(), fixtureArtifacts());
  // NEWS_EARLY is availableAt START; requesting at START sees it
  assert.deepEqual(grant.visibleArtifacts, [NEWS_EARLY]);
  // NEWS_LATE is availableAt LATER — withheld AND named at START
  assert.deepEqual(grant.withheldArtifacts, [NEWS_LATE]);
  assert.deepEqual(grant.denials, []);
  // one tick before availableAt it is still withheld; at LATER it is visible
  const before = projectBodyObservations(
    traderView(),
    request({ asOf: (START - 1) as never }),
    fixtureArtifacts(),
  );
  assert.deepEqual(before.visibleArtifacts, []);
  assert.deepEqual(before.withheldArtifacts, [NEWS_EARLY, NEWS_LATE]);
  const atLater = projectBodyObservations(
    traderView(),
    request({ asOf: LATER }),
    fixtureArtifacts(),
  );
  assert.deepEqual(atLater.visibleArtifacts, [NEWS_EARLY, NEWS_LATE]);
  assert.deepEqual(atLater.withheldArtifacts, []);
});

test("kinds beyond the view are denied by name", () => {
  const view = traderView({ observations: ["market-quote"] });
  const grant = projectBodyObservations(view, request(), fixtureArtifacts());
  assert.deepEqual(grant.kinds, ["market-quote"]);
  assert.deepEqual(
    grant.denials.map((denial) => denial.code),
    // market-book + information-artifacts (the kinds) and one more for the
    // artifact channel: the requested artifacts were not judged because
    // their observation kind is not granted
    ["kind-not-in-view", "kind-not-in-view", "kind-not-in-view"],
  );
  // the information-artifacts denial covers the artifact channel: nothing
  // is visible and nothing is silently dropped
  assert.deepEqual(grant.visibleArtifacts, []);
  assert.deepEqual(grant.withheldArtifacts, []);
});

test("instruments beyond the view are denied by name", () => {
  const grant = projectBodyObservations(
    traderView(),
    request({ instruments: [INSTRUMENT_ES, INSTRUMENT_NQ] }),
    fixtureArtifacts(),
  );
  assert.deepEqual(grant.instruments, [INSTRUMENT_ES]);
  assert.deepEqual(grant.denials.map((denial) => denial.code), ["instrument-not-in-view"]);
  assert.match(grant.denials[0]?.message ?? "", /outside this Body's view/);
});

test("instruments default to the view's own scope", () => {
  const grant = projectBodyObservations(
    traderView(),
    request({ instruments: undefined }),
    fixtureArtifacts(),
  );
  assert.deepEqual(grant.instruments, [INSTRUMENT_ES]);
  assert.deepEqual(grant.denials, []);
});

test("unknown artifacts are denied, never guessed", () => {
  const grant = projectBodyObservations(
    traderView(),
    request({ artifacts: [NEWS_EARLY, "artifact-ghost" as never] }),
    fixtureArtifacts(),
  );
  assert.deepEqual(grant.visibleArtifacts, [NEWS_EARLY]);
  assert.deepEqual(grant.denials.map((denial) => denial.code), ["unknown-artifact"]);
});

test("a non-finite asOf fails closed: no artifact is visible", () => {
  const grant = projectBodyObservations(
    traderView(),
    request({ asOf: Number.POSITIVE_INFINITY as never }),
    fixtureArtifacts(),
  );
  assert.deepEqual(grant.visibleArtifacts, []);
  assert.deepEqual(grant.withheldArtifacts, []);
  assert.deepEqual(
    grant.denials.map((denial) => denial.code),
    ["non-finite-as-of"],
  );
  // market kinds remain grantable (they are as-of-current projections);
  // the broken axis only poisons the artifact channel
  assert.deepEqual(grant.kinds, ["market-quote", "market-book", "information-artifacts"]);
});

test("the grant is always within the view (subset invariants)", () => {
  const view = traderView();
  for (const asOf of [START, LATER, Number.NaN] as const) {
    const grant = projectBodyObservations(
      view,
      request({ asOf: asOf as never, kinds: [...view.observations] }),
      fixtureArtifacts(),
    );
    assert.ok(grant.kinds.every((kind) => view.observations.includes(kind)));
    assert.ok(grant.instruments.every((i) => view.instruments.includes(i)));
    assert.equal(grant.bodyId, view.bodyId);
    assert.equal(grant.worldId, view.worldId);
  }
});

test("withholding is per-request: unrequested artifacts are neither visible nor withheld", () => {
  const grant = projectBodyObservations(
    traderView(),
    request({ artifacts: undefined }),
    fixtureArtifacts(),
  );
  assert.deepEqual(grant.visibleArtifacts, []);
  assert.deepEqual(grant.withheldArtifacts, []);
  assert.deepEqual(grant.denials, []);
});
