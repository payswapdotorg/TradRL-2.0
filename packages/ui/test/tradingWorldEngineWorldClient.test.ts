/**
 * Engine-backed world client tests (W018) — the REAL provider laws.
 *
 * The provider (`src/trading-world/runtime/engineWorldClient.ts`) is the
 * "World Client" box of spec/SIMULATION.md "Runtime topology" over the W018
 * adapter envelope. These tests run it against the REAL Node in-process
 * adapter (`tradrl-world-sim/adapter/inProcess.ts`, imported directly — the
 * W005-established test-side pattern) and the REAL W013 engine fixtures:
 *
 * - the describe handshake gates the attach (identity + envelope version);
 * - port calls forward VERBATIM: engine values, resolved command rejections
 *   and thrown engine errors reconstructed as TradingWorldRemoteError (typed
 *   extras preserved — nothing fabricated, A6);
 * - the published channel carries the engine's own sequences; the clock
 *   channel pushes settled views after acked mutating clock calls only;
 * - transport death and dispose FAIL CLOSED (typed rejections, never data);
 * - a worldId mismatch refuses the attach typed.
 *
 * The provider-level PARITY law (both adapters, identical digests) lives in
 * tradingWorldTransportParity.test.ts; the React provider hook laws live in
 * tradingWorldUseEngineWorldClient.test.ts.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldEngineWorldClient.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  attachEngineWorldClient,
  TradingWorldRemoteError,
  TradingWorldRuntimeMismatchError,
  TradingWorldTransportClosedError,
} from "../src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { TradingWorldClient } from "../src/trading-world/runtime/worldClient.js";
import type { WorldPublishedProjection } from "../src/trading-world/runtime/worldAdapterContracts.js";
import type {
  WorldClientMessage,
  WorldHostMessage,
} from "../src/trading-world/runtime/worldAdapterContracts.js";
import type { WorldTransport } from "../src/trading-world/runtime/worldAdapterContracts.js";
import { createInProcessWorldTransport } from "../../tradrl-world-sim/adapter/inProcess.js";
import {
  addAnnotationCommand,
  fixedWallTimeSource,
  START,
  submitOrderCommand,
  testDefinition,
  TRADER,
  WALL_START,
  WORLD,
} from "../../tradrl-world-sim/world/test/helpers.js";

/** Compile-time guard: the engine client IS the W006 seam client. */
type ExpectTrue<T extends true> = T;
type _EngineClientSatisfiesSeam = ExpectTrue<
  EngineWorldClient extends TradingWorldClient ? true : false
>;

/** The canonical W003 port method names (the W006 drift-guard list). */
const PORT_METHOD_NAMES: Readonly<Record<string, readonly string[]>> = {
  query: [
    "getWorldMeta",
    "getSnapshot",
    "getInstrument",
    "getQuote",
    "getOrderBook",
    "getTrades",
    "getOrders",
    "getPositions",
    "getPortfolio",
    "getRisk",
    "getNews",
    "getTimeline",
  ],
  command: [
    "submitOrder",
    "cancelOrder",
    "replaceOrder",
    "closePosition",
    "addAnnotation",
    "createSnapshot",
    "branchWorld",
    "setScenario",
  ],
  clock: [
    "play",
    "pause",
    "step",
    "seek",
    "jumpToEvent",
    "setSpeed",
    "followRealtime",
    "getClock",
  ],
  evidence: [
    "getEvent",
    "getEvents",
    "getProvenance",
    "getSnapshot",
    "getBranchLineage",
    "getInformationBoundary",
    "getDeterminismManifest",
  ],
};

/** A transport wrapper that records posted client messages (dispose checks). */
function recordingTransport(transport: WorldTransport) {
  const posted: WorldClientMessage[] = [];
  return {
    posted,
    transport: {
      postMessage(message: WorldClientMessage): void {
        posted.push(message);
        transport.postMessage(message);
      },
      onHostMessage: (listener: (message: WorldHostMessage) => void) =>
        transport.onHostMessage(listener),
      onTransportClosed: (listener: (reason?: unknown) => void) =>
        transport.onTransportClosed(listener),
      close: () => transport.close(),
    } satisfies WorldTransport,
  };
}

