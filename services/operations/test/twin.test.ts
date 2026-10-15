/**
 * The A9 determinism twin (W061 `services/operations`) — same records ⇒
 * same trail; same trail + events ⇒ the same bit-for-bit report; refusals
 * are deterministic too.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleTrail, verifyTrail } from "../trail.js";
import { composeOperationsReport } from "../reports.js";
import { auditAt, sampleEvents, sampleTrail } from "./fixtures.js";

test("the same record set assembles bit-for-bit equal trails", () => {
  const first = assembleTrail([auditAt(1), auditAt(2), auditAt(3)]);
  const second = assembleTrail([auditAt(1), auditAt(2), auditAt(3)]);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.trail, second.trail);
});

test("the same trail + stream compose bit-for-bit equal reports", () => {
  const first = composeOperationsReport(sampleTrail(), sampleEvents());
  const second = composeOperationsReport(sampleTrail(), [...sampleEvents()].reverse());
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.report, second.report);
});

test("verification outcomes are deterministic (ok and refusal alike)", () => {
  const okFirst = verifyTrail(sampleTrail());
  const okSecond = verifyTrail(sampleTrail());
  assert.deepEqual(okFirst, okSecond);
  const tampered = { ...sampleTrail(), head: "forged" };
  assert.deepEqual(verifyTrail(tampered), verifyTrail(tampered));
});

test("composition refusals are deterministic — the same violation list", () => {
  const events = sampleEvents();
  const first = composeOperationsReport(sampleTrail(), [...events, events[0]!]);
  const second = composeOperationsReport(sampleTrail(), [...events, events[0]!]);
  assert.ok(!first.ok && !second.ok);
  assert.deepEqual(first.violations, second.violations);
});
