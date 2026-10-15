/**
 * Shared deterministic fixtures for the W039 organization-compiler tests.
 *
 * REAL components only (the no-shim law): the organization definition is
 * built through the REAL `organization` package surface; the bodies are
 * REAL, validator-passing W032 `BodyDescriptor`s (the possession fixture
 * shapes); the substrates are REAL W033 `CognitiveSubstrateDescriptor`s.
 * Branded leaves are cast literals (the possession/agent-body fixture
 * convention).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { BodyDescriptor } from "agent-body";
import type { CognitiveSubstrateDescriptor } from "cognitive-substrate";
import type {
  OrganizationCapabilityId,
  OrganizationDefinition,
  OrganizationPositionId,
  OrganizationScope,
  OrganizationUnitId,
} from "organization";
import type { PossessionPrincipalId } from "possession";
import type { OrganizationComponentRegistry, RegisteredBody, RegisteredSubstrate } from "../registry.js";

export const TENANT = "tenant-compiler-tests";
export const PROJECT = "project-compiler";
export const WORLD = "world-compiler-tests";
export const SCOPE: OrganizationScope = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };

export const PRINCIPAL = "principal-compiler-org" as PossessionPrincipalId;
export const GRANTED_AT = 1_700_000_000_000;

export const CAPABILITY_MOMENTUM = "capability-momentum-execution" as OrganizationCapabilityId;
export const CAPABILITY_RISK = "capability-risk-guard" as OrganizationCapabilityId;
export const CAPABILITY_LIQUIDITY = "capability-liquidity-analysis" as OrganizationCapabilityId;

export const POSITION_TRADER = "position-execution-trader" as OrganizationPositionId;
export const POSITION_ANALYST = "position-liquidity-analyst" as OrganizationPositionId;
export const POSITION_RISK = "position-risk-guard" as OrganizationPositionId;

export const UNIT_FRONT = "unit-front-office" as OrganizationUnitId;
export const UNIT_RESEARCH = "unit-research" as OrganizationUnitId;
export const UNIT_RISK = "unit-risk" as OrganizationUnitId;

type InstrumentRef = BodyDescriptor["embodiment"]["instruments"][number];
export const INSTRUMENT_ES = "instrument-es" as InstrumentRef;
export const INSTRUMENT_NQ = "instrument-nq" as InstrumentRef;

/** Branded Money literal (the possession fixture convention). */
function money(amount: string): BodyDescriptor["riskEnvelope"]["maxGrossExposure"] {
  return { amount: amount as never, currency: "USD" as never };
}

/** The alpha (trader) Body: narrow seat, ES only, order issuance only. */
export function alphaBody(overrides: Partial<BodyDescriptor> = {}): BodyDescriptor {
  return {
    bodyId: "body-compiler-alpha" as BodyDescriptor["bodyId"],
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD } as BodyDescriptor["scope"],
    participantId: "participant-compiler-alpha" as BodyDescriptor["participantId"],
    accountId: "account-compiler-alpha" as BodyDescriptor["accountId"],
    participantKind: "human",
    displayName: "compiler fixture alpha body",
    embodiment: {
      instruments: [INSTRUMENT_ES],
      venues: ["venue-compiler-main" as BodyDescriptor["embodiment"]["venues"][number]],
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
    ...overrides,
  };
}

/** The beta (analyst/risk) Body: wide seat covering both instruments. */
export function betaBody(overrides: Partial<BodyDescriptor> = {}): BodyDescriptor {
  return {
    ...alphaBody(),
    bodyId: "body-compiler-beta" as BodyDescriptor["bodyId"],
    participantId: "participant-compiler-beta" as BodyDescriptor["participantId"],
    accountId: "account-compiler-beta" as BodyDescriptor["accountId"],
    displayName: "compiler fixture beta body",
    embodiment: {
      instruments: [INSTRUMENT_ES, INSTRUMENT_NQ],
      venues: ["venue-compiler-main" as BodyDescriptor["embodiment"]["venues"][number]],
      orderKinds: ["market", "limit"],
      timeInForce: ["GTC", "IOC"],
      commandKinds: ["submit-order", "cancel-order", "replace-order", "close-position", "add-annotation"],
    },
    ...overrides,
  };
}

/** The momentum substrate: declared-state, modest rate. */
export function momentumSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: "substrate-compiler-alpha-momentum" as CognitiveSubstrateDescriptor["substrateId"],
    displayName: "compiler fixture momentum mind",
    stateMode: "declared-state",
    seed: "compiler-momentum-seed",
    decisionRate: { maxDecisionsPerView: 2, minViewIntervalMs: 1000 },
    commandKinds: ["submit-order", "cancel-order", "close-position"],
    ...overrides,
  };
}

