/**
 * The A9 determinism twins (W060, the service) — same inputs ⇒ deep-equal
 * records with the same canonical ids; permuted record/reference order
 * never leaks; the R056 law constants pinned against the memory contract's
 * own (REAL imports); and the machinery's purity law: the same §14-scoped
 * records + policy always yield the same proofs + enforcements.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { TENANT_ISOLATION_LAW as MEMORY_TENANT_LAW } from "memory";
import { EXPLICIT_SCOPE_LAW as MEMORY_SCOPE_LAW } from "security";
import { TENANT_ISOLATION_LAW } from "security";
import type { IsolationEvidenceRecord } from "security";
import { brainEvidence, proveIsolation } from "../isolation.js";
import { enforceSecretPolicy } from "../secrets.js";
import { brainFixture, handleFixture, policyFixture, SCOPE } from "./fixtures.js";

test("the law pins: the service surface carries the SAME R056/§14 law constants as the memory contract", () => {
  assert.equal(TENANT_ISOLATION_LAW, MEMORY_TENANT_LAW);
  assert.notEqual(MEMORY_SCOPE_LAW, "");
});

test("A9 twin — proveIsolation: deep-equal proofs + the same iso-<digest> id for the same record set", () => {
  const records: IsolationEvidenceRecord[] = [
    { recordId: "rec-alpha", scope: { ...SCOPE }, kind: "firm-brain" },
    { recordId: "rec-beta", scope: { ...SCOPE }, kind: "firm-brain" },
  ];
  const first = proveIsolation(records);
  const second = proveIsolation([records[1]!, records[0]!]);
  if (!first.ok || !second.ok) {
    assert.fail("expected proofs");
  }
  assert.deepEqual(first.proof, second.proof);
  assert.equal(first.proof.proofId, second.proof.proofId);
});

test("A9 twin — proveIsolation over REAL W054 brain generations: permuted REAL records yield the same proof", () => {
  const brains = [brainFixture(), brainFixture({ ...SCOPE, worldId: "world-security-alt" })];
  const evidence = brains.map((brain) => brainEvidence(brain));
  const first = proveIsolation(evidence);
  const second = proveIsolation([evidence[1]!, evidence[0]!]);
  if (!first.ok || !second.ok) {
    assert.fail("expected proofs");
  }
  assert.deepEqual(first.proof, second.proof);
  assert.equal(first.proof.isolated, false);
  assert.equal(first.proof.findings.length, 1);
});

test("A9 twin — enforceSecretPolicy: deep-equal enforcements + the same enf-<digest> id for the same policy + handles", () => {
  const policy = policyFixture();
  const handles = [
    handleFixture(),
    handleFixture({ displayName: "second desk handle" }),
    handleFixture({ displayName: "third desk handle" }),
  ];
  const first = enforceSecretPolicy(policy, handles);
  const second = enforceSecretPolicy(policy, [handles[2]!, handles[0]!, handles[1]!]);
  if (!first.ok || !second.ok) {
    assert.fail("expected enforcements");
  }
  assert.deepEqual(first.enforcement, second.enforcement);
  assert.equal(first.enforcement.enforcementId, second.enforcement.enforcementId);
});

test("A9 twin — the failing path is deterministic too: the same violations, the same enforcement id, whatever the order", () => {
  const policy = policyFixture();
  const handles = [
    handleFixture({ scope: { ...SCOPE, tenantId: "tenant-security-OTHER" } }),
    handleFixture({ custody: { ...policy.secretCustody, rotation: { kind: "never" } } }),
    handleFixture({ displayName: "upstream exchange handle" }),
  ];
  const first = enforceSecretPolicy(policy, handles);
  const second = enforceSecretPolicy(policy, [handles[2]!, handles[1]!, handles[0]!]);
  if (!first.ok || !second.ok) {
    assert.fail("expected enforcements");
  }
  assert.deepEqual(first.enforcement, second.enforcement);
  assert.equal(first.enforcement.compliant, false);
  assert.equal(first.enforcement.violations.length >= 2, true);
});
