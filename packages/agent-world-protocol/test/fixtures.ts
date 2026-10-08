/**
 * Shared deterministic fixtures for the W035 tests.
 *
 * The fixture worlds are REAL, valid `WorldDefinition`s (the W032/W034
 * fixture pattern) so the attach gates and the observation grants are
 * proven against honest world shapes, never hand-wired stubs; the bodies
 * are REAL W032 `BodyDescriptor`s; the substrates are the REAL W033
 * reference minds (`createMomentumSubstrate` / `createMeanReversionSub-
 * strate`); the possessions are REAL W034 `PossessionDescriptor`s; the
 * streams are complete, lawful W033 `DecisionStream`s (the W034
 * `lawfulStream` pattern). The scripted clients (`scriptedAgentWorldClient`)
 * are DETERMINISTIC TEST SEAMS for the protocol laws that a lawful engine
 * can never produce (a never-settling clock, a port serving an artifact
 * the grant withholds) — disclosed here, never hidden.
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
import type { BodyDescriptor } from "tradrl-world-contracts/agentBody";
import type {
  CognitiveSubstrateDescriptor,
  DecisionStream,
  SubstrateId,
} from "tradrl-world-contracts/cognitiveSubstrate";
import type { PossessionDescriptor } from "possession/contracts";

// --- the compact protocol world (the W023 helpers pattern) ---------------------

export const PROTOCOL_WORLD_ID = "world-w035-protocol";
export const TENANT = "tenant-alpha" as BodyDescriptor["scope"]["tenantId"];
export const PROJECT = "project-tradrl" as BodyDescriptor["scope"]["projectId"];
/** Simulation origin (2023-11-14T22:13:20Z — the house epoch). */
export const SIM_START = 1_700_000_000_000;
export const SEC = 1_000;
export const MIN = 60 * SEC;
/** Wall origin deliberately later than sim start (recorded, never mixed). */
export const WALL_START = 1_700_000_500_000;

export const VENUE_SIM = "venue-w035-sim" as Venue["venueId"];
export const INSTRUMENT_ES = `instrument-es-${PROTOCOL_WORLD_ID}` as Instrument["instrumentId"];
export const INSTRUMENT_NQ = `instrument-nq-${PROTOCOL_WORLD_ID}` as Instrument["instrumentId"];
export const ACCOUNT_AGENT = `account-agent-${PROTOCOL_WORLD_ID}` as Account["accountId"];
export const PARTICIPANT_AGENT = `participant-agent-${PROTOCOL_WORLD_ID}` as Participant["participantId"];

/** The agent account's declared world limits (the A13 shape). */
export const AGENT_WORLD_LIMITS: RiskLimits = {
  maxOrderQuantity: "10" as never,
  maxPositionQuantity: "40" as never,
  maxLeverage: 2,
  maxGrossExposure: money("150000"),
  maxDrawdown: money("5000"),
  minBuyingPowerAfterOrder: money("10000"),
};

/** The early artifact (available from the simulation origin). */
export const ARTIFACT_EARLY = "artifact-w035-early" as never;
/** The future-dated artifact (available 30s in — the A7 fixture). */
export const ARTIFACT_LATER = "artifact-w035-later" as never;
export const ARTIFACT_LATER_AT = (SIM_START + 30 * SEC) as never;

/** A branded Money literal (the engineAttachment/helpers `as never` convention). */
export function money(amount: string, currency = "USD"): Money {
  return { amount: amount as never, currency: currency as never };
}

