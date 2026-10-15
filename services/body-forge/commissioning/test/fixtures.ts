/**
 * Shared deterministic fixtures for the W043 commissioning tests — the
 * REAL W041 forged plan (through the forge's own `forgeBody` gate over
 * the REAL extracted skills + registry), the REAL W042 selection (through
 * `selectSubstrate` over the REAL benchmark catalogue + registry), and
 * the combined commissioning input. ADAPTED from the W041 body-forge and
 * W042 model-selection test fixtures (disclosed in-header per file).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { BodyDescriptor } from "agent-body";
import type { CognitiveSubstrateDescriptor } from "cognitive-substrate";
import type { PossessionGrant, PossessionPrincipalId } from "possession";
import { extractSkills } from "skills";
import type { SkillRecord } from "skills";
import { selectSubstrate } from "../../../model-selection/index.js";
import type { SelectionPlan } from "../../../model-selection/index.js";
import type { BenchmarkSurface, SelectionDemand } from "../../../model-selection/index.js";
import { MODEL_CAPABILITY_BENCHMARKS } from "../../../../benchmarks/model-capability/model-capability-benchmarks.js";
import { forgeBody } from "../../forge.js";
import type { ForgeComponents, ForgedBodyPlan } from "../../contracts.js";
import type { CapabilityRegistry } from "capability-registry";
import {
  ORG_CAP_EXECUTION,
  SCOPE,
  SUBSTRATE_MOMENTUM,
  registryFixture,
  surfaceEvaluations,
} from "./evidence.js";
import { fixtureTrajectories } from "./trajectory.js";

export const EXECUTION_BENCHMARK = "bmk-execution-quality-futures-holdout";
export const PRINCIPAL = "principal-commissioning" as PossessionPrincipalId;
export const GRANTED_AT = 1_700_000_000_000 as PossessionGrant["grantedAt"];

type InstrumentRef = BodyDescriptor["embodiment"]["instruments"][number];
export const INSTRUMENT_CO = "instrument-commissioning-es" as InstrumentRef;

/** Branded Money literal (the possession fixture convention). */
function money(amount: string): BodyDescriptor["riskEnvelope"]["maxGrossExposure"] {
  return { amount: amount as never, currency: "USD" as never };
}

/** The momentum substrate — the selected substrate AND the forging bearer. */
export function momentumSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: String(SUBSTRATE_MOMENTUM) as CognitiveSubstrateDescriptor["substrateId"],
    displayName: "commissioning fixture momentum mind",
    stateMode: "declared-state",
    seed: "commissioning-momentum-seed",
    decisionRate: { maxDecisionsPerView: 2, minViewIntervalMs: 1000 },
    commandKinds: ["submit-order", "cancel-order", "close-position"],
    ...overrides,
  };
}

/** The mean-reversion substrate — the registered runner-up candidacy. */
export function meanReversionSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: "substrate-mean-reversion-mind" as CognitiveSubstrateDescriptor["substrateId"],
    displayName: "commissioning fixture mean-reversion mind",
    stateMode: "declared-state",
    seed: "commissioning-mean-reversion-seed",
    decisionRate: { maxDecisionsPerView: 4, minViewIntervalMs: 500 },
    commandKinds: ["submit-order", "cancel-order", "close-position"],
    ...overrides,
  };
}

/** The default body requirements: the execution seat the forge composes. */
export function bodyRequirements(
  overrides: Partial<ForgeComponents["bodyRequirements"]> = {},
): ForgeComponents["bodyRequirements"] {
  return {
    bodyId: "body-commissioning-execution-1" as BodyDescriptor["bodyId"],
    scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId } as BodyDescriptor["scope"],
    participantId: "participant-commissioning-execution" as BodyDescriptor["participantId"],
    accountId: "account-commissioning-execution" as BodyDescriptor["accountId"],
    participantKind: "human",
    displayName: "commissioning fixture execution body",
    embodiment: {
      instruments: [INSTRUMENT_CO],
      venues: ["venue-forge-main" as BodyDescriptor["embodiment"]["venues"][number]],
      orderKinds: ["market", "limit"],
      timeInForce: ["GTC", "IOC"],
      commandKinds: ["submit-order", "cancel-order", "replace-order", "close-position", "add-annotation"],
    },
    riskEnvelope: {
      maxOrderQuantity: "40" as never,
      maxPositionQuantity: "150" as never,
      maxLeverage: 3,
      maxGrossExposure: money("400000"),
      maxDrawdown: money("8000"),
      minBuyingPowerAfterOrder: money("2000"),
    },
    grant: {
      grantedBy: PRINCIPAL,
      channel: "commissioning",
      grantedAt: GRANTED_AT,
      basis: "the organization commissions the execution body for the selected momentum substrate",
    },
    possessionScope: {
      instruments: [INSTRUMENT_CO],
      observations: ["market-quote", "own-portfolio"],
      commandKinds: ["submit-order", "close-position"],
    },
    ...overrides,
  };
}

/** The REAL extracted skill records (the momentum substrate's measured execution quality). */
export function extractedSkills(): SkillRecord[] {
  const outcome = extractSkills(fixtureTrajectories(), registryFixture());
  if (!outcome.ok) {
    throw new Error(`commissioning fixture extraction failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return [...outcome.run.skills];
}

/** The default forge components: substrate + requirements + endowment + registry. */
export function forgeComponents(
  overrides: Partial<ForgeComponents> = {},
): ForgeComponents {
  return {
    substrate: momentumSubstrate(),
    bodyRequirements: bodyRequirements(),
    skills: extractedSkills(),
    registry: registryFixture(),
    ...overrides,
  };
}

/** The REAL forged plan (through the W041 forge's own gate). */
export function forgedPlanFixture(): ForgedBodyPlan {
  const outcome = forgeBody(forgeComponents());
  if (!outcome.ok) {
    throw new Error(`commissioning fixture forging failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.plan;
}

/** The registered candidates (the W039 compiler-registry shape, typed through the demand's own surface). */
export function candidateSubstrates(): SelectionDemand["candidates"] {
  return [
    { substrate: momentumSubstrate(), providesCapabilities: [ORG_CAP_EXECUTION] },
    { substrate: meanReversionSubstrate(), providesCapabilities: [ORG_CAP_EXECUTION] },
  ];
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
        instruments: ["instrument-commissioning-es" as SelectionDemand["position"]["bodyRequirement"]["instruments"][number]],
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

/** The REAL selection plan (through the W042 walk's own gate). */
export function selectionPlanFixture(): SelectionPlan {
  const outcome = selectSubstrate(selectionDemand(), registryFixture(), extractedSkills(), benchmarkSurface());
  if (!outcome.ok) {
    throw new Error(`commissioning fixture selection failed (${outcome.errors.map((e) => e.code).join(", ")})`);
  }
  return outcome.plan;
}

/** The default commissioning input: the plan + the selection + the registry. */
export function commissioningFixture(): {
  readonly plan: ForgedBodyPlan;
  readonly selection: SelectionPlan;
  readonly registry: CapabilityRegistry;
} {
  return { plan: forgedPlanFixture(), selection: selectionPlanFixture(), registry: registryFixture() };
}
