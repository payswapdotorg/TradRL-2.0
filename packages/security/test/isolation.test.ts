/**
 * The tenant-isolation proof vocabulary (W060) — the laws as executable
 * tests: the canonical findings order, the content-addressed proof id
 * (input order never leaks), the evidence-envelope record-shape laws, and
 * `validateIsolationProof`'s whole-record re-derivations (id, verdict,
 * canonical order, checked count, absent-scope coherence, provenance, and
 * THE REDACTION LAW re-scanned over the proof's own bytes).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ISOLATION_PROOF_ID_PREFIX,
  SECURITY_PROVENANCE_LAWS,
  canonicalIsolationFindings,
  isolationCanonicalContent,
  isolationInputDigestOf,
  isolationProofDigestOf,
  isolationRecordShapeErrors,
} from "../isolation.js";
import type { IsolationFinding, IsolationProof } from "../isolation.js";
import { validateIsolationProof } from "../validate.js";
import { RUNTIME_TOKEN, SCOPE } from "./fixtures.js";

function buildProof(
  scope: typeof SCOPE | undefined,
  checked: number,
  findings: readonly IsolationFinding[],
): IsolationProof {
  const ordered = canonicalIsolationFindings(findings);
  return {
    proofId: isolationProofDigestOf({ scope, checked, findings: ordered }),
    scope: scope === undefined ? undefined : { ...scope },
    checked,
    findings: ordered,
    isolated: ordered.length === 0,
    provenance: {
      deriver: "prove-isolation",
      inputDigest: isolationInputDigestOf(scope, checked),
      laws: SECURITY_PROVENANCE_LAWS,
    },
  };
}

test("the canonical findings order is (recordId, code, message) — never the input's order", () => {
  const late: IsolationFinding = { code: "scope-mismatch", recordId: "rec-b", message: "b" };
  const early: IsolationFinding = { code: "cross-tenant", recordId: "rec-a", message: "a" };
  assert.deepEqual(canonicalIsolationFindings([late, early]), [early, late]);
});

test("the proof id is content-addressed over CANONICAL content — permuted findings yield the SAME id (A9)", () => {
  const findings: IsolationFinding[] = [
    { code: "cross-tenant", recordId: "rec-b", message: "tenant differs" },
    { code: "implicit-scope", recordId: "rec-a", message: "blank worldId" },
  ];
  const direct = isolationCanonicalContent(SCOPE, 2, findings);
  const permuted = isolationCanonicalContent(SCOPE, 2, [findings[1]!, findings[0]!]);
  assert.deepEqual(direct, permuted);
  assert.equal(
    isolationProofDigestOf({ scope: SCOPE, checked: 2, findings }),
    isolationProofDigestOf({ scope: SCOPE, checked: 2, findings: [findings[1]!, findings[0]!] }),
  );
});

test("a differing finding or scope yields a DIFFERENT proof id (content addressing is exact)", () => {
  const findings: IsolationFinding[] = [
    { code: "cross-tenant", recordId: "rec-b", message: "tenant differs" },
  ];
  assert.notEqual(
    isolationProofDigestOf({ scope: SCOPE, checked: 2, findings }),
    isolationProofDigestOf({ scope: SCOPE, checked: 2, findings: [] }),
  );
  const otherScope = { tenantId: "tenant-OTHER", projectId: "p", worldId: "w" };
  assert.notEqual(
    isolationProofDigestOf({ scope: SCOPE, checked: 1, findings: [] }),
    isolationProofDigestOf({ scope: otherScope, checked: 1, findings: [] }),
  );
});

test("the evidence-envelope shape laws: not typed data, blank identity, absent scope, blank members", () => {
  assert.equal(isolationRecordShapeErrors(null)[0]?.code, "malformed-record");
  assert.equal(isolationRecordShapeErrors({ recordId: "  " })[0]?.code, "malformed-record");
  assert.equal(isolationRecordShapeErrors({ recordId: "rec-a" })[0]?.code, "implicit-scope");
  const blank = isolationRecordShapeErrors({
    recordId: "rec-a",
    scope: { tenantId: "t", projectId: "", worldId: "w" },
  });
  assert.equal(blank[0]?.code, "implicit-scope");
  assert.match(blank[0]?.message ?? "", /projectId/);
});

test("validateIsolationProof: the lawful proof re-validates from its own bytes alone", () => {
  assert.equal(validateIsolationProof(buildProof(SCOPE, 3, [])).ok, true);
  const findings: IsolationFinding[] = [
    { code: "cross-tenant", recordId: "rec-b", message: "the record's tenant differs — R056" },
  ];
  assert.equal(validateIsolationProof(buildProof(SCOPE, 2, findings)).ok, true);
});

test("validateIsolationProof: a proof with NO reference scope is lawful only when NOT isolated", () => {
  const findings: IsolationFinding[] = [
    { code: "implicit-scope", recordId: "rec-a", message: "blank tenantId" },
  ];
  assert.equal(validateIsolationProof(buildProof(undefined, 1, findings)).ok, true);
  assert.equal(validateIsolationProof(buildProof(undefined, 1, [])).ok, false);
});

test("validateIsolationProof: a tampered id does not re-derive (A9)", () => {
  const proof = buildProof(SCOPE, 2, []);
  const tampered = { ...proof, proofId: `${ISOLATION_PROOF_ID_PREFIX}00000000` as IsolationProof["proofId"] };
  const validation = validateIsolationProof(tampered);
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "proof-id-mismatch"), true);
});

test("validateIsolationProof: non-canonical findings order is refused (input order never leaks)", () => {
  const findings: IsolationFinding[] = [
    { code: "cross-tenant", recordId: "rec-b", message: "tenant differs" },
    { code: "implicit-scope", recordId: "rec-a", message: "blank worldId" },
  ];
  const canonical = buildProof(SCOPE, 2, findings);
  const swapped = { ...canonical, findings: [canonical.findings[1]!, canonical.findings[0]!] };
  const validation = validateIsolationProof(swapped);
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "invalid-record"), true);
});

test("validateIsolationProof: the verdict is derived, never asserted — a disagreement is refused", () => {
  const findings: IsolationFinding[] = [
    { code: "cross-tenant", recordId: "rec-b", message: "tenant differs" },
  ];
  const lying = { ...buildProof(SCOPE, 2, findings), isolated: true };
  assert.equal(validateIsolationProof(lying).ok, false);
  const empty = { ...buildProof(SCOPE, 0, []), checked: 0 };
  assert.equal(validateIsolationProof(empty).ok, false);
});

test("validateIsolationProof: a tampered provenance does not re-derive", () => {
  const proof = buildProof(SCOPE, 2, []);
  const tampered = {
    ...proof,
    provenance: { ...proof.provenance, deriver: "seal-secret-reference" as never },
  };
  const validation = validateIsolationProof(tampered);
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "provenance-mismatch"), true);
});

test("validateIsolationProof: THE REDACTION LAW re-scanned — a finding message carrying secret-shaped bytes is INVALID", () => {
  const findings: IsolationFinding[] = [
    { code: "cross-tenant", recordId: "rec-b", message: `the tenant is ${RUNTIME_TOKEN}` },
  ];
  const validation = validateIsolationProof(buildProof(SCOPE, 2, findings));
  assert.equal(validation.ok, false);
  if (validation.ok) {
    assert.fail("expected a refusal");
  }
  assert.equal(validation.errors.some((error) => error.code === "secret-value-refused"), true);
});
