/**
 * W018 adapter envelope tests: error serialization, structural message
 * guards, the published-projection mapping and the structured-clone law every
 * wire message must satisfy.
 *
 * Run: ../../node_modules/.bin/tsx --test adapter/test/envelope.test.ts
 * (or via `pnpm --filter tradrl-world-sim test`).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ClockRejectionError } from "../../clock/index.js";
import {
  InvalidWorldDefinitionError,
  NotImplementedInSkeletonError,
  UnknownWorldEntityError,
} from "../../world/index.js";
import {
  isWorldClientMessage,
  isWorldHostMessage,
  serializeTransportError,
  toWorldPublishedProjection,
} from "../envelope.js";
import type { WorldClientMessage, WorldHostMessage } from "../envelope.js";

test("serializeTransportError keeps ClockRejectionError's typed rejection", () => {
  const error = new ClockRejectionError({
    code: "rewind-requires-branch",
    message: "in-place backward move refused (A8)",
  });
  const remote = serializeTransportError(error);
  assert.equal(remote.name, "ClockRejectionError");
  assert.match(
    String((remote.data as { rejection?: { code?: string } } | undefined)?.rejection?.code ?? ""),
    /rewind-requires-branch/,
  );
  assert.match(remote.message, /in-place backward move refused/);
  assert.deepEqual(remote.data, {
    rejection: { code: "rewind-requires-branch", message: "in-place backward move refused (A8)" },
  });
});

test("serializeTransportError keeps the engine stub/unknown-entity/definition extras", () => {
  const stub = serializeTransportError(
    new NotImplementedInSkeletonError("market-generator", "QueryPort.getQuote"),
  );
  assert.equal(stub.name, "NotImplementedInSkeletonError");
  assert.deepEqual(stub.data, { surface: "market-generator", operation: "QueryPort.getQuote" });

  const unknown = serializeTransportError(new UnknownWorldEntityError("instrument", "id-x"));
  assert.equal(unknown.name, "UnknownWorldEntityError");
  assert.deepEqual(unknown.data, { kind: "instrument", id: "id-x" });

  const invalid = serializeTransportError(
    new InvalidWorldDefinitionError(["seed must be non-blank"]),
  );
  assert.equal(invalid.name, "InvalidWorldDefinitionError");
  assert.deepEqual(invalid.data, { errors: ["seed must be non-blank"] });
});

test("serializeTransportError falls back to name+message and never throws", () => {
  const plain = serializeTransportError(new Error("boom"));
  assert.deepEqual(plain, { name: "Error", message: "boom" });
  const nonError = serializeTransportError(42);
  assert.deepEqual(nonError, { name: "NonErrorThrow", message: "42" });
  assert.doesNotThrow(() => serializeTransportError(undefined));
});

test("isWorldClientMessage accepts every well-formed client message", () => {
  const messages: WorldClientMessage[] = [
    { kind: "init", requestId: 0, definition: {} },
    { kind: "init", requestId: 3, definition: {}, options: { fixedWallTime: 5 } },
    { kind: "request", requestId: 1, call: { port: "query", method: "getQuote", args: ["i"] } },
    { kind: "subscribe", channel: "published" },
    { kind: "subscribe", channel: "clock" },
    { kind: "unsubscribe", channel: "clock" },
    { kind: "dispose" },
  ];
  for (const message of messages) {
    assert.equal(isWorldClientMessage(message), true, JSON.stringify(message));
  }
});

test("isWorldClientMessage rejects malformed traffic (fail closed)", () => {
  const bad: unknown[] = [
    null,
    "request",
    42,
    {},
    { kind: "nope" },
    { kind: "request", call: { port: "query", method: "getQuote", args: [] } },
    { kind: "subscribe", channel: "nope" },
    { kind: "init", definition: {} },
  ];
  for (const message of bad) {
    assert.equal(isWorldClientMessage(message), false, JSON.stringify(message));
  }
});

test("isWorldHostMessage accepts responses and pushes, rejects garbage", () => {
  const ok: WorldHostMessage[] = [
    { kind: "response", requestId: 7, outcome: { status: "ok", value: null } },
    {
      kind: "response",
      requestId: 8,
      outcome: { status: "error", error: { name: "X", message: "y" } },
    },
    { kind: "published", projection: { ack: {} as never, events: [] } },
    {
      kind: "clock",
      clock: {
        simulationTime: 0 as never,
        status: "paused",
        speed: 1,
        followingRealtime: false,
      },
    },
  ];
  for (const message of ok) {
    assert.equal(isWorldHostMessage(message), true, JSON.stringify(message));
  }
  const bad: unknown[] = [null, {}, { kind: "response" }, { kind: "published-nope" }];
  for (const message of bad) {
    assert.equal(isWorldHostMessage(message), false, JSON.stringify(message));
  }
});

test("toWorldPublishedProjection maps the engine ack envelope to the wire ack", () => {
  // The engine's onPublished hands the full CommandResult; the projection
  // keeps the inner CommandAck (the wire shape).
  const wire = toWorldPublishedProjection({
    ack: {
      status: "acked",
      ack: {
        commandId: "cmd-1" as never,
        worldId: "w" as never,
        acceptedAt: 1 as never,
        resultingEventIds: ["evt:w:1" as never],
        journalCursor: 1 as never,
      },
    },
    events: [],
  });
  assert.equal(wire.ack.commandId, "cmd-1");
  assert.equal(wire.ack.journalCursor, 1);
  assert.deepEqual(wire.events, []);
});

test("every envelope message shape is structured-clone safe (the wire law)", () => {
  const clientMessages: WorldClientMessage[] = [
    { kind: "init", requestId: 1, definition: { scope: { worldId: "w" } } },
    {
      kind: "request",
      requestId: 2,
      call: { port: "command", method: "addAnnotation", args: [{ kind: "add-annotation" }] },
    },
    { kind: "subscribe", channel: "published" },
    { kind: "dispose" },
  ];
  const hostMessages: WorldHostMessage[] = [
    { kind: "response", requestId: 2, outcome: { status: "ok", value: { a: [1, 2, { b: "c" }] } } },
    {
      kind: "clock",
      clock: {
        simulationTime: 1 as never,
        status: "playing",
        speed: 2,
        followingRealtime: true,
      },
    },
  ];
  for (const message of [...clientMessages, ...hostMessages]) {
    assert.deepEqual(structuredClone(message), message, JSON.stringify(message));
  }
  // functions can never cross the wire — the transport must fail loudly there
  assert.throws(() => structuredClone({ kind: "request", requestId: 1, call: { port: "query", method: "x", args: [() => 1] } }));
});
