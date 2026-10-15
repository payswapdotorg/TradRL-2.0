/**
 * Report composition tests (W061 `services/operations`) — the deterministic
 * carried-data laws + the fail-closed composition refusals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { composeOperationsReport } from "../reports.js";
import { assembleTrail } from "../trail.js";
import { AUDIT_ACTION_KINDS, OPS_EVENT_KINDS } from "observability";
import { auditAt, mintEvent, sampleEvents, sampleTrail } from "./fixtures.js";

test("a lawful trail + stream compose into an opr- report", () => {
  const outcome = composeOperationsReport(sampleTrail(), sampleEvents());
  assert.ok(outcome.ok);
  assert.match(outcome.report.reportId, /^opr-/);
  assert.equal(outcome.report.trailRecordCount, 3);
  assert.equal(outcome.report.eventTotal, 4);
});

test("the counts are carried in the closed vocabularies' canonical order", () => {
  const outcome = composeOperationsReport(sampleTrail(), sampleEvents());
  assert.ok(outcome.ok);
  assert.deepEqual(Object.keys(outcome.report.eventCounts), OPS_EVENT_KINDS);
  assert.deepEqual(Object.keys(outcome.report.auditCounts), AUDIT_ACTION_KINDS);
  assert.equal(outcome.report.eventCounts["dataset-imported"], 2);
  assert.equal(outcome.report.auditCounts["world-accessed"], 3);
});

test("the event window is carried as declared data", () => {
  const outcome = composeOperationsReport(sampleTrail(), sampleEvents());
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.report.eventWindow, { fromMs: 10_001, toMs: 10_004 });
});

test("composition is canonical — event input order never leaks (A9)", () => {
  const forwards = composeOperationsReport(sampleTrail(), sampleEvents());
  const backwards = composeOperationsReport(sampleTrail(), [...sampleEvents()].reverse());
  assert.ok(forwards.ok && backwards.ok);
  assert.deepEqual(forwards.report, backwards.report);
});

test("a tampered trail is refused with the verification carried verbatim", () => {
  const trail = sampleTrail();
  const tampered = {
    ...trail,
    records: trail.records.slice(0, 2),
  };
  const outcome = composeOperationsReport(tampered, sampleEvents());
  assert.ok(!outcome.ok);
  const refused = outcome.violations[0]!;
  assert.ok(refused.kind === "trail-unverified");
  assert.ok(!refused.verification.ok);
});

test("an event outside the trail's scope is refused (§14)", () => {
  const foreign = mintEvent({
    sequence: 5,
    declaredAt: 10_005,
    scope: { kind: "tenant-project-world", tenantId: "tenant-beta", projectId: "project-one", worldId: "world-w" },
  });
  const outcome = composeOperationsReport(sampleTrail(), [...sampleEvents(), foreign]);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "event-scope-mismatch"));
});

test("a duplicate event id is refused (the stream is immutable)", () => {
  const events = sampleEvents();
  const outcome = composeOperationsReport(sampleTrail(), [...events, events[0]!]);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "duplicate-event-id"));
});

test("an edited event is refused with its violations carried verbatim", () => {
  const edited = { ...sampleEvents()[0]!, declaredAt: 99_999 };
  const outcome = composeOperationsReport(sampleTrail(), [edited]);
  assert.ok(!outcome.ok);
  const unlawful = outcome.violations.find((violation) => violation.kind === "event-unlawful");
  assert.ok(unlawful !== undefined && unlawful.kind === "event-unlawful");
  assert.ok(unlawful.violations.some((violation) => violation.kind === "id-mismatch"));
});

test("different inputs compose different content-addressed ids", () => {
  const first = composeOperationsReport(sampleTrail(), sampleEvents());
  const second = composeOperationsReport(sampleTrail(), sampleEvents().slice(0, 3));
  assert.ok(first.ok && second.ok);
  assert.notEqual(first.report.reportId, second.report.reportId);
});

test("an empty event stream composes an honest zero report", () => {
  const outcome = composeOperationsReport(sampleTrail(), []);
  assert.ok(outcome.ok);
  assert.equal(outcome.report.eventTotal, 0);
  assert.equal(outcome.report.eventWindow, null);
});

test("the trail's own records are counted by action", () => {
  const outcome = composeOperationsReport(sampleTrail(), []);
  assert.ok(outcome.ok);
  assert.equal(outcome.report.auditCounts["world-accessed"], 3);
  assert.equal(outcome.report.trailRecordCount, 3);
});

test("the report carries the trail's content address", () => {
  const trail = sampleTrail();
  const outcome = composeOperationsReport(trail, []);
  assert.ok(outcome.ok);
  assert.equal(outcome.report.trailId, trail.trailId);
  assert.equal(outcome.report.trailHead, trail.head);
});

test("the report carries the honest W059 provenance marker", () => {
  const outcome = composeOperationsReport(sampleTrail(), []);
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.report.provenance, { kind: "no-declared-source" });
});

test("one extra audit record changes the audit counts and the report id", () => {
  const small = composeOperationsReport(sampleTrail(), []);
  const grownTrail = assembleTrail([auditAt(1), auditAt(2), auditAt(3), auditAt(4)]);
  assert.ok(grownTrail.ok);
  const grown = composeOperationsReport(grownTrail.trail, []);
  assert.ok(small.ok && grown.ok);
  assert.equal(grown.report.trailRecordCount, 4);
  assert.notEqual(small.report.reportId, grown.report.reportId);
});
