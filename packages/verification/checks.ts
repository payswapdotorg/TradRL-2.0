/**
 * The checks (W038, the W022 falsifiable-verification pattern) — adversarial
 * fixtures in, typed verdicts out: `{ claim, verdict: PASS | FAIL | PARTIAL,
 * evidence }`. A **FAIL** is a valid outcome (the harness working, not
 * failing); a **PARTIAL** means the claim held within its declared scope and
 * the limitation is disclosed in the evidence.
 *
 * The checks re-prove every law FROM DATA (the W037/W038 constructor gates
 * are never trusted — the harness walks assembled manifests, records, and
 * evaluations exactly as the W022 harness walks assembled replays):
 * - evidence-chain (§10): every record's stream validates capsule-by-capsule
 *   and every citation resolves (the stream digest + view digest are present);
 * - deterministic-replay (A9): the determinism metadata is present and the
 *   TWIN re-evaluation (the policy re-run over the record's own stream) is
 *   deep-equal to the recorded outcome summary — compared by canonical bytes;
 * - search-history (§13): declared by the policy and carried on the manifest;
 *   undeclared ⇒ PARTIAL with the limitation disclosed;
 * - holdout-coverage (§13): every DECLARED axis carries a split; a declared
 *   axis without a split ⇒ PARTIAL (its evaluation surface is absent);
 * - constraint-dimension (§13): the evaluation carries the compliance
 *   dimension in data (compliance closed-set, counts integral/finite) and no
 *   record's reward is all financial-outcome components — raw P&L is never
 *   the sole objective;
 * - undeclared axes: manifest splits naming axes the policy never declared
 *   surface as their OWN finding kind (undeclared-failure), never swallowed.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { REWARD_COMPONENT_FAMILY, validateEvidenceStream } from "learning-objectives";
import type { EvaluationPolicy } from "learning-objectives";
import { canonicalString } from "trajectory";
import type { TrajectoryRecord } from "trajectory";
import type { ExperimentManifest } from "experiments";
import type { ExperimentEvaluation } from "evaluation";
import type { VerificationClaimDescriptor } from "./claims.js";
import type { Finding } from "./findings.js";

const COMPLIANCE_VALUES: readonly string[] = ["compliant", "non-compliant"];
const DETERMINISM_MEMBERS = ["worldDefinitionDigest", "engineVersion", "seed"] as const;

/** Canonical record order for every check (deterministic evidence lines). */
function orderedRecords(records: readonly TrajectoryRecord[]): TrajectoryRecord[] {
  return [...records].sort((left, right) =>
    String(left.trajectoryId).localeCompare(String(right.trajectoryId)),
  );
}

function finding(
  claim: VerificationClaimDescriptor,
  verdict: Finding["verdict"],
  evidence: readonly string[],
): Finding {
  return {
    claimId: claim.claimId,
    claimKind: claim.kind,
    findingKind: "declared",
    verdict,
    evidence,
  };
}

// ---------------------------------------------------------------------------
// evidence-chain (§10: every capsule validates, citations resolve)
// ---------------------------------------------------------------------------

export function checkEvidenceChain(
  claim: VerificationClaimDescriptor,
  records: readonly TrajectoryRecord[],
): Finding {
  if (records.length === 0) {
    return finding(claim, "FAIL", [
      "record set empty — the evidence-chain claim is unverifiable over nothing (fail-closed)",
    ]);
  }
  const evidence: string[] = [];
  let failed = false;
  for (const record of orderedRecords(records)) {
    const id = String(record.trajectoryId);
    const validation = validateEvidenceStream(record.stream);
    if (!validation.ok) {
      failed = true;
      for (const error of validation.errors) {
        evidence.push(
          `record ${id} capsule ${String(error.capsuleIndex ?? "-")}: ${error.code} — ${error.message}`,
        );
      }
      continue;
    }
    const unresolved = record.stream.capsules.filter(
      (capsule) =>
        String(capsule.pass.streamDigest).trim().length === 0 ||
        String(capsule.pass.observation.viewDigest).trim().length === 0,
    );
    if (unresolved.length > 0) {
      failed = true;
      evidence.push(
        `record ${id}: ${String(unresolved.length)} capsule citation(s) do not resolve (blank stream/view digest)`,
      );
      continue;
    }
    evidence.push(
      `record ${id}: ${String(record.stream.capsules.length)} capsule(s) validated, citations resolve`,
    );
  }
  return finding(claim, failed ? "FAIL" : "PASS", evidence);
}

