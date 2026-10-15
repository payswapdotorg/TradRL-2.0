/**
 * The whole-record re-validation laws (W046) — re-proving a sealed
 * curriculum from its own recorded data alone (the W045
 * `validatePopulation` precedent): identity, canonical orders, schedule
 * laws, lineage cross-laws, provenance laws — every tamper collected.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { advanceStage } from "../progression.js";
import { validateCurriculum } from "../validate.js";
import type { CurriculumValidationOutcome } from "../validate.js";
import { canonicalCurriculum, canonicalEvidence, thaw } from "./fixtures.js";

function violationsOf(proof: CurriculumValidationOutcome) {
  if (proof.ok) {
    assert.fail(`expected violations, got ${proof.checked.join(", ")}`);
  }
  return proof.errors;
}

test("a valid founding curriculum re-proves with the full checked surface", () => {
  const { curriculum } = canonicalCurriculum();
  const proof = validateCurriculum(curriculum);
  assert.equal(proof.ok, true);
  assert.deepEqual(proof.checked, ["identity", "scope", "stages", "difficulty", "threshold", "active-stage", "lineage", "provenance"]);
});

test("an advanced curriculum re-proves too (the gate's output is a real record)", () => {
  const { curriculum } = canonicalCurriculum();
  const advanced = advanceStage(curriculum, canonicalEvidence());
  assert.equal(advanced.ok, true);
  const proof = validateCurriculum(advanced.curriculum);
  assert.equal(proof.ok, true);
});

test("a wrong kind is refused", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.kind = "not-a-curriculum" as never;
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "invalid-kind"));
});

test("a blank scope member is refused", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.scope.worldId = "";
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "invalid-scope"));
});

test("a tampered id is refused as an identity mismatch", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.curriculumId = "curr-0000000000000000" as never;
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "identity-mismatch"));
});

test("an out-of-range active stage is refused", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.activeStage = 2;
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "active-stage-invalid"));
});

test("a rewritten lineage that disagrees with the schedule is refused", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.lineage = { parentCurriculumId: null, generation: 0, origin: { kind: "stage-advance", fromStage: 0, toStage: 1 } };
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "lineage-invalid"));
});

test("an advanced record whose origin disagrees with its active stage is refused", () => {
  const { curriculum } = canonicalCurriculum();
  const advanced = advanceStage(curriculum, canonicalEvidence());
  if (!advanced.ok) {
    assert.fail("expected an unsealed stage");
  }
  const tampered = thaw(advanced.curriculum);
  tampered.lineage = { ...tampered.lineage, origin: { kind: "stage-advance", fromStage: 1, toStage: 2 } };
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "lineage-invalid" && entry.message.includes("cannot disagree")));
});

test("a founding record that records gate evidence is refused", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.provenance.gateEvidenceDigest = "digest-that-does-not-belong";
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "invalid-provenance"));
});

test("an advanced record without its gate-evidence digest is refused", () => {
  const { curriculum } = canonicalCurriculum();
  const advanced = advanceStage(curriculum, canonicalEvidence());
  if (!advanced.ok) {
    assert.fail("expected an unsealed stage");
  }
  const tampered = thaw(advanced.curriculum);
  tampered.provenance.gateEvidenceDigest = null;
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "invalid-provenance"));
});

test("re-ordered stages and requirements are refused as canonical-order violations", () => {
  const { curriculum } = canonicalCurriculum();
  const swapped = thaw(curriculum);
  swapped.stages = [swapped.stages[1]!, swapped.stages[0]!];
  const proof = validateCurriculum(swapped);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "canonical-order"));
});

test("a bare-P&L threshold smuggled into a sealed record is caught at re-validation (§13)", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.stages[0]!.threshold.requirements = [{ kind: "combined-score", min: 1 }];
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  const refusal = violationsOf(proof).find((entry) => entry.code === "bare-pnl-gate");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /Raw P&L is never the sole objective/);
});

test("an evidence-less threshold smuggled into a sealed record is caught at re-validation (R052)", () => {
  const { curriculum } = canonicalCurriculum();
  const tampered = thaw(curriculum);
  tampered.stages[0]!.threshold.citation.evaluationId = "   ";
  const proof = validateCurriculum(tampered);
  assert.ok(!proof.ok);
  assert.ok(violationsOf(proof).some((entry) => entry.code === "threshold-evidence-less"));
});
