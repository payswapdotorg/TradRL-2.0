/**
 * The W023 test harness — the goldenJourneyContext-style helpers: a compact
 * multi-regime AGENT world over the REAL W017 generated market, attached
 * through the REAL W018 provider (`attachEngineWorldClient` over the
 * in-process transport), exactly the composed surface a Trading World pane
 * mounts (the TL wiring of packages/ui/src/trading-world/runtime/
 * engineAttachment.ts, mirrored verbatim for a world definition that
 * declares the reactive participants — the wiring is test-side; participants
 * themselves consume only the client).
 *
 * The world (declared, deterministic): one ES-like instrument, one sim venue
 * (fees + latency + no shock halts), the W017 synthetic cast (makers + the
 * aggressive side), one human trader, and TWO reactive agent participants
 * (kind "human" — the human/agent symmetry of A4/A15: AI traders use the
 * same protocol; the W017 generator ignores human-kind participants, so
 * attribution is clean) with their own account. Regimes: mean-reversion
 * anchor cold start → trend → halt-reopen → mean-reversion close, on the 1s
 * action grid — seconds of wall time per run, a real tape.
 */

import {
  attachEngineWorldClient,
  type EngineWorldClient,
} from "../../ui/src/trading-world/runtime/engineWorldClient.js";
import { createInProcessWorldTransport } from "tradrl-world-sim/adapter";
import { createGeneratedWorldEngine } from "tradrl-world-sim/generator";
import type { WorldDefinition } from "tradrl-world-sim/world";
import type { InformationArtifact } from "tradrl-world-contracts";
import type { NewsPayload } from "tradrl-world-contracts";

/** The agent world identity (seed = `agents:<worldId>`). */
export const AGENT_WORLD_ID = "world-w023-agents";
/** Simulation origin (2023-11-14T22:13:20Z — the house epoch). */
export const SIM_START = 1_700_000_000_000;
/** One simulation second. */
export const SEC = 1_000;
/** Wall origin deliberately later than sim start (recorded, never mixed). */
export const WALL_START = 1_700_000_500_000;

/** The agent world's only instrument. */
export const AGENT_INSTRUMENT_ID = `instrument-es-${AGENT_WORLD_ID}`;
/** The reactive agents' shared account. */
export const AGENT_ACCOUNT_ID = `account-agents-${AGENT_WORLD_ID}`;
/** The momentum agent's declared participant. */
export const AGENT_MOMENTUM_PARTICIPANT_ID = `participant-agent-momentum-${AGENT_WORLD_ID}`;
/** The mean-reversion agent's declared participant. */
export const AGENT_MR_PARTICIPANT_ID = `participant-agent-mr-${AGENT_WORLD_ID}`;
/** The human trader (present so the world is a real cockpit world). */
export const HUMAN_PARTICIPANT_ID = `participant-trader-${AGENT_WORLD_ID}`;

/** A wall-time source fixed at an arbitrary origin (determinism runs). */
export function fixedWallSource(at: number): () => number {
  return () => at;
}

/** News artifact payload shape (the W027 information-world contracts). */
type AgentNewsArtifact = InformationArtifact<NewsPayload>;

/** Options for {@link agentWorldDefinition}. */
export interface AgentWorldOptions {
  /** Extra information artifacts (the A7 news tests declare future items). */
  readonly informationArtifacts?: readonly AgentNewsArtifact[];
  /** Regime-schedule override (defaults to the compact agent day). */
  readonly regimeSchedule?: WorldDefinition["regimeSchedule"];
}

