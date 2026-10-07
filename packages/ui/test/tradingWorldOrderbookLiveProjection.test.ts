/**
 * W009 live-projection tests — the REAL engine laws behind the ladder + tape.
 *
 * Runs the surfaces' data path against the REAL alpha world (the W018 test
 * pattern: `createAlphaEngineTransport` — the generated market behind the
 * in-process adapter — plus `attachEngineWorldClient`, imported directly from
 * the merged surfaces; the W005-established test-side pattern):
 *
 * - the books legitimately start EMPTY at the clock origin (the teaching
 *   state's truth) and FILL as the clock advances — real resting liquidity;
 * - the ladder projection over the real `getOrderBook` snapshot preserves the
 *   engine's canonical text verbatim, computes exact cumulative depth
 *   (independently recomputed here with test-side exact arithmetic) and stays
 *   consistent with the real top-of-book quote (`getQuote`);
 * - the tape projection over the real `getTrades` prints is the exact reverse
 *   of the engine's journal order — never re-sorted — with the true sequences;
 * - the W018 engine channels drive the live update: `published` + `clock`
 *   signals fire as the clock advances, and the shared feed controller (the
 *   framework-free core both surfaces mount) refreshes to the new engine
 *   state through those signals alone (no polling);
 * - typed remote errors surface honestly (unknown instrument), and a dead
 *   transport fails the feed closed (never stale data).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldOrderbookLiveProjection.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { alphaWorldDefinition, createAlphaEngineTransport } from "../src/trading-world/runtime/engineAttachment.js";
import {
  attachEngineWorldClient,
  TradingWorldRemoteError,
} from "../src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { TradingWorldClient } from "../src/trading-world/runtime/worldClient.js";
import {
  alphaInstrumentIdForWorld,
  buildDomLadderProjection,
  windowDomLadderSide,
  type DomLadderProjection,
} from "../src/trading-world/orderbook/bookData.js";
import { buildTimeAndSalesProjection } from "../src/trading-world/orderbook/tapeData.js";
import {
  createTradingWorldProjectionFeedController,
  subscribeEngineProjectionSignals,
} from "../src/trading-world/orderbook/projectionFeed.js";

const WORLD_ID = "world-alpha";

/**
 * Independent exact decimal-text addition (test-side; deliberately NOT the
 * product's arithmetic, so the recomputation is a real cross-check).
 * Supports one negative operand (the spread check).
 */
function exactAdd(a: string, b: string): string {
  const toUnits = (text: string): { units: bigint; scale: number } => {
    const negative = text.startsWith("-");
    const unsigned = negative ? text.slice(1) : text;
    const [whole = "0", fraction = ""] = unsigned.split(".");
    return {
      units: BigInt((negative ? "-" : "") + (whole + fraction)),
      scale: fraction.length,
    };
  };
  const left = toUnits(a);
  const right = toUnits(b);
  const scale = Math.max(left.scale, right.scale);
  const units =
    left.units * 10n ** BigInt(scale - left.scale) +
    right.units * 10n ** BigInt(scale - right.scale);
  const negative = units < 0n;
  let digits = (negative ? -units : units).toString();
  let valueScale = scale;
  while (valueScale > 0 && digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    valueScale -= 1;
  }
  digits = digits.padStart(valueScale + 1, "0");
  const body =
    valueScale === 0
      ? digits
      : `${digits.slice(0, digits.length - valueScale)}.${digits.slice(digits.length - valueScale)}`;
  return negative && digits !== "0" ? `-${body}` : body;
}

/** Attach a fresh REAL alpha-world client (one per test — engines are cheap). */
async function attachAlpha(): Promise<EngineWorldClient> {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport(WORLD_ID),
    expectedWorldId: WORLD_ID,
  });
  assert.equal(client.status, "ready");
  return client;
}

