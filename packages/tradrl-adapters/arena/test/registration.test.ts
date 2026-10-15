/**
 * The arena registration gate (W057) — the closed-set laws, the round
 * laws, the regime law, the R052 refusal THROUGH the real W056 gate, and
 * the canonical record shape. Real W040 registrations, real W056 gate
 * runs, real W037/W038 evidence chains — no shims.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { registerArenaProvider } from "../arena-registration.js";
import type { ArenaLeaderboardStyle, ArenaRegimeKind, ArenaRoundKind, ArenaVenueKind } from "../arena-identity.js";
import {
  arenaDeclarationFixture,
  emptyRegistry,
  evaluationFixture,
  evidenceBundle,
  experimentFixture,
  findingsFixture,
} from "./fixtures.js";

const codes = (errors: readonly { code: string }[]): string[] => errors.map((item) => item.code);

test("a real arena registration passes the REAL W056 gate and records canonical ids", () => {
  const outcome = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected the fixture registration to succeed");
  }
  const { registration, registry } = outcome;
  assert.match(String(registration.arenaId), /^arena-/);
  assert.match(String(registration.provider.providerId), /^provider-/);
  assert.equal(registration.provider.offers.length, 2);
  assert.equal(registration.offers.length, 2);
  assert.equal(registry.entries.length, 2);
  for (const round of registration.venue.rounds) {
    assert.match(String(round.roundId), /^arena-round-/);
  }
  // Canonical order laws: rounds by sequence, offers by canonical offer id.
  assert.deepEqual(
    registration.venue.rounds.map((round) => round.sequence),
    [1, 2, 3],
  );
  const offerIds = registration.offers.map((arenaOffer) => String(arenaOffer.offer.offerId));
  assert.deepEqual([...offerIds].sort(), offerIds);
  // The round citations resolve in the recorded venue.
  const roundIds = new Set(registration.venue.rounds.map((round) => String(round.roundId)));
  for (const arenaOffer of registration.offers) {
    assert.ok(roundIds.has(String(arenaOffer.measuredInRoundId)));
  }
  // The neutral record rides verbatim inside the arena record.
  assert.equal(registration.provider.identity.name, "the arena test venue");
  assert.equal(registration.venue.leaderboard.style, "top-k");
  assert.equal(registration.venue.leaderboard.topK, 2);
});

test("the venue-kind closed set is enforced loudly", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: { ...base.venue, venueKind: "hybrid-tournament" as ArenaVenueKind },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.ok(codes(outcome.errors).includes("unknown-venue-kind"));
});

test("the round-kind closed set is enforced loudly", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: {
      ...base.venue,
      rounds: [{ roundKind: "repechage" as ArenaRoundKind, sequence: 1 }],
    },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.ok(codes(outcome.errors).includes("unknown-round-kind"));
  // The offer round citations now miss too — the multi-law collector is honest.
  assert.ok(codes(outcome.errors).includes("unknown-round-citation"));
});

test("the regime-kind closed set is enforced loudly", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), {
    ...base,
    offers: base.offers.map((arenaOffer, index) =>
      index === 0
        ? { ...arenaOffer, regime: { regimeKind: "committee-of-peers" as ArenaRegimeKind } }
        : arenaOffer,
    ),
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.ok(codes(outcome.errors).includes("unknown-regime-kind"));
});

test("the leaderboard-style closed set is enforced loudly", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: {
      ...base.venue,
      leaderboard: { style: "elo-rating" as ArenaLeaderboardStyle, topK: 2 },
    },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.ok(codes(outcome.errors).includes("unknown-leaderboard-style"));
});

test("a venue with no rounds is refused", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), { ...base, venue: { ...base.venue, rounds: [] } });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.ok(codes(outcome.errors).includes("no-rounds"));
  assert.ok(codes(outcome.errors).includes("unknown-round-citation"));
});

test("round sequences must be positive and strictly increasing", () => {
  const base = arenaDeclarationFixture();
  const zero = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: { ...base.venue, rounds: [{ roundKind: "screening", sequence: 0 }] },
  });
  assert.equal(zero.ok, false);
  if (!zero.ok) {
    assert.ok(codes(zero.errors).includes("round-sequence-break"));
  }
  const backwards = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: {
      ...base.venue,
      rounds: [
        { roundKind: "screening", sequence: 2 },
        { roundKind: "trial", sequence: 1 },
      ],
    },
  });
  assert.equal(backwards.ok, false);
  if (!backwards.ok) {
    assert.ok(codes(backwards.errors).includes("round-sequence-break"));
  }
});

test("an offer citing a round the venue never declared is refused", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), {
    ...base,
    offers: base.offers.map((arenaOffer, index) =>
      index === 0 ? { ...arenaOffer, measuredInRoundSequence: 9 } : arenaOffer,
    ),
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  assert.ok(codes(outcome.errors).includes("unknown-round-citation"));
});

test("the regime never lies about its evidence count", () => {
  const base = arenaDeclarationFixture();
  const singleWithTwo = registerArenaProvider(emptyRegistry(), {
    ...base,
    offers: [
      {
        ...base.offers[0]!,
        regime: { regimeKind: "single-evaluation" },
        offer: { ...base.offers[0]!.offer, evidence: [evidenceBundle("a"), evidenceBundle("b")] },
      },
      base.offers[1]!,
    ],
  });
  assert.equal(singleWithTwo.ok, false);
  if (!singleWithTwo.ok) {
    assert.ok(codes(singleWithTwo.errors).includes("regime-evidence-mismatch"));
  }
  const consensusWithOne = registerArenaProvider(emptyRegistry(), {
    ...base,
    offers: [
      base.offers[0]!,
      {
        ...base.offers[1]!,
        regime: { regimeKind: "single-evaluation" },
      },
    ],
  });
  assert.equal(consensusWithOne.ok, false);
  if (!consensusWithOne.ok) {
    assert.ok(codes(consensusWithOne.errors).includes("regime-evidence-mismatch"));
  }
});

test("the top-k leaderboard laws are enforced loudly", () => {
  const base = arenaDeclarationFixture();
  const withoutK = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: { ...base.venue, leaderboard: { style: "top-k" } },
  });
  assert.equal(withoutK.ok, false);
  if (!withoutK.ok) {
    assert.ok(codes(withoutK.errors).includes("leaderboard-top-k-invalid"));
  }
  const zeroK = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: { ...base.venue, leaderboard: { style: "top-k", topK: 0 } },
  });
  assert.equal(zeroK.ok, false);
  if (!zeroK.ok) {
    assert.ok(codes(zeroK.errors).includes("leaderboard-top-k-invalid"));
  }
  const rosterWithK = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: { ...base.venue, leaderboard: { style: "full-roster", topK: 2 } },
  });
  assert.equal(rosterWithK.ok, false);
  if (!rosterWithK.ok) {
    assert.ok(codes(rosterWithK.errors).includes("leaderboard-top-k-invalid"));
  }
});

test("blank arena and venue names are refused", () => {
  const base = arenaDeclarationFixture();
  const blankArena = registerArenaProvider(emptyRegistry(), {
    ...base,
    identity: { ...base.identity, name: "   " },
  });
  assert.equal(blankArena.ok, false);
  if (!blankArena.ok) {
    assert.ok(codes(blankArena.errors).includes("blank-arena-name"));
  }
  const blankVenue = registerArenaProvider(emptyRegistry(), {
    ...base,
    venue: { ...base.venue, name: "" },
  });
  assert.equal(blankVenue.ok, false);
  if (!blankVenue.ok) {
    assert.ok(codes(blankVenue.errors).includes("blank-venue-name"));
  }
});

test("R052 through the REAL W056 gate: an unmeasured offer is refused there, carried verbatim here", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), {
    ...base,
    offers: [
      {
        ...base.offers[0]!,
        offer: { ...base.offers[0]!.offer, evidence: [] },
      },
      base.offers[1]!,
    ],
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  // The arena regime law fires too (a regime over zero citations lies).
  assert.ok(codes(outcome.errors).includes("regime-evidence-mismatch"));
  const refused = outcome.errors.find((item) => item.code === "provider-gate-refused");
  assert.notEqual(refused, undefined);
  const carried = refused?.providerErrors ?? [];
  assert.ok(
    carried.some((providerError) => providerError.code === "unmeasured-offer"),
    `expected W056's unmeasured-offer carried verbatim, got ${JSON.stringify(carried.map((item) => item.code))}`,
  );
});

test("W040's own evidence verdict law is carried verbatim through W056", () => {
  const experiment = experimentFixture("a");
  const evaluation = evaluationFixture(experiment, "a");
  const findings = findingsFixture(String(evaluation.evaluationId), ["FAIL", "PASS"]);
  const base = arenaDeclarationFixture();
  const failed = registerArenaProvider(emptyRegistry(), {
    ...base,
    offers: [
      {
        ...base.offers[0]!,
        offer: { ...base.offers[0]!.offer, evidence: [{ experiment, evaluation, findings }] },
      },
      base.offers[1]!,
    ],
  });
  assert.equal(failed.ok, false);
  if (failed.ok) {
    assert.fail("expected a refusal");
  }
  const refused = failed.errors.find((item) => item.code === "provider-gate-refused");
  assert.notEqual(refused, undefined);
  assert.ok(
    (refused?.providerErrors ?? []).some((providerError) => providerError.code === "offer-refused"),
    "expected W056's offer-refused (W040's failed-evidence inside) carried verbatim",
  );
});

test("a version-2 arena without a parent is refused by W056's lineage law, carried verbatim", () => {
  const base = arenaDeclarationFixture();
  const outcome = registerArenaProvider(emptyRegistry(), {
    ...base,
    lineage: { parentProviderId: null, version: 2 },
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("expected a refusal");
  }
  const refused = outcome.errors.find((item) => item.code === "provider-gate-refused");
  assert.notEqual(refused, undefined);
  assert.ok(
    (refused?.providerErrors ?? []).some((providerError) => providerError.code === "provider-lineage-break"),
  );
});

test("re-registering the same arena is refused loudly through the W056/W040 duplicate laws", () => {
  const first = registerArenaProvider(emptyRegistry(), arenaDeclarationFixture());
  assert.equal(first.ok, true);
  if (!first.ok) {
    assert.fail("expected the first registration to succeed");
  }
  const second = registerArenaProvider(
    emptyRegistry(),
    arenaDeclarationFixture(),
    [first.registration],
  );
  assert.equal(second.ok, false);
  if (second.ok) {
    assert.fail("expected a refusal");
  }
  const refused = second.errors.find((item) => item.code === "provider-gate-refused");
  assert.notEqual(refused, undefined);
  const carried = (refused?.providerErrors ?? []).map((providerError) => providerError.code);
  assert.ok(
    carried.includes("duplicate-provider") || carried.includes("offer-refused"),
    `expected a duplicate law carried verbatim, got ${JSON.stringify(carried)}`,
  );
});
