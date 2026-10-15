/**
 * Shared deterministic fixtures for the W042 model-selection tests: the
 * REAL benchmark catalogue (imported from benchmarks/model-capability —
 * no shims, the no-shim law), the REAL W040 registry + W041 extracted
 * skills (through their own gates), the REAL W033 candidate substrates,
 * and the default selection demand + benchmark surface.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { CognitiveSubstrateDescriptor } from "cognitive-substrate";
import { extractSkills } from "skills";
import type { SkillRecord } from "skills";
import type { RegisteredSubstrate } from "organization-compiler";
import type { OrganizationInstrumentRef } from "organization";
import type { BenchmarkSurface, SelectionDemand } from "../demand.js";
import { MODEL_CAPABILITY_BENCHMARKS } from "../../../benchmarks/model-capability/model-capability-benchmarks.js";
import { ORG_CAP_EXECUTION, SCOPE, SUBSTRATE_MEANREVERSION, SUBSTRATE_MOMENTUM, registryFixture, surfaceEvaluations } from "./evidence.js";
import { fixtureTrajectories } from "./trajectory.js";

export const EXECUTION_BENCHMARK = "bmk-execution-quality-futures-holdout";
export const UNCOVERED_BENCHMARK = "bmk-risk-control-fx-period";
export const INSTRUMENT_SEL = "instrument-selection-es" as OrganizationInstrumentRef;

/** The momentum substrate — the fixture skill's bearer (a REAL W033 descriptor). */
export function momentumSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: String(SUBSTRATE_MOMENTUM) as CognitiveSubstrateDescriptor["substrateId"],
    displayName: "selection fixture momentum mind",
    stateMode: "declared-state",
    seed: "selection-momentum-seed",
    decisionRate: { maxDecisionsPerView: 2, minViewIntervalMs: 1000 },
    commandKinds: ["submit-order", "cancel-order", "close-position"],
    ...overrides,
  };
}

/** The mean-reversion substrate — registered, measured once, no skill. */
export function meanReversionSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: String(SUBSTRATE_MEANREVERSION) as CognitiveSubstrateDescriptor["substrateId"],
    displayName: "selection fixture mean-reversion mind",
    stateMode: "declared-state",
    seed: "selection-mean-reversion-seed",
    decisionRate: { maxDecisionsPerView: 4, minViewIntervalMs: 500 },
    commandKinds: ["submit-order", "cancel-order", "close-position"],
    ...overrides,
  };
}

/** The registered candidates (the W039 compiler-registry shape). */
export function candidateSubstrates(): readonly RegisteredSubstrate[] {
  return [
    { substrate: momentumSubstrate(), providesCapabilities: [ORG_CAP_EXECUTION] },
    { substrate: meanReversionSubstrate(), providesCapabilities: [ORG_CAP_EXECUTION] },
  ];
}

/** The REAL extracted skill records (the momentum substrate's measured execution quality). */
export function extractedSkills(): SkillRecord[] {
  const outcome = extractSkills(fixtureTrajectories(), registryFixture());
  if (!outcome.ok) {
    throw new Error(`selection fixture extraction failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return [...outcome.run.skills];
}

/** The default benchmark surface: the REAL catalogue + the cited evaluations. */
export function benchmarkSurface(
  overrides: Partial<BenchmarkSurface> = {},
): BenchmarkSurface {
  return {
    catalogue: [...MODEL_CAPABILITY_BENCHMARKS],
    evaluations: [...surfaceEvaluations()],
    ...overrides,
  };
}

/** The default selection demand: the execution seat, benchmark-justified. */
export function selectionDemand(
  overrides: Partial<SelectionDemand> = {},
): SelectionDemand {
  return {
    scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId },
    position: {
      title: "execution seat",
      bodyRequirement: {
        commandKinds: ["submit-order", "cancel-order", "close-position"],
        instruments: [INSTRUMENT_SEL],
        observations: ["market-quote", "own-portfolio"],
      },
      substrateRequirement: {
        stateMode: "declared-state",
        minMaxDecisionsPerView: 2,
        commandKinds: ["submit-order", "cancel-order", "close-position"],
      },
      capabilityDemands: [{ capabilityId: ORG_CAP_EXECUTION, rationale: "the seat's fills must be measured execution quality" }],
    },
    capabilities: [{ capabilityId: ORG_CAP_EXECUTION, name: "execution" }],
    benchmarkPolicy: [EXECUTION_BENCHMARK],
    candidates: [...candidateSubstrates()],
    ...overrides,
  };
}