/** Resolve when the predicate holds over the polled value (bounded wait). */
async function waitFor<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (predicate(value)) {
      return value;
    }
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for ${what} (last: ${JSON.stringify(value)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("the alpha instrument convention matches the real alpha-world definition (drift guard)", () => {
  for (const worldId of ["world-alpha", "world-beta-7", "w"]) {
    const definition = alphaWorldDefinition(worldId);
    assert.equal(definition.instruments.length, 1);
    assert.equal(
      definition.instruments[0]!.instrumentId,
      alphaInstrumentIdForWorld(worldId),
      `alphaWorldDefinition(${worldId}) instrument id must match the W009 default`,
    );
  }
});

test("books legitimately start empty at the clock origin — the teaching state's truth", async () => {
  const client = await attachAlpha();
  const instrumentId = alphaInstrumentIdForWorld(WORLD_ID);
  const book = await client.query.getOrderBook(instrumentId, 10);
  assert.equal(book.instrumentId, instrumentId);
  assert.deepEqual(book.bids, []);
  assert.deepEqual(book.asks, []);
  assert.equal(book.sequence, 0);
  const trades = await client.query.getTrades(instrumentId);
  assert.equal(trades.length, 0);
  client.dispose();
});

test("the ladder fills with real resting liquidity as the clock advances (exact cumulative depth)", async () => {
  const client = await attachAlpha();
  const instrumentId = alphaInstrumentIdForWorld(WORLD_ID);
  await client.clock.step(10_000);

  const snapshot = await client.query.getOrderBook(instrumentId, 10);
  assert.ok(snapshot.bids.length >= 1, "at least one real bid level");
  assert.ok(snapshot.asks.length >= 1, "at least one real ask level");
  const ladder = buildDomLadderProjection(snapshot);
  assert.equal(ladder.instrumentId, instrumentId);
  assert.equal(ladder.sequence, snapshot.sequence);
  assert.equal(ladder.asOf, snapshot.asOf);
  assert.equal(ladder.levelCount, snapshot.bids.length + snapshot.asks.length);

  // Engine convention on real data: bids strictly descending, asks strictly
  // ascending, best first — validated by the projection (never re-sorted).
  for (let index = 1; index < ladder.bids.levels.length; index += 1) {
    assert.ok(
      Number(ladder.bids.levels[index - 1]!.price) > Number(ladder.bids.levels[index]!.price),
    );
  }
  for (let index = 1; index < ladder.asks.levels.length; index += 1) {
    assert.ok(
      Number(ladder.asks.levels[index - 1]!.price) < Number(ladder.asks.levels[index]!.price),
    );
  }

  // Independent exact recomputation of the cumulative depth per side.
  let bidCumulative = "0";
  for (const row of ladder.bids.levels) {
    bidCumulative = exactAdd(bidCumulative, row.quantity);
    assert.equal(row.cumulative, bidCumulative);
  }
  assert.equal(ladder.bids.totalQuantity, bidCumulative);
  let askCumulative = "0";
  for (const row of ladder.asks.levels) {
    askCumulative = exactAdd(askCumulative, row.quantity);
    assert.equal(row.cumulative, askCumulative);
  }
  assert.equal(ladder.asks.totalQuantity, askCumulative);

  // Every price/size is the engine's own canonical text, verbatim.
  for (const [index, row] of ladder.bids.levels.entries()) {
    assert.equal(row.price, snapshot.bids[index]!.price);
    assert.equal(row.quantity, snapshot.bids[index]!.quantity);
  }

  // The real top of book agrees with the quote projection; the spread/mid
  // are exact decimal derivations of it.
  const quote = await client.query.getQuote(instrumentId);
  assert.ok(quote.bid !== undefined && quote.ask !== undefined);
  assert.equal(ladder.bestBid?.price, quote.bid);
  assert.equal(ladder.bestBid?.quantity, quote.bidSize);
  assert.equal(ladder.bestAsk?.price, quote.ask);
  assert.equal(ladder.bestAsk?.quantity, quote.askSize);
  assert.ok(ladder.spread !== undefined);
  assert.equal(ladder.spread, exactAdd(quote.ask, `-${quote.bid}`));
  assert.ok(ladder.mid !== undefined);
  assert.equal(exactAdd(ladder.mid, ladder.mid), exactAdd(quote.bid, quote.ask));

  // The display window keeps the BEST levels.
  const windowed = windowDomLadderSide(ladder.asks, Math.max(1, ladder.asks.levels.length - 1));
  assert.deepEqual(
    windowed.map((row) => row.price),
    ladder.asks.levels.slice(0, ladder.asks.levels.length - 1).map((row) => row.price),
  );
  client.dispose();
});

test("the tape prints real trades in journal order — displayed newest-first, never re-sorted", async () => {
  const client = await attachAlpha();
  const instrumentId = alphaInstrumentIdForWorld(WORLD_ID);
  await client.clock.step(60_000);

  const trades = await client.query.getTrades(instrumentId);
  assert.ok(trades.length >= 1, "the aggressive side has printed by +60s");
  // The engine's own order is the journal truth: ascending sequence.
  for (let index = 1; index < trades.length; index += 1) {
    assert.ok(trades[index - 1]!.sequence < trades[index]!.sequence);
  }
  const tape = buildTimeAndSalesProjection(trades, { maxRows: 20 });
  assert.equal(tape.totalPrints, trades.length);
  assert.equal(tape.fromSequence, trades[0]!.sequence);
  assert.equal(tape.toSequence, trades[trades.length - 1]!.sequence);
  // The display is the exact reverse of the engine's order (newest first)…
  const expectedWindow = trades.slice(Math.max(0, trades.length - 20)).reverse();
  assert.deepEqual(
    tape.rows.map((row) => row.sequence),
    expectedWindow.map((row) => row.sequence),
  );
  // …and every field is the engine's own print, verbatim.
  for (const [index, row] of tape.rows.entries()) {
    assert.equal(row.tradeId, expectedWindow[index]!.tradeId);
    assert.equal(row.price, expectedWindow[index]!.price);
    assert.equal(row.quantity, expectedWindow[index]!.quantity);
    assert.equal(row.aggressorSide, expectedWindow[index]!.aggressorSide);
    assert.equal(row.occurredAt, expectedWindow[index]!.occurredAt);
  }
  assert.equal(tape.lastPrice, trades[trades.length - 1]!.price);

  // Advancing the clock prints MORE trades (the world keeps trading) and the
  // tape grows monotonically — the live-update truth.
  await client.clock.step(60_000);
  const more = await client.query.getTrades(instrumentId);
  assert.ok(more.length > trades.length);
  const grown = buildTimeAndSalesProjection(more, { maxRows: 20 });
  assert.equal(grown.totalPrints, more.length);
  client.dispose();
});

test("the W018 engine channels fire as the clock advances (published + clock)", async () => {
  const client = await attachAlpha();
  const sources = new Set<string>();
  const unsubscribe = subscribeEngineProjectionSignals(client, (signal) => {
    sources.add(signal.source);
  });
  await client.clock.step(10_000);
  await waitFor(
    () => sources,
    (set) => set.has("published") && set.has("clock"),
    "both engine channels to fire",
  );
  unsubscribe();
  client.dispose();
});

test("the shared feed controller refreshes through the engine channels alone (no polling)", async () => {
  const client = await attachAlpha();
  const instrumentId = alphaInstrumentIdForWorld(WORLD_ID);
  const controller = createTradingWorldProjectionFeedController<DomLadderProjection>({
    pollMs: 0,
    fetch: async (current) => {
      const snapshot = await current.query.getOrderBook(instrumentId, 10);
      const ladder = buildDomLadderProjection(snapshot);
      return ladder.levelCount === 0 ? { status: "empty" } : { status: "ready", data: ladder };
    },
  });
  // Before start: fail-closed teaching state.
  assert.equal(controller.getState().status, "unattached");
  controller.start(client);
  // At the clock origin the books are legitimately empty — the feed surfaces
  // the same teaching state the surface renders.
  await waitFor(
    () => controller.getState(),
    (state) => state.status === "empty",
    "the honestly-empty origin ladder",
  );
  // The clock advances the generated market → published/clock pushes → the
  // controller refetches WITHOUT any poll timer → the real ladder appears.
  await client.clock.step(10_000);
  const first = await waitFor(
    () => controller.getState(),
    (state) => state.status === "ready",
    "the first real ladder",
  );
  assert.ok(first.status === "ready");
  const sequenceBefore = first.data.sequence;
  // Another advance pushes again — the ladder tracks the moving market.
  await client.clock.step(10_000);
  const next = await waitFor(
    () => controller.getState(),
    (state) => state.status === "ready" && state.data.sequence > sequenceBefore,
    "the pushed refresh",
  );
  assert.ok(next.status === "ready");
  assert.ok(next.data.sequence > sequenceBefore);
  // Stop fail-closes the feed.
  controller.stop();
  assert.equal(controller.getState().status, "unattached");
  controller.refresh(); // no-op after stop
  client.dispose();
});

test("typed remote errors surface honestly through the feed (unknown instrument)", async () => {
  const client = await attachAlpha();
  const controller = createTradingWorldProjectionFeedController({
    pollMs: 0,
    fetch: async (current) => {
      const snapshot = await current.query.getOrderBook("instrument-nope" as never, 10);
      return { status: "ready" as const, data: snapshot };
    },
  });
  controller.start(client);
  const errorState = await waitFor(
    () => controller.getState(),
    (state) => state.status === "error",
    "the typed unknown-instrument error",
  );
  assert.ok(errorState.status === "error");
  assert.equal(errorState.remoteName, "UnknownWorldEntityError");
  assert.ok(errorState.message.includes("unknown instrument"));

  // The same call through the surface's port is the typed TradingWorldRemoteError.
  await assert.rejects(
    client.query.getOrderBook("instrument-nope" as never, 10),
    (error: unknown) =>
      error instanceof TradingWorldRemoteError && error.remoteName === "UnknownWorldEntityError",
  );
  controller.stop();
  client.dispose();
});

test("a dead transport fails the feed closed — never stale data", async () => {
  const client = await attachAlpha();
  const instrumentId = alphaInstrumentIdForWorld(WORLD_ID);
  const controller = createTradingWorldProjectionFeedController({
    pollMs: 0,
    fetch: async (current) => {
      const snapshot = await current.query.getOrderBook(instrumentId, 10);
      const ladder = buildDomLadderProjection(snapshot);
      return ladder.levelCount === 0 ? { status: "empty" } : { status: "ready", data: ladder };
    },
  });
  controller.start(client);
  await waitFor(
    () => controller.getState(),
    (state) => state.status === "empty" || state.status === "ready",
    "the honest origin state",
  );
  await client.clock.step(10_000);
  await waitFor(
    () => controller.getState(),
    (state) => state.status === "ready",
    "the real ladder before teardown",
  );
  // Transport death (dispose): every subsequent call fails closed.
  client.dispose();
  controller.refresh();
  const closed = await waitFor(
    () => controller.getState(),
    (state) => state.status === "error",
    "the fail-closed error after transport death",
  );
  assert.ok(closed.status === "error");
  assert.ok(closed.message.includes("transport is closed"), closed.message);
  controller.stop();
});

test("feed lifecycle laws on a controlled client (coalescing, unattached, recovery)", async () => {
  const publishedListeners: Array<() => void> = [];
  const clockListeners: Array<() => void> = [];
  let fetchCount = 0;
  let failNext = false;
  const snapshot = {
    instrumentId: "instrument-stub",
    asOf: 1,
    sequence: 1,
    bids: [{ price: "10", quantity: "1" }],
    asks: [{ price: "11", quantity: "2" }],
  };
  // A controlled seam client (lifecycle mechanics only — the DATA laws above
  // run against the real engine; the W018 recording-transport pattern).
  const attachedClient = {
    status: "ready",
    query: {
      getOrderBook: async () => {
        fetchCount += 1;
        if (failNext) {
          failNext = false;
          throw new TradingWorldRemoteError({
            name: "UnknownWorldEntityError",
            message: "unknown instrument: instrument-stub",
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
        return snapshot;
      },
    },
    onPublished: (listener: () => void) => {
      publishedListeners.push(listener);
      return () => {};
    },
    onClock: (listener: () => void) => {
      clockListeners.push(listener);
      return () => {};
    },
  } as unknown as TradingWorldClient;

  const controller = createTradingWorldProjectionFeedController({
    pollMs: 0,
    fetch: async (current) => {
      const result = await current.query.getOrderBook("instrument-stub" as never, 10);
      return { status: "ready" as const, data: result };
    },
    initialClient: attachedClient,
  });
  // The synchronous initial state (SSR): an attached client renders loading.
  assert.equal(controller.getState().status, "loading");
  assert.equal(controller.getServerState().status, "loading");

  controller.start(attachedClient);
  assert.equal(
    (await waitFor(() => controller.getState(), (state) => state.status === "ready", "ready"))
      .status,
    "ready",
  );
  assert.equal(fetchCount, 1);

  // Coalescing: signals arriving while a refresh is in flight collapse into
  // exactly ONE follow-up refresh (never a fetch storm).
  const baseCount = fetchCount;
  for (const listener of [...publishedListeners, ...clockListeners]) {
    listener();
    listener();
    listener();
  }
  await waitFor(
    () => fetchCount,
    (count) => count === baseCount + 2,
    "the in-flight fetch plus exactly one coalesced follow-up",
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(fetchCount, baseCount + 2);

  // An unattached client renders the teaching state and fetches nothing.
  const unattachedClient = { status: "unattached" } as unknown as TradingWorldClient;
  controller.start(unattachedClient);
  assert.equal(controller.getState().status, "unattached");
  assert.equal(fetchCount, baseCount + 2);

  // Recovery: a failed fetch surfaces the typed remote error; refresh() heals.
  controller.start(attachedClient);
  await waitFor(() => controller.getState(), (state) => state.status === "ready", "ready again");
  failNext = true;
  controller.refresh();
  const errored = await waitFor(
    () => controller.getState(),
    (state) => state.status === "error",
    "the typed error",
  );
  assert.ok(errored.status === "error");
  assert.equal(errored.remoteName, "UnknownWorldEntityError");
  controller.refresh();
  await waitFor(() => controller.getState(), (state) => state.status === "ready", "recovered");
  controller.stop();
  assert.equal(controller.getState().status, "unattached");
});
