/**
 * The W044 routing laws — the pure wiring contracts over a REAL sealed
 * binding: which substrate surface an observation event reaches, and the
 * authority-proof chain an action intent flows through — with the A13
 * structural law (an intent without a covering grant is refused LOUDLY)
 * and every fail-closed refusal (fixtures.ts, disclosed in-header).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bindAgent, bindOrganization } from "../binding.js";
import { routeActionIntent, routeObservationEvent } from "../routing.js";
import type { BodyObservationKind } from "tradrl-world-contracts/agentBody";
import type { InstrumentId, ParticipantId } from "tradrl-world-contracts";
import { INSTRUMENT_CO, INSTRUMENT_NQ, PARTICIPANT_SEAT, bindingWorldDefinition, commissionedBodyFixture, compiledPlanFixture, grantsFor, orgCommissionedBodyFixture } from "./fixtures.js";
import { stableDigest } from "skills";

function agentBinding() {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(bindingWorldDefinition(), commissioned, grantsFor(commissioned));
  if (!outcome.ok) {
    assert.fail(`fixture binding failed: ${outcome.errors.map((entry) => entry.code).join(", ")}`);
  }
  return { binding: outcome.binding, commissioned };
}

function orgBinding() {
  const commissioned = orgCommissionedBodyFixture();
  const outcome = bindOrganization(bindingWorldDefinition(), compiledPlanFixture(commissioned), [commissioned], grantsFor(commissioned));
  if (!outcome.ok) {
    assert.fail(`fixture org binding failed: ${outcome.errors.map((entry) => entry.code).join(", ")}`);
  }
  return { binding: outcome.binding, commissioned };
}

test("an observation event routes to the addressed substrate surface", () => {
  const { binding } = agentBinding();
  const outcome = routeObservationEvent(binding, { kind: "market-quote" });
  if (!outcome.ok) {
    assert.fail(outcome.message);
  }
  assert.equal(outcome.surfaces.length, 1);
  const surface = outcome.surfaces[0]!;
  assert.equal(surface.participantId, PARTICIPANT_SEAT);
  assert.equal(String(surface.substrateId), String(binding.substrateId));
  assert.deepEqual(surface.instruments.map(String), [String(INSTRUMENT_CO)]);
});

test("an observation event narrows to one routed instrument", () => {
  const { binding } = agentBinding();
  const outcome = routeObservationEvent(binding, { kind: "market-quote", instrumentId: INSTRUMENT_CO });
  if (!outcome.ok) {
    assert.fail(outcome.message);
  }
  assert.deepEqual(outcome.surfaces[0]!.instruments.map(String), [String(INSTRUMENT_CO)]);
});

test("an unrouted observation kind is refused (fail-closed)", () => {
  const { binding } = agentBinding();
  const outcome = routeObservationEvent(binding, { kind: "order-book" as BodyObservationKind });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.code, "unknown-observation-kind");
});

test("an instrument the wiring does not route is refused", () => {
  const { binding } = agentBinding();
  const outcome = routeObservationEvent(binding, { kind: "market-quote", instrumentId: INSTRUMENT_NQ as InstrumentId });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.code, "instrument-not-routed");
});

test("an action intent derives its authority-proof chain (A13 structural)", () => {
  const { binding, commissioned } = agentBinding();
  const outcome = routeActionIntent(binding, { commandKind: "submit-order", instrumentId: INSTRUMENT_CO });
  if (!outcome.ok) {
    assert.fail(outcome.message);
  }
  const chain = outcome.proofChain;
  assert.equal(chain.participantId, PARTICIPANT_SEAT);
  assert.equal(String(chain.possessionId), String(commissioned.possession.possessionId));
  assert.equal(chain.grants.length, 1);
  assert.deepEqual(chain.grants[0]!.grant, commissioned.possession.grant);
  assert.equal(chain.grants[0]!.grantDigest, stableDigest(commissioned.possession.grant));
});

test("an action intent with NO covering grant is refused LOUDLY (A13)", () => {
  const { binding } = agentBinding();
  const outcome = routeActionIntent(binding, { commandKind: "replace-order", instrumentId: INSTRUMENT_CO });
  assert.equal(outcome.ok, false);
  if (outcome.ok) {
    assert.fail("unreachable");
  }
  assert.equal(outcome.code, "unknown-channel");
  assert.ok(outcome.message.includes("A13"));
});

test("an instrument beyond the channel is refused", () => {
  const { binding } = agentBinding();
  const outcome = routeActionIntent(binding, { commandKind: "submit-order", instrumentId: INSTRUMENT_NQ as InstrumentId });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.code, "instrument-beyond-channel");
});

test("an organization action intent without a participant is refused (fail-closed)", () => {
  const { binding } = orgBinding();
  const outcome = routeActionIntent(binding, { commandKind: "submit-order", instrumentId: INSTRUMENT_CO });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.code, "unknown-participant");
});

test("an organization action intent routes per seat", () => {
  const { binding, commissioned } = orgBinding();
  const outcome = routeActionIntent(binding, {
    commandKind: "close-position",
    instrumentId: INSTRUMENT_CO,
    participantId: PARTICIPANT_SEAT as ParticipantId,
  });
  if (!outcome.ok) {
    assert.fail(outcome.message);
  }
  assert.equal(String(outcome.proofChain.possessionId), String(commissioned.possession.possessionId));
  assert.equal(outcome.proofChain.grants.length, 1);
});

test("an organization observation event for an unknown participant is refused", () => {
  const { binding } = orgBinding();
  const outcome = routeObservationEvent(binding, {
    kind: "market-quote",
    participantId: "participant-unknown" as ParticipantId,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok ? "" : outcome.code, "unknown-participant");
});
