/**
 * The REAL alpha world cases (W032): envelope + binding validation against
 * `alphaWorldDefinition` — the REAL definition the Trading World pane
 * attaches (packages/ui/src/trading-world/runtime/engineAttachment.ts),
 * consumed through the relative cross-package seam the UI/sim tests use.
 * Derived definitions (spread + riskLimits/venue restrictions) isolate the
 * envelope and venue-policy laws against the real world's shape.
 *
 * Run: ../../node_modules/.bin/tsx --test test/alphaWorld.test.ts
 * (from packages/agent-body).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { RiskLimits } from "tradrl-world-contracts";
import { assertValidWorldDefinition } from "tradrl-world-sim/world";
import type { WorldDefinition } from "tradrl-world-sim/world";
import { alphaWorldDefinition } from "../../ui/src/trading-world/runtime/engineAttachment.js";
import {
  bodyAsParticipant,
  effectiveRiskEnvelope,
  validateBodyAttachment,
} from "../index.js";
import type { BodyDescriptor } from "../index.js";
import { money } from "./fixtures.js";

const ALPHA_WORLD_ID = "world-alpha-body";
const DEFINITION: WorldDefinition = alphaWorldDefinition(ALPHA_WORLD_ID);
const TRADER_SEAT = `participant-trader-${ALPHA_WORLD_ID}` as never;
const TRADER_ACCOUNT = `account-trader-${ALPHA_WORLD_ID}` as never;
const ALPHA_INSTRUMENT = `instrument-es-${ALPHA_WORLD_ID}` as never;
const ALPHA_VENUE = "venue-alpha-sim" as never;

/** A trader-seat Body on the REAL alpha world: the full legal embodiment. */
function alphaTraderBody(overrides: Partial<BodyDescriptor> = {}): BodyDescriptor {
  return {
    bodyId: "body-alpha-trader" as never,
    scope: DEFINITION.scope,
    participantId: TRADER_SEAT,
    accountId: TRADER_ACCOUNT,
    participantKind: "human",
    embodiment: {
      instruments: [ALPHA_INSTRUMENT],
      venues: [ALPHA_VENUE],
      // the alpha sim venue allows all four order kinds
      orderKinds: ["market", "limit", "stop", "stop-limit"],
      timeInForce: ["GTC", "IOC", "FOK"],
      commandKinds: [
        "submit-order",
        "cancel-order",
        "replace-order",
        "close-position",
        "add-annotation",
      ],
    },
    riskEnvelope: {
      maxOrderQuantity: "10" as never,
      maxPositionQuantity: "40" as never,
      maxLeverage: 2,
      maxGrossExposure: money("150000"),
      maxDrawdown: money("5000"),
      minBuyingPowerAfterOrder: money("10000"),
    },
    ...overrides,
  };
}

test("the consumed definition is the REAL alpha world (valid, one ES instrument, one sim venue)", () => {
  assertValidWorldDefinition(DEFINITION);
  assert.equal(DEFINITION.instruments.length, 1);
  assert.equal(DEFINITION.venues?.length, 1);
  assert.equal(String(DEFINITION.instruments[0]?.venueId), "venue-alpha-sim");
});

test("a trader-seat Body binds to the REAL alpha world with the full embodiment", () => {
  assert.deepEqual(validateBodyAttachment(alphaTraderBody(), DEFINITION), { ok: true });
});

test("the Body IS the alpha world's real participant declaration (interop)", () => {
  const projected = bodyAsParticipant(alphaTraderBody());
  const real = DEFINITION.participants.find(
    (participant) => participant.participantId === TRADER_SEAT,
  );
  assert.notEqual(real, undefined);
  assert.deepEqual(projected, real);
});

test("a synthetic-participant seat binds too (the kind generality, real world)", () => {
  const momentumSeat = `participant-momentum-${ALPHA_WORLD_ID}` as never;
  const synthAccount = `account-synth-${ALPHA_WORLD_ID}` as never;
  const outcome = validateBodyAttachment(
    alphaTraderBody({
      participantId: momentumSeat,
      accountId: synthAccount,
      participantKind: "momentum",
    }),
    DEFINITION,
  );
  assert.deepEqual(outcome, { ok: true });
});