// ---------------------------------------------------------------------------
// deterministic-replay (A9: metadata present + twin re-evaluation equality)
// ---------------------------------------------------------------------------

export function checkDeterministicReplay(
  claim: VerificationClaimDescriptor,
  records: readonly TrajectoryRecord[],
  policy: EvaluationPolicy,
): Finding {
  if (records.length === 0) {
    return finding(claim, "FAIL", [
      "record set empty — the deterministic-replay claim is unverifiable over nothing (fail-closed)",
    ]);
  }
  const evidence: string[] = [];
  let failed = false;
  for (const record of orderedRecords(records)) {
    const id = String(record.trajectoryId);
    for (const member of DETERMINISM_MEMBERS) {
      if (String(record.determinism[member]).trim().length === 0) {
        failed = true;
        evidence.push(
          `record ${id}: determinism member '${member}' missing or blank — A9 reproducibility is data, never a default`,
        );
      }
    }
    const twin = policy.evaluate(record.stream);
    if (!twin.ok) {
      failed = true;
      evidence.push(
        `record ${id}: twin re-evaluation failed closed (${String(twin.errors.length)} policy error(s): ${twin.errors
          .map((error) => error.code)
          .join(", ")})`,
      );
      continue;
    }
    if (canonicalString(twin.evaluation) !== canonicalString(record.evaluation)) {
      failed = true;
      evidence.push(
        `record ${id}: twin re-evaluation diverged from the recorded outcome summary (canonical bytes differ) — A9 broken in data`,
      );
      continue;
    }
    evidence.push(
      `record ${id}: determinism present (engine ${record.determinism.engineVersion}, seed ${record.determinism.seed}); twin re-evaluation equal by canonical bytes`,
    );
  }
  return finding(claim, failed ? "FAIL" : "PASS", evidence);
}

// ---------------------------------------------------------------------------
// search-history (§13: declared, carried)
// ---------------------------------------------------------------------------

export function checkSearchHistory(
  claim: VerificationClaimDescriptor,
  manifest: ExperimentManifest,
  policy: EvaluationPolicy,
): Finding {
  const declared = policy.descriptor.axes.integrity.includes("search-history");
  const carried = manifest.integrity.includes("search-history");
  if (declared && carried) {
    return finding(claim, "PASS", [
      `search-history declaration carried on the manifest (policy '${policy.descriptor.policyId}' integrity: ${policy.descriptor.axes.integrity.join(", ")})`,
    ]);
  }
  if (declared && !carried) {
    return finding(claim, "FAIL", [
      `search-history declaration present on policy '${policy.descriptor.policyId}' but NOT carried on the manifest [${manifest.integrity.join(", ")}] — the W037 carry-forward law is broken in data`,
    ]);
  }
  return finding(claim, "PARTIAL", [
    `search-history declaration absent — policy '${policy.descriptor.policyId}' does not declare the §13 search-history integrity requirement (disclosed limitation: the claim is unverifiable over undeclared data; the manifest carries [${manifest.integrity.join(", ")}])`,
  ]);
}

// ---------------------------------------------------------------------------
// holdout-coverage (§13 axes: every declared axis is split)
// ---------------------------------------------------------------------------

export function checkHoldoutCoverage(
  claim: VerificationClaimDescriptor,
  manifest: ExperimentManifest,
): Finding {
  const axisId = claim.axisId ?? "";
  const split = manifest.holdoutSplits.find((entry) => entry.axisId === axisId);
  if (split === undefined) {
    return finding(claim, "PARTIAL", [
      `axis ${axisId} declared but never split — the manifest carries no holdout split for this axis (disclosed limitation: the §13 axis's evaluation surface is absent)`,
    ]);
  }
  return finding(claim, "PASS", [
    `axis ${axisId} split: kind ${String(split.kind)}, train ${String(split.train.length)} atom(s), evaluation ${String(split.evaluation.length)} atom(s) (declarative data, compared as data — never computed statistics)`,
  ]);
}

