/**
 * The assembled harness (W038) — one entry running every check over one
 * experiment evaluation into the deterministic, content-addressed findings
 * report.
 *
 * The order of operations is the W022 law itself: the claims are DECLARED
 * first (the registry, from the manifest + the policy), then the checks run
 * (the trial), then the findings assemble (the verdict record) — declared
 * findings in registry order, undeclared failures after them, the digest
 * over the subject + the ordered findings. Pure and deterministic (A9): no
 * wall clocks, no randomness, no env reads — the same inputs always yield
 * the deep-equal report and the same digest.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvaluationPolicy } from "learning-objectives";
import type { TrajectoryRecord } from "trajectory";
import type { ExperimentManifest } from "experiments";
import type { ExperimentEvaluation } from "evaluation";
import { declareEvaluationClaims } from "./claims.js";
import { assembleFindingsReport } from "./findings.js";
import type { Finding, FindingsReport } from "./findings.js";
import {
  checkConstraintDimension,
  checkDeterministicReplay,
  checkEvidenceChain,
  checkHoldoutCoverage,
  checkSearchHistory,
  undeclaredAxisFindings,
} from "./checks.js";

/** The harness input: one walked experiment + its inputs. */
export interface VerificationInput {
  readonly manifest: ExperimentManifest;
  readonly records: readonly TrajectoryRecord[];
  readonly policy: EvaluationPolicy;
  /** The experiment evaluation (the W038 walker's output over these inputs). */
  readonly evaluation: ExperimentEvaluation;
}

/**
 * Run the whole harness over one experiment evaluation: declare the claims
 * (the registry — integrity requirements, holdout axes, the §13 laws), run
 * every check (adversarial data in, typed verdicts out), surface undeclared
 * axes as their own finding kind, and assemble the content-addressed
 * findings report. A FAIL verdict is a VALID outcome — the harness working.
 */
export function verifyExperimentEvaluation(input: VerificationInput): FindingsReport {
  const claims = declareEvaluationClaims(input.manifest, input.policy);
  const declared: Finding[] = [];
  for (const claim of claims) {
    switch (claim.kind) {
      case "evidence-chain":
        declared.push(checkEvidenceChain(claim, input.records));
        break;
      case "deterministic-replay":
        declared.push(checkDeterministicReplay(claim, input.records, input.policy));
        break;
      case "search-history":
        declared.push(checkSearchHistory(claim, input.manifest, input.policy));
        break;
      case "holdout-coverage":
        declared.push(checkHoldoutCoverage(claim, input.manifest));
        break;
      case "constraint-dimension":
        declared.push(checkConstraintDimension(claim, input.evaluation, input.records));
        break;
    }
  }
  const undeclared = undeclaredAxisFindings(input.manifest, input.policy);
  return assembleFindingsReport(
    String(input.evaluation.evaluationId),
    claims,
    declared,
    undeclared,
  );
}
