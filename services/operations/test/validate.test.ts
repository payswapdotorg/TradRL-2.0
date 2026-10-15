/**
 * Report re-validation tests (W061 `services/operations`) — the id
 * re-derivation + count-coherence + window + provenance laws.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOperationsReport } from "../validate.js";
import { composeOperationsReport } from "../reports.js";
import { sampleEvents, sampleTrail } from "./fixtures.js";

test("a lawful report re-validates clean", () => {
  const outcome = composeOperationsReport(sampleTrail(), sampleEvents());
  assert.ok(outcome.ok);
  assert.deepEqual(validateOperationsReport(outcome.report), []);
});

test("an edited count is caught by id re-derivation", () => {
  const outcome = composeOperationsReport(sampleTrail(), sampleEvents());
  assert.ok(outcome.ok);
  const tampered = {
    ...outcome.report,
    eventCounts: { ...outcome.report.eventCounts, "dataset-imported": 9 },
  };
  const violations = validateOperationsReport(tampered);
  assert.ok(violations.some((violation) => violation.kind === "report-id-mismatch"));
  assert.ok(violations.some((violation) => violation.kind === "count-incoherent"));
});

test("an incoherent event total is refused", () => {
  const outcome = composeOperationsReport(sampleTrail(), sampleEvents());
  assert.ok(outcome.ok);
  const tampered = { ...outcome.report, eventTotal: 99 };
  const violations = validateOperationsReport(tampered);
  assert.ok(violations.some((violation) => violation.kind === "count-incoherent"));
});

test("an incoherent audit total is refused", () => {
  const outcome = composeOperationsReport(sampleTrail(), []);
  assert.ok(outcome.ok);
  const tampered = { ...outcome.report, trailRecordCount: 42 };
  const violations = validateOperationsReport(tampered);
  assert.ok(violations.some((violation) => violation.kind === "count-incoherent"));
});

test("a foreign count key is refused (the closed vocabularies)", () => {
  const outcome = composeOperationsReport(sampleTrail(), []);
  assert.ok(outcome.ok);
  const tampered = {
    ...outcome.report,
    eventCounts: { ...outcome.report.eventCounts, "server-restarted": 1 },
  };
  const violations = validateOperationsReport(tampered);
  assert.ok(violations.some((violation) => violation.kind === "vocabulary-foreign-key"));
});

test("an inverted window is refused", () => {
  const outcome = composeOperationsReport(sampleTrail(), sampleEvents());
  assert.ok(outcome.ok);
  const tampered = {
    ...outcome.report,
    eventWindow: { fromMs: 99_999, toMs: 1 },
  };
  const violations = validateOperationsReport(tampered);
  assert.ok(violations.some((violation) => violation.kind === "window-inverted"));
});

test("a missing provenance citation is refused", () => {
  const outcome = composeOperationsReport(sampleTrail(), []);
  assert.ok(outcome.ok);
  const tampered = { ...outcome.report, provenance: undefined };
  const violations = validateOperationsReport(tampered);
  assert.ok(violations.some((violation) => violation.kind === "provenance-missing"));
});

test("an unlawful scope is refused (§14)", () => {
  const outcome = composeOperationsReport(sampleTrail(), []);
  assert.ok(outcome.ok);
  const tampered = {
    ...outcome.report,
    scope: { ...outcome.report.scope, tenantId: "" },
  };
  const violations = validateOperationsReport(tampered);
  assert.ok(violations.some((violation) => violation.kind === "scope-unlawful"));
});

test("a non-object report is refused", () => {
  assert.ok(validateOperationsReport("report").length > 0);
});
