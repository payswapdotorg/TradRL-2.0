/**
 * The Body contract-surface laws (W032): the participant interop, the
 * lifecycle table laws, the closed sets, and the maximal view.
 *
 * Run: ../../node_modules/.bin/tsx --test test/contracts.test.ts
 * (from packages/agent-body).
 */

import assert from "node:assert/strict";
import test from "node:test";
import type {
  OrderKind,
  Participant,
  ParticipantKind,
  RiskLimits,
  TimeInForce,
} from "tradrl-world-contracts";
import {
  BODY_COMMAND_KINDS,
  BODY_LIFECYCLE_TRANSITIONS,
  BODY_OBSERVATION_KINDS,
  BODY_ORDER_KINDS,
  BODY_TIME_IN_FORCE,
  bodyAsParticipant,
  isBodyActive,
  isTerminalBodyAttachmentState,
  maximalBodyView,
} from "../index.js";
import type {
  BodyAttachmentState,
  BodyCommandKind,
  BodyObservationKind,
} from "../index.js";
import { ACCOUNT_TRADER, PARTICIPANT_TRADER, traderBody, traderView } from "./fixtures.js";

test("a Body IS a participant declaration plus the envelope (W003 interop)", () => {
  const descriptor = traderBody({ displayName: "Trader One" });
  const participant: Participant = bodyAsParticipant(descriptor);
  assert.deepEqual(participant, {
    participantId: PARTICIPANT_TRADER,
    worldId: descriptor.scope.worldId,
    kind: "human",
    displayName: "Trader One",
    accountId: ACCOUNT_TRADER,
  });
});

test("bodyAsParticipant omits displayName exactly when the descriptor does", () => {
  const participant = bodyAsParticipant(traderBody());
  assert.equal("displayName" in participant, false);
  assert.deepEqual(participant, {
    participantId: PARTICIPANT_TRADER,
    worldId: traderBody().scope.worldId,
    kind: "human",
    accountId: ACCOUNT_TRADER,
  });
});

test("the risk envelope declares exactly the A13 RiskLimits fields", () => {
  const descriptor = traderBody();
  const fields = Object.keys(descriptor.riskEnvelope).sort();
  assert.deepEqual(fields, [
    "maxDrawdown",
    "maxGrossExposure",
    "maxLeverage",
    "maxOrderQuantity",
    "maxPositionQuantity",
    "minBuyingPowerAfterOrder",
  ]);
  // Compile-time pin: every RiskLimits field is nameable on the envelope.
  const exhaustive: Record<keyof RiskLimits, true> = {
    maxOrderQuantity: true,
    maxPositionQuantity: true,
    maxLeverage: true,
    maxGrossExposure: true,
    maxDrawdown: true,
    minBuyingPowerAfterOrder: true,
  };
  assert.deepEqual(Object.keys(exhaustive).sort(), fields);
});

test("the lifecycle table laws hold (terminal, reachable, no invented states)", () => {
  const states: readonly BodyAttachmentState[] = ["unattached", "active", "detached"];
  for (const state of states) {
    for (const target of BODY_LIFECYCLE_TRANSITIONS[state]) {
      assert.ok(states.includes(target), `unknown transition target ${String(target)}`);
    }
  }
  // detached is terminal: no outgoing transitions
  assert.deepEqual(BODY_LIFECYCLE_TRANSITIONS.detached, []);
  assert.equal(isTerminalBodyAttachmentState("detached"), true);
  assert.equal(isTerminalBodyAttachmentState("unattached"), false);
  assert.equal(isTerminalBodyAttachmentState("active"), false);
  // every state can reach detached (no zombie lifecycles)
  const reaches = (from: BodyAttachmentState, to: BodyAttachmentState): boolean => {
    if (from === to) return true;
    return BODY_LIFECYCLE_TRANSITIONS[from].some((next) => reaches(next, to));
  };
  for (const state of states) {
    assert.equal(reaches(state, "detached"), true, `${state} must reach detached`);
  }
  // only active may act/observe
  assert.deepEqual(
    states.filter(isBodyActive),
    ["active"],
  );
  // the attach path is exactly unattached -> active
  assert.deepEqual(BODY_LIFECYCLE_TRANSITIONS.unattached, ["active", "detached"]);
  assert.deepEqual(BODY_LIFECYCLE_TRANSITIONS.active, ["detached"]);
});

