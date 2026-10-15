/**
 * The selection walk laws (W042) — the pure walk over the REAL registry,
 * REAL extracted skills, and the REAL catalogue: the happy path, the
 * deterministic rank, and every fail-closed refusal (R052 named).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { deepEqual } from "node:assert/strict";
import { test } from "node:test";
import { selectSubstrate } from "../select.js";
import { benchmarkSurface, extractedSkills, selectionDemand } from "./fixtures.js";
import { SCOPE, SUBSTRATE_MEANREVERSION, SUBSTRATE_MOMENTUM, deprecatedMomentumRegistry, registryFixture, revokedMomentumRegistry } from "./evidence.js";

test("the walk selects the most-measured candidate with the full evidence chain", () => {
  const outcome = selectSubstrate(selectionDemand(), registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const plan = outcome.plan;
  deepEqual(plan.selected.selectedSubstrateId, String(SUBSTRATE_MOMENTUM));
  deepEqual(plan.selected.capabilities.length, 1);
  deepEqual(plan.selected.capabilities[0]!.provenance.length, 2);
  deepEqual(plan.selected.skills.length, 1);
  deepEqual(plan.selected.skills[0]!.trajectoryIds.length, 2);
  deepEqual(plan.selected.evaluations.length, 2);
  deepEqual(plan.selected.benchmarkCoverage.length, 1);
  deepEqual(plan.selected.benchmarkCoverage[0]!.axes.every((axis) => axis.coveredAtomCount === axis.requiredAtomCount), true);
  deepEqual(plan.ranking[0]!.substrateId, String(SUBSTRATE_MOMENTUM));
  deepEqual(plan.ranking[1]!.substrateId, String(SUBSTRATE_MEANREVERSION));
  deepEqual(plan.ranking[0]!.carriedCitations > plan.ranking[1]!.carriedCitations, true);
  deepEqual(plan.rejections.length, 0);
  deepEqual(plan.variants.length, 1);
  deepEqual(plan.variants[0]!.kind, "model-substitution");
  deepEqual(plan.variants[0]!.substituteSubstrateId, String(SUBSTRATE_MEANREVERSION));
  deepEqual(plan.selectionId.startsWith("selection-"), true);
});

test("the matchCapabilityDemand evidence reasons are carried verbatim", () => {
  const outcome = selectSubstrate(selectionDemand(), registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const reasons = outcome.plan.selected.capabilities[0]!.matchReasons;
  deepEqual(reasons.some((reason) => reason.includes("first registered provider in canonical id order")), true);
  deepEqual(reasons.some((reason) => reason.includes("measured provenance")), true);
});

test("R052: a selection citing no measured evidence is REJECTED, the law named", () => {
  const demand = selectionDemand({ position: { ...selectionDemand().position, capabilityDemands: [] } });
  const outcome = selectSubstrate(demand, registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "unmeasured-selection" && entry.message.includes("R052")), true);
});

test("a demand citing an unknown benchmark is a loud error", () => {
  const demand = selectionDemand({ benchmarkPolicy: ["bmk-never-declared"] });
  const outcome = selectSubstrate(demand, registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "unknown-benchmark"), true);
});

test("a requirement incompatibility rejects every candidate loudly (never a silent drop)", () => {
  const base = selectionDemand();
  const demand = selectionDemand({ position: { ...base.position, substrateRequirement: { ...base.position.substrateRequirement, minMaxDecisionsPerView: 9 } } });
  const outcome = selectSubstrate(demand, registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  const noCandidate = outcome.errors.find((entry) => entry.code === "no-eligible-candidate");
  deepEqual(noCandidate !== undefined, true);
  deepEqual(noCandidate!.rejections!.every((entry) => entry.code === "requirement-incompatibility"), true);
  deepEqual(noCandidate!.rejections!.length, 2);
});

test("a deprecated-only provider chain is REFUSED with the W040 lifecycle carried verbatim", () => {
  const demand = selectionDemand({ candidates: [{ ...selectionDemand().candidates[0]! }] });
  const outcome = selectSubstrate(demand, deprecatedMomentumRegistry(), [], benchmarkSurface());
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  const refused = outcome.errors.find((entry) => entry.code === "lifecycle-refused");
  deepEqual(refused !== undefined, true);
  deepEqual(refused!.message.includes("DEPRECATED"), true);
  deepEqual(refused!.message.includes("capability-org-execution"), true);
});

test("a revoked-only provider chain is REFUSED (terminal, carried verbatim)", () => {
  const demand = selectionDemand({ candidates: [{ ...selectionDemand().candidates[0]! }] });
  const outcome = selectSubstrate(demand, revokedMomentumRegistry(), [], benchmarkSurface());
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  const refused = outcome.errors.find((entry) => entry.code === "lifecycle-refused");
  deepEqual(refused !== undefined, true);
  deepEqual(refused!.message.includes("REVOKED"), true);
});

test("an uncovered benchmark axis rejects the candidates on coverage grounds", () => {
  const demand = selectionDemand({ benchmarkPolicy: ["bmk-risk-control-fx-period"] });
  const outcome = selectSubstrate(demand, registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  const noCandidate = outcome.errors.find((entry) => entry.code === "no-eligible-candidate");
  deepEqual(noCandidate !== undefined, true);
  deepEqual(noCandidate!.rejections!.every((entry) => entry.code === "benchmark-coverage-failure"), true);
  deepEqual(noCandidate!.rejections![0]!.message.includes("bmk-risk-control-fx-period"), true);
});

test("a scope mismatch between demand and registry is a loud error", () => {
  const demand = selectionDemand({ scope: { ...SCOPE, tenantId: "tenant-elsewhere" } });
  const outcome = selectSubstrate(demand, registryFixture(), extractedSkills(), benchmarkSurface());
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "scope-mismatch"), true);
});

test("a cited evaluation missing from the surface refuses the selection (fail-closed evidence chain)", () => {
  const surface = benchmarkSurface({ evaluations: [] });
  const outcome = selectSubstrate(selectionDemand(), registryFixture(), extractedSkills(), surface);
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  deepEqual(outcome.errors.some((entry) => entry.code === "unknown-evaluation"), true);
});

test("an invalid catalogue is refused with its own errors carried", () => {
  const real = benchmarkSurface();
  const surface = benchmarkSurface({ catalogue: [...real.catalogue, real.catalogue[0]!] });
  const outcome = selectSubstrate(selectionDemand(), registryFixture(), extractedSkills(), surface);
  deepEqual(outcome.ok, false);
  if (outcome.ok) {
    return;
  }
  const invalid = outcome.errors.find((entry) => entry.code === "catalogue-invalid");
  deepEqual(invalid !== undefined, true);
  deepEqual(invalid!.catalogueErrors!.some((entry) => entry.code === "duplicate-benchmark"), true);
});
