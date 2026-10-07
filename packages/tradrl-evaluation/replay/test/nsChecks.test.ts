/**
 * The ns-convention check tests (W022): the three timestamp claims hold
 * against the real adapter, with the expected verdict semantics (the
 * truncation and int64 claims are honestly PARTIAL — scoped by their
 * disclosed limitations).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyNsConventions } from "../nsChecks.js";
import { harnessCatalog } from "../index.js";

const findings = verifyNsConventions(harnessCatalog());
const byId = new Map(findings.map((finding) => [finding.claimId, finding]));

test("three ns findings are emitted (truncation, window, carriers)", () => {
  assert.deepEqual(
    findings.map((f) => f.claimId),
    ["ns-to-ms-exact-digit-truncation", "ns-sanity-window-1990-2100", "int64-carrier-fidelity"],
  );
});

test("the truncation claim is PARTIAL: exact-digit truncation held, the sub-ms loss is disclosed", () => {
  const finding = byId.get("ns-to-ms-exact-digit-truncation");
  assert.ok(finding);
  assert.equal(finding.verdict, "PARTIAL");
  assert.match(finding.limitation ?? "", /sub-millisecond precision is TRUNCATED/);
  const held = finding.cases.map((c) => c.caseId);
  assert.deepEqual(held, [
    "trunc-sub-ms-remainder-dropped",
    "trunc-max-remainder-still-drops",
    "trunc-numeric-carrier-exact",
    "limitation-disclosed",
  ]);
  for (const verdict of finding.cases) {
    assert.equal(verdict.problem, undefined, `${verdict.caseId}: held`);
  }
});

test("the sanity-window claim PASSES: unit swaps rejected loudly, window edges map", () => {
  const finding = byId.get("ns-sanity-window-1990-2100");
  assert.ok(finding);
  assert.equal(finding.verdict, "PASS");
  assert.equal(finding.cases.length, 11);
  for (const verdict of finding.cases) {
    assert.equal(verdict.problem, undefined, `${verdict.caseId}: held`);
  }
});

test("the int64 carrier claim is PARTIAL: full-fidelity strings held, the JSON-rounding reality is disclosed", () => {
  const finding = byId.get("int64-carrier-fidelity");
  assert.ok(finding);
  assert.equal(finding.verdict, "PARTIAL");
  assert.match(finding.limitation ?? "", /safe-integer range/);
  assert.match(finding.limitation ?? "", /undetectable/);
  for (const verdict of finding.cases) {
    assert.equal(verdict.problem, undefined, `${verdict.caseId}: held`);
  }
});

test("the unit-swap rejections name the sanity window and the raw value in the evidence", () => {
  const finding = byId.get("ns-sanity-window-1990-2100");
  assert.ok(finding);
  const msCase = finding.cases.find((c) => c.caseId === "window-reject-ms-in-ns");
  assert.ok(msCase);
  assert.match(msCase.observed, /timestamp-out-of-range/);
  assert.match(msCase.observed, /sanity window/);
});
