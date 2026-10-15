/**
 * W030 seam state-machine laws — the coalesced projection stream + surface
 * feeds over a scripted engine client (the W009 controller-law pattern):
 * fail-closed unattached states, the attach drain, ONE fetch per feed per
 * drain (the count law), honest error states with natural retry, loud feed
 * registration validation, in-flight coalescing, stop/dispose fail-closing.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { ClockView } from "tradrl-world-contracts";
import type { TradingWorldClient } from "../../runtime/worldClient.js";
import type { ProjectionFeedFetchResult } from "../../orderbook/projectionFeed.js";
import {
  createCoalescedProjectionStream,
  manualScheduler,
} from "../coalescedProjectionStream.js";

type Unsubscribe = () => void;

/** A scripted engine client: publish/clock emitters + a fetch-counting port. */
function scriptedClient() {
  const publishedListeners = new Set<(projection: { events: readonly WorldEventEnvelope[] }) => void>();
  const clockListeners = new Set<(clock: ClockView) => void>();
  let quoteSequence = 0;
  let fetches = 0;
  const client: TradingWorldClient & {
    onPublished(listener: (projection: { events: readonly WorldEventEnvelope[] }) => void): Unsubscribe;
    onClock(listener: (clock: ClockView) => void): Unsubscribe;
    publish(events: readonly WorldEventEnvelope[]): void;
    tickClock(): void;
    fetchCount(): number;
  } = {
    worldId: "world-scripted",
    status: "ready",
    query: {
      getWorldMeta: () => Promise.resolve({} as never),
      getSnapshot: () => Promise.resolve({} as never),
      getInstrument: () => Promise.resolve({} as never),
      getQuote: () => {
        fetches += 1;
        quoteSequence += 1;
        return Promise.resolve({ asOf: quoteSequence } as never);
      },
      getOrderBook: () => Promise.resolve({} as never),
      getTrades: () => Promise.resolve([] as never),
      getOrders: () => Promise.resolve([] as never),
      getPositions: () => Promise.resolve([] as never),
      getPortfolio: () => Promise.resolve({} as never),
      getRisk: () => Promise.resolve({} as never),
      getNews: () => Promise.resolve([] as never),
      getTimeline: () => Promise.resolve({} as never),
    },
    command: {
      submitOrder: () => Promise.resolve({ status: "acked" } as never),
      cancelOrder: () => Promise.resolve({ status: "acked" } as never),
      replaceOrder: () => Promise.resolve({ status: "acked" } as never),
      closePosition: () => Promise.resolve({ status: "acked" } as never),
      addAnnotation: () => Promise.resolve({ status: "acked" } as never),
      createSnapshot: () => Promise.resolve({ status: "acked" } as never),
      branchWorld: () => Promise.resolve({ status: "acked" } as never),
      setScenario: () => Promise.resolve({ status: "acked" } as never),
    },
    clock: {
      play: () => Promise.resolve(),
      pause: () => Promise.resolve(),
      step: () => Promise.resolve(),
      seek: () => Promise.resolve(),
      jumpToEvent: () => Promise.resolve(),
      setSpeed: () => Promise.resolve(),
      followRealtime: () => Promise.resolve(),
      getClock: () => Promise.resolve({ simulationTime: 0, status: "paused", speed: 1, followingRealtime: false }),
    },
    evidence: {
      getEvent: () => Promise.resolve(undefined),
      getEvents: () => Promise.resolve([]),
      getProvenance: () => Promise.resolve(undefined),
      getSnapshot: () => Promise.resolve(undefined),
      getBranchLineage: () => Promise.resolve([]),
      getInformationBoundary: () => Promise.resolve({} as never),
      getDeterminismManifest: () => Promise.resolve({} as never),
    },
    onPublished(listener) {
      publishedListeners.add(listener);
      return () => {
        publishedListeners.delete(listener);
      };
    },
    onClock(listener) {
      clockListeners.add(listener);
      return () => {
        clockListeners.delete(listener);
      };
    },
    publish(events) {
      for (const listener of Array.from(publishedListeners)) {
        listener({ events });
      }
    },
    tickClock() {
      for (const listener of Array.from(clockListeners)) {
        listener({ simulationTime: 0 as never, status: "paused", speed: 1, followingRealtime: false });
      }
    },
    fetchCount: () => fetches,
  };
  return client;
}