/** The stateless substrate: stateless-per-view, wider rate. */
export function statelessSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: "substrate-compiler-beta-stateless" as CognitiveSubstrateDescriptor["substrateId"],
    displayName: "compiler fixture stateless mind",
    stateMode: "stateless-per-view",
    seed: "compiler-stateless-seed",
    decisionRate: { maxDecisionsPerView: 3 },
    commandKinds: ["submit-order", "cancel-order"],
    ...overrides,
  };
}

export function registeredBodies(
  overrides: readonly RegisteredBody[] = [
    { body: alphaBody(), providesCapabilities: [CAPABILITY_MOMENTUM] },
    { body: betaBody(), providesCapabilities: [CAPABILITY_LIQUIDITY, CAPABILITY_RISK] },
  ],
): readonly RegisteredBody[] {
  return overrides;
}

export function registeredSubstrates(
  overrides: readonly RegisteredSubstrate[] = [
    { substrate: momentumSubstrate(), providesCapabilities: [CAPABILITY_MOMENTUM] },
    { substrate: statelessSubstrate(), providesCapabilities: [CAPABILITY_LIQUIDITY] },
  ],
): readonly RegisteredSubstrate[] {
  return overrides;
}

/** The component registry the compile fixtures resolve against. */
export function componentRegistry(
  overrides: Partial<OrganizationComponentRegistry> = {},
): OrganizationComponentRegistry {
  return {
    scope: SCOPE,
    bodies: registeredBodies(),
    substrates: registeredSubstrates(),
    ...overrides,
  };
}

/** The canonical organization definition the fixtures compile. */
export function organizationDefinition(
  overrides: Partial<OrganizationDefinition> = {},
): OrganizationDefinition {
  return {
    displayName: "compiler fixture organization",
    scope: SCOPE,
    capabilities: [
      { capabilityId: CAPABILITY_MOMENTUM, name: "momentum execution" },
      { capabilityId: CAPABILITY_RISK, name: "risk guarding" },
      { capabilityId: CAPABILITY_LIQUIDITY, name: "liquidity analysis" },
    ],
    positions: [
      {
        positionId: POSITION_TRADER,
        title: "execution trader",
        bodyRequirement: {
          commandKinds: ["submit-order", "close-position"],
          instruments: [INSTRUMENT_ES],
          observations: ["market-quote", "market-book", "own-orders", "own-positions"],
        },
        substrateRequirement: {
          stateMode: "declared-state",
          minMaxDecisionsPerView: 1,
          commandKinds: ["submit-order", "close-position"],
        },
        capabilityDemands: [{ capabilityId: CAPABILITY_MOMENTUM, rationale: "the seat executes momentum signals" }],
      },
      {
        positionId: POSITION_ANALYST,
        title: "liquidity analyst",
        bodyRequirement: {
          commandKinds: ["submit-order", "cancel-order"],
          instruments: [INSTRUMENT_ES, INSTRUMENT_NQ],
          observations: ["market-quote", "market-trades"],
        },
        substrateRequirement: {
          stateMode: "stateless-per-view",
          minMaxDecisionsPerView: 2,
          commandKinds: ["submit-order", "cancel-order"],
        },
        capabilityDemands: [{ capabilityId: CAPABILITY_LIQUIDITY, rationale: "the seat reads microstructure" }],
      },
      {
        positionId: POSITION_RISK,
        title: "risk guard",
        bodyRequirement: {
          commandKinds: ["submit-order", "cancel-order", "close-position"],
          instruments: [INSTRUMENT_ES, INSTRUMENT_NQ],
          observations: ["market-quote", "own-positions"],
        },
        substrateRequirement: {
          stateMode: "declared-state",
          minMaxDecisionsPerView: 1,
          commandKinds: ["submit-order", "cancel-order", "close-position"],
        },
        capabilityDemands: [{ capabilityId: CAPABILITY_RISK, rationale: "the seat gates gross exposure" }],
      },
    ],
    units: [
      { unitId: UNIT_FRONT, name: "front office", parentUnitId: null, positionIds: [POSITION_TRADER] },
      { unitId: UNIT_RESEARCH, name: "research", parentUnitId: UNIT_FRONT, positionIds: [POSITION_ANALYST] },
      { unitId: UNIT_RISK, name: "risk", parentUnitId: null, positionIds: [POSITION_RISK] },
    ],
    bindings: [
      {
        positionId: POSITION_TRADER,
        grant: { grantedBy: PRINCIPAL, channel: "organization", grantedAt: GRANTED_AT, basis: "the organization binds the execution seat" },
        scopeNarrowing: { instruments: [INSTRUMENT_ES] },
      },
      {
        positionId: POSITION_ANALYST,
        grant: { grantedBy: PRINCIPAL, channel: "organization", grantedAt: GRANTED_AT, basis: "the organization binds the research seat" },
      },
      {
        positionId: POSITION_RISK,
        grant: { grantedBy: PRINCIPAL, channel: "organization", grantedAt: GRANTED_AT + 1, basis: "the organization binds the risk seat" },
      },
    ],
    lineage: { parentOrganizationId: null, origin: { kind: "genesis" } },
    ...overrides,
  };
}
