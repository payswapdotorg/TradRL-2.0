/**
 * Live watchlist projection tests (W008) — the controller laws against the
 * REAL engine, through the REAL W018 provider.
 *
 * Guards `src/trading-world/market/watchlistProjection.ts`: the framework-
 * free controller behind the surface. Runs against the REAL Node in-process
 * adapter + REAL W013/W014 engine (a scratch THREE-instrument world, orders
 * through the real matching engine) and the REAL W017 generated alpha world
 * (the TL wiring, `runtime/engineAttachment.ts`):
 * - honest states: unattached (fail-closed noop), loading, ready (quote rows
 *   from real projections), error (typed, fail-closed);
 * - live updates: the W018 push channels (published + clock) drive
 *   refreshes — quote rows update as the world's clock advances;
 * - journal-driven instrument discovery (A7-aware: instruments appear when
 *   their book deltas become observable);
 * - per-row typed errors (unknown instrument) never blank the list;
 * - regime context: scheduled (declared metadata) on the plain engine,
 *   ANNOUNCED (market.regime.changed) on the generated alpha world;
 * - coalescing: a burst of publishes collapses into one trailing refetch;
 * - stop/start lifecycle (StrictMode tolerance) and fail-closed on
 *   transport death — never stale fake data.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldMarketProjection.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { attachEngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import {
  createAlphaEngineTransport,
} from "../src/trading-world/runtime/engineAttachment.js";
import { createSimulatedNoopWorldClient } from "../src/trading-world/runtime/worldClient.js";
import {
  createWatchlistProjectionController,
  type WatchlistProjectionController,
  type WatchlistProjectionSnapshot,
} from "../src/trading-world/market/watchlistProjection.js";
import type {
  MarketInstrumentId,
  WatchlistRow,
} from "../src/trading-world/market/marketData.js";
import { createInProcessWorldTransport } from "../../tradrl-world-sim/adapter/inProcess.js";
import { fixedWallTimeSource } from "../../tradrl-world-sim/world/test/helpers.js";
import type { WorldDefinition } from "../../tradrl-world-sim/world/definition.js";

/** Configured ids enter the controller as the branded opaque keys (plain
 * strings at composition; the brand mirrors the port signature). */
const ids = (values: readonly string[]): readonly MarketInstrumentId[] =>
  values as readonly MarketInstrumentId[];

/** Scratch three-instrument world (plain W013/W014 engine, no generator). */
const START = 1_700_000_000_000;
const WALL_START = 1_700_000_500_000;

function scratchDefinition(): WorldDefinition {
  const worldId = "world-w008-watchlist" as WorldDefinition["scope"]["worldId"];
  const venueId = "venue-w008" as never;
  const instruments = ["es", "nq", "ym"].map((short) => ({
    instrumentId: `inst-${short}` as never,
    worldId,
    venueId,
    symbol: `${short.toUpperCase()}-SCRATCH`,
    assetClass: "future",
    quoteCurrency: "USD" as never,
    tickSize: "0.25" as never,
    lotSize: "1" as never,
    pricePrecision: 2,
    quantityPrecision: 0,
    tradingState: "open",
    tradable: true,
  }));
  return {
    scope: {
      tenantId: "tenant-w008" as never,
      projectId: "project-w008" as never,
      worldId,
    },
    mode: "reactive-replay",
    seed: "w008-watchlist-scratch",
    worldDefinitionVersion: "w008-scratch@1",
    inputDataSource: "synthetic://w008-scratch",
    regimeSchedule: [
      {
        regime: "mean-reversion",
        from: START as never,
        to: (START + 60_000) as never,
        parameters: { anchorPrice: 4800, direction: 1 },
      },
      { regime: "trend", from: (START + 60_000) as never },
    ],
    clock: {
      start: START as never,
      defaultStepMs: 1000,
      initialWallTime: WALL_START as never,
    },
    instruments: instruments as never,
    venues: [
      {
        venueId,
        worldId,
        name: "w008-scratch-venue",
        matchingModel: "price-time-priority",
        allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
        feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
        latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
        calendar: { sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }] },
        haltPolicy: { haltOnShock: false },
      },
    ] as never,
    accounts: [
      {
        accountId: "account-trader-w008" as never,
        worldId,
        balances: { USD: { amount: "100000.00", currency: "USD" } } as never,
        buyingPower: { amount: "100000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "100000.00" as never, currency: "USD" as never },
        leverage: 1,
        permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
      },
    ] as never,
    participants: [
      {
        participantId: "participant-trader-w008" as never,
        worldId,
        kind: "human",
        accountId: "account-trader-w008" as never,
      },
    ] as never,
  };
}

