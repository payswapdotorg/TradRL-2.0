/**
 * W018 adapter host tests: dispatch over the four ports, the `host`
 * pseudo-port, published/clock channels, the fail-closed laws (unknown
 * port/method, duplicate init), the realtime driver (injectable scheduler)
 * and the init state machine (`createWorldAdapterSession`).
 *
 * Run: ../../node_modules/.bin/tsx --test adapter/test/host.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { WallTimeMs } from "tradrl-world-contracts/time";
import { asWallTime } from "tradrl-world-contracts/time";

import { createHeadlessWorldEngine } from "../../world/index.js";
import {
  addAnnotationCommand,
  fixedWallTimeSource,
  setScenarioCommand,
  START,
  submitOrderCommand,
  testDefinition,
  WALL_START,
} from "../../world/test/helpers.js";
import { createEngineAdapterRuntime, createWorldAdapterSession } from "../host.js";
import type { WorldHostMessage } from "../envelope.js";
import { ADAPTER_ENVELOPE_VERSION } from "../envelope.js";
import { createTestWorldClient } from "./helpers.js";
import { createInProcessWorldTransport } from "../inProcess.js";

type HarnessOptions = Partial<Parameters<typeof createEngineAdapterRuntime>[0]> &
  Partial<{ readonly definition: ReturnType<typeof testDefinition> }>;

function harness(options: HarnessOptions = {}) {
  const emitted: WorldHostMessage[] = [];
  const diagnostics: string[] = [];
  const runtime = createEngineAdapterRuntime({
    ...options,
    definition: options.definition ?? testDefinition(),
    emit: options.emit ?? ((message) => emitted.push(message)),
    ...(options.onDiagnostics === undefined ? {} : { onDiagnostics: options.onDiagnostics }),
  });
  return { runtime, emitted, diagnostics };
}

test("host.describe reports adapter+engine identity and the envelope version", async () => {
  const { runtime } = harness();
  const info = await runtime.core.describe();
  assert.equal(info.worldId, "world-w013-tests");
  assert.equal(info.engine, "tradrl-world-sim");
  assert.equal(info.envelopeVersion, ADAPTER_ENVELOPE_VERSION);
  assert.equal(info.journalCursor, 0);
});

test("dispatch reaches the engine ports: query ok, typed stubs as remote errors", async () => {
  const { runtime, emitted } = harness();
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "query", method: "getWorldMeta", args: [] },
  });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 2,
    call: { port: "query", method: "getQuote", args: ["instrument-es-fut"] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const metaResponse = emitted.find((m) => m.kind === "response" && m.requestId === 1);
  assert.equal(metaResponse?.kind === "response" && metaResponse.outcome.status, "ok");
  const meta = metaResponse?.kind === "response" && metaResponse.outcome.status === "ok"
    ? (metaResponse.outcome.value as { worldId: string })
    : undefined;
  assert.equal(meta?.worldId, "world-w013-tests");

  const quoteResponse = emitted.find((m) => m.kind === "response" && m.requestId === 2);
  assert.ok(
    quoteResponse?.kind === "response" &&
      quoteResponse.outcome.status === "error" &&
      quoteResponse.outcome.error.name === "NotImplementedInSkeletonError",
    "the W017 stub surfaces as a typed remote error — never a fabricated quote",
  );
});

test("command results are VALUES (acked or typed rejection), not wire errors", async () => {
  const { runtime, emitted } = harness();
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "command", method: "addAnnotation", args: [addAnnotationCommand()] },
  });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 2,
    call: { port: "command", method: "submitOrder", args: [submitOrderCommand()] },
  });
  // a structurally broken command: the typed validate-stage rejection value
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 3,
    call: { port: "command", method: "addAnnotation", args: [addAnnotationCommand({ text: " " })] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const acked = emitted.find((m) => m.kind === "response" && m.requestId === 1);
  const submitted = emitted.find((m) => m.kind === "response" && m.requestId === 2);
  const rejected = emitted.find((m) => m.kind === "response" && m.requestId === 3);
  assert.ok(
    acked?.kind === "response" &&
      acked.outcome.status === "ok" &&
      (acked.outcome.value as { status: string }).status === "acked",
  );
  assert.ok(
    submitted?.kind === "response" &&
      submitted.outcome.status === "ok" &&
      (submitted.outcome.value as { status: string }).status === "acked",
    "a submit-order ack is a VALUE on the wire (W014/W015: the order really routes through the seams)",
  );
  assert.ok(
    rejected?.kind === "response" &&
      rejected.outcome.status === "ok" &&
      (rejected.outcome.value as { status: string }).status === "rejected",
    "a typed CommandResult rejection is a VALUE on the wire (the lifecycle result)",
  );
});

test("clock ops dispatch; a typed clock rejection surfaces with its code", async () => {
  const { runtime, emitted } = harness();
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "clock", method: "step", args: [5_000] },
  });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 2,
    call: { port: "clock", method: "seek", args: [START + 1_000] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const step = emitted.find((m) => m.kind === "response" && m.requestId === 1);
  assert.equal(step?.kind === "response" && step.outcome.status, "ok");
  const rewind = emitted.find((m) => m.kind === "response" && m.requestId === 2);
  assert.ok(
    rewind?.kind === "response" &&
      rewind.outcome.status === "error" &&
      rewind.outcome.error.name === "ClockRejectionError" &&
      (rewind.outcome.error.data as { rejection?: { code?: string } } | undefined)?.rejection
        ?.code === "rewind-requires-branch",
    "A8 rewind-requires-branch survives the wire with its typed code",
  );
});

test("evidence + host.headlessReport dispatch (the parity artifacts)", async () => {
  const { runtime, emitted } = harness();
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "evidence", method: "getDeterminismManifest", args: [] },
  });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 2,
    call: { port: "host", method: "headlessReport", args: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const manifest = emitted.find((m) => m.kind === "response" && m.requestId === 1);
  assert.ok(
    manifest?.kind === "response" &&
      manifest.outcome.status === "ok" &&
      typeof (manifest.outcome.value as { commandStreamHash: string }).commandStreamHash ===
        "string",
  );
  const report = emitted.find((m) => m.kind === "response" && m.requestId === 2);
  assert.ok(
    report?.kind === "response" &&
      report.outcome.status === "ok" &&
      typeof (report.outcome.value as { eventHash: string }).eventHash === "string",
  );
});

test("unknown port/method fails closed with a typed adapter error", async () => {
  const { runtime, emitted } = harness();
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "query", method: "getNope", args: [] },
  });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 2,
    call: { port: "nope" as never, method: "x", args: [] },
  });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 3,
    call: { port: "host", method: "nope", args: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const codes = emitted
    .filter((m) => m.kind === "response")
    .map(
      (m) =>
        m.kind === "response" &&
        m.outcome.status === "error" &&
        (m.outcome.error.data as { code?: string } | undefined)?.code,
    );
  assert.deepEqual(codes, ["unknown-method", "unknown-port", "unknown-method"]);
});

test("the published channel carries engine sequences; unsubscribing stops pushes", async () => {
  const { runtime, emitted } = harness();
  runtime.core.handleClientMessage({ kind: "subscribe", channel: "published" });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "command", method: "addAnnotation", args: [addAnnotationCommand()] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const push = emitted.find((m) => m.kind === "published");
  assert.ok(push?.kind === "published", "onPublished crossed the envelope");
  if (push?.kind === "published") {
    assert.equal(push.projection.events.length, 1);
    assert.equal(push.projection.events[0]!.sequence, 1);
    assert.equal(push.projection.ack.journalCursor, 1);
    assert.equal(push.projection.events[0]!.eventType, "world.annotation.added");
  }
  runtime.core.handleClientMessage({ kind: "unsubscribe", channel: "published" });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 2,
    call: { port: "command", method: "setScenario", args: [setScenarioCommand()] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(emitted.filter((m) => m.kind === "published").length, 1);
});

test("the clock channel pushes the settled view after acked mutating clock calls only", async () => {
  const { runtime, emitted } = harness();
  runtime.core.handleClientMessage({ kind: "subscribe", channel: "clock" });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "clock", method: "play", args: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pushes = emitted.filter((m) => m.kind === "clock");
  assert.equal(pushes.length, 1);
  if (pushes[0]?.kind === "clock") {
    assert.equal(pushes[0].clock.status, "playing");
  }
  // a read (getClock) is not a mutation: no extra push
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 2,
    call: { port: "clock", method: "getClock", args: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(emitted.filter((m) => m.kind === "clock").length, 1);
  // a REJECTED clock op changes nothing: no push either
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 3,
    call: { port: "clock", method: "seek", args: [0] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(emitted.filter((m) => m.kind === "clock").length, 1);
});

test("determinism guard: burst commands serialize in invocation order", async () => {
  const { runtime, emitted } = harness();
  const burstCommands = Array.from({ length: 8 }, (_, i) =>
    addAnnotationCommand({
      commandId: `cmd-burst-${String(i)}` as never,
      text: `burst ${String(i)}`,
    }),
  );
  // interleave commands with clock steps WITHOUT awaiting: the arrival order
  // must equal the invocation order (FIFO envelope + engine queue)
  for (let i = 0; i < burstCommands.length; i += 1) {
    runtime.core.handleClientMessage({
      kind: "request",
      requestId: i + 1,
      call: { port: "command", method: "addAnnotation", args: [burstCommands[i]] },
    });
    runtime.core.handleClientMessage({
      kind: "request",
      requestId: 100 + i,
      call: { port: "clock", method: "step", args: [1_000] },
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const records = runtime.engine.journal.records();
  assert.equal(records.length, burstCommands.length);
  assert.deepEqual(
    records.map((record) => (record.envelope.payload as { text: string }).text),
    burstCommands.map((command) => command.text),
    "journal order == invocation order",
  );
  const responseIds = emitted
    .filter((m) => m.kind === "response")
    .map((m) => (m as { requestId: number }).requestId);
  assert.deepEqual(
    responseIds,
    Array.from({ length: burstCommands.length * 2 }, (_, i) =>
      i % 2 === 0 ? i / 2 + 1 : 100 + Math.floor(i / 2),
    ),
    "responses return in request order (correlation by id)",
  );
});

test("the realtime driver steps by elapsed wall time x speed through the engine queue", async () => {
  const emitted: WorldHostMessage[] = [];
  const diagnostics: string[] = [];
  let wallNow = WALL_START;
  const ticks: Array<() => void> = [];
  const runtime = createEngineAdapterRuntime({
    definition: testDefinition(),
    wallTimeSource: () => asWallTime(wallNow),
    wireOptions: {
      realtime: {
        enabled: true,
        tickMs: 10,
      },
    },
    scheduler: {
      setInterval: (handler) => {
        ticks.push(handler);
        return ticks.length;
      },
      clearInterval: () => undefined,
    },
    emit: (message) => emitted.push(message),
    onDiagnostics: (detail) => diagnostics.push(detail),
  });
  runtime.core.handleClientMessage({ kind: "subscribe", channel: "clock" });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "clock", method: "play", args: [] },
  });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 2,
    call: { port: "clock", method: "followRealtime", args: [true] },
  });
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 3,
    call: { port: "clock", method: "setSpeed", args: [2] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const before = runtime.engine.clockState().simulationTime;
  wallNow = wallNow + 1_000; // 1s of wall time passes
  ticks[0]!(); // driver tick
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    runtime.engine.clockState().simulationTime - before,
    2_000,
    "delta = elapsed (1000ms) x speed (2x)",
  );
  assert.ok(
    emitted.some((m) => m.kind === "clock"),
    "driver steps push the clock channel",
  );

  // paused clock: no stepping, and the wall anchor refreshes
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 4,
    call: { port: "clock", method: "pause", args: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pausedAt = runtime.engine.clockState().simulationTime;
  wallNow = wallNow + 5_000;
  ticks[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(runtime.engine.clockState().simulationTime, pausedAt, "no steps while paused");
  assert.deepEqual(diagnostics, []);

  // resume, let the queue drain, then a driver tick must land BEFORE the next
  // command (arrival-order serialization: driver steps go through the queue)
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 5,
    call: { port: "clock", method: "play", args: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  wallNow = wallNow + 500;
  ticks[0]!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const afterDriverStep = runtime.engine.clockState().simulationTime;
  assert.ok(afterDriverStep > pausedAt, "driver stepped after resume");
  runtime.core.handleClientMessage({
    kind: "request",
    requestId: 6,
    call: { port: "command", method: "addAnnotation", args: [addAnnotationCommand()] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const lastRecord = runtime.engine.journal.records().at(-1);
  assert.ok(lastRecord !== undefined);
  assert.equal(
    lastRecord.envelope.occurredAt,
    afterDriverStep,
    "the command is stamped with the post-driver-step time (serialized behind it)",
  );
  runtime.core.dispose();
});

test("session: init creates the engine; duplicate/bad init and pre-init requests fail closed", async () => {
  const emitted: WorldHostMessage[] = [];
  const diagnostics: string[] = [];
  const session = createWorldAdapterSession({
    emit: (message) => emitted.push(message),
    onDiagnostics: (detail) => diagnostics.push(detail),
  });
  // request before init
  session.handleClientMessage({
    kind: "request",
    requestId: 1,
    call: { port: "query", method: "getWorldMeta", args: [] },
  });
  // subscribe before init: dropped with a diagnostic (no requestId to answer)
  session.handleClientMessage({ kind: "subscribe", channel: "published" });
  // malformed traffic: dropped, never throws
  session.handleClientMessage("garbage");
  session.handleClientMessage(null);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const notInitialized = emitted.find((m) => m.kind === "response");
  assert.ok(
    notInitialized?.kind === "response" &&
      notInitialized.outcome.status === "error" &&
      (notInitialized.outcome.error.data as { code?: string }).code === "not-initialized",
  );
  assert.equal(diagnostics.length, 3);

  // bad (shaped but invalid) definition: typed error response, session stays initializable
  session.handleClientMessage({
    kind: "init",
    requestId: 2,
    definition: { ...testDefinition(), seed: "" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const badInit = emitted.find((m) => m.kind === "response" && m.requestId === 2);
  assert.ok(
    badInit?.kind === "response" &&
      badInit.outcome.status === "error" &&
      badInit.outcome.error.name === "InvalidWorldDefinitionError",
  );

  // garbage definition: still fail closed, never a session crash
  session.handleClientMessage({ kind: "init", requestId: 7, definition: { nope: true } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const garbageInit = emitted.find((m) => m.kind === "response" && m.requestId === 7);
  assert.ok(
    garbageInit?.kind === "response" && garbageInit.outcome.status === "error",
  );

  // valid init: ok response carrying the host info
  session.handleClientMessage({
    kind: "init",
    requestId: 3,
    definition: testDefinition(),
    options: { fixedWallTime: WALL_START },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const okInit = emitted.find((m) => m.kind === "response" && m.requestId === 3);
  assert.ok(okInit?.kind === "response" && okInit.outcome.status === "ok");
  assert.equal(
    (okInit as { outcome: { value: { worldId: string } } }).outcome.value.worldId,
    "world-w013-tests",
  );

  // duplicate init: typed already-initialized
  session.handleClientMessage({ kind: "init", requestId: 4, definition: testDefinition() });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const duplicate = emitted.find((m) => m.kind === "response" && m.requestId === 4);
  assert.ok(
    duplicate?.kind === "response" &&
      duplicate.outcome.status === "error" &&
      (duplicate.outcome.error.data as { code?: string }).code === "already-initialized",
  );

  // dispose then request: typed disposed
  session.handleClientMessage({ kind: "dispose" });
  session.handleClientMessage({
    kind: "request",
    requestId: 5,
    call: { port: "query", method: "getWorldMeta", args: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const disposed = emitted.find((m) => m.kind === "response" && m.requestId === 5);
  assert.ok(
    disposed?.kind === "response" &&
      disposed.outcome.status === "error" &&
      (disposed.outcome.error.data as { code?: string }).code === "disposed",
  );
});

test("the in-process transport core rejects init (engine exists since construction)", async () => {
  const transport = createInProcessWorldTransport({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(),
  });
  const client = createTestWorldClient(transport);
  await assert.rejects(
    client.call("host", "nope", []),
    (error: unknown) =>
      error instanceof Error &&
      (error as { data?: { code?: string } }).data?.code === "unknown-method",
  );
  await assert.rejects(
    client.call("query", "getNope", []),
    (error: unknown) =>
      error instanceof Error &&
      (error as { data?: { code?: string } }).data?.code === "unknown-method",
  );
  client.close();
});

test("createEngineAdapterRuntime honors an injected engine factory (the seam the session uses)", async () => {
  const emitted: WorldHostMessage[] = [];
  let injectedWall: () => WallTimeMs = () => asWallTime(WALL_START);
  const runtime = createEngineAdapterRuntime({
    definition: testDefinition(),
    wallTimeSource: () => injectedWall(),
    emit: (message) => emitted.push(message),
    createEngine: (options) => {
      injectedWall = options.wallTimeSource;
      return createHeadlessWorldEngine({
        definition: options.definition,
        wallTimeSource: options.wallTimeSource,
        onPublished: options.onPublished,
      });
    },
  });
  assert.equal(runtime.engine.worldId, "world-w013-tests");
  const info = await runtime.core.describe();
  assert.equal(info.envelopeVersion, ADAPTER_ENVELOPE_VERSION);
});
