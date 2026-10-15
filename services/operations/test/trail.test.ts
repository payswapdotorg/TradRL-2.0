/**
 * Trail assembly + verification tests (W061 `services/operations`) — the
 * determinism laws, the refusal laws, and the tamper-detection laws pinned.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleTrail, verifyTrail } from "../trail.js";
import type { AuditTrail } from "observability";
import { auditAt, DATASET_CITATION, mintAudit, sampleTrail, WORLD_SCOPE } from "./fixtures.js";

test("a lawful record set assembles into a trail with id and head", () => {
  const outcome = assembleTrail([auditAt(1), auditAt(2), auditAt(3)]);
  assert.ok(outcome.ok);
  assert.match(outcome.trail.trailId, /^atr-/);
  assert.equal(outcome.trail.records.length, 3);
  assert.ok(outcome.trail.head.length > 0);
});

test("assembly is canonical — input order never leaks (A9)", () => {
  const forwards = assembleTrail([auditAt(1), auditAt(2), auditAt(3)]);
  const backwards = assembleTrail([auditAt(3), auditAt(1), auditAt(2)]);
  assert.ok(forwards.ok && backwards.ok);
  assert.deepEqual(forwards.trail, backwards.trail);
});

test("the same records always assemble bit-for-bit (A9 twin)", () => {
  const first = assembleTrail([auditAt(1), auditAt(2)]);
  const second = assembleTrail([auditAt(1), auditAt(2)]);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.trail, second.trail);
});

test("an empty input is refused", () => {
  const outcome = assembleTrail([]);
  assert.ok(!outcome.ok);
  assert.equal(outcome.violations[0]!.kind, "empty-input");
});

test("a duplicate record id is refused loudly (§14 immutability)", () => {
  const record = auditAt(1);
  const outcome = assembleTrail([record, record]);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "duplicate-record-id"));
});

test("a duplicate sequence is refused", () => {
  const outcome = assembleTrail([auditAt(1), mintAudit({ sequence: 1, subject: "subject-dup" })]);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "duplicate-sequence"));
});

test("a sequence gap is refused", () => {
  const outcome = assembleTrail([auditAt(1), auditAt(3)]);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "sequence-gap"));
});

test("a record outside the trail's scope is refused (§14)", () => {
  const foreign = mintAudit({
    sequence: 2,
    scope: { ...WORLD_SCOPE, worldId: "world-other" },
  });
  const outcome = assembleTrail([auditAt(1), foreign]);
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "scope-mismatch"));
});

test("an unlawful record is refused with its violations carried verbatim", () => {
  const tampered = { ...auditAt(1), detail: { ...auditAt(1).detail, edited: true } };
  const outcome = assembleTrail([tampered]);
  assert.ok(!outcome.ok);
  const unlawful = outcome.violations.find((violation) => violation.kind === "record-unlawful");
  assert.ok(unlawful !== undefined && unlawful.kind === "record-unlawful");
  assert.ok(unlawful.violations.some((violation) => violation.kind === "record-id-mismatch"));
});

test("a lawful trail verifies end-to-end", () => {
  const verification = verifyTrail(sampleTrail());
  assert.ok(verification.ok);
  assert.equal(verification.recordCount, 3);
});

test("an edited record detail is caught at the exact index (the rewrite law)", () => {
  const trail = sampleTrail();
  const records = [...trail.records];
  records[1] = { ...records[1]!, detail: { ...records[1]!.detail, code: 500 } };
  const verification = verifyTrail({ ...trail, records });
  assert.ok(!verification.ok);
  assert.equal(verification.kind, "record-unlawful");
  assert.equal(verification.index, 1);
});

test("an edited provenance citation is caught by the chain + id laws", () => {
  const trail = sampleTrail();
  const records = [...trail.records];
  records[2] = { ...records[2]!, provenance: DATASET_CITATION };
  const verification = verifyTrail({ ...trail, records });
  assert.ok(!verification.ok);
  assert.equal(verification.kind, "record-unlawful");
});

test("a removed middle record is caught as a sequence gap", () => {
  const trail = sampleTrail();
  const records = [trail.records[0]!, trail.records[2]!];
  const verification = verifyTrail({ ...trail, records });
  assert.ok(!verification.ok);
  assert.equal(verification.kind, "sequence-gap");
});

test("records out of canonical order are caught (the sequence axis)", () => {
  const trail = sampleTrail();
  const records = [trail.records[1]!, trail.records[0]!, trail.records[2]!];
  const verification = verifyTrail({ ...trail, records });
  assert.ok(!verification.ok);
  assert.equal(verification.kind, "sequence-gap");
});

test("a repeated sequence inside a trail is caught as out-of-order", () => {
  const trail = sampleTrail();
  const records = [trail.records[0]!, trail.records[1]!, trail.records[0]!];
  const verification = verifyTrail({ ...trail, records });
  assert.ok(!verification.ok);
  assert.equal(verification.kind, "sequence-out-of-order");
});

test("a forged head is refused", () => {
  const verification = verifyTrail({ ...sampleTrail(), head: "0".repeat(64) });
  assert.ok(!verification.ok);
  assert.equal(verification.kind, "head-mismatch");
});

test("a forged trail id is refused", () => {
  const forged = "atr-forged" as unknown as AuditTrail["trailId"];
  const verification = verifyTrail({ ...sampleTrail(), trailId: forged });
  assert.ok(!verification.ok);
  assert.equal(verification.kind, "trail-id-mismatch");
});

test("a non-object trail is refused", () => {
  const verification = verifyTrail(null as unknown as AuditTrail);
  assert.ok(!verification.ok);
  assert.equal(verification.kind, "trail-not-an-object");
});
