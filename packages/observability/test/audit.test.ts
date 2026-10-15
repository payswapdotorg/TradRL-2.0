/**
 * Audit-record tests (W061 `observability`) — the W028 provenance law, the
 * immutable append-only lineage laws and the hash-chained digests as data.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendToTrail,
  auditLinkOf,
  auditRecordIdOf,
  AUDIT_ACTION_KINDS,
  AUDIT_RECORD_ID_PREFIX,
  emptyTrail,
  isSourceCitation,
  mintAuditRecord,
  scopeAnchorOf,
  type AuditActionKind,
} from "../audit.js";
import type { SourceCitation } from "tradrl-evidence";
import {
  ARTIFACT_CITATION,
  auditDeclaration,
  DATASET_CITATION,
  NO_SOURCE,
  resetFixtureCounters,
  tenantScope,
  worldScope,
} from "./fixtures.js";

test("a lawful audit record mints an aud- id", () => {
  const outcome = mintAuditRecord(auditDeclaration());
  assert.ok(outcome.ok);
  assert.match(outcome.record.recordId, /^aud-/);
});

test("the same declaration always mints the same id (A9)", () => {
  const declaration = auditDeclaration();
  assert.equal(auditRecordIdOf(declaration), auditRecordIdOf(declaration));
});

test("an audit record WITHOUT provenance is refused (the W028 law)", () => {
  const declaration = auditDeclaration();
  const outcome = mintAuditRecord({
    ...declaration,
    provenance: undefined as unknown as SourceCitation,
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "provenance-missing"));
});

test("a malformed provenance citation is refused", () => {
  const outcome = mintAuditRecord(
    auditDeclaration({
      provenance: { kind: "rumour" } as unknown as SourceCitation,
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "provenance-malformed"));
});

test("the honest no-declared-source marker is a lawful citation", () => {
  const outcome = mintAuditRecord(auditDeclaration({ provenance: NO_SOURCE }));
  assert.ok(outcome.ok);
  assert.equal(outcome.record.provenance.kind, "none");
});

test("an information-artifact citation is carried verbatim", () => {
  const outcome = mintAuditRecord(auditDeclaration({ provenance: ARTIFACT_CITATION }));
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.record.provenance, ARTIFACT_CITATION);
});

test("the structural provenance guard mirrors W028's closed union", () => {
  assert.ok(isSourceCitation(DATASET_CITATION));
  assert.ok(isSourceCitation(ARTIFACT_CITATION));
  assert.ok(isSourceCitation(NO_SOURCE));
  assert.ok(!isSourceCitation({ kind: "none", reason: "because" }));
  assert.ok(!isSourceCitation({ kind: "dataset", basis: "guess", datasetId: "ds" }));
  assert.ok(!isSourceCitation(null));
  assert.ok(!isSourceCitation(42));
});

test("an unknown audit action is refused", () => {
  const outcome = mintAuditRecord(
    auditDeclaration({ action: "_deleted" as unknown as AuditActionKind }),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "unknown-audit-action"));
});

test("a blank subject or non-record detail is refused", () => {
  const blankSubject = mintAuditRecord(auditDeclaration({ subject: "" }));
  assert.ok(!blankSubject.ok);
  assert.ok(blankSubject.violations.some((violation) => violation.kind === "blank-subject"));
  const badDetail = mintAuditRecord(
    auditDeclaration({ detail: ["not", "a", "record"] as unknown as Record<string, unknown> }),
  );
  assert.ok(!badDetail.ok);
  assert.ok(badDetail.violations.some((violation) => violation.kind === "detail-not-record"));
});

test("the closed audit-action vocabulary is canonical and complete", () => {
  assert.deepEqual(AUDIT_ACTION_KINDS, [...AUDIT_ACTION_KINDS].sort());
  assert.equal(AUDIT_ACTION_KINDS.length, 7);
  assert.equal(AUDIT_RECORD_ID_PREFIX, "aud-");
});

test("the empty trail carries the scope anchor as its head", () => {
  const trail = emptyTrail(worldScope());
  assert.equal(trail.records.length, 0);
  assert.equal(trail.head, scopeAnchorOf(worldScope()));
});

test("appendToTrail grows the trail and advances the head", () => {
  const first = mintAuditRecord(auditDeclaration({ sequence: 1 }));
  assert.ok(first.ok);
  const second = mintAuditRecord(auditDeclaration({ sequence: 2 }));
  assert.ok(second.ok);
  let trail = emptyTrail(worldScope());
  const appendedFirst = appendToTrail(trail, first.record);
  assert.ok(appendedFirst.ok);
  trail = appendedFirst.trail;
  const appendedSecond = appendToTrail(trail, second.record);
  assert.ok(appendedSecond.ok);
  assert.equal(appendedSecond.trail.records.length, 2);
  assert.equal(
    appendedSecond.trail.head,
    auditLinkOf(auditLinkOf(scopeAnchorOf(worldScope()), first.record), second.record),
  );
  assert.notEqual(appendedSecond.trail.head, appendedFirst.trail.head);
});

test("re-appending a record id is refused — the trail is immutable (§14)", () => {
  const minted = mintAuditRecord(auditDeclaration());
  assert.ok(minted.ok);
  const trail = emptyTrail(worldScope());
  const first = appendToTrail(trail, minted.record);
  assert.ok(first.ok);
  const replay = appendToTrail(first.trail, minted.record);
  assert.ok(!replay.ok);
  assert.ok(replay.violations.some((violation) => violation.kind === "duplicate-record-id"));
});

test("a non-successive sequence append is refused", () => {
  const first = mintAuditRecord(auditDeclaration());
  assert.ok(first.ok);
  const skipped = mintAuditRecord(auditDeclaration({ sequence: 3 }));
  assert.ok(skipped.ok);
  const trail = emptyTrail(worldScope());
  const grown = appendToTrail(trail, first.record);
  assert.ok(grown.ok);
  const outcome = appendToTrail(grown.trail, skipped.record);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "non-successive-sequence"));
});

test("an append outside the trail's scope is refused (§14)", () => {
  const minted = mintAuditRecord(auditDeclaration({ scope: tenantScope() }));
  assert.ok(minted.ok);
  const outcome = appendToTrail(emptyTrail(worldScope()), minted.record);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "scope-mismatch"));
});

test("an append of a rewritten record is refused (id re-derivation)", () => {
  const minted = mintAuditRecord(auditDeclaration());
  assert.ok(minted.ok);
  const rewritten = {
    ...minted.record,
    detail: { ...minted.record.detail, secretEdit: true },
  };
  const outcome = appendToTrail(emptyTrail(worldScope()), rewritten);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "record-unlawful"));
});

test("a chain link commits to the record's provenance (W028 citation digest)", () => {
  resetFixtureCounters();
  const withDataset = mintAuditRecord(auditDeclaration({ provenance: DATASET_CITATION }));
  resetFixtureCounters();
  const withNone = mintAuditRecord(auditDeclaration({ provenance: NO_SOURCE }));
  assert.ok(withDataset.ok && withNone.ok);
  const anchor = scopeAnchorOf(worldScope());
  assert.notEqual(
    auditLinkOf(anchor, withDataset.record),
    auditLinkOf(anchor, withNone.record),
  );
});
