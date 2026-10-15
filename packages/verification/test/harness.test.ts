/**
 * The harness tests (W038): the assembled findings report — coverage,
 * ordering, counts, the A9 twin determinism, and the falsifiability law
 * (adversarial fixtures flip verdicts and the digest).
 *
 * Run: cd packages/verification && ../../../node_modules/.bin/tsx --test test/*.test.ts
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyExperimentEvaluation } from "../harness.js";
import { declareEvaluationClaims } from "../claims.js";
import { needlesMissing } from "../findings.js";
import { bundleOf } from "./fixtures.js";
import type { TrajectoryRecord } from "trajectory";
import type { ExperimentManifest } from "experiments";
import type { VerificationInput } from "../harness.js";

test("the report answers every declared claim, in registry order", () => {
  const bundle = bundleOf();
  const report = verifyExperimentEvaluation(bundle);
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  assert.equal(report.claimCount, claims.length);
  assert.equal(report.findings.length, claims.length);
  const declared = report.findings.filter((finding) => finding.findingKind === "declared");
  assert.deepEqual(
    declared.map((finding) => finding.claimId),
    claims.map((claim) => claim.claimId),
  );
});

test("the good bundle: PASS everywhere except the disclosed search-history PARTIAL", () => {
  const bundle = bundleOf();
  const report = verifyExperimentEvaluation(bundle);
  assert.equal(report.passCount, 5); // evidence-chain, deterministic-replay, h-1, h-2, constraint-dimension
  assert.equal(report.partialCount, 1); // search-history (undeclared by the fixture policy)
  assert.equal(report.failCount, 0);
  assert.equal(report.undeclaredCount, 0);
  const partial = report.findings.find((finding) => finding.verdict === "PARTIAL");
  assert.equal(partial?.claimId, "search-history");
});

test("every finding's evidence names its claim's needles (the registry law)", () => {
  const bundle = bundleOf();
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  const report = verifyExperimentEvaluation(bundle);
  for (const finding of report.findings) {
    if (finding.findingKind !== "declared") {
      continue; // undeclared failures answer no registered claim
    }
    const claim = claims.find((entry) => entry.claimId === finding.claimId);
    assert.ok(claim !== undefined);
    assert.deepEqual(needlesMissing(claim, finding.evidence), []);
  }
});

test("A9 twin: the same inputs yield the deep-equal report and the same digest", () => {
  const first = verifyExperimentEvaluation(bundleOf());
  const second = verifyExperimentEvaluation(bundleOf());
  assert.deepEqual(first, second);
  assert.equal(first.digest, second.digest);
  assert.ok(first.digest.length > 0);
});

test("the subject is the experiment evaluation's content-addressed id", () => {
  const bundle = bundleOf();
  const report = verifyExperimentEvaluation(bundle);
  assert.equal(report.subject, String(bundle.evaluation.evaluationId));
});

test("falsifiability: a perturbed record flips verdicts AND the digest", () => {
  const bundle = bundleOf();
  const clean = verifyExperimentEvaluation(bundle);
  const perturbedInput: VerificationInput = {
    ...bundle,
    records: bundle.records.map((record: TrajectoryRecord) =>
      record.scope.sessionId === "session-1"
        ? { ...record, evaluation: { ...record.evaluation, combinedScore: record.evaluation.combinedScore + 1 } }
        : record,
    ),
  };
  const perturbed = verifyExperimentEvaluation(perturbedInput);
  assert.notEqual(perturbed.digest, clean.digest);
  const replay = perturbed.findings.find((finding) => finding.claimId === "deterministic-replay");
  assert.equal(replay?.verdict, "FAIL");
  assert.equal(perturbed.failCount, 1);
});

test("falsifiability: an undeclared axis surfaces as its own finding kind and flips the digest", () => {
  const bundle = bundleOf();
  const clean = verifyExperimentEvaluation(bundle);
  const poisoned: ExperimentManifest = {
    ...bundle.manifest,
    holdoutSplits: [
      ...bundle.manifest.holdoutSplits,
      {
        axisId: "h-9",
        kind: "venue",
        train: [{ kind: "venue", venueId: "a" }],
        evaluation: [{ kind: "venue", venueId: "b" }],
      },
    ],
  };
  const report = verifyExperimentEvaluation({ ...bundle, manifest: poisoned });
  assert.notEqual(report.digest, clean.digest);
  assert.equal(report.undeclaredCount, 1);
  const undeclared = report.findings.filter((finding) => finding.findingKind === "undeclared-failure");
  assert.equal(undeclared.length, 1);
  assert.equal(undeclared[0]?.claimId, "holdout-coverage:h-9");
  // Undeclared findings come AFTER every declared finding.
  assert.equal(report.findings[report.findings.length - 1]?.claimId, "holdout-coverage:h-9");
});

test("falsifiability: a reordered capsule stream flips evidence-chain AND deterministic-replay to FAIL", () => {
  const bundle = bundleOf();
  const mangled: VerificationInput = {
    ...bundle,
    records: bundle.records.map((record: TrajectoryRecord) =>
      record.scope.sessionId === "session-2"
        ? {
            ...record,
            stream: {
              ...record.stream,
              capsules: [record.stream.capsules[1] as never, record.stream.capsules[0] as never],
            },
          }
        : record,
    ),
  };
  const report = verifyExperimentEvaluation(mangled);
  const evidenceChain = report.findings.find((finding) => finding.claimId === "evidence-chain");
  const replay = report.findings.find((finding) => finding.claimId === "deterministic-replay");
  assert.equal(evidenceChain?.verdict, "FAIL");
  assert.equal(replay?.verdict, "FAIL");
  assert.equal(report.failCount, 2);
});

test("a search-history-declaring policy turns the PARTIAL into a PASS", () => {
  const bundle = bundleOf(["evidence-chain", "deterministic-replay", "search-history"]);
  const report = verifyExperimentEvaluation(bundle);
  assert.equal(report.partialCount, 0);
  assert.equal(report.passCount, 6);
  assert.equal(report.failCount, 0);
});

test("the report is frozen data (findings never mutate after assembly)", () => {
  const bundle = bundleOf();
  const report = verifyExperimentEvaluation(bundle);
  assert.throws(() => {
    "use strict";
    (report as unknown as { failCount: number }).failCount = 99;
  });
});
