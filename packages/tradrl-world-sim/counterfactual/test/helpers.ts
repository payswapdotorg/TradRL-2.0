/**
 * The W025 counterfactual test harness — the goldenJourneyContext-style
 * helpers: a compact deterministic GENERATED parent world (the W017 market
 * over the W014/W015 engine — makers, an aggressive side, a human trader
 * and a declared reactive agent participant for the W023 attachment), the
 * disciplined parent journey (drive → snapshot → continuation), the branch
 * factory over the REAL generated engine, and the fixed branch journeys
 * the determinism goldens pin.
 *
 * Everything here is deterministic: fixed ids, fixed times, the seeded
 * W017 generator (the parent seed drives the market; a branch's OWN seed
 * drives the branch's market — the counterfactual axis).
 */

import type {
  Account,
  InformationArtifact,
  Instrument,
  NewsPayload,
  Participant,
  RegimeScheduleEntry,
  SnapshotId,
  SubmitOrderCommand,
  AddAnnotationCommand,
  Venue,
  WorldScope,
} from "tradrl-world-contracts";
import type { WallTimeMs } from "tradrl-world-contracts/time";
import { asSimulationTime, asWallTime } from "tradrl-world-contracts/time";
import type { WorldDefinition } from "../../world/index.js";
import type { HeadlessWorldEngine } from "../../world/index.js";
import { createGeneratedWorldEngine } from "../../generator/index.js";
import { snapshotIdFor } from "../../snapshot/index.js";
import { fixedWallTimeSource } from "../../world/test/helpers.js";
import type { CounterfactualEngineFactory } from "../engine.js";
import { createCounterfactualBranchEngine } from "../engine.js";
import type { CounterfactualBranchHandle } from "../engine.js";
import type { CounterfactualBranch } from "../index.js";

/** The parent world identity. */
export const PARENT_WORLD_ID = "world-w025-parent";
/** Simulation origin (2023-11-14T22:13:20Z — the house epoch). */
export const SIM_START = 1_700_000_000_000;
/** One simulation second. */
export const SEC = 1_000;
/** Wall origin deliberately later than sim start (recorded, never mixed). */
export const WALL_START = SIM_START + 500_000;
/** The parent's seed (drives the parent market; control branches reuse it). */
export const PARENT_SEED = "w025-parent-seed";

export const TRADER_PARTICIPANT_ID = `participant-trader-${PARENT_WORLD_ID}`;
export const TRADER_ACCOUNT_ID = `account-trader-${PARENT_WORLD_ID}`;
export const INSTRUMENT_ID = `instrument-es-${PARENT_WORLD_ID}`;
export const AGENT_ACCOUNT_ID = `account-agents-${PARENT_WORLD_ID}`;
export const AGENT_MOMENTUM_PARTICIPANT_ID = `participant-agent-momentum-${PARENT_WORLD_ID}`;

/** The parent's regime schedule (mean-reversion → trend → mean-reversion). */
export const PARENT_SCHEDULE: readonly RegimeScheduleEntry[] = [
  {
    regime: "mean-reversion",
    from: asSimulationTime(SIM_START),
    to: asSimulationTime(SIM_START + 30 * SEC),
    parameters: { anchorPrice: 4800, direction: 1 },
  },
  { regime: "trend", from: asSimulationTime(SIM_START + 30 * SEC), to: asSimulationTime(SIM_START + 70 * SEC) },
  { regime: "mean-reversion", from: asSimulationTime(SIM_START + 70 * SEC), parameters: { anchorPrice: 4900, direction: 1 } },
];

