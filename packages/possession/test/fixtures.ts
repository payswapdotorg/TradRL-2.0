/**
 * Shared deterministic fixtures for the W034 possession tests.
 *
 * The fixture worlds are REAL, valid `WorldDefinition`s (the W032
 * agent-body fixture pattern) so the compatibility/attach laws are proven
 * against honest world shapes, not hand-wired stubs; the bodies are REAL
 * W032 `BodyDescriptor`s; the substrates are REAL W033
 * `CognitiveSubstrateDescriptor`s (the reference minds' shapes); the
 * decision streams are complete, lawful W033 `DecisionStream`s. The REAL
 * alpha world definition (packages/ui/src/trading-world/runtime/
 * engineAttachment.ts) is consumed by test/alphaWorld.test.ts through the
 * same relative-seam pattern the agent-body/cognitive-substrate/ui tests
 * use for cross-package sources.
 */

import type {
  Account,
  InformationArtifact,
  Instrument,
  Money,
  NewsPayload,
  Participant,
  RiskLimits,
  Venue,
} from "tradrl-world-contracts";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type { BodyDescriptor, BodyEmbodiment, BodyId, BodyView } from "tradrl-world-contracts/agentBody";
import type {
  CognitiveSubstrateDescriptor,
  DecisionStream,
  SubstrateId,
} from "tradrl-world-contracts/cognitiveSubstrate";
import type { PossessionDescriptor, PossessionId } from "../index.js";

export const TENANT = "tenant-possession-tests" as BodyDescriptor["scope"]["tenantId"];
export const PROJECT = "project-possession" as BodyDescriptor["scope"]["projectId"];
export const WORLD = "world-possession-tests" as BodyDescriptor["scope"]["worldId"];

export const VENUE_ALL = "venue-all" as Instrument["venueId"];
export const VENUE_RESTRICTIVE = "venue-restrictive" as Instrument["venueId"];
export const INSTRUMENT_ES = "instrument-es" as Instrument["instrumentId"];
export const INSTRUMENT_NQ = "instrument-nq" as Instrument["instrumentId"];
export const ACCOUNT_TRADER = "account-trader" as Account["accountId"];
export const ACCOUNT_FROZEN = "account-frozen" as Account["accountId"];
export const PARTICIPANT_TRADER = "participant-trader" as Participant["participantId"];
export const PARTICIPANT_MM = "participant-mm" as Participant["participantId"];

export const BODY_TRADER = "body-trader-one" as BodyId;
export const SUBSTRATE_MOMENTUM = "substrate-momentum-one" as SubstrateId;
export const SUBSTRATE_ALT = "substrate-alt-one" as SubstrateId;
export const POSSESSION_ONE = "possession-one" as PossessionId;
export const POSSESSION_TWO = "possession-two" as PossessionId;
export const PRINCIPAL = "principal-operator-one" as PossessionDescriptor["grant"]["grantedBy"];

/** A branded Money literal (the engineAttachment/helpers `as never` convention). */
export function money(amount: string, currency = "USD"): Money {
  return { amount: amount as never, currency: currency as never };
}

/** The world's declared limits for the trader account (the A13 shape). */
export const TRADER_WORLD_LIMITS: RiskLimits = {
  maxOrderQuantity: "50" as never,
  maxPositionQuantity: "200" as never,
  maxLeverage: 4,
  maxGrossExposure: money("500000"),
  maxDrawdown: money("10000"),
  minBuyingPowerAfterOrder: money("1000"),
};

const SIM_START = 1_700_000_000_000;
export const START = SIM_START;
export const AT_START = SIM_START as never;
export const LATER = (SIM_START + 60_000) as never;
export const MUCH_LATER = (SIM_START + 3_600_000) as never;
export const NEWS_EARLY = "artifact-news-early" as never;

function account(accountId: Account["accountId"], canTrade: boolean): Account {
  return {
    accountId,
    worldId: WORLD,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
    buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade, canShort: true, liveExecutionAllowed: false },
  };
}

function venue(venueId: Venue["venueId"], kinds: readonly string[]): Venue {
  return {
    venueId,
    worldId: WORLD,
    name: String(venueId),
    matchingModel: "price-time-priority",
    allowedOrderKinds: kinds as never,
    feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
    latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
    calendar: {
      sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }],
    },
    haltPolicy: { haltOnShock: false },
  };
}

