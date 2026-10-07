/**
 * W018 worker adapter tests over REAL `node:worker_threads`: the engine runs
 * in a separate thread, every message crosses a genuine postMessage +
 * structured-clone boundary, and the SAME host code a browser Web Worker runs
 * (`installWorldWorkerHost`) serves the session.
 *
 * Run: ../../node_modules/.bin/tsx --test adapter/test/worker.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { testDefinition } from "../../world/test/helpers.js";
import { detectWorkerScope } from "../workerHost.js";
import { asNodeWorkerChannel, createWorkerWorldTransport } from "../workerTransport.js";
import { WorldAdapterInitError } from "../transportError.js";
import { createTestWorldClient, spawnAdapterWorker } from "./helpers.js";

async function spawnReadyClient() {
  const worker = spawnAdapterWorker();
  const transport = await createWorkerWorldTransport(asNodeWorkerChannel(worker), {
    definition: testDefinition(),
  });
  return { worker, transport, client: createTestWorldClient(transport) };
}

test("init handshake over a real thread: describe returns the engine identity", async () => {
  const { worker, client } = await spawnReadyClient();
  const info = (await client.call("host", "describe", [])) as {
    worldId: string;
    engine: string;
  };
  assert.equal(info.worldId, "world-w013-tests");
  assert.equal(info.engine, "tradrl-world-sim");
  client.close();
  await worker.terminate();
});

test("a command over the thread boundary acks and publishes with engine sequences", async () => {
  const { worker, client } = await spawnReadyClient();
  const result = (await client.call("command", "addAnnotation", [
    {
      kind: "add-annotation",
      commandId: "cmd-worker-1" as never,
      worldId: "world-w013-tests" as never,
      issuedBy: "participant-trader" as never,
      issuedAt: 1_700_000_000_000 as never,
      at: 1_700_000_000_500 as never,
      text: "from the other thread",
    },
  ])) as { status: string; ack?: { journalCursor: number } };
  assert.equal(result.status, "acked");
  assert.equal(result.ack?.journalCursor, 1);
  assert.equal(client.published.length, 1);
  assert.equal(client.published[0]!.events[0]!.sequence, 1);
  assert.equal(client.published[0]!.events[0]!.eventType, "world.annotation.added");
  client.close();
  await worker.terminate();
});

test("typed stubs and clock rejections cross the thread as serialized errors", async () => {
  const { worker, client } = await spawnReadyClient();
  await assert.rejects(
    client.call("query", "getQuote", ["instrument-es-fut"]),
    (error: unknown) =>
      (error as { remoteName?: string }).remoteName === "NotImplementedInSkeletonError" &&
      (error as { data?: { surface?: string } }).data?.surface === "market-generator",
  );
  await client.call("clock", "step", [5_000]);
  await assert.rejects(
    client.call("clock", "seek", [1_700_000_000_000 + 1_000]),
    (error: unknown) =>
      (error as { remoteName?: string }).remoteName === "ClockRejectionError" &&
      (
        (error as { data?: { rejection?: { code?: string } } }).data?.rejection
          ?.code === "rewind-requires-branch"
      ),
  );
  client.close();
  await worker.terminate();
});

test("a bad definition rejects the init handshake with a typed error", async () => {
  const worker = spawnAdapterWorker();
  await assert.rejects(
    createWorkerWorldTransport(asNodeWorkerChannel(worker), {
      definition: { ...testDefinition(), seed: "" },
    }),
    (error: unknown) =>
      error instanceof WorldAdapterInitError &&
      error.remote.name === "InvalidWorldDefinitionError",
  );
  await worker.terminate();
});

test("worker death fails the transport closed (never a silent hang)", async () => {
  const worker = spawnAdapterWorker();
  const transport = await createWorkerWorldTransport(asNodeWorkerChannel(worker), {
    definition: testDefinition(),
  });
  const client = createTestWorldClient(transport);
  const pending = client.call("query", "getWorldMeta", []);
  const closed = new Promise<unknown>((resolve) => {
    const unsubscribe = transport.onTransportClosed((reason) => {
      unsubscribe();
      resolve(reason);
    });
  });
  await worker.terminate(); // the thread dies mid-request
  await assert.rejects(pending, (error: unknown) => error instanceof Error);
  await closed;
  client.close();
});

test("the worker ENTRY does not self-install outside a worker context", async () => {
  // Importing the entry in a main (window-less but self-less) process is a
  // detected no-op: detectWorkerScope finds no worker surface here.
  await import("../worker.js");
  assert.equal(detectWorkerScope(), undefined);
  const fakeWindow = { window: {} };
  assert.equal(
    detectWorkerScope.call({ ...fakeWindow } as never),
    undefined,
    "a main window never self-installs",
  );
});

test("real-time driver over a real thread: playing+following advances the clock", async () => {
  const worker = spawnAdapterWorker();
  const transport = await createWorkerWorldTransport(asNodeWorkerChannel(worker), {
    definition: testDefinition(),
    wireOptions: { realtime: { enabled: true, tickMs: 20 } },
  });
  const client = createTestWorldClient(transport);
  await client.call("clock", "play", []);
  await client.call("clock", "followRealtime", [true]);
  const before = (await client.call("clock", "getClock", [])) as {
    simulationTime: number;
  };
  await new Promise((resolve) => setTimeout(resolve, 120));
  const after = (await client.call("clock", "getClock", [])) as {
    simulationTime: number;
  };
  assert.ok(
    after.simulationTime > before.simulationTime,
    `the driver stepped the clock across the thread (${String(after.simulationTime)} > ${String(before.simulationTime)})`,
  );
  assert.ok(client.clockViews.length >= 1, "clock pushes crossed the thread");
  client.close();
  await worker.terminate();
});
