/**
 * The check tests (W038, the falsifiability law): PASS, FAIL, and PARTIAL
 * verdicts all pinned — a mangled fixture MUST flip its verdict, and every
 * finding's evidence names its claim's needles.
 *
 * Run: cd packages/verification && ../../../node_modules/.bin/tsx --test test/*.test.ts
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkConstraintDimension,
  checkDeterministicReplay,
  checkEvidenceChain,
  checkHoldoutCoverage,
  checkSearchHistory,
  undeclaredAxisFindings,
} from "../checks.js";
import { declareEvaluationClaims } from "../claims.js";
import { needlesMissing } from "../findings.js";
import type { Finding } from "../findings.js";
import { bundleOf } from "./fixtures.js";
import type { TrajectoryRecord } from "trajectory";
import type { ExperimentManifest } from "experiments";

function claimOf(bundle: ReturnType<typeof bundleOf>, claimId: string) {
  const claims = declareEvaluationClaims(bundle.manifest, bundle.policy);
  const claim = claims.find((entry) => entry.claimId === claimId);
  assert.ok(claim !== undefined);
  return claim;
}

/** The registry's own honesty law: evidence names every needle. */
function assertNeedlesNamed(claim: ReturnType<typeof claimOf>, finding: Finding): void {
  assert.deepEqual(needlesMissing(claim, finding.evidence), []);
}

// --- evidence-chain ----------------------------------------------------------

test("evidence-chain: PASS over real records, needles named", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "evidence-chain");
  const finding = checkEvidenceChain(claim, bundle.records);
  assert.equal(finding.verdict, "PASS");
  assert.equal(finding.findingKind, "declared");
  assert.equal(finding.evidence.length, 2);
  assertNeedlesNamed(claim, finding);
});

test("evidence-chain: a reordered capsule pair MUST flip the verdict to FAIL", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "evidence-chain");
  const mangled: TrajectoryRecord[] = bundle.records.map((record) =>
    record.scope.sessionId === "session-1"
      ? {
          ...record,
          stream: {
            ...record.stream,
            capsules: [record.stream.capsules[1] as never, record.stream.capsules[0] as never],
          },
        }
      : record,
  );
  const finding = checkEvidenceChain(claim, mangled);
  assert.equal(finding.verdict, "FAIL");
  assert.ok(finding.evidence.some((line) => line.includes("pass-out-of-order")));
  assertNeedlesNamed(claim, finding);
});

test("evidence-chain: an empty record set is FAIL, never a silent pass", () => {
  const bundle = bundleOf();
  const finding = checkEvidenceChain(claimOf(bundle, "evidence-chain"), []);
  assert.equal(finding.verdict, "FAIL");
});

// --- deterministic-replay ----------------------------------------------------

test("deterministic-replay: PASS — the twin re-evaluation equals the recorded summary", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "deterministic-replay");
  const finding = checkDeterministicReplay(claim, bundle.records, bundle.policy);
  assert.equal(finding.verdict, "PASS");
  assertNeedlesNamed(claim, finding);
});

test("deterministic-replay: a perturbed outcome summary MUST flip to FAIL", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "deterministic-replay");
  const perturbed: TrajectoryRecord[] = bundle.records.map((record) =>
    record.scope.sessionId === "session-1"
      ? { ...record, evaluation: { ...record.evaluation, combinedScore: record.evaluation.combinedScore + 1 } }
      : record,
  );
  const finding = checkDeterministicReplay(claim, perturbed, bundle.policy);
  assert.equal(finding.verdict, "FAIL");
  assert.ok(finding.evidence.some((line) => line.includes("diverged")));
  assertNeedlesNamed(claim, finding);
});

test("deterministic-replay: missing determinism metadata MUST flip to FAIL", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "deterministic-replay");
  const mangled: TrajectoryRecord[] = bundle.records.map((record) =>
    record.scope.sessionId === "session-2"
      ? { ...record, determinism: { ...record.determinism, seed: "" } }
      : record,
  );
  const finding = checkDeterministicReplay(claim, mangled, bundle.policy);
  assert.equal(finding.verdict, "FAIL");
  assert.ok(finding.evidence.some((line) => line.includes("determinism member 'seed'")));
  assertNeedlesNamed(claim, finding);
});

// --- search-history ----------------------------------------------------------

test("search-history: PARTIAL when the policy does not declare it (disclosed)", () => {
  const bundle = bundleOf(); // no search-history declared
  const claim = claimOf(bundle, "search-history");
  const finding = checkSearchHistory(claim, bundle.manifest, bundle.policy);
  assert.equal(finding.verdict, "PARTIAL");
  assert.ok(finding.evidence[0]?.includes("disclosed limitation"));
  assertNeedlesNamed(claim, finding);
});