function deltaEvent(sequence: number): WorldEventEnvelope {
  return {
    worldId: "world-scripted" as never,
    sequence: sequence as never,
    eventId: `evt:${String(sequence)}` as never,
    eventType: "market.book.delta",
    occurredAt: 1_000 as never,
    causationId: "cause" as never,
    correlationId: "corr" as never,
    producer: "matching-engine" as never,
    schemaVersion: "test@1",
    payload: { instrumentId: "instrument-es-x", operations: [] },
  } as const as WorldEventEnvelope;
}

const STREAM_CONFIG = {
  surfaces: {
    quote: { window: { maxEvents: 1_000 }, keys: ["instrument-es-x"] },
  },
} as const;

const quoteFetch = async (client: TradingWorldClient): Promise<ProjectionFeedFetchResult<{ asOf: number }>> => {
  const quote = await client.query.getQuote("instrument-es-x" as never);
  return { status: "ready", data: quote as { asOf: number } };
};

test("fail closed before the first drain; the attach drain refreshes registered feeds", async () => {
  const client = scriptedClient();
  const scheduler = manualScheduler();
  const stream = createCoalescedProjectionStream({
    client,
    config: STREAM_CONFIG,
    scheduler,
  });
  const feed = stream.registerFeed({ surface: "quote", key: "instrument-es-x", fetch: quoteFetch });
  assert.deepEqual(feed.getState(), { status: "unattached" }, "A6: nothing fabricated before the first drain");
  assert.equal(scheduler.pending(), true, "registering a feed schedules the attach drain");
  scheduler.run();
  await stream.drainNow();
  assert.deepEqual(feed.getState(), { status: "ready", data: { asOf: 1 } });
  stream.dispose();
});

test("the count law: N signals between drains ⇒ ONE fetch per feed per drain", async () => {
  const client = scriptedClient();
  const scheduler = manualScheduler();
  const stream = createCoalescedProjectionStream({
    client,
    config: STREAM_CONFIG,
    scheduler,
  });
  const feed = stream.registerFeed({ surface: "quote", key: "instrument-es-x", fetch: quoteFetch });
  scheduler.run();
  await stream.drainNow();
  assert.equal(client.fetchCount(), 1);

  // A burst: 5 publications + 2 clock views, then ONE drain.
  for (let index = 0; index < 5; index += 1) {
    client.publish([deltaEvent(index + 1)]);
  }
  client.tickClock();
  client.tickClock();
  assert.equal(scheduler.pending(), true);
  scheduler.run();
  await stream.drainNow();
  assert.equal(
    client.fetchCount(),
    2,
    "7 signals coalesced into ONE fetch (the raw path would fetch 7 times)",
  );
  assert.deepEqual(feed.getState(), { status: "ready", data: { asOf: 2 } });
  assert.deepEqual(stream.metrics(), {
    publications: 5,
    clockSignals: 2,
    eventsIngested: 5,
    drains: 2,
    feedDrives: 2,
  });
  stream.dispose();
});

test("honest error state; the next dirty drain retries naturally", async () => {
  const client = scriptedClient();
  const scheduler = manualScheduler();
  const stream = createCoalescedProjectionStream({ client, config: STREAM_CONFIG, scheduler });
  let failFirst = true;
  const feed = stream.registerFeed({
    surface: "quote",
    key: "instrument-es-x",
    fetch: async (current) => {
      if (failFirst) {
        failFirst = false;
        throw new Error("transport hiccup");
      }
      return quoteFetch(current);
    },
  });
  scheduler.run();
  await stream.drainNow();
  assert.deepEqual(feed.getState(), {
    status: "error",
    message: "transport hiccup",
  });

  client.publish([deltaEvent(1)]);
  scheduler.run();
  await stream.drainNow();
  assert.deepEqual(feed.getState(), { status: "ready", data: { asOf: 1 } }, "self-healed on the next drain");
  stream.dispose();
});

