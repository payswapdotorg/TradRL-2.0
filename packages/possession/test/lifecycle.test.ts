/**
 * The possession lifecycle (W034): unpossessed → possessed → released
 * (+ the discard path) — the W032 lifecycle-table precedent: fail-closed
 * pure transforms, typed refusals that never mutate, terminal states
 * that admit nothing, a new possession is a new record.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPossessionCompatibility,
  initialPossessionRecord,
  isPossessionActive,
  possessEvent,
  transitionPossession,
} from "../index.js";
import type { PossessionRecord } from "../index.js";
import { possessionOne, possessionTwo } from "./fixtures.js";

function compatibleOutcome() {
  const outcome = checkPossessionCompatibility(possessionOne());
  assert.equal(outcome.ok, true);
  return outcome;
}

function incompatibleOutcome() {
  const descriptor = possessionOne({
    substrate: { ...possessionOne().substrate, commandKinds: ["branch-world"] },
  });
  const outcome = checkPossessionCompatibility(descriptor);
  assert.equal(outcome.ok, false);
  return outcome;
}

test("the initial record is unpossessed and carries the composed identity", () => {
  const record = initialPossessionRecord(possessionOne());
  assert.deepEqual(record, {
    possessionId: possessionOne().possessionId,
    bodyId: possessionOne().body.bodyId,
    substrateId: possessionOne().substrate.substrateId,
    worldId: possessionOne().body.scope.worldId,
    state: "unpossessed",
  });
  assert.equal(isPossessionActive(record), false);
});

test("possess with a passing compatibility outcome holds the body", () => {
  const record = initialPossessionRecord(possessionOne());
  const result = transitionPossession(record, possessEvent(compatibleOutcome()));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.record.state, "possessed");
  assert.equal(result.record.releaseReason, undefined);
  assert.equal(isPossessionActive(result.record), true);
});

test("possess with a FAILING compatibility outcome is refused fail-closed and never mutates", () => {
  const record = initialPossessionRecord(possessionOne());
  const result = transitionPossession(record, possessEvent(incompatibleOutcome()));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "possess-compatibility-failed");
  assert.match(result.message, /fail-closed/u);
  // the no-mutation law: the refused result carries the record unchanged
  assert.deepEqual(result.record, record);
  assert.equal(isPossessionActive(record), false);
});

test("possess from possessed is refused (one possession, one lifecycle)", () => {
  const held = transitionPossession(
    initialPossessionRecord(possessionOne()),
    possessEvent(compatibleOutcome()),
  );
  assert.equal(held.ok, true);
  if (!held.ok) return;
  const again = transitionPossession(held.record, possessEvent(compatibleOutcome()));
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.code, "invalid-transition");
  assert.deepEqual(again.record, held.record);
});

test("release from possessed is always legal and records the honest reason", () => {
  const held = transitionPossession(
    initialPossessionRecord(possessionOne()),
    possessEvent(compatibleOutcome()),
  );
  assert.equal(held.ok, true);
  if (!held.ok) return;
  const released = transitionPossession(held.record, {
    kind: "release",
    reason: "operator-request",
  });
  assert.equal(released.ok, true);
  if (!released.ok) return;
  assert.deepEqual(released.record, {
    ...held.record,
    state: "released",
    releaseReason: "operator-request",
  });
  assert.equal(isPossessionActive(released.record), false);
});

test("release from unpossessed is the discard path (legal, recorded)", () => {
  const record = initialPossessionRecord(possessionOne());
  const discarded = transitionPossession(record, {
    kind: "release",
    reason: "substrate-retired",
  });
  assert.equal(discarded.ok, true);
  if (!discarded.ok) return;
  assert.equal(discarded.record.state, "released");
  assert.equal(discarded.record.releaseReason, "substrate-retired");
});

test("released is terminal — every event is refused with terminal-state", () => {
  const released = transitionPossession(
    initialPossessionRecord(possessionOne()),
    { kind: "release", reason: "operator-request" },
  );
  assert.equal(released.ok, true);
  if (!released.ok) return;
  const terminal: PossessionRecord = released.record;
  const possessAgain = transitionPossession(terminal, possessEvent(compatibleOutcome()));
  assert.equal(possessAgain.ok, false);
  if (possessAgain.ok) return;
  assert.equal(possessAgain.code, "terminal-state");
  const releaseAgain = transitionPossession(terminal, {
    kind: "release",
    reason: "operator-request",
  });
  assert.equal(releaseAgain.ok, false);
  if (releaseAgain.ok) return;
  assert.equal(releaseAgain.code, "terminal-state");
  assert.deepEqual(releaseAgain.record, terminal);
});

test("every transition follows the table — no invented paths", () => {
  // unpossessed → possess ok; possessed → possess refused; released →
  // everything refused (terminal). The table is the authority.
  const unpossessed = initialPossessionRecord(possessionOne());
  const possessed = transitionPossession(unpossessed, possessEvent(compatibleOutcome()));
  assert.equal(possessed.ok, true);
  const released = transitionPossession(possessed.ok ? possessed.record : unpossessed, {
    kind: "release",
    reason: "protocol-error",
  });
  assert.equal(released.ok, true);
  const terminalRecord = released.ok ? released.record : unpossessed;
  const events = [
    possessEvent(compatibleOutcome()),
    { kind: "release", reason: "rate-violation" } as const,
  ];
  for (const event of events) {
    const result = transitionPossession(terminalRecord, event);
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.code, "terminal-state");
    assert.deepEqual(result.record, terminalRecord);
  }
});

test("a new possession is a new record — prior records are never rewritten", () => {
  const first = initialPossessionRecord(possessionOne());
  const heldFirst = transitionPossession(first, possessEvent(compatibleOutcome()));
  assert.equal(heldFirst.ok, true);
  assert.equal(heldFirst.ok && heldFirst.record.state, "possessed");
  // the successor possession of the same body starts from ITS own record
  const second = initialPossessionRecord(possessionTwo());
  assert.equal(second.state, "unpossessed");
  assert.notEqual(second.possessionId, first.possessionId);
  assert.notEqual(second.substrateId, first.substrateId);
  // and the first record is untouched by the second's existence
  assert.deepEqual(first, initialPossessionRecord(possessionOne()));
});

test("the possess event helper carries the outcome verbatim", () => {
  const compatibility = compatibleOutcome();
  const event = possessEvent(compatibility);
  assert.deepEqual(event, { kind: "possess", compatibility });
});