function account(accountId: Account["accountId"]): Account {
  return {
    accountId,
    worldId: PROTOCOL_WORLD_ID as never,
    balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
    buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

/** The compact multi-regime protocol world (the W023 agent-world shape). */
export function protocolWorldDefinition(
  worldId: string = PROTOCOL_WORLD_ID,
): WorldDefinition {
  const id = worldId as WorldDefinition["scope"]["worldId"];
  return {
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: id },
    mode: "reactive-replay",
    seed: `w035:${worldId}`,
    worldDefinitionVersion: "w035-protocol@1",
    inputDataSource: "synthetic://w035",
    regimeSchedule: [
      {
        regime: "mean-reversion",
        from: SIM_START as never,
        to: (SIM_START + 30 * SEC) as never,
        parameters: { anchorPrice: 4800, direction: 1 },
      },
      { regime: "trend", from: (SIM_START + 30 * SEC) as never, to: (SIM_START + 70 * SEC) as never },
      { regime: "halt-reopen", from: (SIM_START + 70 * SEC) as never, to: (SIM_START + 78 * SEC) as never },
      { regime: "mean-reversion", from: (SIM_START + 78 * SEC) as never },
    ],
    clock: {
      start: SIM_START as never,
      defaultStepMs: 1000,
      initialWallTime: WALL_START as never,
    },
    instruments: [
      {
        instrumentId: `instrument-es-${worldId}` as never,
        worldId: id,
        venueId: VENUE_SIM,
        symbol: "ES-W035",
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
        instrumentId: `instrument-nq-${worldId}` as never,
        worldId: id,
        venueId: VENUE_SIM,
        symbol: "NQ-W035",
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
        venueId: VENUE_SIM,
        worldId: id,
        name: "w035-sim-venue",
        matchingModel: "price-time-priority",
        allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
        feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
        latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
        calendar: {
          sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }],
        },
        haltPolicy: { haltOnShock: false },
      },
    ],
    accounts: [
      account(`account-agent-${worldId}` as never),
      account(`account-mm-${worldId}` as never),
      account(`account-synth-${worldId}` as never),
    ],
    participants: [
      // The agent's seat (kind "human" — the A4/A15 human/agent symmetry;
      // the generator does not plan for human-kind participants, so every
      // agent command and fill is cleanly attributable to the protocol).
      {
        participantId: `participant-agent-${worldId}` as never,
        worldId: id,
        kind: "human",
        accountId: `account-agent-${worldId}` as never,
      },
      // The W017 synthetic cast (the market's liquidity): the makers quote
      // around the reference, the aggressive side trades.
      {
        participantId: `participant-mm-1-${worldId}` as never,
        worldId: id,
        kind: "passive-market-maker",
        accountId: `account-mm-${worldId}` as never,
      },
      {
        participantId: `participant-mm-2-${worldId}` as never,
        worldId: id,
        kind: "passive-market-maker",
        accountId: `account-mm-${worldId}` as never,
      },
      {
        participantId: `participant-taker-${worldId}` as never,
        worldId: id,
        kind: "liquidity-taker",
        accountId: `account-synth-${worldId}` as never,
      },
      {
        participantId: `participant-noise-${worldId}` as never,
        worldId: id,
        kind: "noise-trader",
        accountId: `account-synth-${worldId}` as never,
      },
      {
        participantId: `participant-momentum-${worldId}` as never,
        worldId: id,
        kind: "momentum",
        accountId: `account-synth-${worldId}` as never,
      },
    ],
    riskLimits: { [String(`account-agent-${worldId}`)]: AGENT_WORLD_LIMITS },
    informationArtifacts: [
      newsArtifact(worldId, ARTIFACT_EARLY, "the early wire story", SIM_START as never),
      newsArtifact(worldId, ARTIFACT_LATER, "the later wire story", ARTIFACT_LATER_AT),
    ],
  };
}

/** A news artifact (the W027 information-world shape). */
export function newsArtifact(
  worldId: string,
  artifactId: never,
  headline: string,
  availableAt: never,
): InformationArtifact<NewsPayload> {
  return {
    artifactId,
    worldId: worldId as never,
    source: "w035-fixture-wire",
    createdAt: availableAt,
    availableAt,
    scope: "news",
    provenance: { producer: "w035-fixture-wire" as never, recordedAt: availableAt },
    version: "1",
    payload: { headline },
  };
}

/** The fixture news-artifact type (re-exported for the alpha A7 case). */
export type InformationArtifactFixture = InformationArtifact<NewsPayload>;

// --- the wide dispatch fixtures (the 8-kind action test) ----------------------

export const SUBSTRATE_WIDE = "substrate-w035-wide" as SubstrateId;

/** The wide substrate descriptor: proposes all eight command kinds. */
export function wideSubstrateDescriptor(): CognitiveSubstrateDescriptor {
  return {
    substrateId: SUBSTRATE_WIDE,
    displayName: "fixture wide dispatch mind",
    stateMode: "stateless-per-view",
    seed: "w035-wide-1",
    decisionRate: { maxDecisionsPerView: 8 },
    commandKinds: [
      "submit-order",
      "cancel-order",
      "replace-order",
      "close-position",
      "add-annotation",
      "create-snapshot",
      "branch-world",
      "set-scenario",
    ],
  };
}