/** The compact multi-regime agent world definition (deterministic, seeded). */
export function agentWorldDefinition(
  worldId: string = AGENT_WORLD_ID,
  options: AgentWorldOptions = {},
): WorldDefinition {
  const id = worldId as WorldDefinition["scope"]["worldId"];
  const base: WorldDefinition = {
    scope: {
      tenantId: "tenant-alpha" as never,
      projectId: "project-tradrl" as never,
      worldId: id,
    },
    mode: "reactive-replay",
    seed: `agents:${worldId}`,
    worldDefinitionVersion: "world-agents@1",
    inputDataSource: "synthetic://world-agents",
    regimeSchedule:
      options.regimeSchedule ??
      ([
        {
          regime: "mean-reversion",
          from: SIM_START as never,
          to: (SIM_START + 30 * SEC) as never,
          parameters: { anchorPrice: 4800, direction: 1 },
        },
        {
          regime: "trend",
          from: (SIM_START + 30 * SEC) as never,
          to: (SIM_START + 70 * SEC) as never,
        },
        {
          regime: "halt-reopen",
          from: (SIM_START + 70 * SEC) as never,
          to: (SIM_START + 78 * SEC) as never,
        },
        {
          regime: "mean-reversion",
          from: (SIM_START + 78 * SEC) as never,
        },
      ] as WorldDefinition["regimeSchedule"]),
    clock: {
      start: SIM_START as never,
      defaultStepMs: 1000,
      initialWallTime: WALL_START as never,
    },
    instruments: [
      {
        instrumentId: `instrument-es-${worldId}` as never,
        worldId: id,
        venueId: "venue-agents-sim" as never,
        symbol: "ES-AGENTS",
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
        venueId: "venue-agents-sim" as never,
        worldId: id,
        name: "agents-sim-venue",
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
      {
        accountId: `account-trader-${worldId}` as never,
        worldId: id,
        balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
        buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
      {
        accountId: `account-mm-${worldId}` as never,
        worldId: id,
        balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
        buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
      {
        accountId: `account-synth-${worldId}` as never,
        worldId: id,
        balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
        buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
      {
        accountId: `account-agents-${worldId}` as never,
        worldId: id,
        balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
        buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
    ],
    participants: [
      {
        participantId: `participant-trader-${worldId}` as never,
        worldId: id,
        kind: "human",
        accountId: `account-trader-${worldId}` as never,
      },
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
      // The reactive agents (W023): kind "human" — the A4/A15 human/agent
      // symmetry (AI traders use the same protocol); the generator does not
      // plan for human-kind participants, so every agent command and fill is
      // cleanly attributable to the reactive protocol.
      {
        participantId: `participant-agent-momentum-${worldId}` as never,
        worldId: id,
        kind: "human",
        accountId: `account-agents-${worldId}` as never,
      },
      {
        participantId: `participant-agent-mr-${worldId}` as never,
        worldId: id,
        kind: "human",
        accountId: `account-agents-${worldId}` as never,
      },
    ],
    ...(options.informationArtifacts === undefined
      ? {}
      : { informationArtifacts: options.informationArtifacts }),
  };
  return base;
}

/** Options for {@link attachAgentWorld}. */
export interface AttachAgentWorldOptions extends AgentWorldOptions {
  /** Wall-axis source (the twin runs fix it a day apart; default: host clock). */
  readonly wallTimeSource?: () => number;
}

/**
 * Attach the REAL provider over the agent world: the W018 in-process
 * transport hosting the W017 generated market — the engineAttachment.ts
 * wiring verbatim, with the agent world definition.
 */
export async function attachAgentWorld(
  worldId: string = AGENT_WORLD_ID,
  options: AttachAgentWorldOptions = {},
): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createInProcessWorldTransport({
      definition: agentWorldDefinition(worldId, options),
      createEngine: (engineOptions) =>
        createGeneratedWorldEngine({
          definition: engineOptions.definition,
          wallTimeSource: engineOptions.wallTimeSource,
          onPublished: engineOptions.onPublished,
        }),
      ...(options.wallTimeSource === undefined
        ? {}
        : { wallTimeSource: options.wallTimeSource as () => never }),
    }),
    expectedWorldId: worldId,
  });
}
