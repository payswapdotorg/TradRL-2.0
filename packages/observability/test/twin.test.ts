/**
 * The A9 determinism twin (W061 `observability`) — same inputs ⇒ deep-equal
 * records, trails and heads, bit-for-bit; refusals included.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { appendToTrail, emptyTrail, mintAuditRecord, scopeAnchorOf } from "../audit.js";
import { mintOperationalEvent } from "../events.js";
import { resetFixtureCounters, auditDeclaration, eventDeclaration, worldScope } from "./fixtures.js";

test("the same event declaration mints bit-for-bit equal events", () => {
  resetFixtureCounters();
  const first = mintOperationalEvent(eventDeclaration());
  resetFixtureCounters();
  const second = mintOperationalEvent(eventDeclaration());
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.event, second.event);
});

test("the same audit declaration mints bit-for-bit equal records", () => {
  resetFixtureCounters();
  const first = mintAuditRecord(auditDeclaration());
  resetFixtureCounters();
  const second = mintAuditRecord(auditDeclaration());
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.record, second.record);
});

test("the same appends produce bit-for-bit equal trails (ids and heads)", () => {
  const buildTrail = () => {
    resetFixtureCounters();
    const one = mintAuditRecord(auditDeclaration());
    const two = mintAuditRecord(auditDeclaration({ sequence: 2 }));
    assert.ok(one.ok && two.ok);
    const first = appendToTrail(emptyTrail(worldScope()), one.record);
    assert.ok(first.ok);
    const second = appendToTrail(first.trail, two.record);
    assert.ok(second.ok);
    return second.trail;
  };
  assert.deepEqual(buildTrail(), buildTrail());
});

test("the scope anchor is a pure function of the scope (A9)", () => {
  assert.equal(scopeAnchorOf(worldScope()), scopeAnchorOf(worldScope()));
});

test("a refusal is deterministic too — the same violation list every time", () => {
  resetFixtureCounters();
  const first = mintAuditRecord(auditDeclaration({ subject: "" }));
  resetFixtureCounters();
  const second = mintAuditRecord(auditDeclaration({ subject: "" }));
  assert.ok(!first.ok && !second.ok);
  assert.deepEqual(first.violations, second.violations);
});