/**
 * The undeclared-axis scan: manifest splits naming holdout axes the policy
 * NEVER declared surface as their OWN finding kind (`undeclared-failure`)
 * — a check may not fail in a way its declaration does not anticipate, and
 * the harness never swallows an axis the registry never saw.
 */
export function undeclaredAxisFindings(
  manifest: ExperimentManifest,
  policy: EvaluationPolicy,
): readonly Finding[] {
  const declared = new Set(policy.descriptor.axes.holdouts.map((axis) => axis.axisId));
  return manifest.holdoutSplits
    .filter((split) => !declared.has(split.axisId))
    .sort((left, right) => left.axisId.localeCompare(right.axisId))
    .map((split) => ({
      claimId: `holdout-coverage:${split.axisId}`,
      claimKind: "holdout-coverage" as const,
      findingKind: "undeclared-failure" as const,
      verdict: "FAIL" as const,
      evidence: [
        `split names axis '${split.axisId}' (kind ${String(split.kind)}) which the evaluation policy never declared — undeclared axes surface as findings (splits never invent axes)`,
      ],
    }));
}

// ---------------------------------------------------------------------------
// constraint-dimension (§13: raw P&L is never the sole objective)
// ---------------------------------------------------------------------------

export function checkConstraintDimension(
  claim: VerificationClaimDescriptor,
  evaluation: ExperimentEvaluation,
  records: readonly TrajectoryRecord[],
): Finding {
  const evidence: string[] = [];
  let failed = false;
  const reduction = evaluation.reduction;
  if (!COMPLIANCE_VALUES.includes(String(reduction.compliance))) {
    failed = true;
    evidence.push(
      `reduction compliance '${String(reduction.compliance)}' is outside the closed set (${COMPLIANCE_VALUES.join(", ")}) — the compliance dimension is malformed in data`,
    );
  }
  if (!Number.isInteger(reduction.hardViolationCount) || reduction.hardViolationCount < 0) {
    failed = true;
    evidence.push(
      `reduction hardViolationCount ${String(reduction.hardViolationCount)} is not a non-negative integer — the constraint dimension is malformed in data`,
    );
  }
  if (!Number.isFinite(reduction.appliedSoftPenaltyTotal) || !Number.isFinite(reduction.combinedScoreTotal)) {
    failed = true;
    evidence.push(
      `reduction fold totals are non-finite (combined ${String(reduction.combinedScoreTotal)}, penalties ${String(reduction.appliedSoftPenaltyTotal)}) — never a silent clamp`,
    );
  }
  for (const summary of evaluation.trajectories) {
    if (!COMPLIANCE_VALUES.includes(String(summary.compliance))) {
      failed = true;
      evidence.push(
        `trajectory ${String(summary.trajectoryId)} compliance '${String(summary.compliance)}' is outside the closed set — a summary without the constraint dimension is a bare score (§13 breach)`,
      );
    }
  }
  for (const record of orderedRecords(records)) {
    const kinds = record.evaluation.reward.components.map((component) => component.kind);
    const nonFinancial = kinds.filter((kind) => REWARD_COMPONENT_FAMILY[kind] !== "financial-outcome");
    if (nonFinancial.length === 0) {
      failed = true;
      evidence.push(
        `record ${String(record.trajectoryId)}: reward components [${kinds.join(", ")}] are all financial-outcome — raw P&L is the sole objective (§13 breach in data)`,
      );
    } else {
      evidence.push(
        `record ${String(record.trajectoryId)}: reward components [${kinds.join(", ")}] include ${String(nonFinancial.length)} non-financial-outcome component(s)`,
      );
    }
  }
  if (!failed) {
    evidence.push(
      `compliance '${reduction.compliance}' over ${String(reduction.trajectoryCount)} trajectory summaries, each carrying the constraint dimension (hard violations gate, soft penalties fold — never a bare P&L)`,
    );
  } else {
    evidence.push(
      `compliance '${String(reduction.compliance)}' over ${String(reduction.trajectoryCount)} trajectory summaries — the §13 compliance dimension could not be certified (a bare P&L verdict is refused)`,
    );
  }
  return finding(claim, failed ? "FAIL" : "PASS", evidence);
}