/** The wide possession: the widest body × the widest scope (the dispatch case). */
export function widePossession(worldId: string = PROTOCOL_WORLD_ID): PossessionDescriptor {
  const body = agentBody(worldId);
  return {
    possessionId: POSSESSION_ID,
    body: { ...body, embodiment: wideEmbodiment(worldId) },
    substrate: wideSubstrateDescriptor(),
    grant: {
      grantedBy: PRINCIPAL,
      channel: "operator",
      grantedAt: SIM_START as never,
      basis: "operator-reviewed wide dispatch fixture for the W035 action laws",
    },
    scope: {
      instruments: [`instrument-es-${worldId}` as never, `instrument-nq-${worldId}` as never],
      observations: ["market-quote"] as PossessionDescriptor["scope"]["observations"],
      commandKinds: [
        "submit-order",
        "cancel-order",
        "replace-order",
        "close-position",
        "add-annotation",
        "create-snapshot",
        "branch-world",
        "set-scenario",
      ] as PossessionDescriptor["scope"]["commandKinds"],
      decisionRate: { maxDecisionsPerView: 8 },
    },
  };
}

/**
 * The wide lawful stream: one decision per command kind (all eight), each
 * complete, deterministic and lawful against the wide possession — the
 * FIFO dispatch fixture.
 */
export function wideStream(worldId: string = PROTOCOL_WORLD_ID): DecisionStream {
  const viewDigest = "view-digest-w035-wide" as never;
  const at = (SIM_START + 5 * SEC) as never;
  const base = {
    worldId: worldId as never,
    issuedBy: `participant-agent-${worldId}` as never,
    issuedAt: at,
  };
  const es = `instrument-es-${worldId}` as never;
  const account = `account-agent-${worldId}` as never;
  const rationale = (rule: string) => ({
    rule,
    signals: [{ name: "fixture", value: rule }],
    explanation: `the wide dispatch fixture's ${rule} proposal`,
  });
  const decision = (index: number, rule: string, command: DecisionStream["decisions"][number]["command"]) => ({
    decisionId: `decision-w035-wide-${String(index)}` as never,
    viewDigest,
    command,
    rationale: rationale(rule),
    confidence: 0.5,
  });
  return {
    substrateId: SUBSTRATE_WIDE,
    seed: "w035-wide-1",
    viewDigest,
    asOf: at,
    decisions: [
      decision(0, "submit-order", {
        ...base,
        commandId: "command-w035-wide-0" as never,
        kind: "submit-order",
        accountId: account,
        instrumentId: es,
        submission: {
          kind: "market",
          side: "buy",
          quantity: "1" as never,
          constraints: { timeInForce: "GTC" },
        },
      }),
      decision(1, "cancel-order", {
        ...base,
        commandId: "command-w035-wide-1" as never,
        kind: "cancel-order",
        orderId: "order-w035-unknown" as never,
        reason: "fixture cancel",
      }),
      decision(2, "replace-order", {
        ...base,
        commandId: "command-w035-wide-2" as never,
        kind: "replace-order",
        orderId: "order-w035-unknown" as never,
        quantity: "2" as never,
      }),
      decision(3, "close-position", {
        ...base,
        commandId: "command-w035-wide-3" as never,
        kind: "close-position",
        accountId: account,
        instrumentId: es,
      }),
      decision(4, "add-annotation", {
        ...base,
        commandId: "command-w035-wide-4" as never,
        kind: "add-annotation",
        instrumentId: es,
        at,
        text: "the wide dispatch fixture annotated",
      }),
      decision(5, "create-snapshot", {
        ...base,
        commandId: "command-w035-wide-5" as never,
        kind: "create-snapshot",
        label: "w035-dispatch-snapshot",
      }),
      decision(6, "branch-world", {
        ...base,
        commandId: "command-w035-wide-6" as never,
        kind: "branch-world",
        sourceSnapshotId: "snapshot-w035-unknown" as never,
      }),
      decision(7, "set-scenario", {
        ...base,
        commandId: "command-w035-wide-7" as never,
        kind: "set-scenario",
        scenario: { entries: [] },
      }),
    ],
  };
}

// --- the agent Body / substrate / possession fixtures -------------------------

import { agentBody, POSSESSION_ID, PRINCIPAL, wideEmbodiment } from "./agentFixtures.js";
export * from "./agentFixtures.js";