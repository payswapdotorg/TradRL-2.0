/**
 * The A9 twins (W057) — same arena declaration + same registry ⇒
 * deep-equal registrations, same canonical ids, deep-equal adjudication
 * and leaderboard projections; any differing byte ⇒ a different id.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { adjudicateArenaOffers, projectArenaLeaderboard } from "../arena-adjudication.js";
import { registerArenaProvider } from "../arena-registration.js";
import {
  ORG_CAP_EXECUTION,
  SCOPE,
  arenaDeclarationFixture,
  asOrgCap,
  emptyRegistry,
  evidenceBundle,
} from "./fixtures.js";

const demand = {
  scope: { ...SCOPE },
  capability: { capabilityId: asOrgCap(String(ORG_CAP_EXECUTION)), name: "the demanded capability" },
  demand: { capabilityId: asOrgCap(String(ORG_CAP_EXECUTION)), rationale: "the seat requires a measured capability" },
};

test("twin registrations are deep-equal with the same canonical ids (A9)", () => {
  const left = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  const right = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    assert.fail("expected both twins to register");
  }
  assert.equal(String(left.registration.arenaId), String(right.registration.arenaId));
  assert.equal(
    String(left.registration.provider.providerId),
    String(right.registration.provider.providerId),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(left.registration)),
    JSON.parse(JSON.stringify(right.registration)),
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(left.registry)),
    JSON.parse(JSON.stringify(right.registry)),
  );
});

test("offer declaration order never leaks: a shuffled declaration is the SAME arena (A9)", () => {
  const straight = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  const shuffled = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture({
    offers: [...arenaDeclarationFixture().offers].reverse(),
  }));
  assert.equal(straight.ok, true);
  assert.equal(shuffled.ok, true);
  if (!straight.ok || !shuffled.ok) {
    assert.fail("expected both to register");
  }
  assert.equal(String(straight.registration.arenaId), String(shuffled.registration.arenaId));
  assert.deepEqual(
    JSON.parse(JSON.stringify(straight.registration)),
    JSON.parse(JSON.stringify(shuffled.registration)),
  );
});

test("twin adjudications are deep-equal with the same adjudication id (A9)", () => {
  const left = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  const right = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  if (!left.ok || !right.ok) {
    assert.fail("expected both twins to register");
  }
  const leftOutcome = adjudicateArenaOffers(demand, left.registration, left.registry);
  const rightOutcome = adjudicateArenaOffers(demand, right.registration, right.registry);
  assert.deepEqual(
    JSON.parse(JSON.stringify(leftOutcome)),
    JSON.parse(JSON.stringify(rightOutcome)),
  );
  if (leftOutcome.ok && rightOutcome.ok) {
    assert.equal(String(leftOutcome.adjudicationId), String(rightOutcome.adjudicationId));
  }
});

test("twin leaderboard projections are deep-equal with the same leaderboard id (A9)", () => {
  const left = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  const right = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  if (!left.ok || !right.ok) {
    assert.fail("expected both twins to register");
  }
  const leftProjection = projectArenaLeaderboard(left.registration);
  const rightProjection = projectArenaLeaderboard(right.registration);
  assert.deepEqual(
    JSON.parse(JSON.stringify(leftProjection)),
    JSON.parse(JSON.stringify(rightProjection)),
  );
  if (leftProjection.ok && rightProjection.ok) {
    assert.equal(
      String(leftProjection.projection.leaderboardId),
      String(rightProjection.projection.leaderboardId),
    );
  }
});

test("any differing byte is a different arena: the venue, then the regime (A9)", () => {
  const base = arenaDeclarationFixture();
  const renamed = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture({
    venue: { ...base.venue, name: "a renamed venue" },
  }));
  const regevened = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture({
    offers: base.offers.map((arenaOffer, index) =>
      index === 0
        ? {
            ...arenaOffer,
            regime: { regimeKind: "consensus-of-evaluations" },
            offer: { ...arenaOffer.offer, evidence: [...arenaOffer.offer.evidence, evidenceBundle("e")] },
          }
        : arenaOffer,
    ),
  }));
  const baseline = registerArenaProvider(emptyRegistry(), base);
  if (!baseline.ok || !renamed.ok || !regevened.ok) {
    assert.fail("expected all three to register");
  }
  assert.notEqual(String(baseline.registration.arenaId), String(renamed.registration.arenaId));
  assert.notEqual(String(baseline.registration.arenaId), String(regevened.registration.arenaId));
  // The neutral provider id is untouched by arena-ONLY differences (R055:
  // the neutral layer never weighs arena specifics — the venue rename proof).
  assert.equal(
    String(baseline.registration.provider.providerId),
    String(renamed.registration.provider.providerId),
  );
});
