/**
 * The attach-time world binding laws (W032): a Body attaches only to a REAL
 * seat in the bound world — the participant, account, instruments, venues,
 * venue policies and tradability are all checked loudly, and the envelope
 * must sit within the world's declared limits.
 *
 * Run: ../../node_modules/.bin/tsx --test test/worldBinding.test.ts
 * (from packages/agent-body).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { assertValidWorldDefinition } from "tradrl-world-sim/world";
import { validateBodyAttachment } from "../index.js";
import {
  ACCOUNT_FROZEN,
  INSTRUMENT_ES,
  INSTRUMENT_NQ,
  PARTICIPANT_MM,
  VENUE_ALL,
  VENUE_RESTRICTIVE,
  fixtureWorld,
  traderBody,
  traderEmbodiment,
} from "./fixtures.js";

function codes(outcome: ReturnType<typeof validateBodyAttachment>): string[] {
  return outcome.ok ? [] : outcome.errors.map((error) => error.code);
}

test("the fixture worlds are REAL valid world definitions (no hand-wired stubs)", () => {
  assertValidWorldDefinition(fixtureWorld());
  assertValidWorldDefinition(
    fixtureWorld({
      venues: undefined,
      riskLimits: undefined,
    }),
  );
});

test("the happy path: the trader Body binds to its seat", () => {
  assert.deepEqual(validateBodyAttachment(traderBody(), fixtureWorld()), { ok: true });
});

test("a Body bound to a different world is refused loudly", () => {
  const outcome = validateBodyAttachment(
    traderBody({ scope: { ...traderBody().scope, worldId: "world-elsewhere" as never } }),
    fixtureWorld(),
  );
  assert.deepEqual(codes(outcome), ["world-mismatch"]);
});

test("unknown seats, accounts and kind/account mismatches are refused loudly", () => {
  // the seat does not exist
  assert.deepEqual(
    codes(
      validateBodyAttachment(
        traderBody({ participantId: "participant-ghost" as never }),
        fixtureWorld(),
      ),
    ),
    ["unknown-participant"],
  );
  // the seat exists but the Body declared a different account — and the
  // frozen account it declared cannot host a submit-order Body (both
  // violations are collected)
  assert.deepEqual(
    codes(
      validateBodyAttachment(traderBody({ accountId: ACCOUNT_FROZEN }), fixtureWorld()),
    ),
    ["participant-account-mismatch", "account-not-tradable"],
  );
  // the seat exists but the Body declared a different kind
  assert.deepEqual(
    codes(
      validateBodyAttachment(traderBody({ participantKind: "momentum" }), fixtureWorld()),
    ),
    ["participant-kind-mismatch"],
  );
  // the account does not exist (and no seat to catch it first)
  assert.deepEqual(
    codes(
      validateBodyAttachment(
        traderBody({
          participantId: PARTICIPANT_MM,
          accountId: "account-ghost" as never,
          participantKind: "passive-market-maker",
        }),
        fixtureWorld(),
      ),
    ),
    ["participant-account-mismatch", "unknown-account"],
  );
});

test("a Body with the submit-order command cannot attach to a non-tradable account", () => {
  const outcome = validateBodyAttachment(
    traderBody({
      participantId: PARTICIPANT_MM,
      accountId: ACCOUNT_FROZEN,
      participantKind: "passive-market-maker",
    }),
    fixtureWorld(),
  );
  assert.deepEqual(codes(outcome), ["account-not-tradable"]);
});

test("unknown instruments and venue mismatches are refused loudly", () => {
  assert.deepEqual(
    codes(
      validateBodyAttachment(
        traderBody({
          embodiment: traderEmbodiment({
            instruments: ["instrument-ghost" as never],
            venues: ["venue-ghost" as never],
          }),
        }),
        fixtureWorld(),
      ),
    ),
    ["unknown-instrument", "unknown-venue"],
  );
  // the instrument exists but trades on a venue the Body did not declare
  assert.deepEqual(
    codes(
      validateBodyAttachment(
        traderBody({
          embodiment: traderEmbodiment({
            instruments: [INSTRUMENT_NQ],
            venues: [VENUE_ALL],
          }),
        }),
        fixtureWorld(),
      ),
    ),
    ["instrument-venue-mismatch"],
  );
});

test("venue policies bind the embodiment (order-kind-not-allowed)", () => {
  // NQ trades on the restrictive venue (market + limit only): a Body
  // declaring stop orders on it exceeds the venue policy.
  const outcome = validateBodyAttachment(
    traderBody({
      embodiment: traderEmbodiment({
        instruments: [INSTRUMENT_NQ],
        venues: [VENUE_RESTRICTIVE],
        orderKinds: ["market", "stop"],
      }),
    }),
    fixtureWorld(),
  );
  assert.deepEqual(codes(outcome), ["order-kind-not-allowed"]);
  // ...and staying within the venue policy is valid
  assert.deepEqual(
    validateBodyAttachment(
      traderBody({
        embodiment: traderEmbodiment({
          instruments: [INSTRUMENT_NQ],
          venues: [VENUE_RESTRICTIVE],
          orderKinds: ["market", "limit"],
        }),
      }),
      fixtureWorld(),
    ),
    { ok: true },
  );
});

test("worlds without venue declarations run the documented default policy (W014 seam)", () => {
  const noVenues = fixtureWorld({ venues: undefined });
  // every order kind is admissible under the default policy, and the
  // instrument/venue self-consistency still holds
  assert.deepEqual(
    validateBodyAttachment(
      traderBody({
        embodiment: traderEmbodiment({ orderKinds: ["market", "limit", "stop", "stop-limit"] }),
      }),
      noVenues,
    ),
    { ok: true },
  );
});

test("every binding violation is collected (complete outcomes, deterministic order)", () => {
  const outcome = validateBodyAttachment(
    traderBody({
      participantId: "participant-ghost" as never,
      accountId: "account-ghost" as never,
      embodiment: traderEmbodiment({
        instruments: ["instrument-ghost" as never, INSTRUMENT_ES],
        venues: ["venue-ghost" as never],
      }),
    }),
    fixtureWorld(),
  );
  assert.deepEqual(codes(outcome), [
    "unknown-participant",
    "unknown-account",
    "unknown-instrument",
    "instrument-venue-mismatch",
    "unknown-venue",
  ]);
  if (outcome.ok) return;
  // every error carries a field path (loud + addressable)
  assert.ok(outcome.errors.every((error) => error.field !== undefined));
});
