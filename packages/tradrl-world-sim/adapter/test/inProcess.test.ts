/**
 * W018 in-process adapter transport tests: worker-faithful delivery (async
 * FIFO), the structuredClone wire discipline, close semantics, channels
 * through the transport, and the determinism guard (burst ordering).
 *
 * Run: ../../node_modules/.bin/tsx --test adapter/test/inProcess.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  addAnnotationCommand,
  fixedWallTimeSource,
  testDefinition,
} from "../../world/test/helpers.js";
import { createInProcessWorldTransport } from "../inProcess.js";
import { WorldTransportClosedError } from "../transportError.js";
import { createTestWorldClient } from "./helpers.js";
import type { WorldHostMessage } from "../envelope.js";

function makeTransport() {
  return createInProcessWorldTransport({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(),
  });
}

test("the transport is ready at creation and describes the engine", async () => {
  const client = createTestWorldClient(makeTransport());
  const info = (await client.call("host", "describe", [])) as { worldId: string };
  assert.equal(info.worldId, "world-w013-tests");
  client.close();
});

test("delivery is ASYNC (worker-faithful): no synchronous response, then FIFO", async () => {
  const transport = makeTransport();
  const received: WorldHostMessage[] = [];
  transport.onHostMessage((message) => received.push(message));
  transport.postMessage({
    kind: "request",
    requestId: 1,
    call: { port: "query", method: "getWorldMeta", args: [] },
  });
  transport.postMessage({
    kind: "request",
    requestId: 2,
    call: { port: "query", method: "getOrders", args: [] },
  });
  assert.equal(received.length, 0, "no synchronous host message (microtask delivery)");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    received.map((message) => (message as { requestId: number }).requestId),
    [1, 2],
    "responses arrive in request order",
  );
  transport.close();
});

test("structuredClone by default: engine objects never leak by reference", async () => {
  const client = createTestWorldClient(makeTransport());
  const events = (await client.call("evidence", "getEvents", [{}])) as unknown[];
  assert.deepEqual(events, []);
  // a non-cloneable payload fails LOUDLY at post time (functions never cross)
  await assert.rejects(
    client.call("query", "getTrades", [
      { not: "relevant" },
      { impossible: () => 1 },
    ] as never),
    (error: unknown) => error instanceof Error && error.name === "DataCloneError",
  );
  client.close();
});

test("close(): postMessage throws typed, closed listeners fire, idempotent", async () => {
  const transport = makeTransport();
  let closed = 0;
  const unsubscribe = transport.onTransportClosed(() => {
    closed += 1;
  });
  transport.close();
  assert.equal(closed, 1);
  unsubscribe();
  transport.close();
  assert.equal(closed, 1, "close is idempotent and fires once per listener");
  assert.throws(() => transport.postMessage({ kind: "dispose" }), WorldTransportClosedError);
  // a client with an in-flight request fails closed too
  const pending = createTestWorldClient(makeTransport());
  const inFlight = pending.call("query", "getWorldMeta", []);
  pending.close();
  await assert.rejects(inFlight, (error: unknown) => error instanceof Error);
});

test("published + clock channels flow through the transport", async () => {
  const client = createTestWorldClient(makeTransport());
  await client.call("clock", "play", []);
  await client.call("command", "addAnnotation", [addAnnotationCommand()]);
  assert.equal(client.published.length, 1);
  assert.equal(client.published[0]!.events[0]!.sequence, 1);
  assert.ok(client.clockViews.length >= 1, "the play ack pushed a clock view");
  assert.equal(client.clockViews.at(-1)!.status, "playing");
  client.close();
});

test("determinism guard: burst through the transport keeps invocation order", async () => {
  const client = createTestWorldClient(makeTransport());
  // fire without awaiting: postMessage is FIFO, the engine queue is FIFO
  const pendingAcks = Array.from({ length: 6 }, (_, i) =>
    client.call("command", "addAnnotation", [
      addAnnotationCommand({
        commandId: `cmd-burst-tp-${String(i)}` as never,
        text: `tp ${String(i)}`,
      }),
    ]),
  );
  for (const ack of pendingAcks) {
    const result = (await ack) as { status: string };
    assert.equal(result.status, "acked");
  }
  const events = (await client.call("evidence", "getEvents", [{}])) as {
    payload: { text: string };
  }[];
  assert.deepEqual(
    events.map((event) => event.payload.text),
    Array.from({ length: 6 }, (_, i) => `tp ${String(i)}`),
    "journal order == invocation order through the transport",
  );
  const report = (await client.call("host", "headlessReport", [])) as {
    eventCount: number;
  };
  assert.equal(report.eventCount, 6);
  client.close();
});
