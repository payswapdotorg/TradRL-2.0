/**
 * The claim-registry + verdict-semantics tests (W022): the findings core is
 * deterministic, plain data, and the registry binds 1:1 to what the checks
 * emit (no orphan findings, no unverified registry entries).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { findingOf, findingDigestOf, summarizeVerdicts, assertFindingsArePlainData } from "../findings.js";
import { FIDELITY_CLAIM_REGISTRY, registeredClaimIds } from "../claims.js";
import { verifyFidelityClaims, harnessCatalog } from "../index.js";

const catalog = harnessCatalog();
const findings = verifyFidelityClaims(catalog);

test("the claim registry has the 21 registered claims (17 fidelity + 4 e2e)", () => {
  assert.equal(FIDELITY_CLAIM_REGISTRY.length, 21);
  assert.equal(new Set(registeredClaimIds()).size, 21);
});

test("the 17 fidelity findings map 1:1 onto the registry (no orphans, no unverified entries)", () => {
  const emitted = findings.map((finding) => finding.claimId);
  const expected = FIDELITY_CLAIM_REGISTRY.filter((entry) => entry.family !== "e2e").map((entry) => entry.claimId);
  assert.deepEqual([...emitted].sort(), [...expected].sort());
});

test("every finding carries its claim quoted from the adapter's own declaration and at least one case", () => {
  for (const finding of findings) {
    assert.ok(finding.claim.length > 20, `${finding.claimId}: the claim quote is substantive`);
    assert.ok(finding.cases.length >= 1, `${finding.claimId}: at least one case`);
    assert.ok(finding.declaredIn.length > 0);
  }
});

test("every case carries the full { expected, observed } evidence pair", () => {
  for (const finding of findings) {
    for (const verdict of finding.cases) {
      assert.ok(verdict.expected.length > 0, `${finding.claimId}/${verdict.caseId}: expected present`);
      assert.ok(verdict.observed.length > 0, `${finding.claimId}/${verdict.caseId}: observed present`);
    }
  }
});

test("verdict derivation: a case problem forces FAIL; a limitation without problems is PARTIAL; otherwise PASS", () => {
  const base = { claimId: "x", claim: "the claim", declaredIn: "somewhere" };
  const held = { caseId: "c1", describe: "d", expected: "e", observed: "o" };
  const violated = { ...held, problem: "the violation" };
  assert.equal(findingOf({ ...base, cases: [held] }).verdict, "PASS");
  assert.equal(findingOf({ ...base, cases: [violated] }).verdict, "FAIL");
  assert.equal(findingOf({ ...base, cases: [held, violated] }).verdict, "FAIL");
  assert.equal(findingOf({ ...base, cases: [held], limitation: "the disclosed limit" }).verdict, "PARTIAL");
  assert.equal(findingOf({ ...base, cases: [violated], limitation: "the disclosed limit" }).verdict, "FAIL");
  assert.match(findingOf({ ...base, cases: [violated] }).problem ?? "", /case 'c1': the violation/);
});

test("verdict tallies count every verdict exactly once", () => {
  const f1 = findingOf({ claimId: "a", claim: "c", declaredIn: "d", cases: [] });
  const f2 = findingOf({ claimId: "b", claim: "c", declaredIn: "d", cases: [], limitation: "l" });
  const f3 = findingOf({ claimId: "c", claim: "c", declaredIn: "d", cases: [{ caseId: "x", describe: "d", expected: "e", observed: "o", problem: "p" }] });
  assert.deepEqual(summarizeVerdicts([f1, f2, f3]), { pass: 1, fail: 1, partial: 1, total: 3 });
});

test("findings are frozen plain data (journalable) and the harness rejects smuggled non-data", () => {
  assert.doesNotThrow(() => assertFindingsArePlainData(findings));
  assert.throws(
    () =>
      assertFindingsArePlainData([
        findingOf({
          claimId: "smuggled",
          claim: "c",
          declaredIn: "d",
          cases: [{ caseId: "c1", describe: "d", expected: "e", observed: { nope: () => 1 } as unknown as string }],
        }),
      ]),
    /not plain JSON-serializable/,
  );
});

test("finding digests are deterministic and content-addressed (A9)", () => {
  const again = verifyFidelityClaims(harnessCatalog());
  assert.equal(findings.length, again.length);
  for (let i = 0; i < findings.length; i += 1) {
    assert.equal(findingDigestOf(findings[i]!), findingDigestOf(again[i]!), `${findings[i]!.claimId}: stable digest`);
  }
});