async function attachReady(options?: { expectedWorldId?: string }) {
  const { posted, transport } = recordingTransport(
    createInProcessWorldTransport({
      definition: testDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    }),
  );
  const client = await attachEngineWorldClient({
    transport,
    expectedWorldId: options?.expectedWorldId ?? WORLD,
  });
  return { client, posted, transport };
}

test("attach performs the describe handshake and yields the READY engine client", async () => {
  const { client } = await attachReady();
  assert.equal(client.status, "ready");
  assert.equal(client.worldId, WORLD);
  const info = await client.host.describe();
  assert.equal(info.worldId, WORLD);
  assert.equal(info.engine, "tradrl-world-sim");
  assert.equal(info.envelopeVersion, "w018-adapter@1");
  assert.equal(typeof info.engineVersion, "string");
});

test("the provider exposes exactly the W006 seam surface (drift guard)", async () => {
  const { client } = await attachReady();
  for (const [port, methods] of Object.entries(PORT_METHOD_NAMES)) {
    const portObject = (client as unknown as Record<string, Record<string, unknown>>)[port]!;
    assert.deepEqual(
      Object.keys(portObject).sort(),
      [...methods].sort(),
      `${port} exposes exactly the W003 methods`,
    );
  }
});

test("port calls forward verbatim: engine values come back untouched", async () => {
  const { client } = await attachReady();
  const meta = await client.query.getWorldMeta();
  assert.equal(meta.worldId, WORLD);
  assert.equal(meta.mode, "reactive-replay");
  // The engine's honest empty projections stay honest through the wire.
  const orders = await client.query.getOrders();
  assert.deepEqual(orders, []);
  // The information firewall holds through the provider (A7): the delayed
  // artifact (availableAt START+60s) is not observable at START.
  const news = await client.query.getNews();
  assert.equal(
    news.some((artifact) => (artifact as { artifactId: string }).artifactId === "news-future"),
    false,
    "the future-dated artifact must not cross the provider",
  );
});

test("commands ack through the wire with the engine's own cursor", async () => {
  const { client } = await attachReady();
  const result = await client.command.addAnnotation(addAnnotationCommand());
  assert.equal(result.status, "acked");
  assert.equal(result.ack.journalCursor, 1);
  assert.equal(result.ack.commandId, "cmd-annotation-1");
});

test("command rejections are VALUES (the engine's typed outcome), not wire errors", async () => {
  const { client } = await attachReady();
  // The W013 skeleton stub: submit-order is a domain-rules rejection.
  const submit = await client.command.submitOrder(submitOrderCommand());
  assert.equal(submit.status, "rejected");
  assert.equal(submit.rejection.code, "not-implemented-in-skeleton");
  // A structural rejection is likewise a value.
  const blank = await client.command.addAnnotation(addAnnotationCommand({ text: " " }));
  assert.equal(blank.status, "rejected");
});

test("thrown engine errors reconstruct as TradingWorldRemoteError with typed extras", async () => {
  const { client } = await attachReady();
  // Projection stub (thrown by the engine, serialized over the wire).
  await assert.rejects(
    client.query.getQuote("instrument-es-fut" as never),
    (error: unknown) =>
      error instanceof TradingWorldRemoteError &&
      error.remoteName === "NotImplementedInSkeletonError" &&
      error.remoteData?.surface === "market-generator",
  );
  // Clock rejection keeps its typed code.
  await client.clock.step(5_000);
  await assert.rejects(
    client.clock.seek((START + 1_000) as never),
    (error: unknown) =>
      error instanceof TradingWorldRemoteError &&
      error.remoteName === "ClockRejectionError" &&
      (error.remoteData?.rejection as { code?: string } | undefined)?.code ===
        "rewind-requires-branch",
  );
});