test("search-history: PASS when declared by the policy and carried on the manifest", () => {
  const bundle = bundleOf(["evidence-chain", "deterministic-replay", "search-history"]);
  const claim = claimOf(bundle, "search-history");
  const finding = checkSearchHistory(claim, bundle.manifest, bundle.policy);
  assert.equal(finding.verdict, "PASS");
  assertNeedlesNamed(claim, finding);
});

test("search-history: FAIL when declared but NOT carried (broken carry-forward)", () => {
  const bundle = bundleOf(["evidence-chain", "deterministic-replay", "search-history"]);
  const claim = claimOf(bundle, "search-history");
  const broken: ExperimentManifest = { ...bundle.manifest, integrity: ["evidence-chain"] };
  const finding = checkSearchHistory(claim, broken, bundle.policy);
  assert.equal(finding.verdict, "FAIL");
  assert.ok(finding.evidence[0]?.includes("carry-forward law is broken"));
  assertNeedlesNamed(claim, finding);
});

// --- holdout-coverage --------------------------------------------------------

test("holdout-coverage: PASS per declared axis that carries a split", () => {
  const bundle = bundleOf();
  for (const axisId of ["h-1", "h-2"]) {
    const claim = claimOf(bundle, `holdout-coverage:${axisId}`);
    const finding = checkHoldoutCoverage(claim, bundle.manifest);
    assert.equal(finding.verdict, "PASS");
    assertNeedlesNamed(claim, finding);
  }
});

test("holdout-coverage: PARTIAL when a declared axis is never split", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "holdout-coverage:h-2");
  const unsplit: ExperimentManifest = {
    ...bundle.manifest,
    holdoutSplits: bundle.manifest.holdoutSplits.filter((split) => split.axisId === "h-1"),
  };
  const finding = checkHoldoutCoverage(claim, unsplit);
  assert.equal(finding.verdict, "PARTIAL");
  assert.ok(finding.evidence[0]?.includes("never split"));
  assertNeedlesNamed(claim, finding);
});

test("undeclared axes: a split naming an axis the policy never declared is its OWN finding kind", () => {
  const bundle = bundleOf();
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
  const findings = undeclaredAxisFindings(poisoned, bundle.policy);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.findingKind, "undeclared-failure");
  assert.equal(findings[0]?.verdict, "FAIL");
  assert.equal(findings[0]?.claimId, "holdout-coverage:h-9");
  assert.ok(findings[0]?.evidence[0]?.includes("never declared"));
});

// --- constraint-dimension ----------------------------------------------------

test("constraint-dimension: PASS — compliance carried, reward never sole-P&L", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "constraint-dimension");
  const finding = checkConstraintDimension(claim, bundle.evaluation, bundle.records);
  assert.equal(finding.verdict, "PASS");
  assertNeedlesNamed(claim, finding);
});

test("constraint-dimension: a malformed compliance value MUST flip to FAIL", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "constraint-dimension");
  const tampered = {
    ...bundle.evaluation,
    reduction: { ...bundle.evaluation.reduction, compliance: "nonsense" as never },
  };
  const finding = checkConstraintDimension(claim, tampered, bundle.records);
  assert.equal(finding.verdict, "FAIL");
  assert.ok(finding.evidence.some((line) => line.includes("outside the closed set")));
  assertNeedlesNamed(claim, finding);
});

test("constraint-dimension: an all-financial-outcome reward MUST flip to FAIL (§13 in data)", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "constraint-dimension");
  const solePnl: TrajectoryRecord[] = bundle.records.map((record) =>
    record.scope.sessionId === "session-1"
      ? {
          ...record,
          evaluation: {
            ...record.evaluation,
            reward: {
              ...record.evaluation.reward,
              components: [record.evaluation.reward.components[0] as never],
            },
          },
        }
      : record,
  );
  const finding = checkConstraintDimension(claim, bundle.evaluation, solePnl);
  assert.equal(finding.verdict, "FAIL");
  assert.ok(finding.evidence.some((line) => line.includes("raw P&L is the sole objective")));
  assertNeedlesNamed(claim, finding);
});

test("constraint-dimension: a non-finite fold total MUST flip to FAIL", () => {
  const bundle = bundleOf();
  const claim = claimOf(bundle, "constraint-dimension");
  const tampered = {
    ...bundle.evaluation,
    reduction: { ...bundle.evaluation.reduction, combinedScoreTotal: Number.POSITIVE_INFINITY },
  };
  const finding = checkConstraintDimension(claim, tampered, bundle.records);
  assert.equal(finding.verdict, "FAIL");
  assert.ok(finding.evidence.some((line) => line.includes("non-finite")));
});
