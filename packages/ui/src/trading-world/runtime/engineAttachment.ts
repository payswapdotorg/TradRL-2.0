/**
 * TL wiring (W018 follow-up, shared-surface integration): the real
 * engine-backed attachment for the Trading World pane.
 *
 * Builds a minimal, honest World Alpha definition (one ES-like instrument,
 * one sim venue with fees/latency, one 100k account, one human participant)
 * and attaches the W018 in-process transport — the SAME typed surface the
 * worker topology uses (UI/headless parity, ACCEPTANCE I).
 *
 * TL wiring update (W017 follow-up): the alpha world now runs the W017
 * generated market — `createGeneratedWorldEngine` behind the W018 transport's
 * new `createEngine` seam, driven by the definition's `regimeSchedule`.
 * The books fill with real generated liquidity as the clock advances; the
 * UI renders real projections of that generated world, never fabricated
 * data. Deterministic: same definition+seed+clock ⇒ same market.
 */

import {
  createInProcessWorldTransport,
  type WorldTransport,
} from "tradrl-world-sim/adapter";
import { createGeneratedWorldEngine } from "tradrl-world-sim/generator";
import type { WorldDefinition } from "tradrl-world-sim/world";

export interface AlphaEngineAttachment {
  readonly transport: WorldTransport;
}

const ALPHA_TENANT = "tenant-alpha" as WorldDefinition["scope"]["tenantId"];
const ALPHA_PROJECT = "project-tradrl" as WorldDefinition["scope"]["projectId"];

/** Simulation clock origin: 2023-11-14T22:13:20Z (a fixed, boring epoch). */
const SIM_START = 1_700_000_000_000;
/** One minute in simulation ms (regime-schedule readability). */
const MIN = 60_000;
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
    /**
     * The W017 regime schedule (world metadata, SIMULATION.md "Synthetic
     * regimes"): a gentle multi-regime trading day for the alpha world.
     * Times are absolute simulation-ms offsets from SIM_START. Deterministic:
     * the generator seeds from `seed`, so the same definition+clock produce
     * the same market, regime by regime.
     */
    regimeSchedule: [
      // Cold start: mean-reversion is anchor-mode — the first entry declares
      // the anchor the makers open around (empty book, no tape yet). Without
      // it the market cannot seed itself (W017 referencePriceOf law).
      {
        regime: "mean-reversion",
        from: SIM_START as never,
        to: (SIM_START + 30 * MIN) as never,
        parameters: { anchorPrice: 4800, direction: 1 },
      },
      { regime: "trend", from: (SIM_START + 30 * MIN) as never, to: (SIM_START + 60 * MIN) as never },
      {
        regime: "high-volatility",
        from: (SIM_START + 60 * MIN) as never,
        to: (SIM_START + 90 * MIN) as never,
      },
      {
        regime: "low-liquidity",
        from: (SIM_START + 90 * MIN) as never,
        to: (SIM_START + 120 * MIN) as never,
      },
      // Open-ended calm close: the day settles back into mean reversion.
      { regime: "mean-reversion", from: (SIM_START + 120 * MIN) as never },
    ],
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
      // The synthetic cast's accounts: the two passive market makers share
      // one margin account; the aggressive side (taker/noise/momentum) shares
      // another — same shape as the W017 test definitions' population.
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
    ],
    participants: [
      // The human trader (the console's user) + the W017 synthetic cast:
      // the makers quote around the reference, the aggressive side trades —
      // everything through the REAL matching engine, never fabricated.
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
    ],
  };
}

/**
 * Options for {@link createAlphaEngineTransport} (additive, W019 disclosed
 * seam): the default behavior is UNCHANGED — an omitted option reproduces the
 * exact pre-W019 transport. `wallTimeSource` exists so the W019 determinism
 * golden can run the SAME composed attachment twice with wall axes a day
 * apart and prove wall time never enters the digests (A9 — the W017-golden
 * methodology at the integration level). It is forwarded verbatim to the
 * W018 in-process adapter's existing seam.
 */
export interface AlphaEngineTransportOptions {
  /** Injected wall-axis source (the engine-test pattern; default: host clock). */
  readonly wallTimeSource?: () => WorldDefinition["clock"]["initialWallTime"];
}

/** One transport per attach — the W018 controller owns its lifecycle. */
export function createAlphaEngineTransport(
  worldId: string,
  options: AlphaEngineTransportOptions = {},
): WorldTransport {
  return createInProcessWorldTransport({
    definition: alphaWorldDefinition(worldId),
    // TL wiring (W017 follow-up): host the GENERATED market, not the plain
    // headless engine — the books fill with real generated liquidity as
    // the clock advances (deterministic: same definition+seed+clock).
    createEngine: (engineOptions) =>
      createGeneratedWorldEngine({
        definition: engineOptions.definition,
        wallTimeSource: engineOptions.wallTimeSource,
        onPublished: engineOptions.onPublished,
      }),
    ...(options.wallTimeSource === undefined ? {} : { wallTimeSource: options.wallTimeSource }),
  });
}