/**
 * The fixture world (the W032 shape): one permissive venue, one
 * restrictive venue, two instruments, a tradable trader account with
 * declared risk limits, and a frozen market-maker account.
 * `overrides` adapts it for specific cases.
 */
export function fixtureWorld(
  overrides: Partial<WorldDefinition> = {},
): WorldDefinition {
  return {
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    mode: "reactive-replay",
    seed: "possession-fixtures",
    worldDefinitionVersion: "possession-tests@1",
    inputDataSource: "synthetic://possession-tests",
    clock: {
      start: SIM_START as never,
      defaultStepMs: 1000,
      initialWallTime: (SIM_START + 5000) as never,
    },
    instruments: [
      {
        instrumentId: INSTRUMENT_ES,
        worldId: WORLD,
        venueId: VENUE_ALL,
        symbol: "ES-POSSESSION",
        assetClass: "future",
        quoteCurrency: "USD" as never,
        tickSize: "0.25" as never,
        lotSize: "1" as never,
        pricePrecision: 2,
        quantityPrecision: 0,
        tradingState: "open",
        tradable: true,
      },
      {
        instrumentId: INSTRUMENT_NQ,
        worldId: WORLD,
        venueId: VENUE_RESTRICTIVE,
        symbol: "NQ-POSSESSION",
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
    venues: [venue(VENUE_ALL, ["market", "limit", "stop", "stop-limit"]), venue(VENUE_RESTRICTIVE, ["market", "limit"])],
    accounts: [account(ACCOUNT_TRADER, true), account(ACCOUNT_FROZEN, false)],
    participants: [
      {
        participantId: PARTICIPANT_TRADER,
        worldId: WORLD,
        kind: "human",
        accountId: ACCOUNT_TRADER,
      },
      {
        participantId: PARTICIPANT_MM,
        worldId: WORLD,
        kind: "passive-market-maker",
        accountId: ACCOUNT_FROZEN,
      },
    ],
    riskLimits: { [String(ACCOUNT_TRADER)]: TRADER_WORLD_LIMITS },
    ...overrides,
  };
}

/** The default trader Body: a valid seat on the fixture world (the W032 fixture). */
export function traderBody(
  overrides: Partial<BodyDescriptor> = {},
): BodyDescriptor {
  return {
    bodyId: BODY_TRADER,
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    participantId: PARTICIPANT_TRADER,
    accountId: ACCOUNT_TRADER,
    participantKind: "human",
    embodiment: traderEmbodiment(),
    riskEnvelope: traderEnvelope(),
    ...overrides,
  };
}

export function traderEmbodiment(
  overrides: Partial<BodyEmbodiment> = {},
): BodyEmbodiment {
  return {
    instruments: [INSTRUMENT_ES, INSTRUMENT_NQ],
    venues: [VENUE_ALL, VENUE_RESTRICTIVE],
    orderKinds: ["market", "limit"],
    timeInForce: ["GTC", "IOC"],
    commandKinds: ["submit-order", "cancel-order", "replace-order", "close-position", "add-annotation"],
    ...overrides,
  };
}

/** The trader Body's envelope: strictly within the world's declared limits. */
export function traderEnvelope(overrides: Partial<RiskLimits> = {}): RiskLimits {
  return {
    maxOrderQuantity: "40" as never,
    maxPositionQuantity: "150" as never,
    maxLeverage: 3,
    maxGrossExposure: money("400000"),
    maxDrawdown: money("8000"),
    minBuyingPowerAfterOrder: money("2000"),
    ...overrides,
  };
}

/**
 * The default substrate: a declared-state momentum-shaped mind (the W033
 * reference descriptor shape) whose command kinds fit the trader body.
 */
export function momentumSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: SUBSTRATE_MOMENTUM,
    displayName: "fixture momentum mind",
    stateMode: "declared-state",
    seed: "possession-fixture-seed",
    decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 1000 },
    commandKinds: ["submit-order", "close-position"],
    ...overrides,
  };
}

/** A second substrate (succession/lineage fixtures). */
export function altSubstrate(
  overrides: Partial<CognitiveSubstrateDescriptor> = {},
): CognitiveSubstrateDescriptor {
  return {
    substrateId: SUBSTRATE_ALT,
    stateMode: "stateless-per-view",
    seed: "possession-alt-seed",
    decisionRate: { maxDecisionsPerView: 2 },
    commandKinds: ["submit-order"],
    ...overrides,
  };
}