function accountOf(accountId: string): Account {
  return {
    accountId: accountId as Account["accountId"],
    worldId: PARENT_WORLD_ID as Account["worldId"],
    balances: { USD: { amount: "100000.00", currency: "USD" } } as Account["balances"],
    buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

function participantOf(participantId: string, kind: Participant["kind"], accountId: string): Participant {
  return {
    participantId: participantId as Participant["participantId"],
    worldId: PARENT_WORLD_ID as Participant["worldId"],
    kind,
    accountId: accountId as Participant["accountId"],
  };
}

/** The parent world's news artifacts (visible now / delayed — A7 fixtures). */
export function parentNewsArtifacts(): readonly InformationArtifact<NewsPayload>[] {
  const news = (artifactId: string, availableAt: number, headline: string): InformationArtifact<NewsPayload> => ({
    artifactId: artifactId as never,
    worldId: PARENT_WORLD_ID as never,
    source: "w025-wire",
    createdAt: SIM_START as never,
    availableAt: availableAt as never,
    scope: "news",
    provenance: { producer: "w025-wire" as never, recordedAt: SIM_START as never },
    version: "1",
    payload: { headline },
  });
  return [news("news-parent-visible", SIM_START, "parent news at the origin")];
}

/** The compact generated parent world definition (deterministic, seeded). */
export function parentWorldDefinition(): WorldDefinition {
  const instrument: Instrument = {
    instrumentId: INSTRUMENT_ID as never,
    worldId: PARENT_WORLD_ID as never,
    venueId: "venue-w025-sim" as never,
    symbol: "ES-W025",
    assetClass: "future",
    quoteCurrency: "USD" as never,
    tickSize: "0.25" as never,
    lotSize: "1" as never,
    pricePrecision: 2,
    quantityPrecision: 0,
    tradingState: "open",
    tradable: true,
  };
  const venue: Venue = {
    venueId: "venue-w025-sim" as never,
    worldId: PARENT_WORLD_ID as never,
    name: "w025-sim-venue",
    matchingModel: "price-time-priority",
    allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
    feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
    latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
    calendar: { sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }] },
    haltPolicy: { haltOnShock: false },
  };
  return {
    scope: {
      tenantId: "tenant-alpha" as WorldScope["tenantId"],
      projectId: "project-tradrl" as WorldScope["projectId"],
      worldId: PARENT_WORLD_ID as WorldScope["worldId"],
    },
    mode: "reactive-replay",
    seed: PARENT_SEED,
    worldDefinitionVersion: "w025-parent-def@1",
    inputDataSource: "synthetic://w025",
    regimeSchedule: PARENT_SCHEDULE,
    clock: {
      start: asSimulationTime(SIM_START),
      defaultStepMs: 1000,
      initialWallTime: asWallTime(WALL_START),
    },
    instruments: [instrument],
    venues: [venue],
    accounts: [
      accountOf(TRADER_ACCOUNT_ID),
      accountOf(`account-mm-${PARENT_WORLD_ID}`),
      accountOf(`account-synth-${PARENT_WORLD_ID}`),
      accountOf(AGENT_ACCOUNT_ID),
    ],
    participants: [
      participantOf(TRADER_PARTICIPANT_ID, "human", TRADER_ACCOUNT_ID),
      participantOf(`participant-mm-1-${PARENT_WORLD_ID}`, "passive-market-maker", `account-mm-${PARENT_WORLD_ID}`),
      participantOf(`participant-mm-2-${PARENT_WORLD_ID}`, "passive-market-maker", `account-mm-${PARENT_WORLD_ID}`),
      participantOf(`participant-taker-${PARENT_WORLD_ID}`, "liquidity-taker", `account-synth-${PARENT_WORLD_ID}`),
      participantOf(`participant-noise-${PARENT_WORLD_ID}`, "noise-trader", `account-synth-${PARENT_WORLD_ID}`),
      participantOf(`participant-momentum-${PARENT_WORLD_ID}`, "momentum", `account-synth-${PARENT_WORLD_ID}`),
      // The reactive agent participant (W023): kind "human" — the A4/A15
      // human/agent symmetry; the generator ignores human-kind participants
      // so agent commands are cleanly attributable.
      participantOf(AGENT_MOMENTUM_PARTICIPANT_ID, "human", AGENT_ACCOUNT_ID),
    ],
    informationArtifacts: [...parentNewsArtifacts()],
  };
}

/**
 * The generated-engine factory for branches (the W017 wrapper). NOTE the
 * disclosed W017 seam: the wrapper forwards (definition, restore,
 * wallTimeSource, onPublished) — `lineage` is dropped (the counterfactual
 * record + genesis capture carry the lineage evidence at this layer).
 */
export const generatedBranchEngine: CounterfactualEngineFactory = (options) =>
  createGeneratedWorldEngine({
    definition: options.definition,
    restore: options.restore,
    ...(options.wallTimeSource === undefined ? {} : { wallTimeSource: options.wallTimeSource }),
    ...(options.onPublished === undefined ? {} : { onPublished: options.onPublished }),
  });

/** How far the parent lives before the branch point (20 grid turns). */
export const BRANCH_POINT_MS = 20 * SEC;
/** Where the parent's continuation ends (drives the comparison window). */
export const CONTINUATION_END_MS = 50 * SEC;

/**
 * The deterministic parent journey: create the generated world, drive to
 * +20s (a real tape: maker liquidity, prints), take the origin snapshot.
 */
