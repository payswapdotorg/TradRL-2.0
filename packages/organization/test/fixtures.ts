/**
 * Shared deterministic fixtures for the W039 organization tests.
 *
 * Real model data only: a three-position trading organization (two root
 * units, one nested) with a declared capability catalogue, one scoped
 * possession binding, and a genesis lineage. Opaque ids are branded
 * literals (the possession/agent-body fixture convention); every law
 * violation is composed from THESE parts, never hand-wired stubs.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  OrganizationCapability,
  OrganizationCapabilityId,
  OrganizationDefinition,
  OrganizationPosition,
  OrganizationPositionId,
  OrganizationScope,
  OrganizationUnit,
  OrganizationUnitId,
} from "../index.js";
import type { PossessionPrincipalId } from "possession";

export const TENANT = "tenant-org-tests";
export const PROJECT = "project-org";
export const WORLD = "world-org-tests";
export const SCOPE: OrganizationScope = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };

export const PRINCIPAL = "principal-org-one" as PossessionPrincipalId;
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

export const INSTRUMENT_ES = "instrument-es" as OrganizationDefinition["positions"][number]["bodyRequirement"]["instruments"][number];
export const INSTRUMENT_NQ = "instrument-nq" as OrganizationDefinition["positions"][number]["bodyRequirement"]["instruments"][number];

export const CAPABILITIES: readonly OrganizationCapability[] = [
  { capabilityId: CAPABILITY_MOMENTUM, name: "momentum execution" },
  { capabilityId: CAPABILITY_RISK, name: "risk guarding", description: "drawdown-aware order gating" },
  { capabilityId: CAPABILITY_LIQUIDITY, name: "liquidity analysis" },
];

export function traderPosition(
  overrides: Partial<OrganizationPosition> = {},
): OrganizationPosition {
  return {
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
    ...overrides,
  };
}

export function analystPosition(
  overrides: Partial<OrganizationPosition> = {},
): OrganizationPosition {
  return {
    positionId: POSITION_ANALYST,
    title: "liquidity analyst",
    bodyRequirement: {
      commandKinds: ["submit-order", "cancel-order"],
      instruments: [INSTRUMENT_ES, INSTRUMENT_NQ],
      observations: ["market-quote", "market-book", "market-trades"],
    },
    substrateRequirement: {
      stateMode: "stateless-per-view",
      minMaxDecisionsPerView: 2,
      commandKinds: ["submit-order", "cancel-order"],
    },
    capabilityDemands: [{ capabilityId: CAPABILITY_LIQUIDITY, rationale: "the seat reads microstructure" }],
    ...overrides,
  };
}

export function riskPosition(
  overrides: Partial<OrganizationPosition> = {},
): OrganizationPosition {
  return {
    positionId: POSITION_RISK,
    title: "risk guard",
    bodyRequirement: {
      commandKinds: ["submit-order", "cancel-order", "close-position"],
      instruments: [INSTRUMENT_ES, INSTRUMENT_NQ],
      observations: ["market-quote", "own-orders", "own-positions"],
    },
    substrateRequirement: {
      stateMode: "declared-state",
      minMaxDecisionsPerView: 1,
      commandKinds: ["submit-order", "cancel-order", "close-position"],
    },
    capabilityDemands: [{ capabilityId: CAPABILITY_RISK, rationale: "the seat gates gross exposure" }],
    ...overrides,
  };
}

export const POSITIONS: readonly OrganizationPosition[] = [
  traderPosition(),
  analystPosition(),
  riskPosition(),
];

export const UNITS: readonly OrganizationUnit[] = [
  { unitId: UNIT_FRONT, name: "front office", parentUnitId: null, positionIds: [POSITION_TRADER] },
  { unitId: UNIT_RESEARCH, name: "research", parentUnitId: UNIT_FRONT, positionIds: [POSITION_ANALYST] },
  { unitId: UNIT_RISK, name: "risk", parentUnitId: null, positionIds: [POSITION_RISK] },
];

/** The canonical genesis organization the violation fixtures mutate. */
export function organizationDefinition(
  overrides: Partial<OrganizationDefinition> = {},
): OrganizationDefinition {
  return {
    displayName: "fixture trading organization",
    scope: SCOPE,
    capabilities: CAPABILITIES,
    positions: POSITIONS.map((position) => ({ ...position })),
    units: UNITS.map((unit) => ({ ...unit, positionIds: [...unit.positionIds] })),
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

/** Collect the codes of a failed validation (test convenience only). */
export function violationCodes(
  outcome: { readonly ok: boolean; readonly errors?: readonly { readonly code: string }[] },
): string[] {
  if (outcome.ok || outcome.errors === undefined) {
    return [];
  }
  return outcome.errors.map((entry) => entry.code);
}