test("the closed sets are exactly the merged contract unions", () => {
  // Runtime pins...
  assert.deepEqual([...BODY_COMMAND_KINDS].sort(), [
    "add-annotation",
    "branch-world",
    "cancel-order",
    "close-position",
    "create-snapshot",
    "replace-order",
    "set-scenario",
    "submit-order",
  ]);
  assert.deepEqual([...BODY_ORDER_KINDS].sort(), ["limit", "market", "stop", "stop-limit"]);
  assert.deepEqual([...BODY_TIME_IN_FORCE], ["GTC", "IOC", "FOK"]);
  assert.deepEqual([...BODY_OBSERVATION_KINDS].sort(), [
    "information-artifacts",
    "market-book",
    "market-quote",
    "market-trades",
    "own-orders",
    "own-portfolio",
    "own-positions",
    "own-risk",
  ]);
  // ...and compile-time pins: a Record over each union requires EVERY
  // member, so a contract change without a body-contracts update fails tsc.
  const commands: Record<BodyCommandKind, true> = {
    "submit-order": true,
    "cancel-order": true,
    "replace-order": true,
    "close-position": true,
    "add-annotation": true,
    "create-snapshot": true,
    "branch-world": true,
    "set-scenario": true,
  };
  const orderKinds: Record<OrderKind, true> = {
    market: true,
    limit: true,
    stop: true,
    "stop-limit": true,
  };
  const tifs: Record<TimeInForce, true> = { GTC: true, IOC: true, FOK: true };
  const observations: Record<BodyObservationKind, true> = {
    "market-quote": true,
    "market-book": true,
    "market-trades": true,
    "own-orders": true,
    "own-positions": true,
    "own-portfolio": true,
    "own-risk": true,
    "information-artifacts": true,
  };
  assert.equal(Object.keys(commands).length, BODY_COMMAND_KINDS.length);
  assert.equal(Object.keys(orderKinds).length, BODY_ORDER_KINDS.length);
  assert.equal(Object.keys(tifs).length, BODY_TIME_IN_FORCE.length);
  assert.equal(Object.keys(observations).length, BODY_OBSERVATION_KINDS.length);
});

test("the design-for-both seam: every merged ParticipantKind is declarable", () => {
  // The W003 closed set (no "agent" kind yet — W023 owns that contract
  // change; the descriptor consumes whatever union is merged at the base).
  const kinds: readonly ParticipantKind[] = [
    "human",
    "noise-trader",
    "liquidity-taker",
    "passive-market-maker",
    "momentum",
  ];
  for (const kind of kinds) {
    const descriptor = traderBody({ participantKind: kind });
    assert.equal(bodyAsParticipant(descriptor).kind, kind);
  }
});

test("maximalBodyView grants the full embodiment and account", () => {
  const descriptor = traderBody();
  const view = maximalBodyView(descriptor);
  assert.deepEqual(view, {
    bodyId: descriptor.bodyId,
    worldId: descriptor.scope.worldId,
    instruments: descriptor.embodiment.instruments,
    observations: BODY_OBSERVATION_KINDS,
    accountId: descriptor.accountId,
  });
  // a declared view can be tighter — never wider — than the maximal view
  const tighter = traderView({ observations: ["market-quote"], instruments: [] });
  assert.ok(tighter.observations.every((kind) => view.observations.includes(kind)));
  assert.ok(tighter.instruments.every((i) => view.instruments.includes(i)));
});
