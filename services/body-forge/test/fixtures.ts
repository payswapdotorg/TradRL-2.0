/**
 * Shared deterministic fixtures for the W041 body-forge tests: the REAL
 * extracted skill records (through the `skills` package's own extraction
 * gate over the REAL trajectories + registry), the REAL W033 substrate
 * (the skill bearer), and the REAL body requirements the forge composes.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { BodyDescriptor } from "agent-body";
import type { CognitiveSubstrateDescriptor } from "cognitive-substrate";
import type { PossessionGrant, PossessionPrincipalId } from "possession";
import { extractSkills } from "skills";
import type { SkillRecord } from "skills";
import type { ForgeComponents } from "../contracts.js";
import { SCOPE, SUBSTRATE_MOMENTUM, registryFixture } from "./evidence.js";
import { fixtureTrajectories } from "./trajectory.js";

export const PRINCIPAL = "principal-forge-commissioning" as PossessionPrincipalId;
export const GRANTED_AT = 1_700_000_000_000 as PossessionGrant["grantedAt"];

type InstrumentRef = BodyDescriptor["embodiment"]["instruments"][number];
export const INSTRUMENT_FE = "instrument-forge-es" as InstrumentRef;

/** Branded Money literal (the possession fixture convention). */
function money(amount: string): BodyDescriptor["riskEnvelope"]["maxGrossExposure"] {
  return { amount: amount as never, currency: "USD" as never };
}

/** The momentum substrate — the VERY bearer the fixture skill was measured on. */
export function momentumSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: String(SUBSTRATE_MOMENTUM) as CognitiveSubstrateDescriptor["substrateId"],
    displayName: "forge fixture momentum mind",
    stateMode: "declared-state",
    seed: "forge-momentum-seed",
    decisionRate: { maxDecisionsPerView: 2, minViewIntervalMs: 1000 },
    commandKinds: ["submit-order", "cancel-order", "close-position"],
    ...overrides,
  };
}

/** The default body requirements: the execution seat the forge composes. */
export function bodyRequirements(overrides: Partial<ForgeComponents["bodyRequirements"]> = {}): ForgeComponents["bodyRequirements"] {
  return {
    bodyId: "body-forge-execution-1" as BodyDescriptor["bodyId"],
    scope: { tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, worldId: SCOPE.worldId } as BodyDescriptor["scope"],
    participantId: "participant-forge-execution" as BodyDescriptor["participantId"],
    accountId: "account-forge-execution" as BodyDescriptor["accountId"],
    participantKind: "human",
    displayName: "forge fixture execution body",
    embodiment: {
      instruments: [INSTRUMENT_FE],
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
      basis: "the forge composes the execution body for the momentum substrate",
    },
    possessionScope: {
      instruments: [INSTRUMENT_FE],
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
    throw new Error(`forge fixture extraction failed (${outcome.errors.map((e) => e.code).join(", ")})`);
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