/** The default possession scope: covers the momentum substrate on ES only. */
export function esScope(overrides: Partial<PossessionDescriptor["scope"]> = {}) {
  return {
    instruments: [INSTRUMENT_ES],
    observations: [
      "market-quote",
      "market-book",
      "market-trades",
      "own-orders",
      "own-positions",
      "own-portfolio",
      "own-risk",
      "information-artifacts",
    ] as PossessionDescriptor["scope"]["observations"],
    commandKinds: ["submit-order", "close-position"] as PossessionDescriptor["scope"]["commandKinds"],
    decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 1000 },
    ...overrides,
  };
}

/** The default possession descriptor: a compatible, valid possession. */
export function possessionOne(
  overrides: Partial<PossessionDescriptor> = {},
): PossessionDescriptor {
  return {
    possessionId: POSSESSION_ONE,
    body: traderBody(),
    substrate: momentumSubstrate(),
    grant: {
      grantedBy: PRINCIPAL,
      channel: "operator",
      grantedAt: AT_START,
      basis: "operator-reviewed momentum mind for the ES desk",
    },
    scope: esScope(),
    ...overrides,
  };
}

/** A second possession of the same body (succession fixtures). */
export function possessionTwo(
  overrides: Partial<PossessionDescriptor> = {},
): PossessionDescriptor {
  return {
    possessionId: POSSESSION_TWO,
    body: traderBody(),
    substrate: altSubstrate(),
    grant: {
      grantedBy: PRINCIPAL,
      channel: "organization",
      grantedAt: LATER,
      basis: "organization-composed successor mind for the ES desk",
    },
    scope: esScope({ decisionRate: { maxDecisionsPerView: 2, minViewIntervalMs: 500 } }),
    ...overrides,
  };
}

/** The view the default scope projects (the maximal view ∩ scope). */
export function esView(overrides: Partial<BodyView> = {}): BodyView {
  return {
    bodyId: BODY_TRADER,
    worldId: WORLD,
    instruments: [INSTRUMENT_ES],
    observations: [
      "market-quote",
      "market-book",
      "market-trades",
      "own-orders",
      "own-positions",
      "own-portfolio",
      "own-risk",
      "information-artifacts",
    ],
    accountId: ACCOUNT_TRADER,
    ...overrides,
  };
}

/**
 * A complete, lawful decision stream from the default substrate over the
 * ES desk (passes W033's validateDecisionStream against the default body
 * and substrate, and the possession-scope layer against the default
 * scope). `overrides` adapts it for specific violation cases.
 */
export function lawfulStream(
  overrides: Partial<DecisionStream> = {},
): DecisionStream {
  const viewDigest = "view-digest-fixture" as never;
  return {
    substrateId: SUBSTRATE_MOMENTUM,
    seed: "possession-fixture-seed",
    viewDigest,
    asOf: LATER,
    decisions: [
      {
        decisionId: "decision-fixture-1" as never,
        viewDigest,
        command: {
          commandId: "command-fixture-1" as never,
          worldId: WORLD,
          issuedBy: PARTICIPANT_TRADER,
          issuedAt: LATER,
          kind: "submit-order",
          accountId: ACCOUNT_TRADER,
          instrumentId: INSTRUMENT_ES,
          submission: {
            kind: "market",
            side: "buy",
            quantity: "1" as never,
            constraints: { timeInForce: "GTC" },
          },
        },
        rationale: {
          rule: "fixture-momentum-cross",
          signals: [
            { name: "instrument", value: String(INSTRUMENT_ES) },
            { name: "signal", value: "up" },
          ],
          explanation: "fixture momentum crossing upward — buy one market lot",
        },
        confidence: 0.8,
      },
    ],
    ...overrides,
  };
}

/** A news artifact available from the start (the A7 fixture shape). */
export function fixtureArtifact(): InformationArtifact<NewsPayload> {
  return {
    artifactId: NEWS_EARLY,
    worldId: WORLD as never,
    source: "fixture-wire",
    createdAt: AT_START,
    availableAt: AT_START,
    scope: "news",
    provenance: { producer: "fixture-wire" as never, recordedAt: AT_START },
    version: "1",
    payload: { headline: "available from the start" },
  };
}