test("empty is honest (a legitimately empty world view)", async () => {
  const client = scriptedClient();
  const scheduler = manualScheduler();
  const stream = createCoalescedProjectionStream({ client, config: STREAM_CONFIG, scheduler });
  const feed = stream.registerFeed({
    surface: "quote",
    key: "instrument-es-x",
    fetch: async () => ({ status: "empty" as const }),
  });
  scheduler.run();
  await stream.drainNow();
  assert.deepEqual(feed.getState(), { status: "empty" });
  stream.dispose();
});

test("stop fail-closes the feed; the stream no longer drives it", async () => {
  const client = scriptedClient();
  const scheduler = manualScheduler();
  const stream = createCoalescedProjectionStream({ client, config: STREAM_CONFIG, scheduler });
  const feed = stream.registerFeed({ surface: "quote", key: "instrument-es-x", fetch: quoteFetch });
  scheduler.run();
  await stream.drainNow();
  feed.stop();
  assert.deepEqual(feed.getState(), { status: "unattached" });
  client.publish([deltaEvent(1)]);
  scheduler.run();
  await stream.drainNow();
  assert.equal(client.fetchCount(), 1, "no fetch after stop");
  stream.dispose();
});

test("loud registration validation: unconfigured surfaces never refresh", () => {
  const client = scriptedClient();
  const scheduler = manualScheduler();
  const stream = createCoalescedProjectionStream({ client, config: STREAM_CONFIG, scheduler });
  assert.throws(
    () =>
      stream.registerFeed({
        // @ts-expect-error — unconfigured surface on purpose
        surface: "orderbook",
        key: "instrument-es-x",
        fetch: quoteFetch,
      }),
    /surface 'orderbook' is not configured/,
  );
  assert.throws(
    () =>
      stream.registerFeed({
        surface: "quote",
        key: "instrument-nq-x",
        fetch: quoteFetch,
      }),
    /outside the configured keys/,
  );
  stream.dispose();
});

test("dispose unsubscribes: signals after dispose never drain", async () => {
  const client = scriptedClient();
  const scheduler = manualScheduler();
  const stream = createCoalescedProjectionStream({ client, config: STREAM_CONFIG, scheduler });
  stream.registerFeed({ surface: "quote", key: "instrument-es-x", fetch: quoteFetch });
  scheduler.run();
  await stream.drainNow();
  stream.dispose();
  client.publish([deltaEvent(1)]);
  client.tickClock();
  assert.equal(scheduler.pending(), false, "no drain scheduled after dispose");
  assert.equal(client.fetchCount(), 1);
});

test("in-flight coalescing: signals during a drain schedule exactly one follow-up", async () => {
  const client = scriptedClient();
  const scheduler = manualScheduler();
  const stream = createCoalescedProjectionStream({ client, config: STREAM_CONFIG, scheduler });
  let releaseFetch: (() => void) | undefined;
  const feed = stream.registerFeed({
    surface: "quote",
    key: "instrument-es-x",
    fetch: (current) =>
      new Promise<ProjectionFeedFetchResult<{ asOf: number }>>((resolve) => {
        releaseFetch = () => {
          void quoteFetch(current).then(resolve);
        };
      }),
  });
  client.publish([deltaEvent(1)]);
  scheduler.run(); // starts the drain (fetch now in flight)
  client.publish([deltaEvent(2)]); // arrives while the drain's fetch is in flight
  releaseFetch?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(scheduler.pending(), true, "exactly one follow-up drain scheduled");
  scheduler.run(); // the follow-up drain starts — its fetch is gated too
  releaseFetch?.(); // the test releases the follow-up fetch (the gated seam)
  await stream.drainNow();
  const state = feed.getState();
  assert.equal(state.status, "ready");
  assert.ok(client.fetchCount() >= 2, "the follow-up fetch ran");
  stream.dispose();
});
