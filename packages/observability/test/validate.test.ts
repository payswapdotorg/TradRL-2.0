/**
 * Whole-record re-validation tests (W061 `observability`) — ids re-derived
 * from the carried content: every post-hoc edit is a LOUD typed violation.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAuditRecord,
  validateHealthDescriptor,
  validateOperationalEvent,
  validateTrafficDescriptor,
} from "../validate.js";
import { descriptorIdOf, mintOperationalEvent, type HealthDescriptor, type TrafficDescriptor } from "../events.js";
import { mintAuditRecord } from "../audit.js";
import type { SourceCitation } from "tradrl-evidence";
import { ARTIFACT_CITATION, auditDeclaration, eventDeclaration, NO_SOURCE, worldScope } from "./fixtures.js";

test("a lawful event re-validates clean", () => {
  const outcome = mintOperationalEvent(eventDeclaration());
  assert.ok(outcome.ok);
  assert.deepEqual(validateOperationalEvent(outcome.event), []);
});

test("an edited event payload is caught by id re-derivation", () => {
  const outcome = mintOperationalEvent(eventDeclaration());
  assert.ok(outcome.ok);
  const tampered = {
    ...outcome.event,
    payload: { ...outcome.event.payload, seed: 999 },
  };
  const violations = validateOperationalEvent(tampered);
  assert.ok(violations.some((violation) => violation.kind === "id-mismatch"));
});

test("an event id without the oev- prefix is refused", () => {
  const outcome = mintOperationalEvent(eventDeclaration());
  assert.ok(outcome.ok);
  const wrong = { ...outcome.event, eventId: `x-${outcome.event.eventId}` };
  const violations = validateOperationalEvent(wrong);
  assert.ok(violations.some((violation) => violation.kind === "id-mismatch"));
});

test("a non-object event is refused", () => {
  assert.ok(validateOperationalEvent(null).length > 0);
  assert.ok(validateOperationalEvent("event").length > 0);
});

test("a lawful audit record re-validates clean", () => {
  const outcome = mintAuditRecord(auditDeclaration());
  assert.ok(outcome.ok);
  assert.deepEqual(validateAuditRecord(outcome.record), []);
});

test("an edited detail is caught by id re-derivation (the rewrite law)", () => {
  const outcome = mintAuditRecord(auditDeclaration());
  assert.ok(outcome.ok);
  const tampered = {
    ...outcome.record,
    detail: { ...outcome.record.detail, code: 500 },
  };
  const violations = validateAuditRecord(tampered);
  assert.ok(violations.some((violation) => violation.kind === "record-id-mismatch"));
});

test("a swapped provenance citation is caught by id re-derivation", () => {
  const outcome = mintAuditRecord(auditDeclaration({ provenance: NO_SOURCE }));
  assert.ok(outcome.ok);
  const tampered = {
    ...outcome.record,
    provenance: ARTIFACT_CITATION,
  };
  const violations = validateAuditRecord(tampered);
  assert.ok(violations.some((violation) => violation.kind === "record-id-mismatch"));
});

test("a malformed provenance is caught by the rewrite law (id re-derivation)", () => {
  const outcome = mintAuditRecord(auditDeclaration());
  assert.ok(outcome.ok);
  const malformed = {
    ...outcome.record,
    provenance: { kind: "gossip" } as unknown as SourceCitation,
  };
  const violations = validateAuditRecord(malformed);
  assert.ok(violations.some((violation) => violation.kind === "record-id-mismatch"));
});

test("a non-object record is refused", () => {
  assert.ok(validateAuditRecord(42).length > 0);
});

test("a lawful health descriptor re-validates clean", () => {
  const scope = worldScope();
  const descriptor: HealthDescriptor = {
    descriptorId: descriptorIdOf({
      scope,
      kind: "health",
      content: { checkedAt: 5_000, notes: ["nominal"], status: "healthy" },
    }),
    scope,
    status: "healthy",
    checkedAt: 5_000,
    notes: ["nominal"],
  };
  assert.deepEqual(validateHealthDescriptor(descriptor), []);
});

test("an out-of-vocabulary health status is refused", () => {
  const scope = worldScope();
  const descriptor = {
    descriptorId: "opsd-x",
    scope,
    status: "sparkling",
    checkedAt: 5_000,
    notes: [],
  } as unknown as HealthDescriptor;
  const violations = validateHealthDescriptor(descriptor);
  assert.ok(violations.some((violation) => violation.kind === "payload-field-invalid"));
});

test("a rewritten health descriptor is caught by id re-derivation", () => {
  const scope = worldScope();
  const descriptor = {
    descriptorId: descriptorIdOf({
      scope,
      kind: "health",
      content: { checkedAt: 5_000, notes: [], status: "healthy" },
    }),
    scope,
    status: "down",
    checkedAt: 5_000,
    notes: [],
  } as unknown as HealthDescriptor;
  const violations = validateHealthDescriptor(descriptor);
  assert.ok(violations.some((violation) => violation.kind === "id-mismatch"));
});

test("a lawful traffic descriptor re-validates clean", () => {
  const scope = worldScope();
  const descriptor: TrafficDescriptor = {
    descriptorId: descriptorIdOf({
      scope,
      kind: "traffic",
      content: { auditRecordCount: 2, eventCount: 3, windowFromMs: 0, windowToMs: 9_000 },
    }),
    scope,
    windowFromMs: 0,
    windowToMs: 9_000,
    eventCount: 3,
    auditRecordCount: 2,
  };
  assert.deepEqual(validateTrafficDescriptor(descriptor), []);
});

test("an inverted traffic window is refused", () => {
  const scope = worldScope();
  const descriptor = {
    descriptorId: "opsd-x",
    scope,
    windowFromMs: 9_000,
    windowToMs: 0,
    eventCount: 1,
    auditRecordCount: 1,
  } as unknown as TrafficDescriptor;
  const violations = validateTrafficDescriptor(descriptor);
  assert.ok(violations.some((violation) => violation.kind === "payload-field-invalid"));
});

test("a rewritten traffic count is caught by id re-derivation", () => {
  const scope = worldScope();
  const descriptor = {
    descriptorId: descriptorIdOf({
      scope,
      kind: "traffic",
      content: { auditRecordCount: 2, eventCount: 3, windowFromMs: 0, windowToMs: 9_000 },
    }),
    scope,
    windowFromMs: 0,
    windowToMs: 9_000,
    eventCount: 7,
    auditRecordCount: 2,
  } as unknown as TrafficDescriptor;
  const violations = validateTrafficDescriptor(descriptor);
  assert.ok(violations.some((violation) => violation.kind === "id-mismatch"));
});