test("the REAL alpha world declares no limits: any envelope is valid and effective as-declared", () => {
  assert.equal(DEFINITION.riskLimits, undefined);
  const body = alphaTraderBody();
  assert.deepEqual(validateBodyAttachment(body, DEFINITION), { ok: true });
  // the W003 unset law on the real world: the effective envelope is exactly
  // the Body's own declaration
  assert.deepEqual(effectiveRiskEnvelope(body.riskEnvelope, {}), body.riskEnvelope);
});

test("envelope validation against a derived alpha world with declared limits", () => {
  const worldLimits: RiskLimits = {
    maxOrderQuantity: "20" as never,
    maxLeverage: 3,
    maxGrossExposure: money("200000"),
    minBuyingPowerAfterOrder: money("5000"),
  };
  const limited: WorldDefinition = {
    ...DEFINITION,
    riskLimits: { [String(TRADER_ACCOUNT)]: worldLimits },
  };
  assertValidWorldDefinition(limited);
  const body = alphaTraderBody();

  // within: valid, and the effective envelope is the Body's declaration
  assert.deepEqual(validateBodyAttachment(body, limited), { ok: true });
  assert.deepEqual(effectiveRiskEnvelope(body.riskEnvelope, worldLimits), body.riskEnvelope);

  // exceeds: invalid at attach, with the exact compared values
  const exceeding = alphaTraderBody({
    riskEnvelope: {
      ...body.riskEnvelope,
      maxOrderQuantity: "20.5" as never,
      maxLeverage: 3.5,
      maxGrossExposure: money("200001"),
      minBuyingPowerAfterOrder: money("4999"),
    },
  });
  const outcome = validateBodyAttachment(exceeding, limited);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  const breaches = outcome.errors.filter(
    (error) => error.code === "envelope-exceeds-world-limits",
  );
  assert.deepEqual(
    breaches.map((error) => error.envelope?.limit),
    ["maxOrderQuantity", "maxLeverage", "maxGrossExposure", "minBuyingPowerAfterOrder"],
  );
  assert.deepEqual(breaches[0]?.envelope, {
    limit: "maxOrderQuantity",
    bodyValue: "20.5",
    worldValue: "20",
  });

  // a tighter Body on the same derived world stays valid
  const tighter = alphaTraderBody({
    riskEnvelope: { maxOrderQuantity: "20" as never, maxLeverage: 3 },
  });
  assert.deepEqual(validateBodyAttachment(tighter, limited), { ok: true });
});

test("the REAL venue policy admits all four order kinds; a restricted derived venue binds it", () => {
  const realVenue = DEFINITION.venues?.[0];
  assert.deepEqual(realVenue?.allowedOrderKinds, ["market", "limit", "stop", "stop-limit"]);

  const restricted: WorldDefinition = {
    ...DEFINITION,
    venues: [
      {
        ...realVenue!,
        allowedOrderKinds: ["market", "limit"],
      },
    ],
  };
  assertValidWorldDefinition(restricted);
  const outcome = validateBodyAttachment(alphaTraderBody(), restricted);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  const policyErrors = outcome.errors.filter(
    (error) => error.code === "order-kind-not-allowed",
  );
  assert.equal(policyErrors.length, 2);
  assert.match(policyErrors[0]?.message ?? "", /venue-alpha-sim/);

  const withinPolicy = alphaTraderBody({
    embodiment: {
      ...alphaTraderBody().embodiment,
      orderKinds: ["market", "limit"],
    },
  });
  assert.deepEqual(validateBodyAttachment(withinPolicy, restricted), { ok: true });
});

test("binding refuses an unknown seat on the REAL world", () => {
  const outcome = validateBodyAttachment(
    alphaTraderBody({ participantId: "participant-ghost" as never }),
    DEFINITION,
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.errors.map((error) => error.code),
    ["unknown-participant"],
  );
});
