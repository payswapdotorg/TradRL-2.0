/**
 * The arena re-validation gate (W057) — the whole registration re-proved
 * from its RECORDED data, W056's validateProviderRegistration carried
 * verbatim.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { validateArenaRegistration } from "../validate.js";
import type { ArenaProviderRegistration } from "../arena-registration.js";
import { arenaDeclarationFixture, emptyRegistry, registerArenaFixture } from "./fixtures.js";

const codes = (errors: readonly { code: string }[]): string[] => errors.map((item) => item.code);

test("a real recorded arena registration re-validates clean, with and without the registry", () => {
  const { registration, registry } = registerArenaFixture();
  const bare = validateArenaRegistration(registration);
  assert.equal(bare.ok, true);
  if (!bare.ok) {
    assert.fail("expected the bare re-validation to succeed");
  }
  assert.deepEqual(bare.checked, [
    "arena-closed-sets",
    "round-laws",
    "offer-citations",
    "canonical-order",
    "arena-identity",
  ]);
  const cross = validateArenaRegistration(registration, registry);
  assert.equal(cross.ok, true);
  if (!cross.ok) {
    assert.fail("expected the cross-checked re-validation to succeed");
  }
  assert.deepEqual(cross.checked, [
    "arena-closed-sets",
    "round-laws",
    "offer-citations",
    "canonical-order",
    "arena-identity",
    "registry-agreement",
  ]);
});

test("a tampered arena id is refused: identity is a function of content (A9)", () => {
  const { registration } = registerArenaFixture();
  const tampered: ArenaProviderRegistration = {
    ...registration,
    arenaId: "arena-forged" as ArenaProviderRegistration["arenaId"],
  };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(codes(outcome.errors).includes("arena-id-mismatch"));
  }
});

test("a tampered round id is refused: identity is a function of content (A9)", () => {
  const { registration } = registerArenaFixture();
  const rounds = registration.venue.rounds.map((round) => ({ ...round }));
  const first = rounds[0];
  if (first === undefined) {
    assert.fail("expected a first round");
  }
  first.roundId = "arena-round-forged" as typeof first.roundId;
  const tampered: ArenaProviderRegistration = {
    ...registration,
    venue: { ...registration.venue, rounds },
  };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(codes(outcome.errors).includes("round-id-mismatch"));
  }
});

test("a tampered offer round citation is refused, and the arena id with it", () => {
  const { registration } = registerArenaFixture();
  const offers = registration.offers.map((arenaOffer) => ({ ...arenaOffer }));
  const first = offers[0];
  if (first === undefined) {
    assert.fail("expected a first offer");
  }
  first.measuredInRoundId = "arena-round-forged" as typeof first.measuredInRoundId;
  const tampered: ArenaProviderRegistration = { ...registration, offers };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const present = codes(outcome.errors);
    assert.ok(present.includes("unknown-round-citation"));
    assert.ok(present.includes("arena-id-mismatch"));
  }
});

test("a recorded round kind outside the closed vocabulary is refused loudly", () => {
  const { registration } = registerArenaFixture();
  const rounds = registration.venue.rounds.map((round) => ({ ...round }));
  const first = rounds[0];
  if (first === undefined) {
    assert.fail("expected a first round");
  }
  first.roundKind = "repechage" as typeof first.roundKind;
  const tampered: ArenaProviderRegistration = {
    ...registration,
    venue: { ...registration.venue, rounds },
  };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const present = codes(outcome.errors);
    assert.ok(present.includes("unknown-round-kind"));
    assert.ok(present.includes("round-id-mismatch"));
    assert.ok(present.includes("arena-id-mismatch"));
  }
});

test("a duplicated recorded round is refused", () => {
  const { registration } = registerArenaFixture();
  const rounds = [...registration.venue.rounds, { ...registration.venue.rounds[1]! }];
  const tampered: ArenaProviderRegistration = {
    ...registration,
    venue: { ...registration.venue, rounds },
  };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const present = codes(outcome.errors);
    assert.ok(present.includes("duplicate-round"));
    assert.ok(present.includes("round-sequence-break"));
  }
});

test("offers recorded out of canonical order are refused (A9)", () => {
  const { registration } = registerArenaFixture();
  const tampered: ArenaProviderRegistration = {
    ...registration,
    offers: [...registration.offers].reverse(),
  };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.ok(codes(outcome.errors).includes("non-canonical-order"));
  }
});

test("a tampered regime is refused twice: the closed set and the arena id", () => {
  const { registration } = registerArenaFixture();
  const offers = registration.offers.map((arenaOffer) => ({ ...arenaOffer }));
  const first = offers[0];
  if (first === undefined) {
    assert.fail("expected a first offer");
  }
  first.regime = { regimeKind: "committee-of-peers" as typeof first.regime.regimeKind };
  const tampered: ArenaProviderRegistration = { ...registration, offers };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const present = codes(outcome.errors);
    assert.ok(present.includes("unknown-regime-kind"));
    assert.ok(present.includes("arena-id-mismatch"));
  }
});

test("a truncated provenance trips BOTH gates: the arena regime law and W056's own laws, carried verbatim", () => {
  const { registration } = registerArenaFixture();
  // The tampered offer replaces the recorded one in BOTH arrays (the arena
  // offers and the provider's neutral record share the offer by id).
  const first = registration.offers[0];
  if (first === undefined) {
    assert.fail("expected a first offer");
  }
  const truncated = { ...first.offer, provenance: [] };
  const tampered: ArenaProviderRegistration = {
    ...registration,
    offers: registration.offers.map((arenaOffer) =>
      String(arenaOffer.offer.offerId) === String(truncated.offerId)
        ? { ...arenaOffer, offer: truncated }
        : arenaOffer,
    ),
    provider: {
      ...registration.provider,
      offers: registration.provider.offers.map((offer) =>
        String(offer.offerId) === String(truncated.offerId) ? truncated : offer,
      ),
    },
  };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const present = codes(outcome.errors);
    assert.ok(present.includes("regime-evidence-mismatch"));
    const carried = outcome.errors.find((item) => item.code === "provider-registration-invalid");
    assert.notEqual(carried, undefined);
    const providerCodes = (carried?.providerErrors ?? []).map((providerError) => providerError.code);
    assert.ok(providerCodes.includes("unmeasured-offer"));
    assert.ok(providerCodes.includes("offer-id-mismatch"));
  }
});

test("a tampered neutral side is refused through W056's own re-validation, carried verbatim", () => {
  const { registration } = registerArenaFixture();
  const tampered: ArenaProviderRegistration = {
    ...registration,
    provider: {
      ...registration.provider,
      identity: { ...registration.provider.identity, name: "   " },
    },
  };
  const outcome = validateArenaRegistration(tampered);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const carried = outcome.errors.find((item) => item.code === "provider-registration-invalid");
    assert.notEqual(carried, undefined);
    const providerCodes = (carried?.providerErrors ?? []).map((providerError) => providerError.code);
    assert.ok(providerCodes.includes("blank-provider-name"));
    assert.ok(providerCodes.includes("provider-id-mismatch"));
  }
});

test("a venue the gate would refuse never validates either (the closed sets re-proved from the record)", () => {
  const base = arenaDeclarationFixture();
  const outcome = validateArenaRegistration({
    arenaId: "arena-forged" as ArenaProviderRegistration["arenaId"],
    provider: {
      providerId: "provider-forged" as never,
      identity: { name: "forged" },
      scope: base.scope,
      offers: [],
      lineage: { parentProviderId: null, version: 1 },
    },
    venue: {
      name: base.venue.name,
      venueKind: "hybrid-tournament" as never,
      rounds: [],
      leaderboard: { style: "full-roster" },
    },
    offers: [],
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    const present = codes(outcome.errors);
    assert.ok(present.includes("unknown-venue-kind"));
    assert.ok(present.includes("no-rounds"));
    assert.ok(present.includes("provider-registration-invalid"));
  }
  assert.equal(emptyRegistry().entries.length, 0);
});