async function attachScratch(): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createInProcessWorldTransport({
      definition: scratchDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    }),
    expectedWorldId: "world-w008-watchlist",
  });
}

/** Wait until the snapshot satisfies the predicate (bounded, no hangs). */
async function until(
  controller: WatchlistProjectionController,
  predicate: (snapshot: WatchlistProjectionSnapshot) => boolean,
): Promise<WatchlistProjectionSnapshot> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const snapshot = controller.getSnapshot();
    if (predicate(snapshot)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return controller.getSnapshot();
}

function rowOf(
  snapshot: WatchlistProjectionSnapshot,
  instrumentId: string,
): WatchlistRow | undefined {
  return snapshot.status === "ready"
    ? snapshot.rows.find((row) => row.instrumentId === instrumentId)
    : undefined;
}

let orderSeq = 0;

async function restOrder(
  client: EngineWorldClient,
  instrumentId: string,
  side: "buy" | "sell",
  limitPrice: string,
): Promise<void> {
  orderSeq += 1;
  const ack = await client.command.submitOrder({
    kind: "submit-order",
    commandId: `cmd-w008-${orderSeq}` as never,
    worldId: "world-w008-watchlist" as never,
    issuedBy: "participant-trader-w008" as never,
    issuedAt: START as never,
    accountId: "account-trader-w008" as never,
    instrumentId: instrumentId as never,
    submission: {
      kind: "limit",
      side,
      quantity: "10" as never,
      limitPrice: limitPrice as never,
      constraints: { timeInForce: "GTC" },
    },
  });
  assert.equal(ack.status, "acked", `order on ${instrumentId} must ack`);
}

test("the controller stays honestly unattached on the fail-closed noop client", async () => {
  const controller = createWatchlistProjectionController({
    client: createSimulatedNoopWorldClient("world-x"),
    instrumentIds: ids(["inst-es"]),
    discoveryEnabled: true,
    pollMs: 0,
  });
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(controller.getSnapshot(), { status: "unattached" });
  // No subscription crash on stop; SSR snapshot is the same honest state.
  controller.stop();
  assert.deepEqual(controller.getServerSnapshot(), { status: "unattached" });
});

test("ready projection: origin rows are real and empty-book honest; unknown ids surface per-row typed errors", async () => {
  const client = await attachScratch();
  const controller = createWatchlistProjectionController({
    client,
    instrumentIds: ids(["inst-es", "inst-bogus"]),
    discoveryEnabled: true,
    pollMs: 0,
  });
  controller.start();
  const ready = await until(controller, (snapshot) => snapshot.status === "ready");
  assert.equal(ready.status, "ready");
  // World identity + declared schedule are real projections.
  if (ready.status !== "ready") {
    throw new Error("unreachable");
  }
  assert.equal(ready.world.worldId, "world-w008-watchlist");
  assert.equal(ready.world.engine, "tradrl-world-sim");
  assert.equal(ready.world.executionAuthority, "simulated-only");
  assert.equal(ready.world.regimeSchedule.length, 2);
  assert.equal(ready.clock?.simulationTime, START);
  assert.deepEqual(ready.announcements, [], "plain engine announces nothing at the origin");
  // Two configured rows only — the empty journal discovers no instruments.
  assert.equal(ready.rows.length, 2);
  const es = rowOf(ready, "inst-es");
  assert.equal(es?.source, "configured");
  assert.equal(es?.instrument?.symbol, "ES-SCRATCH");
  assert.equal(es?.instrument?.tradingState, "open");
  // Empty book at the world origin: the quote exists with NO bid/ask/last —
  // absent fields stay absent (never zero-invented).
  assert.deepEqual(es?.quote, { instrumentId: "inst-es", asOf: START });
  // Regime context: no announcement ⇒ the declared schedule, labeled scheduled.
  assert.deepEqual(es?.regime, {
    kind: "scheduled",
    entry: ready.world.regimeSchedule[0],
  });
  // The bogus configured instrument: per-row typed errors, list intact.
  const bogus = rowOf(ready, "inst-bogus");
  assert.equal(bogus?.quote, undefined);
  assert.match(bogus?.quoteError ?? "", /UnknownWorldEntityError/);
  assert.match(bogus?.instrumentError ?? "", /unknown instrument/);
  assert.equal(bogus?.regime?.kind, "scheduled", "regime context still applies");
  controller.stop();
  client.dispose();
});