export async function parentWorldAtSnapshot(
  wallBase: number = WALL_START,
): Promise<{
  readonly engine: HeadlessWorldEngine;
  readonly definition: WorldDefinition;
  readonly sourceSnapshotId: SnapshotId;
  readonly branchPointTime: number;
}> {
  const definition = parentWorldDefinition();
  const engine = createGeneratedWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(wallBase) as () => WallTimeMs,
  });
  await engine.clock.seek(asSimulationTime(SIM_START + BRANCH_POINT_MS));
  const ack = await engine.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-w025-origin-snapshot" as never,
    worldId: definition.scope.worldId,
    issuedBy: TRADER_PARTICIPANT_ID as never,
    issuedAt: (SIM_START + BRANCH_POINT_MS) as never,
    label: "counterfactual origin",
  });
  if (ack.status !== "acked") {
    throw new Error("w025 fixture: origin snapshot failed");
  }
  return {
    engine,
    definition,
    sourceSnapshotId: snapshotIdFor(definition.scope.worldId, 1),
    branchPointTime: SIM_START + BRANCH_POINT_MS,
  };
}

/** Drive the parent's continuation from the branch point to +50s. */
export async function continueParent(engine: HeadlessWorldEngine): Promise<void> {
  await engine.clock.seek(asSimulationTime(SIM_START + CONTINUATION_END_MS));
}

/** Create a generated counterfactual branch of a parent. */
export async function branchFromParent(
  parent: HeadlessWorldEngine,
  branch: CounterfactualBranch,
  options: { readonly wallBase?: number } = {},
): Promise<CounterfactualBranchHandle> {
  return createCounterfactualBranchEngine({
    parent,
    branch,
    createEngine: generatedBranchEngine,
    ...(options.wallBase === undefined
      ? {}
      : { wallTimeSource: fixedWallTimeSource(options.wallBase) as () => WallTimeMs }),
  });
}

/** The fixed branch journey: drive the branch to +50s with a human trade. */
export async function driveBranchJourney(handle: CounterfactualBranchHandle): Promise<void> {
  // The journey is RELATIVE to the branch's genesis clock: branches may be
  // born at any point of their parent's life (a nested counterfactual is
  // born at +50s), and the A8 law refuses in-place backward moves — a
  // hardcoded early milestone would be an illegal rewind for late-born
  // branches. For the origin branches (born at the +20s branch point) the
  // times are exactly the historical ones (+25s order, +50s end).
  const start = Number(handle.engine.clockState().simulationTime);
  const orderAt = Math.max(start + 5 * SEC, SIM_START + 25 * SEC);
  await handle.engine.clock.seek(asSimulationTime(orderAt));
  // The command id is namespaced by the BRANCH WORLD id: a nested
  // counterfactual restores its parent branch's journal (which already
  // acknowledged this journey's command for ITS world) — the same id would
  // be a duplicate-command rejection. Per-world = deterministic (A9 twins
  // derive the same world id) AND unique across the family.
  const commandId = `cmd-cf-human-1@${String(handle.engine.worldId)}` as never;
  const order: SubmitOrderCommand = {
    kind: "submit-order",
    commandId,
    worldId: handle.engine.worldId,
    issuedBy: TRADER_PARTICIPANT_ID as never,
    issuedAt: orderAt as never,
    accountId: TRADER_ACCOUNT_ID as never,
    instrumentId: INSTRUMENT_ID as never,
    submission: {
      kind: "market",
      side: "buy",
      quantity: "2" as never,
      constraints: { timeInForce: "IOC" },
    },
  };
  const acked = await handle.engine.command.submitOrder(order);
  if (acked.status !== "acked") {
    throw new Error("w025 fixture: branch human order failed");
  }
  await handle.engine.clock.seek(asSimulationTime(Math.max(orderAt + 5 * SEC, SIM_START + CONTINUATION_END_MS)));
}

/** An annotation command with a fixed deterministic identity. */
export function branchAnnotationCommand(
  handle: CounterfactualBranchHandle,
  text: string,
): AddAnnotationCommand {
  return {
    kind: "add-annotation",
    commandId: "cmd-cf-annotation-1" as never,
    worldId: handle.engine.worldId,
    issuedBy: TRADER_PARTICIPANT_ID as never,
    issuedAt: handle.engine.clockState().simulationTime as never,
    at: handle.engine.clockState().simulationTime as never,
    text,
  };
}

/**
 * The domain evolution of a world, stripped of world identity (the W016
 * golden pattern): the trade tape, order registry and annotations.
 */
export function domainOutcomeOf(engine: HeadlessWorldEngine): {
  readonly trades: readonly (readonly string[])[];
  readonly orders: readonly (readonly string[])[];
  readonly annotations: readonly string[];
} {
  const state = engine.worldState();
  return {
    trades: state.matching.trades.map((trade) => [
      String(trade.price),
      String(trade.quantity),
      String(trade.aggressorSide),
      String(trade.tradeId).split(":").pop() ?? "",
    ]),
    orders: state.matching.orders.map((order) => [
      String(order.orderId).split(":").pop() ?? "",
      order.status,
      String(order.quantity),
    ]),
    annotations: state.annotations.map((annotation) => annotation.text),
  };
}
