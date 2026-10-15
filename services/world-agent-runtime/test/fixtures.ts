/**
 * Shared deterministic fixtures for the W044 binding tests — REAL
 * commissioned bodies through commissioning's own gate (forgeBody over
 * the REAL extracted skills + W040 registry, selectSubstrate over the
 * REAL benchmark catalogue, commissionBody sealing the activation
 * record), a REAL compiled organization plan through the W039 compiler's
 * own gate, and REAL W034 possession grants. The commissioned-body
 * fixtures are IMPORTED DIRECTLY from body-forge's commissioning test
 * fixtures (the REAL gates, zero fixture drift — disclosed deviation:
 * cross-package test-fixture import via relative path, the W043
 * relative-import precedent) and the world definition is ADAPTED from
 * the W035 protocol world (packages/agent-world-protocol/test/fixtures,
 * disclosed in-header) so the commissioned body's seat, account,
 * instrument and scope are REAL world shapes.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { BodyDescriptor } from "agent-body";
import type { CognitiveSubstrateDescriptor } from "cognitive-substrate";
import type { PossessionGrant, PossessionPrincipalId, PossessionRecord } from "possession";
import type {
  Account,
  InformationArtifact,
  Instrument,
  NewsPayload,
  Participant,
  Venue,
} from "tradrl-world-contracts";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type { OrganizationCapability, OrganizationCapabilityId, OrganizationDefinition, OrganizationPositionId, OrganizationScope } from "organization";
import type { OrganizationComponentRegistry } from "organization-compiler";
import { compileOrganization } from "organization-compiler";
import { commissionBody } from "body-forge/commissioning";
import { forgeBody } from "body-forge";
import type { CommissionedBody } from "body-forge/commissioning";
import type { CapabilityRegistry } from "capability-registry";
import {
  bodyRequirements,
  forgeComponents,
  INSTRUMENT_CO,
  selectionPlanFixture,
} from "../../body-forge/commissioning/test/fixtures.js";
import {
  ORG_CAP_EXECUTION,
  SCOPE,
  deprecatedMomentumRegistry,
  registryFixture,
  revokedMomentumRegistry,
} from "../../body-forge/commissioning/test/evidence.js";
import type { BindingGrants } from "../contracts.js";

export const VENUE_BINDING = "venue-forge-main";
export const ACCOUNT_SEAT = "account-commissioning-execution";
export const PARTICIPANT_SEAT = "participant-commissioning-execution";
export const GRANTED_AT = 1_700_000_000_000;
export const ORG_PRINCIPAL = "principal-org-binding" as PossessionPrincipalId;
export const ORG_POSITION = "position-binding-execution" as OrganizationPositionId;
export const INSTRUMENT_NQ = "instrument-binding-nq" as Instrument["instrumentId"];

/** The organization's seat grant — the authority the commissioning seals. */
export const ORG_GRANT: PossessionGrant = {
  grantedBy: ORG_PRINCIPAL,
  channel: "organization",
  grantedAt: GRANTED_AT as PossessionGrant["grantedAt"],
  basis: "the organization issues the execution seat to the selected momentum substrate",
};

// --- the binding world (adapted from the W035 protocol world) -------------------

function seatAccount(worldId: string): Account {
  return {
    accountId: ACCOUNT_SEAT as never,
    worldId: worldId as never,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
    buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

function seatParticipant(worldId: string, accountId: string = ACCOUNT_SEAT): Participant {
  return {
    participantId: PARTICIPANT_SEAT as never,
    worldId: worldId as never,
    kind: "human",
    accountId: accountId as never,
  };
}

/**
 * The binding world: the commissioning fixture's scope, the commissioned
 * body's seat/account/instrument/venue as REAL declared world shapes.
 */
export function bindingWorldDefinition(overrides: {
  worldId?: string;
  participants?: readonly Participant[];
  venueAllowedOrderKinds?: readonly string[];
  instruments?: readonly Instrument[];
} = {}): WorldDefinition {
  const worldId = overrides.worldId ?? SCOPE.worldId;
  const id = worldId as WorldDefinition["scope"]["worldId"];
  return {
    scope: { tenantId: SCOPE.tenantId as never, projectId: SCOPE.projectId as never, worldId: id },
    mode: "reactive-replay",
    seed: `w044:${worldId}`,
    worldDefinitionVersion: "w044-binding@1",
    inputDataSource: "synthetic://w044",
    clock: { start: GRANTED_AT as never, defaultStepMs: 1000, initialWallTime: (GRANTED_AT + 500_000) as never },
    instruments: overrides.instruments ?? [
      {
        instrumentId: INSTRUMENT_CO as never,
        worldId: id,
        venueId: VENUE_BINDING as never,
        symbol: "ES-W044",
        assetClass: "future",
        quoteCurrency: "USD" as never,
        tickSize: "0.25" as never,
        lotSize: "1" as never,
        pricePrecision: 2,
        quantityPrecision: 0,
        tradingState: "open",
        tradable: true,
      },
    ],
    venues: [
      {
        venueId: VENUE_BINDING as never,
        worldId: id,
        name: "w044-binding-venue",
        matchingModel: "price-time-priority",
        allowedOrderKinds: (overrides.venueAllowedOrderKinds ?? ["market", "limit", "stop", "stop-limit"]) as never,
        feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
        latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
        calendar: { sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }] },
        haltPolicy: { haltOnShock: false },
      } as Venue,
    ],
    accounts: [seatAccount(worldId)],
    participants: overrides.participants ?? [seatParticipant(worldId)],
    informationArtifacts: [] as readonly InformationArtifact<NewsPayload>[],
  };
}