test("live updates: real orders publish; clock advances push; rows and discovery update (A7-aware)", async () => {
  const client = await attachScratch();
  const controller = createWatchlistProjectionController({
    client,
    instrumentIds: ids(["inst-es"]),
    discoveryEnabled: true,
    pollMs: 0,
  });
  const snapshots: WatchlistProjectionSnapshot[] = [];
  controller.subscribe(() => {
    snapshots.push(controller.getSnapshot());
  });
  controller.start();
  await until(controller, (snapshot) => snapshot.status === "ready");

  // Two-sided resting liquidity on a DISCOVERED instrument (inst-nq), through
  // the real matching engine. The submit publishes (push path #1).
  await restOrder(client, "inst-nq", "buy", "4800.25");
  await restOrder(client, "inst-nq", "sell", "4800.75");
  // The book-delta events carry availableAt (venue latency, A7): before the
  // clock passes it, discovery honestly cannot see the instrument yet.
  await controller.refresh();
  let snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") {
    throw new Error("unreachable");
  }
  assert.equal(
    snapshot.rows.some((row) => row.instrumentId === "inst-nq"),
    false,
    "the book delta is not observable before availableAt (A7 firewall)",
  );

  // Advance the world clock past the latency: the clock push (path #2)
  // refreshes; the journal now reveals inst-nq and its real top-of-book.
  await client.clock.step(1_000);
  snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" && rowOf(current, "inst-nq")?.quote?.bid !== undefined,
  );
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") {
    throw new Error("unreachable");
  }
  const nq = rowOf(snapshot, "inst-nq");
  assert.equal(nq?.source, "discovered", "journal discovery, not configuration");
  assert.equal(nq?.instrument?.symbol, "NQ-SCRATCH");
  assert.deepEqual(
    {
      bid: nq?.quote?.bid,
      bidSize: nq?.quote?.bidSize,
      ask: nq?.quote?.ask,
      askSize: nq?.quote?.askSize,
    },
    { bid: "4800.25", bidSize: "10", ask: "4800.75", askSize: "10" },
    "the real top-of-book of the resting orders (canonical text)",
  );
  assert.equal(nq?.quote?.asOf, START + 1_000);
  // The configured instrument's row moved with the clock too.
  assert.deepEqual(rowOf(snapshot, "inst-es")?.quote, {
    instrumentId: "inst-es",
    asOf: START + 1_000,
  });
  assert.equal(snapshot.clock?.simulationTime, START + 1_000);
  // At least three snapshots were published (ready → post-publish → post-clock).
  assert.ok(snapshots.length >= 3, `snapshots published: ${snapshots.length}`);
  controller.stop();
  client.dispose();
});

test("a client without push channels still projects (poll-fallback shape)", async () => {
  const engineClient = await attachScratch();
  // A plain seam client (no push channels): the W006 contract allows any
  // TradingWorldClient shape — the controller must not require them.
  const plainClient = {
    worldId: engineClient.worldId,
    status: engineClient.status,
    query: engineClient.query,
    command: engineClient.command,
    clock: engineClient.clock,
    evidence: engineClient.evidence,
  };
  const controller = createWatchlistProjectionController({
    client: plainClient,
    instrumentIds: ids(["inst-ym"]),
    discoveryEnabled: false,
    pollMs: 0,
  });
  controller.start();
  const ready = await until(controller, (snapshot) => snapshot.status === "ready");
  assert.equal(ready.status, "ready");
  assert.equal(rowOf(ready, "inst-ym")?.instrument?.symbol, "YM-SCRATCH");
  // Manual refresh still works (the Retry path).
  await controller.refresh();
  assert.equal(controller.getSnapshot().status, "ready");
  controller.stop();
  engineClient.dispose();
});

test("a burst of publishes coalesces into ONE trailing refetch", async () => {
  const engineClient = await attachScratch();
  let worldMetaCalls = 0;
  const publishedListeners = new Set<() => void>();
  const clockListeners = new Set<() => void>();
  const wrapped: EngineWorldClient = {
    ...engineClient,
    query: {
      ...engineClient.query,
      getWorldMeta: async () => {
        worldMetaCalls += 1;
        return engineClient.query.getWorldMeta();
      },
    },
    // Manual push trigger for the coalescing assertion (a test seam over
    // the real push-channel shape).
    onPublished: ((listener: () => void) => {
      publishedListeners.add(listener);
      return () => {
        publishedListeners.delete(listener);
      };
    }) as EngineWorldClient["onPublished"],
    onClock: ((listener: () => void) => {
      clockListeners.add(listener);
      return () => {
        clockListeners.delete(listener);
      };
    }) as EngineWorldClient["onClock"],
  };
  // Trigger both channels manually for the coalescing assertion (a test
  // seam over the real push-channel shape).
  const triggerPublished = (): void => {
    for (const listener of Array.from(publishedListeners)) {
      listener();
    }
  };
  const controller = createWatchlistProjectionController({
    client: wrapped,
    instrumentIds: ids(["inst-es"]),
    discoveryEnabled: false,
    pollMs: 0,
  });
  controller.start();
  await until(controller, (snapshot) => snapshot.status === "ready");
  const callsAfterStart = worldMetaCalls;
  // Five synchronous publish pushes (e.g. five applied commands in one turn).
  for (let index = 0; index < 5; index++) {
    triggerPublished();
  }
  await controller.refresh(); // settles the trailing refetch
  await until(controller, (snapshot) => snapshot.status === "ready");
  assert.equal(
    worldMetaCalls,
    callsAfterStart + 2,
    "the burst collapses into the in-flight refresh + ONE trailing refetch (not five)",
  );
  controller.stop();
  engineClient.dispose();
});

