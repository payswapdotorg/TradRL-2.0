/**
 * The cross-record isolation proof (W060) — the laws as executable tests,
 * over REAL W054 brain generations founded through `foundBrain` at real
 * §14 scopes: the isolated set (same scope ⇒ no findings), the LOUD
 * cross-tenant finding naming R056 (the W054 law constant, imported from
 * the memory contract and proven equal to this layer's own), the
 * scope-mismatch findings, the implicit-scope + malformed-record +
 * duplicate-record findings, the canonical reference scope's
 * determinism (input order never leaks — A9), and the fail-closed gate
 * refusals (malformed input, empty record set). The proof re-validates
 * through the contract's own validator.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_ISOLATION_LAW as MEMORY_TENANT_ISOLATION_LAW } from "memory";
import { TENANT_ISOLATION_LAW } from "security";
import { validateIsolationProof } from "security";
import type { IsolationEvidenceRecord } from "security";
import { brainEvidence, proveIsolation } from "../isolation.js";
import { brainFixture, SCOPE } from "./fixtures.js";

function evidenceFixture(
  overrides: Partial<IsolationEvidenceRecord> = {},
): IsolationEvidenceRecord {
  return {
    recordId: "rec-alpha",
    scope: { ...SCOPE },
    kind: "firm-brain",
    ...overrides,
  };
}

test("the law pin: this layer's R056 constant IS the memory contract's own (the generalization cites the first instance)", () => {
  assert.equal(TENANT_ISOLATION_LAW, MEMORY_TENANT_ISOLATION_LAW);
});

test("the happy path: a same-scope record set is ISOLATED — and a REAL W054 brain generation proves isolated beside its scope-mates", () => {
  const outcome = proveIsolation([evidenceFixture(), evidenceFixture({ recordId: "rec-beta" })]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a proof");
  }
  assert.equal(outcome.proof.isolated, true);
  assert.deepEqual(outcome.proof.findings, []);
  assert.equal(outcome.proof.checked, 2);
  assert.deepEqual(outcome.proof.scope, SCOPE);
  assert.equal(validateIsolationProof(outcome.proof).ok, true);

  const brain = brainFixture();
  const realOutcome = proveIsolation([brainEvidence(brain), evidenceFixture({ recordId: "rec-zeta" })]);
  assert.equal(realOutcome.ok, true);
  if (!realOutcome.ok) {
    assert.fail("expected a proof");
  }
  assert.equal(realOutcome.proof.isolated, true);
  assert.deepEqual(realOutcome.proof.scope, SCOPE);
  assert.equal(validateIsolationProof(realOutcome.proof).ok, true);
});

test("W054's own A9 meets the proof: two deep-equal brain generations are ONE record — the duplicate-record finding, never a double count", () => {
  const brains = [brainFixture(), brainFixture()];
  assert.deepEqual(brains[0], brains[1]);
  const outcome = proveIsolation(brains.map((brain) => brainEvidence(brain)));
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a proof");
  }
  assert.equal(outcome.proof.isolated, false);
  const finding = outcome.proof.findings.find((candidate) => candidate.code === "duplicate-record");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.recordId, String(brains[0]?.brainId));
  assert.equal(outcome.proof.checked, 2);
});

test("R056: a CROSS-TENANT record is the LOUD typed `cross-tenant` finding naming the law", () => {
  const otherTenant = evidenceFixture({
    recordId: "rec-beta",
    scope: { ...SCOPE, tenantId: "tenant-security-OTHER" },
  });
  const outcome = proveIsolation([evidenceFixture(), otherTenant]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a proof");
  }
  assert.equal(outcome.proof.isolated, false);
  const finding = outcome.proof.findings.find((candidate) => candidate.code === "cross-tenant");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.recordId, "rec-beta");
  assert.match(finding?.message ?? "", /tenant-security-OTHER/);
  assert.ok((finding?.message ?? "").includes(TENANT_ISOLATION_LAW));
  assert.equal(validateIsolationProof(outcome.proof).ok, true);
});

test("§14: same tenant, ANOTHER PROJECT/WORLD — typed scope-mismatch findings, never a silent pass", () => {
  const otherWorld = evidenceFixture({
    recordId: "rec-beta",
    scope: { ...SCOPE, worldId: "world-OTHER" },
  });
  const otherProject = evidenceFixture({
    recordId: "rec-gamma",
    scope: { ...SCOPE, projectId: "project-OTHER" },
  });
  const outcome = proveIsolation([evidenceFixture(), otherWorld, otherProject]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a proof");
  }
  const codes = outcome.proof.findings.map((finding) => finding.code);
  assert.deepEqual(codes.filter((code) => code === "scope-mismatch").length, 2);
  assert.equal(outcome.proof.findings.some((finding) => finding.code === "cross-tenant"), false);
});

test("an IMPLICIT §14 scope is a typed finding (§14 never defaults)", () => {
  const outcome = proveIsolation([
    evidenceFixture(),
    evidenceFixture({ recordId: "rec-beta", scope: { ...SCOPE, worldId: "" } }),
  ]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a proof");
  }
  const finding = outcome.proof.findings.find((candidate) => candidate.code === "implicit-scope");
  assert.notEqual(finding, undefined);
  assert.equal(finding?.recordId, "rec-beta");
  assert.match(finding?.message ?? "", /worldId/);
});

test("a malformed entry and a DUPLICATE record id are typed findings", () => {
  const outcome = proveIsolation([evidenceFixture(), null, evidenceFixture()]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    assert.fail("expected a proof");
  }
  assert.equal(outcome.proof.findings.some((finding) => finding.code === "malformed-record"), true);
  const duplicate = outcome.proof.findings.find((finding) => finding.code === "duplicate-record");
  assert.notEqual(duplicate, undefined);
  assert.equal(duplicate?.recordId, "rec-alpha");
  assert.equal(outcome.proof.checked, 3);
});

test("A9: the CANONICAL reference scope — input order never leaks; permuted inputs yield the SAME proof id", () => {
  const records = [
    evidenceFixture({ recordId: "rec-zeta" }),
    evidenceFixture({ recordId: "rec-alpha" }),
    evidenceFixture({ recordId: "rec-mid" }),
  ];
  const forward = proveIsolation(records);
  const permuted = proveIsolation([records[2]!, records[0]!, records[1]!]);
  if (!forward.ok || !permuted.ok) {
    assert.fail("expected proofs");
  }
  assert.deepEqual(forward.proof, permuted.proof);
  assert.equal(forward.proof.proofId, permuted.proof.proofId);
  assert.deepEqual(forward.proof.scope, SCOPE);
});

test("fail-closed: a non-array input and an EMPTY record set are refused loudly, never proven vacuously", () => {
  const malformed = proveIsolation({} as unknown as readonly IsolationEvidenceRecord[]);
  assert.equal(malformed.ok, false);
  if (malformed.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(malformed.errors[0]?.code, "malformed-input");
  const empty = proveIsolation([]);
  assert.equal(empty.ok, false);
  if (empty.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(empty.errors[0]?.code, "empty-record-set");
});

test("the reference scope is the CANONICALLY-FIRST well-scoped record's — a lone scope disagreement is measured against it, deterministically", () => {
  // 'rec-alpha' < 'rec-beta': the reference scope is alpha's, so BETA is
  // the record the cross-tenant finding names — whatever the input order.
  const alpha = evidenceFixture({ recordId: "rec-alpha" });
  const beta = evidenceFixture({
    recordId: "rec-beta",
    scope: { ...SCOPE, tenantId: "tenant-security-OTHER" },
  });
  const first = proveIsolation([alpha, beta]);
  const second = proveIsolation([beta, alpha]);
  if (!first.ok || !second.ok) {
    assert.fail("expected proofs");
  }
  assert.deepEqual(first.proof, second.proof);
  assert.equal(first.proof.findings[0]?.recordId, "rec-beta");
  assert.deepEqual(first.proof.scope, SCOPE);
});
