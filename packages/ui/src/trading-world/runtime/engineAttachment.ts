/**
 * TL wiring (W018 follow-up, shared-surface integration): the real
 * engine-backed attachment for the Trading World pane.
 *
 * Builds a minimal, honest World Alpha definition (one ES-like instrument,
 * one sim venue with fees/latency, one 100k account, one human participant)
 * and attaches the W018 in-process transport — the SAME typed surface the
 * worker topology uses (UI/headless parity, ACCEPTANCE I).
 *
 * Honest state today: the engine starts with EMPTY books (no generator until
 * W017; knownLimitations say so in WorldMeta) — the UI renders real
 * projections of an honestly-empty world, never fabricated data.
 */

import {
  createInProcessWorldTransport,
  type WorldTransport,
} from "tradrl-world-sim/adapter";
import type { WorldDefinition } from "tradrl-world-sim/world";

export interface AlphaEngineAttachment {
  readonly transport: WorldTransport;
}

const ALPHA_TENANT = "tenant-alpha" as WorldDefinition["scope"]["tenantId"];
const ALPHA_PROJECT = "project-tradrl" as WorldDefinition["scope"]["projectId"];

/** Simulation clock origin: 2023-11-14T22:13:20Z (a fixed, boring epoch). */
const SIM_START = 1_700_000_000_000;
/** Wall origin deliberately later than sim start (recorded, never mixed). */
const WALL_START = 1_700_000_500_000;

export function alphaWorldDefinition(worldId: string): WorldDefinition {
  const id = worldId as WorldDefinition["scope"]["worldId"];
  return {
    scope: { tenantId: ALPHA_TENANT, projectId: ALPHA_PROJECT, worldId: id },
    mode: "reactive-replay",
    seed: `alpha:${worldId}`,
    worldDefinitionVersion: "world-alpha@1",
    inputDataSource: "synthetic://world-alpha",
    clock: {
      start: SIM_START as WorldDefinition["clock"]["start"],
      defaultStepMs: 1000,
      initialWallTime: WALL_START as WorldDefinition["clock"]["initialWallTime"],
    },
    instruments: [
      {
        instrumentId: `instrument-es-${worldId}` as never,
        worldId: id,
        venueId: "venue-alpha-sim" as never,
        symbol: "ES-ALPHA",
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
        venueId: "venue-alpha-sim" as never,
        worldId: id,
        name: "alpha-sim-venue",
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
    ],
    participants: [
      {
        participantId: `participant-trader-${worldId}` as never,
        worldId: id,
        kind: "human",
        accountId: `account-trader-${worldId}` as never,
      },
    ],
  };
}

/** One transport per attach — the W018 controller owns its lifecycle. */
export function createAlphaEngineTransport(worldId: string): WorldTransport {
  return createInProcessWorldTransport({
    definition: alphaWorldDefinition(worldId),
  });
}
