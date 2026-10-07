/**
 * The honesty check tests (W022): the seven declared-limitation and
 * structural-honesty claims hold — holes detected and declared, no silent
 * sorts, derived ranges, disclosures intact, acquisition honest, A9
 * double-map determinism.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyHonestyClaims } from "../honestyChecks.js";
import { harnessCatalog } from "../index.js";

const findings = verifyHonestyClaims(harnessCatalog());

test("seven honesty findings are emitted, all PASS", () => {
  assert.deepEqual(
    findings.map((f) => f.claimId),
    [
      "unmappable-dtype-declaration",
      "bar-hole-detection",
      "ascending-order-never-resorted",
      "derived-range-never-claimed",
      "known-gap-declaration-honesty",
      "acquisition-honesty",
      "a9-double-map-determinism",
    ],
  );
  for (const finding of findings) {
    assert.equal(finding.verdict, "PASS", `${finding.claimId}: PASS`);
    for (const verdict of finding.cases) {
      assert.equal(verdict.problem, undefined, `${finding.claimId}/${verdict.caseId}: held`);
    }
  }
});

test("the unmappable claim refuses a well-formed delta row BY DECLARATION", () => {
  const finding = findings[0]!;
  const refusal = finding.cases.find((c) => c.caseId === "well-formed-delta-row-still-refused");
  assert.ok(refusal);
  assert.match(refusal.observed, /unmappable-dtype/);
  assert.match(refusal.observed, /reconstructing/);
});

test("the hole-detection claim carries the exact declared gap bounds and the contradiction case", () => {
  const finding = findings[1]!;
  const detected = finding.cases.find((c) => c.caseId === "hole-detected-and-declared");
  assert.ok(detected);
  assert.match(finding.claim, /sequence hole/);
  const contradiction = finding.cases.find((c) => c.caseId === "record-inside-declared-gap-is-contradiction");
  assert.ok(contradiction);
  assert.match(contradiction.observed, /record-in-declared-gap/);
});

test("the never-resorted claim proves the descending batch maps verbatim and the W020 rejects it", () => {
  const finding = findings[2]!;
  const kept = finding.cases.find((c) => c.caseId === "descending-batch-maps-in-input-order");
  assert.ok(kept);
  assert.match(kept.observed, /closeTime":1700448180000/);
  const rejected = finding.cases.find((c) => c.caseId === "descending-import-rejected-loudly");
  assert.ok(rejected);
  assert.match(rejected.observed, /out-of-order-records/);
});

test("the disclosure claim keeps all six disclosed limitations under watch", () => {
  const finding = findings[4]!;
  assert.equal(finding.cases.length, 6);
  const ids = finding.cases.map((c) => c.caseId);
  assert.deepEqual(ids, [
    "discloses-sub-ms-truncation",
    "discloses-int64-json-rounding",
    "discloses-quote-no-last",
    "discloses-irregular-aggregation",
    "discloses-unmappable-deltas",
    "discloses-no-parquet-io",
  ]);
});

test("the acquisition claim invalidates a tampered parquetCatalog claim BY LAW", () => {
  const finding = findings[5]!;
  const tampered = finding.cases.find((c) => c.caseId === "catalog-claiming-parquet-is-invalid");
  assert.ok(tampered);
  assert.match(tampered.observed, /invalid-catalog/);
  assert.match(tampered.observed, /not-implemented/);
});
