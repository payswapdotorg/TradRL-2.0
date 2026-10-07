/**
 * Shared deterministic fixtures for the W031 CLI tests.
 *
 * Everything is hand-authored and fixed (ids, times, prices): the same
 * definition + script files always yield the same runs (A9). The world
 * definitions mirror the W020 (plain) and W017 (generated) test templates;
 * the dataset files mirror the W020/W027 loader fixtures.
 */

import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorldDefinition } from "tradrl-world-sim/world";

/** Fixture base time (2023-11-20T00:00:00Z — the W020 convention). */
export const T0 = 1_700_044_800_000;
export const MINUTE = 60_000;

export const PLAIN_WORLD = "world-w031-plain";
export const GEN_WORLD = "world-w031-gen";

/** Create a fresh temp dir for one test's files. */
export async function fixtureDir(prefix = "w031-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Write one JSON fixture; returns its path. */
export async function writeJson(dir: string, name: string, value: unknown): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

/** Write one raw-text fixture; returns its path. */
export async function writeText(dir: string, name: string, text: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, text, "utf8");
  return path;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function instrumentOf(worldId: string): Record<string, unknown> {
  return {
    instrumentId: "instrument-btcusd",
    worldId,
    venueId: "venue-w031",
    symbol: "BTC-USD",
    assetClass: "crypto",
    quoteCurrency: "USD",
    tickSize: "0.05",
    lotSize: "0.0001",
    pricePrecision: 2,
    quantityPrecision: 4,
    tradingState: "open",
    tradable: true,
  };
}

function accountOf(worldId: string, accountId: string, balance: string): Record<string, unknown> {
  return {
    accountId,
    worldId,
    balances: { USD: { amount: balance, currency: "USD" } },
    buyingPower: { amount: balance, currency: "USD" },
    marginUsed: { amount: "0.00", currency: "USD" },
    marginAvailable: { amount: balance, currency: "USD" },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

function participantOf(worldId: string, id: string, kind: string, accountId: string): Record<string, unknown> {
  return { participantId: id, worldId, kind, accountId };
}

/** A minimal VALID plain (no regimeSchedule) world definition JSON. */
export function plainDefinition(worldId = PLAIN_WORLD): Record<string, unknown> {
  return {
    scope: { tenantId: "tenant-w031", projectId: "project-w031", worldId },
    mode: "reactive-replay",
    seed: "w031-test-seed",
    worldDefinitionVersion: "w031-test-def@1",
    inputDataSource: "synthetic://w031-tests",
    clock: {
      start: T0,
      end: T0 + 10 * MINUTE,
      defaultStepMs: 1000,
      initialWallTime: T0 + 500_000,
    },
    instruments: [instrumentOf(worldId)],
    accounts: [accountOf(worldId, "account-trader", "100000.00")],
    participants: [participantOf(worldId, "participant-trader", "human", "account-trader")],
  };
}

/** A VALID generated-market world definition (the W017 synthetic cast). */
export function generatedDefinition(worldId = GEN_WORLD): Record<string, unknown> {
  return {
    scope: { tenantId: "tenant-w031", projectId: "project-w031", worldId },
    mode: "reactive-replay",
    seed: "w031-gen-test-seed",
    worldDefinitionVersion: "w031-gen-def@1",
    inputDataSource: "synthetic://w031-tests",
    regimeSchedule: [
      { regime: "trend", from: T0, to: T0 + 20_000, parameters: { anchorPrice: 4800, direction: 1 } },
      { regime: "high-volatility", from: T0 + 20_000, to: T0 + 60_000, parameters: { anchorPrice: 4800 } },
    ],
    clock: { start: T0, defaultStepMs: 1000, initialWallTime: T0 + 500_000 },
    instruments: [instrumentOf(worldId)],
    accounts: [
      accountOf(worldId, "account-trader", "100000.00"),
      accountOf(worldId, "account-mm", "10000000.00"),
      accountOf(worldId, "account-takers", "10000000.00"),
    ],
    participants: [
      participantOf(worldId, "participant-trader", "human", "account-trader"),
      participantOf(worldId, "participant-mm-1", "passive-market-maker", "account-mm"),
      participantOf(worldId, "participant-mm-2", "passive-market-maker", "account-mm"),
      participantOf(worldId, "participant-taker", "liquidity-taker", "account-takers"),
      participantOf(worldId, "participant-noise", "noise-trader", "account-takers"),
      participantOf(worldId, "participant-momentum", "momentum", "account-takers"),
    ],
  };
}

function buyLimit(commandId: string, limitPrice = "4800.10", quantity = "0.5"): Record<string, unknown> {
  return {
    kind: "submit-order",
    commandId,
    issuedBy: "participant-trader",
    accountId: "account-trader",
    instrumentId: "instrument-btcusd",
    submission: {
      kind: "limit",
      side: "buy",
      quantity,
      limitPrice,
      constraints: { timeInForce: "GTC" },
    },
  };
}

/** The mixed plain-world script: clock ops, acks, typed rejections. */
export function plainScript(): unknown[] {
  return [
    { id: "step-1", clock: { op: "step", deltaMs: 5000 } },
    { id: "buy-1", command: buyLimit("cmd-buy-1") },
    { id: "seek-1", clock: { op: "seek", to: T0 + 10_000 } },
    { id: "rewind-1", clock: { op: "seek", to: T0 } },
    { id: "buy-2", command: buyLimit("cmd-buy-2", "4799.90") },
    { id: "cancel-1", command: { kind: "cancel-order", commandId: "cmd-cancel-1", issuedBy: "participant-trader", orderId: "order-ghost" } },
    { id: "dup-1", command: buyLimit("cmd-buy-1") },
    { id: "speed-1", clock: { op: "set-speed", speed: 2 } },
    { id: "step-2", clock: { op: "step" } },
    { id: "annotate-1", command: { kind: "add-annotation", commandId: "cmd-ann-1", issuedBy: "participant-trader", at: T0, text: "cli test annotation" } },
    { id: "snapshot-1", command: { kind: "create-snapshot", commandId: "cmd-snap-1", issuedBy: "participant-trader", label: "cli-test-snapshot" } },
    { id: "ghost-world-1", clock: { op: "jump-to-event", target: "evt:world-w031-plain:1" } },
  ];
}

/** The generated-world script: market flow over the regime timeline. */
export function generatedScript(): unknown[] {
  return [
    { id: "step-1", clock: { op: "step", deltaMs: 10_000 } },
    {
      id: "buy-1",
      command: {
        kind: "submit-order",
        commandId: "cmd-gen-buy-1",
        issuedBy: "participant-trader",
        accountId: "account-trader",
        instrumentId: "instrument-btcusd",
        submission: { kind: "market", side: "buy", quantity: "0.25", constraints: { timeInForce: "IOC" } },
      },
    },
    { id: "seek-1", clock: { op: "seek", to: T0 + 30_000 } },
    {
      id: "scenario-1",
      command: {
        kind: "set-scenario",
        commandId: "cmd-gen-scenario-1",
        issuedBy: "participant-trader",
        scenario: { label: "cli-counterfactual", entries: [{ regime: "low-liquidity", from: T0 + 30_000, to: T0 + 60_000, parameters: { anchorPrice: 4800 } }] },
      },
    },
    { id: "step-2", clock: { op: "step", deltaMs: 5000 } },
  ];
}

/** A continuation script (replay tests): a step + a small sell. */
export function continuationScript(): unknown[] {
  return [
    { id: "cont-step-1", clock: { op: "step", deltaMs: 5000 } },
    {
      id: "cont-sell-1",
      command: {
        kind: "submit-order",
        commandId: "cmd-cont-sell-1",
        issuedBy: "participant-trader",
        accountId: "account-trader",
        instrumentId: "instrument-btcusd",
        submission: { kind: "market", side: "sell", quantity: "0.001", constraints: { timeInForce: "IOC" } },
      },
    },
  ];
}

/** A VALID information dataset file (the W027 fixture shape). */
export function informationDatasetFile(): Record<string, unknown> {
  return {
    descriptor: {
      datasetId: "info-w031-fixture",
      source: {
        provider: "fixture",
        name: "research-news-sample",
        format: "mixed-information",
        obtained: "hand-authored fixture (W031 CLI tests)",
      },
      range: { from: T0, to: T0 + 5 * MINUTE },
      recordKinds: ["news"],
      granularity: "event-driven",
      knownGaps: [],
      limitations: ["fixture: hand-authored, not a real research/wire feed"],
      determinism: { kind: "deterministic" },
    },
    sources: [{ source: "global-wire", credibility: "primary-media" }],
    symbolMap: { "BTC-USD": "instrument-btcusd" },
    records: [
      {
        kind: "news",
        source: "global-wire",
        sourceId: "w031-wire-1",
        publishedAt: T0,
        headline: "Spot venue reports record session volume",
        summary: "Tuesday session printed the highest volume since launch.",
        symbols: ["BTC-USD"],
        confidence: "high",
      },
      {
        kind: "news",
        source: "global-wire",
        sourceId: "w031-wire-2",
        publishedAt: T0 + 30_000,
        headline: "Desk notes steady institutional accumulation",
        summary: "Flow analysis argues for sustained accumulation.",
        symbols: ["BTC-USD"],
        confidence: "medium",
        availableAt: T0 + 90_000,
      },
    ],
  };
}

/** A VALID historical dataset file (the W020 fixture shape). */
export function historicalDatasetFile(): Record<string, unknown> {
  return {
    descriptor: {
      datasetId: "hist-w031-fixture",
      source: {
        provider: "fixture",
        name: "crypto-sample",
        format: "mixed-feed",
        obtained: "hand-authored fixture (W031 CLI tests)",
      },
      range: { from: T0, to: T0 + 2 * MINUTE },
      recordKinds: ["bar"],
      granularity: "1m",
      knownGaps: [],
      limitations: ["fixture: hand-authored, not a real venue feed"],
      determinism: { kind: "deterministic" },
    },
    symbolMap: { "BTC-USD": "instrument-btcusd" },
    records: [
      {
        kind: "bar",
        symbol: "BTC-USD",
        openTime: T0,
        closeTime: T0 + MINUTE,
        open: "4800.10",
        high: "4800.60",
        low: "4800.00",
        close: "4800.40",
        volume: "12.5",
      },
      {
        kind: "bar",
        symbol: "BTC-USD",
        openTime: T0 + MINUTE,
        closeTime: T0 + 2 * MINUTE,
        open: "4800.40",
        high: "4800.55",
        low: "4800.20",
        close: "4800.45",
        volume: "8.25",
      },
    ],
  };
}

/** Convenience: build the engine definition typed view (tests re-validate). */
export type { WorldDefinition };
