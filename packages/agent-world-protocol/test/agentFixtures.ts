/**
 * The agent-side fixtures (split from fixtures.ts — the 400-line law): the
 * Body/Substrate/Possession fixture family and the scripted/spy clients.
 */
import type { RiskLimits, TimestampMs } from "tradrl-world-contracts";
import type { DecisionStream } from "tradrl-world-contracts/cognitiveSubstrate";
import type { BodyDescriptor, BodyEmbodiment, BodyId } from "tradrl-world-contracts/agentBody";
import type { SubstrateId } from "tradrl-world-contracts/cognitiveSubstrate";
import type { PossessionDescriptor, PossessionId } from "possession/contracts";
import type { AgentWorldClient } from "../contracts.js";
import {
  PROTOCOL_WORLD_ID,
  SIM_START,
  SEC,
  TENANT,
  PROJECT,
  VENUE_SIM,
  INSTRUMENT_ES,
  ACCOUNT_AGENT,
  PARTICIPANT_AGENT,
  money,
} from "./fixtures.js";
import type {
  Quote,
  InformationArtifact,
  NewsPayload,
  CommandResult,
  WorldCommand,
} from "tradrl-world-contracts";
import type { CognitiveSubstrateDescriptor } from "tradrl-world-contracts/cognitiveSubstrate";

export const BODY_AGENT = "body-w035-agent" as BodyId;
export const SUBSTRATE_MR = "substrate-w035-mr" as SubstrateId;
export const POSSESSION_ID = "possession-w035-one" as PossessionId;
export const PRINCIPAL = "principal-w035-operator" as PossessionDescriptor["grant"]["grantedBy"];

/** The agent Body on the protocol world (the W034 alpha pattern). */
export function agentBody(worldId: string = PROTOCOL_WORLD_ID): BodyDescriptor {
  return {
    bodyId: BODY_AGENT,
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: worldId as never },
    participantId: `participant-agent-${worldId}` as never,
    accountId: `account-agent-${worldId}` as never,
    participantKind: "human",
    embodiment: agentEmbodiment(worldId),
    riskEnvelope: agentEnvelope(),
  };
}

/** The full trader embodiment (all order kinds/TIFs, the five trader commands). */
export function agentEmbodiment(worldId: string = PROTOCOL_WORLD_ID): BodyEmbodiment {
  return {
    instruments: [`instrument-es-${worldId}` as never, `instrument-nq-${worldId}` as never],
    venues: [VENUE_SIM],
    orderKinds: ["market", "limit", "stop", "stop-limit"],
    timeInForce: ["GTC", "IOC", "FOK"],
    commandKinds: ["submit-order", "cancel-order", "replace-order", "close-position", "add-annotation"],
  };
}

/**
 * The widest embodiment (all EIGHT command kinds — the dispatch fixture:
 * the Body terminates at the same CommandPort, world-admin commands
 * included when the embodiment declares them).
 */