test("onPublished delivers the engine publications with the ENGINE's sequences", async () => {
  const { client } = await attachReady();
  const published: WorldPublishedProjection[] = [];
  const unsubscribe = client.onPublished((projection) => published.push(projection));
  await client.command.addAnnotation(addAnnotationCommand({ commandId: "pub-1" as never }));
  await client.command.addAnnotation(addAnnotationCommand({ commandId: "pub-2" as never }));
  assert.equal(published.length, 2, "one publication per acked command");
  assert.equal(published[0]!.events[0]!.sequence, 1);
  assert.equal(published[1]!.events[0]!.sequence, 2);
  assert.equal(published[0]!.events[0]!.eventType, "world.annotation.added");
  assert.equal(published[0]!.ack.commandId, "pub-1");
  // Rejected commands publish nothing.
  await client.command.addAnnotation(addAnnotationCommand({ text: " " }));
  assert.equal(published.length, 2);
  // Unsubscribe stops delivery.
  unsubscribe();
  await client.command.addAnnotation(addAnnotationCommand({ commandId: "pub-3" as never }));
  assert.equal(published.length, 2, "unsubscribed listeners receive nothing");
});

test("onClock pushes settled views after acked MUTATING clock calls only", async () => {
  const { client } = await attachReady();
  const clockViews: { simulationTime: number }[] = [];
  client.onClock((clock) => clockViews.push(clock));
  await client.clock.step(1_500);
  await client.clock.getClock(); // read-only: no push
  assert.equal(clockViews.length, 1, "getClock does not push a settled view");
  assert.equal(clockViews[0]!.simulationTime, START + 1_500);
});

test("transport death FAILS CLOSED: pending and future calls reject typed", async () => {
  const { client, transport } = await attachReady();
  const pending = client.query.getWorldMeta();
  transport.close(); // worker death equivalent: no response will ever arrive
  await assert.rejects(pending, TradingWorldTransportClosedError);
  await assert.rejects(client.query.getQuote("i" as never), TradingWorldTransportClosedError);
  await assert.rejects(client.command.addAnnotation(addAnnotationCommand()), (error: unknown) =>
    error instanceof TradingWorldTransportClosedError,
  );
});

test("dispose(): posts the dispose message, closes the transport, idempotent", async () => {
  const { client, posted, transport } = await attachReady();
  client.dispose();
  assert.ok(
    posted.some((message) => message.kind === "dispose"),
    "dispose is sent over the envelope before closing",
  );
  assert.throws(() => transport.postMessage({ kind: "dispose" })); // transport really closed
  await assert.rejects(client.query.getWorldMeta(), TradingWorldTransportClosedError);
  client.dispose(); // idempotent, never throws
});

test("a worldId mismatch refuses the attach typed (fail closed, no client)", async () => {
  const transport = createInProcessWorldTransport({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(WALL_START + 42),
  });
  await assert.rejects(
    attachEngineWorldClient({ transport, expectedWorldId: "world-somewhere-else" }),
    (error: unknown) =>
      error instanceof TradingWorldRuntimeMismatchError &&
      error.message.includes("world-somewhere-else") &&
      error.message.includes(String(WORLD)),
  );
  // The transport was disposed by the failed attach.
  assert.throws(() => transport.postMessage({ kind: "dispose" }));
});

test("request correlation survives interleaved calls (FIFO envelope)", async () => {
  const { client } = await attachReady();
  // Fire a burst without awaiting: responses must correlate to THEIR call.
  const [meta, orders, positions, news] = await Promise.all([
    client.query.getWorldMeta(),
    client.query.getOrders(),
    client.query.getPositions(),
    client.query.getNews(),
  ]);
  assert.equal(meta.worldId, WORLD);
  assert.deepEqual(orders, []);
  assert.deepEqual(positions, []);
  assert.equal(
    news.some((artifact) => (artifact as { artifactId: string }).artifactId === "news-future"),
    false,
  );
});

test("the provider works for the declared participant account (authorize path)", async () => {
  const { client } = await attachReady();
  // addAnnotation issued by the DECLARED participant is exactly the parity
  // stream's acked command; a ghost participant is a typed value rejection.
  const acked = await client.command.addAnnotation(
    addAnnotationCommand({ commandId: "auth-ok" as never }),
  );
  assert.equal(acked.status, "acked");
  const ghost = await client.command.addAnnotation(
    addAnnotationCommand({
      commandId: "auth-ghost" as never,
      issuedBy: "participant-nope" as never,
    }),
  );
  assert.equal(ghost.status, "rejected");
  assert.equal(ghost.rejection.code, "unknown-participant");
  assert.equal(TRADER, "participant-trader");
});