// --- the commissioned bodies (through commissioning's own REAL gates) -----------

/** The default commissioned body (the commissioning channel grant). */
export function commissionedBodyFixture(): CommissionedBody {
  const outcome = commissionBody(forgedPlanOf(undefined), selectionPlanFixture(), registryFixture());
  if (!outcome.ok) {
    throw new Error(`binding fixture commissioning failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.body;
}

function forgedPlanOf(grant: PossessionGrant | undefined) {
  const components = forgeComponents(
    grant === undefined ? {} : { bodyRequirements: bodyRequirements({ grant }) },
  );
  const outcome = forgeBody(components);
  if (!outcome.ok) {
    throw new Error(`binding fixture forging failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.plan;
}

/** The organization-seat commissioned body (the org's issued grant, sealed). */
export function orgCommissionedBodyFixture(): CommissionedBody {
  const outcome = commissionBody(forgedPlanOf(ORG_GRANT), selectionPlanFixture(), registryFixture());
  if (!outcome.ok) {
    throw new Error(`binding fixture org commissioning failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.body;
}

// --- the grants input (the live W034 authority material) ------------------------

/** The grants input backing one commissioned body's authority channels. */
export function grantsFor(
  commissioned: CommissionedBody,
  registry: CapabilityRegistry = registryFixture(),
  overrides: { state?: PossessionRecord["state"]; releaseReason?: PossessionRecord["releaseReason"]; bodyId?: string } = {},
): BindingGrants {
  return {
    registry,
    grants: [
      {
        descriptor: {
          possessionId: commissioned.possession.possessionId,
          body: commissioned.body,
          substrate: commissioned.substrate,
          grant: commissioned.possession.grant,
          scope: commissioned.possession.scope,
        },
        record: {
          possessionId: commissioned.possession.possessionId,
          bodyId: (overrides.bodyId ?? commissioned.body.bodyId) as PossessionRecord["bodyId"],
          substrateId: commissioned.substrate.substrateId,
          worldId: SCOPE.worldId as PossessionRecord["worldId"],
          state: overrides.state ?? "possessed",
          ...(overrides.releaseReason === undefined ? {} : { releaseReason: overrides.releaseReason }),
        },
      },
    ],
  };
}

export { INSTRUMENT_CO, deprecatedMomentumRegistry, revokedMomentumRegistry, registryFixture, SCOPE };

// --- the compiled organization plan (through the W039 compiler's REAL gate) ----

/** The organization definition whose one seat is the commissioned body. */
export function organizationDefinition(): OrganizationDefinition {
  return {
    displayName: "binding fixture organization",
    scope: SCOPE as OrganizationScope,
    capabilities: [{ capabilityId: ORG_CAP_EXECUTION as OrganizationCapabilityId, name: "execution" } satisfies OrganizationCapability],
    positions: [
      {
        positionId: ORG_POSITION,
        title: "execution seat",
        bodyRequirement: {
          commandKinds: ["submit-order", "close-position"],
          instruments: [INSTRUMENT_CO as BodyDescriptor["embodiment"]["instruments"][number]],
          observations: ["market-quote", "own-portfolio"],
        },
        substrateRequirement: {
          stateMode: "declared-state" as CognitiveSubstrateDescriptor["stateMode"],
          minMaxDecisionsPerView: 2,
          commandKinds: ["submit-order", "cancel-order", "close-position"],
        },
        capabilityDemands: [{ capabilityId: ORG_CAP_EXECUTION as OrganizationCapabilityId, rationale: "the seat's fills must be measured execution quality" }],
      },
    ],
    units: [],
    bindings: [{ positionId: ORG_POSITION, grant: ORG_GRANT }],
    lineage: { parentOrganizationId: null, origin: { kind: "genesis" } },
  };
}

/** The component registry registering the commissioned pair as the seat. */
export function componentRegistry(commissioned: CommissionedBody): OrganizationComponentRegistry {
  return {
    scope: SCOPE as OrganizationScope,
    bodies: [{ body: commissioned.body, providesCapabilities: [ORG_CAP_EXECUTION as OrganizationCapabilityId] }],
    substrates: [{ substrate: commissioned.substrate, providesCapabilities: [ORG_CAP_EXECUTION as OrganizationCapabilityId] }],
  };
}

/** The REAL compiled plan (through the W039 compiler's own gate). */
export function compiledPlanFixture(commissioned: CommissionedBody = orgCommissionedBodyFixture()) {
  const outcome = compileOrganization(organizationDefinition(), componentRegistry(commissioned));
  if (!outcome.ok) {
    throw new Error(`binding fixture compile failed (${outcome.error.code}: ${outcome.error.message})`);
  }
  return outcome.compiled;
}