test("stop/start re-attaches cleanly (StrictMode double-mount tolerance)", async () => {
  const client = await attachScratch();
  const controller = createWatchlistProjectionController({
    client,
    instrumentIds: ids(["inst-es"]),
    discoveryEnabled: true,
    pollMs: 0,
  });
  controller.start();
  await until(controller, (snapshot) => snapshot.status === "ready");
  controller.stop();
  assert.deepEqual(controller.getSnapshot(), { status: "unattached" });
  controller.start();
  const ready = await until(controller, (snapshot) => snapshot.status === "ready");
  assert.equal(ready.status, "ready");
  assert.equal(rowOf(ready, "inst-es")?.source, "configured");
  controller.stop();
  client.dispose();
});

test("transport death fails closed: the typed error replaces the rows (never stale fake data)", async () => {
  const client = await attachScratch();
  const controller = createWatchlistProjectionController({
    client,
    instrumentIds: ids(["inst-es"]),
    discoveryEnabled: true,
    pollMs: 0,
  });
  controller.start();
  await until(controller, (snapshot) => snapshot.status === "ready");
  client.dispose(); // the transport dies under the controller
  await controller.refresh();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, "error");
  if (snapshot.status === "error") {
    assert.match(snapshot.message, /transport is closed/);
  }
  controller.stop();
});

test("the generated alpha world: ANNOUNCED regime context + deterministic real quotes", async () => {
  // The TL wiring (W017 follow-up): the REAL alpha attachment behind the
  // W018 in-process transport — the production shape the watchlist mounts in.
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport("alpha"),
    expectedWorldId: "alpha",
  });
  const controller = createWatchlistProjectionController({
    client,
    instrumentIds: ids(["instrument-es-alpha"]),
    discoveryEnabled: true,
    pollMs: 0,
  });
  controller.start();
  await until(controller, (snapshot) => snapshot.status === "ready");
  // Before the first clock advance: no announcement (origin rule fires on
  // the FIRST advance) — the declared schedule is the honest context.
  let snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") {
    throw new Error("unreachable");
  }
  assert.equal(rowOf(snapshot, "instrument-es-alpha")?.regime?.kind, "scheduled");

  // Advance the clock 10s: the origin-rule announcement lands, the W017
  // makers fill the book with real generated liquidity, the clock push
  // refreshes the rows — all real projections (deterministic world).
  // (Mid-step publishes may refresh earlier — equally real; the assertion
  // waits for the SETTLED +10s view deterministically.)
  await client.clock.step(10_000);
  snapshot = await until(
    controller,
    (current) =>
      current.status === "ready" &&
      rowOf(current, "instrument-es-alpha")?.quote?.asOf === START + 10_000 &&
      rowOf(current, "instrument-es-alpha")?.regime?.kind === "announced",
  );
  assert.equal(snapshot.status, "ready");
  if (snapshot.status !== "ready") {
    throw new Error("unreachable");
  }
  const row = rowOf(snapshot, "instrument-es-alpha");
  assert.equal(row?.source, "configured");
  assert.equal(row?.instrument?.symbol, "ES-ALPHA");
  assert.equal(row?.instrument?.tradingState, "open");
  assert.deepEqual(
    {
      bid: row?.quote?.bid,
      bidSize: row?.quote?.bidSize,
      ask: row?.quote?.ask,
      askSize: row?.quote?.askSize,
      last: row?.quote?.last,
      asOf: row?.quote?.asOf,
    },
    {
      bid: "4799.75",
      bidSize: "14",
      ask: "4800.25",
      askSize: "13",
      last: "4799.75",
      asOf: START + 10_000,
    },
    "the deterministic generated top-of-book at +10s (canonical text)",
  );
  assert.deepEqual(row?.regime, {
    kind: "announced",
    announcement: {
      at: START,
      to: "mean-reversion",
      parameters: { anchorPrice: 4800, direction: 1 },
    },
  });
  assert.equal(snapshot.clock?.simulationTime, START + 10_000);
  assert.equal(snapshot.world.worldId, "alpha");
  assert.equal(snapshot.world.mode, "reactive-replay");
  controller.stop();
  client.dispose();
});