export function wideEmbodiment(worldId: string = PROTOCOL_WORLD_ID): BodyEmbodiment {
  return {
    ...agentEmbodiment(worldId),
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

/** The Body's envelope: strictly within the world's declared limits. */
export function agentEnvelope(overrides: Partial<RiskLimits> = {}): RiskLimits {
  return {
    maxOrderQuantity: "8" as never,
    maxPositionQuantity: "32" as never,
    maxLeverage: 2,
    maxGrossExposure: money("120000"),
    maxDrawdown: money("4000"),
    minBuyingPowerAfterOrder: money("12000"),
    ...overrides,
  };
}

/** The default (ES-desk) possession scope — everything the view grants. */
export function esScope(
  worldId: string = PROTOCOL_WORLD_ID,
  overrides: Partial<PossessionDescriptor["scope"]> = {},
) {
  return {
    instruments: [`instrument-es-${worldId}` as never],
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

/** A possession descriptor around a given substrate descriptor. */
export function possessionOf(
  substrate: CognitiveSubstrateDescriptor,
  worldId: string = PROTOCOL_WORLD_ID,
  overrides: Partial<PossessionDescriptor> = {},
): PossessionDescriptor {
  return {
    possessionId: POSSESSION_ID,
    body: agentBody(worldId),
    substrate,
    grant: {
      grantedBy: PRINCIPAL,
      channel: "operator",
      grantedAt: SIM_START as never,
      basis: "operator-reviewed reference mind for the W035 ES desk",
    },
    scope: esScope(worldId),
    ...overrides,
  };
}

/**
 * A complete, lawful decision stream from the default substrate over the
 * ES desk (the W034 `lawfulStream` pattern): passes the W034 decision-level
 * admission against the default possession. `overrides` adapts it for
 * violation cases.
 */
export function lawfulStream(overrides: Partial<DecisionStream> = {}): DecisionStream {
  const viewDigest = "view-digest-w035-fixture" as never;
  const at = (SIM_START + 60 * SEC) as never;
  return {
    substrateId: SUBSTRATE_MR,
    seed: "w035-mr-1",
    viewDigest,
    asOf: at,
    decisions: [
      {
        decisionId: "decision-w035-1" as never,
        viewDigest,
        command: {
          commandId: "command-w035-1" as never,
          worldId: PROTOCOL_WORLD_ID as never,
          issuedBy: PARTICIPANT_AGENT,
          issuedAt: at,
          kind: "submit-order",
          accountId: ACCOUNT_AGENT,
          instrumentId: INSTRUMENT_ES,
          submission: {
            kind: "market",
            side: "buy",
            quantity: "1" as never,
            constraints: { timeInForce: "GTC" },
          },
        },
        rationale: {
          rule: "fixture-mr-edge",
          signals: [
            { name: "instrument", value: String(INSTRUMENT_ES) },
            { name: "zone", value: "low" },
          ],
          explanation: "fixture mean-reversion edge — buy one market lot",
        },
        confidence: 0.8,
      },
    ],
    ...overrides,
  };
}

// --- the scripted client (a disclosed deterministic TEST seam) ----------------

/** One recorded port call (the spy surface). */
export interface ScriptedCall {
  readonly port: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

/** The scripted client's fixture data (deterministic; no RNG, no wall reads). */
export interface ScriptedClientScript {
  readonly worldId: string;
  /** The getClock behavior (called at the read start, per family read, and trailing). */
  readonly clock: () => TimestampMs;
  readonly quote?: Quote;
  readonly news?: readonly InformationArtifact<NewsPayload>[];
  /** The CommandResult every command method returns (default: a typed ack). */
  readonly commandResult?: CommandResult;
  /** When true, every command method records but throws (the dead-transport law). */
  readonly failCommands?: boolean;
}

/**
 * A deterministic scripted `AgentWorldClient` for the protocol laws a
 * lawful engine can never produce: the never-settling clock (the
 * torn-read guard) and the port/grant artifact inconsistency. Every call
 * is recorded; nothing is random.
 */
export function scriptedAgentWorldClient(script: ScriptedClientScript): {
  readonly client: AgentWorldClient;
  readonly calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  const record = (port: string, method: string) => (...args: unknown[]) => {
    calls.push({ port, method, args });
  };
  const acked = (command: WorldCommand): CommandResult => ({
    status: "acked",
    ack: {
      commandId: command.commandId,
      worldId: command.worldId,
      acceptedAt: command.issuedAt,
      resultingEventIds: ["event-scripted-1" as never],
      journalCursor: 1 as never,
    },
  });
  const commandMethod = (method: string) => (command: WorldCommand) => {
    record("command", method)(command);
    if (script.failCommands === true) {
      throw new Error(`[scripted] command ${method} failed closed`);
    }
    return Promise.resolve(script.commandResult ?? acked(command));
  };
  const client: AgentWorldClient = {
    worldId: script.worldId,
    query: {
      getWorldMeta: async () => {
        throw new Error("[scripted] getWorldMeta is not part of the agent observation surface");
      },
      getSnapshot: async () => {
        throw new Error("[scripted] getSnapshot is not part of the agent observation surface");
      },
      getInstrument: async (instrumentId) => {
        record("query", "getInstrument")(instrumentId);
        throw new Error("[scripted] getInstrument is not part of the agent observation surface");
      },
      getQuote: async (instrumentId) => {
        record("query", "getQuote")(instrumentId);
        if (script.quote === undefined) {
          throw new Error("[scripted] no quote scripted");
        }
        return script.quote;
      },
      getOrderBook: async (instrumentId) => {
        record("query", "getOrderBook")(instrumentId);
        throw new Error("[scripted] no book scripted");
      },
      getTrades: async (instrumentId) => {
        record("query", "getTrades")(instrumentId);
        return [];
      },
      getOrders: async () => [],
      getPositions: async () => [],
      getPortfolio: async () => {
        throw new Error("[scripted] no portfolio scripted");
      },
      getRisk: async () => {
        throw new Error("[scripted] no risk scripted");
      },
      getNews: async () => {
        record("query", "getNews")();
        return script.news ?? [];
      },
      getTimeline: async () => {
        throw new Error("[scripted] getTimeline is not part of the agent observation surface");
      },
    },
    command: {
      submitOrder: commandMethod("submitOrder"),
      cancelOrder: commandMethod("cancelOrder"),
      replaceOrder: commandMethod("replaceOrder"),
      closePosition: commandMethod("closePosition"),
      addAnnotation: commandMethod("addAnnotation"),
      createSnapshot: commandMethod("createSnapshot"),
      branchWorld: commandMethod("branchWorld"),
      setScenario: commandMethod("setScenario"),
    },
    clock: {
      play: async () => {},
      pause: async () => {},
      step: async () => {},
      seek: async () => {},
      jumpToEvent: async () => {},
      setSpeed: async () => {},
      followRealtime: async () => {},
      getClock: async () => {
        const at = script.clock();
        return {
          simulationTime: at,
          status: "paused",
          speed: 1,
          followingRealtime: false,
        };
      },
    },
    onClock: () => () => {},
  };
  return { client, calls };
}

/** A recording wrapper over a REAL client's command port (the spy surface). */
export function spyCommandsOn(client: AgentWorldClient): {
  readonly client: AgentWorldClient;
  readonly calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  const wrap =
    (method: string) =>
    (command: WorldCommand): Promise<CommandResult> => {
      calls.push({ port: "command", method, args: [command] });
      const ports = client.command as unknown as Record<
        string,
        (command: WorldCommand) => Promise<CommandResult>
      >;
      const target = ports[method];
      if (target === undefined || target === null) {
        throw new Error(`[spy] no such command method: ${method}`);
      }
      return target(command);
    };
  return {
    client: {
      worldId: client.worldId,
      query: client.query,
      command: {
        submitOrder: wrap("submitOrder"),
        cancelOrder: wrap("cancelOrder"),
        replaceOrder: wrap("replaceOrder"),
        closePosition: wrap("closePosition"),
        addAnnotation: wrap("addAnnotation"),
        createSnapshot: wrap("createSnapshot"),
        branchWorld: wrap("branchWorld"),
        setScenario: wrap("setScenario"),
      },
      clock: client.clock,
      onClock: client.onClock,
    },
    calls,
  };
}
