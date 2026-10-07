/**
 * The effective agent projection (W034): the composed agent AS DATA —
 * the tighter-of intersections, the view grant intersection, purity
 * (never a mutation), and fail-closed refusals for incompatible
 * possessions.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { validateBodyView } from "agent-body/validate";
import { effectiveRiskEnvelope } from "agent-body/envelope";
import { resolveRiskLimits } from "tradrl-world-sim/risk";
import { projectEffectiveAgent } from "../index.js";
import {
  INSTRUMENT_ES,
  esView,
  fixtureWorld,
  lawfulStream,
  possessionOne,
  traderBody,
  momentumSubstrate,
} from "./fixtures.js";

test("the projection composes body + substrate + the tighter-of intersections", () => {
  const outcome = projectEffectiveAgent(possessionOne());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const agent = outcome.agent;
  assert.equal(agent.possessionId, possessionOne().possessionId);
  assert.equal(agent.bodyId, traderBody().bodyId);
  assert.equal(agent.substrateId, possessionOne().substrate.substrateId);
  assert.equal(agent.participantId, traderBody().participantId);
  assert.equal(agent.accountId, traderBody().accountId);
  // the declarations are carried verbatim
  assert.deepEqual(agent.body, traderBody());
  assert.deepEqual(agent.substrate, possessionOne().substrate);
  // the effective command surface: substrate ∩ scope, declaration order
  assert.deepEqual(agent.commandKinds, ["submit-order", "close-position"]);
  assert.deepEqual(agent.instruments, [INSTRUMENT_ES]);
});

test("the view grant intersection narrows the maximal view to the scope", () => {
  const outcome = projectEffectiveAgent(possessionOne());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.agent.view, esView());
  // and the projected view is a LAWFUL W032 BodyView of the same body
  assert.deepEqual(validateBodyView(outcome.agent.view, traderBody()), { ok: true });
});

test("the scope narrows the substrate's declared kinds (the tighter-of, no invention)", () => {
  // the substrate declares add-annotation as well; the grant covers only
  // submit-order + close-position → the effective surface is the overlap.
  const descriptor = possessionOne({
    substrate: momentumSubstrate({
      commandKinds: ["close-position", "add-annotation", "submit-order"],
    }),
  });
  const outcome = projectEffectiveAgent(descriptor);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  // declaration order of the substrate is preserved, narrowed by the grant
  assert.deepEqual(outcome.agent.commandKinds, ["close-position", "submit-order"]);
});

test("the effective decision rate is the tighter-of both declarations", () => {
  // fixture default: substrate {1, 1000} vs grant {1, 1000} → identity
  const identity = projectEffectiveAgent(possessionOne());
  assert.equal(identity.ok, true);
  if (!identity.ok) return;
  assert.deepEqual(identity.agent.decisionRate, {
    maxDecisionsPerView: 1,
    minViewIntervalMs: 1000,
  });

  // a WIDER grant grants nothing extra: the substrate's declaration
  // governs (compatibility already proves the substrate fits the grant —
  // the W032 body-values-carry-through law, applied to the rate family)
  const widerGrant = projectEffectiveAgent(
    possessionOne({
      substrate: momentumSubstrate({
        decisionRate: { maxDecisionsPerView: 3, minViewIntervalMs: 1000 },
      }),
      scope: {
        ...possessionOne().scope,
        decisionRate: { maxDecisionsPerView: 5, minViewIntervalMs: 1000 },
      },
    }),
  );
  assert.equal(widerGrant.ok, true);
  if (!widerGrant.ok) return;
  assert.deepEqual(widerGrant.agent.decisionRate, {
    maxDecisionsPerView: 3,
    minViewIntervalMs: 1000,
  });

  // a substrate SILENT on spacing takes the grant's declared interval
  // (a one-sided declaration surfaces — the W003 unset law)
  const grantIntervalOnly = projectEffectiveAgent(
    possessionOne({
      substrate: momentumSubstrate({ decisionRate: { maxDecisionsPerView: 1 } }),
      scope: {
        ...possessionOne().scope,
        decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 2000 },
      },
    }),
  );
  assert.equal(grantIntervalOnly.ok, true);
  if (!grantIntervalOnly.ok) return;
  assert.deepEqual(grantIntervalOnly.agent.decisionRate, {
    maxDecisionsPerView: 1,
    minViewIntervalMs: 2000,
  });

  // one-sided declarations carry (the W003 unset law)
  const noGrant = projectEffectiveAgent(
    possessionOne({ scope: { ...possessionOne().scope, decisionRate: undefined } }),
  );
  assert.equal(noGrant.ok, true);
  if (!noGrant.ok) return;
  assert.deepEqual(noGrant.agent.decisionRate, {
    maxDecisionsPerView: 1,
    minViewIntervalMs: 1000,
  });
});

test("the effective risk envelope without a world is the body's declaration verbatim", () => {
  const outcome = projectEffectiveAgent(possessionOne());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.agent.riskEnvelope, traderBody().riskEnvelope);
});

test("the effective risk envelope with a world is the W032 intersection (carried through on a valid attach)", () => {
  const world = fixtureWorld();
  const outcome = projectEffectiveAgent(possessionOne(), world);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const expected = effectiveRiskEnvelope(
    traderBody().riskEnvelope,
    resolveRiskLimits(world.riskLimits, String(traderBody().accountId)),
  );
  assert.deepEqual(outcome.agent.riskEnvelope, expected);
  // the body declared within the world's limits → its values carry through
  assert.deepEqual(outcome.agent.riskEnvelope, traderBody().riskEnvelope);
});

test("the intersection is real: one-sided declarations carry through (the tighter-of)", () => {
  // the body declares NO maxDrawdown; the world does — the effective
  // envelope for the composed agent carries the world's limit (a
  // one-sided declaration wins, the W003 unset law), while every
  // body-declared value carries through unchanged (valid attach).
  const bodyWithoutDrawdown = traderBody({
    riskEnvelope: {
      maxOrderQuantity: "40" as never,
      maxPositionQuantity: "150" as never,
      maxLeverage: 3,
      maxGrossExposure: { amount: "400000" as never, currency: "USD" as never },
      minBuyingPowerAfterOrder: { amount: "2000" as never, currency: "USD" as never },
    },
  });
  const outcome = projectEffectiveAgent(
    possessionOne({ body: bodyWithoutDrawdown }),
    fixtureWorld(),
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(outcome.agent.riskEnvelope, {
    maxOrderQuantity: "40",
    maxPositionQuantity: "150",
    maxLeverage: 3,
    maxGrossExposure: { amount: "400000", currency: "USD" },
    minBuyingPowerAfterOrder: { amount: "2000", currency: "USD" },
    maxDrawdown: { amount: "10000", currency: "USD" },
  } as never);
  // the body's own declaration is NOT mutated by the projection
  assert.equal(bodyWithoutDrawdown.riskEnvelope.maxDrawdown, undefined);
});

test("an incompatible possession is refused loudly (never a partial projection)", () => {
  const outcome = projectEffectiveAgent(
    possessionOne({
      substrate: momentumSubstrate({ commandKinds: ["branch-world"] }),
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.incompatibilities.map((one) => one.code),
    ["command-kind-not-embodied"],
  );
});

test("an invalid descriptor is refused with the errors verbatim", () => {
  const outcome = projectEffectiveAgent(possessionOne({ possessionId: "" as never }));
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.deepEqual(
    outcome.incompatibilities.map((one) => one.code),
    ["descriptor-invalid"],
  );
});

test("the projection is pure — inputs are never mutated (never a mutation)", () => {
  const before = possessionOne();
  const snapshot = structuredClone(before);
  const outcome = projectEffectiveAgent(before, fixtureWorld());
  assert.equal(outcome.ok, true);
  assert.deepEqual(before, snapshot);
  // determinism: same declarations ⇒ same agent, bit-for-bit
  const second = projectEffectiveAgent(possessionOne(), fixtureWorld());
  assert.equal(second.ok, true);
  if (!outcome.ok || !second.ok) return;
  assert.deepEqual(outcome.agent, second.agent);
});

test("the projected agent's decision stream laws hold (the composed surface agrees with the proof)", () => {
  const outcome = projectEffectiveAgent(possessionOne(), fixtureWorld());
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const agent = outcome.agent;
  // every effective command kind is inside the body's embodiment
  for (const kind of agent.commandKinds) {
    assert.ok(traderBody().embodiment.commandKinds.includes(kind));
  }
  // every effective instrument is inside the scope and the embodiment
  for (const instrument of agent.instruments) {
    assert.ok(possessionOne().scope.instruments.includes(instrument));
    assert.ok(traderBody().embodiment.instruments.includes(instrument));
  }
  // the fixture stream proves lawful against the composed surface
  const stream = lawfulStream();
  assert.ok(stream.decisions.every((decision) => agent.commandKinds.includes(decision.command.kind)));
  assert.ok(
    stream.decisions.every((decision) =>
      agent.instruments.includes((decision.command as { readonly instrumentId: typeof INSTRUMENT_ES }).instrumentId),
    ),
  );
});
