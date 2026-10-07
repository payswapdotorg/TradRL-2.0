/**
 * THE ADAPTER PARITY TEST — W018's SIMULATION.md/ACCEPTANCE I law at the
 * adapter level.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md I ("The same command stream run
 * headlessly and through the UI produces the same deterministic result
 * hash") — this is the adapter half: one fixed command+clock stream, three
 * runtimes:
 *   (a) the direct in-process engine (the headless control),
 *   (b) the Node in-process adapter (loopback wire),
 *   (c) the WORKER adapter (real thread, real postMessage boundary).
 *
 * All three must produce IDENTICAL headless reports (eventCount + eventHash —
 * the journal digest), identical determinism manifests (command-stream hash)
 * and identical event envelopes, while their wall-clock sources differ
 * (wall time never enters digests — A9, proven here across a thread boundary).
 *
 * The provider-level twin (the REAL UI client over both adapters) lives at
 * packages/ui/test/tradingWorldTransportParity.test.ts.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createHeadlessWorldEngine } from "../../world/index.js";
import { fixedWallTimeSource, testDefinition, WALL_START } from "../../world/test/helpers.js";
import { createInProcessWorldTransport } from "../inProcess.js";
import { asNodeWorkerChannel, createWorkerWorldTransport } from "../workerTransport.js";
import { createTestWorldClient, runParityStream, spawnAdapterWorker } from "./helpers.js";
import type { ParityWorldRuntime, TestWorldClient } from "./helpers.js";

const PARITY = {
  worldId: "world-w013-tests",
  participant: "participant-trader",
  start: 1_700_000_000_000,
} as const;

function directEngineRuntime(): ParityWorldRuntime {
  const engine = createHeadlessWorldEngine({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(),
  });
  return {
    command: engine.command,
    clock: engine.clock,
    evidence: engine.evidence,
    headlessReport: async () => engine.headlessReport(),
  };
}

/** Adapt a correlated envelope client to the four-port parity surface. */
function clientRuntime(client: TestWorldClient): ParityWorldRuntime {
  return {
    command: {
      submitOrder: (command) => client.call("command", "submitOrder", [command]) as never,
      cancelOrder: (command) => client.call("command", "cancelOrder", [command]) as never,
      replaceOrder: (command) => client.call("command", "replaceOrder", [command]) as never,
      closePosition: (command) => client.call("command", "closePosition", [command]) as never,
      addAnnotation: (command) => client.call("command", "addAnnotation", [command]) as never,
      createSnapshot: (command) => client.call("command", "createSnapshot", [command]) as never,
      branchWorld: (command) => client.call("command", "branchWorld", [command]) as never,
      setScenario: (command) => client.call("command", "setScenario", [command]) as never,
    },
    clock: {
      play: () => client.call("clock", "play", []) as never,
      pause: () => client.call("clock", "pause", []) as never,
      step: (deltaMs?: number) =>
        client.call("clock", "step", deltaMs === undefined ? [] : [deltaMs]) as never,
      seek: (to) => client.call("clock", "seek", [to]) as never,
      jumpToEvent: (target) => client.call("clock", "jumpToEvent", [target]) as never,
      setSpeed: (speed) => client.call("clock", "setSpeed", [speed]) as never,
      followRealtime: (enabled) => client.call("clock", "followRealtime", [enabled]) as never,
      getClock: () => client.call("clock", "getClock", []) as never,
    },
    evidence: {
      getEvent: (eventId) => client.call("evidence", "getEvent", [eventId]) as never,
      getEvents: (query) => client.call("evidence", "getEvents", [query ?? {}]) as never,
      getProvenance: (eventId) => client.call("evidence", "getProvenance", [eventId]) as never,
      getSnapshot: (snapshotId) => client.call("evidence", "getSnapshot", [snapshotId]) as never,
      getBranchLineage: (worldId) =>
        client.call(
          "evidence",
          "getBranchLineage",
          worldId === undefined ? [] : [worldId],
        ) as never,
      getInformationBoundary: (asOf) =>
        client.call("evidence", "getInformationBoundary", [asOf]) as never,
      getDeterminismManifest: () =>
        client.call("evidence", "getDeterminismManifest", []) as never,
    },
    headlessReport: () => client.call("host", "headlessReport", []) as never,
  };
}

function inProcessRuntime(): ParityWorldRuntime {
  return clientRuntime(
    createTestWorldClient(
      createInProcessWorldTransport({
        definition: testDefinition(),
        wallTimeSource: fixedWallTimeSource(WALL_START + 123_456), // DIFFERENT wall clock
      }),
    ),
  );
}

async function spawnWorkerRuntime(): Promise<{
  runtime: ParityWorldRuntime;
  shutdown: () => Promise<void>;
}> {
  const worker = spawnAdapterWorker();
  const transport = await createWorkerWorldTransport(asNodeWorkerChannel(worker), {
    definition: testDefinition(),
    // the worker host uses the REAL Date.now wall clock — maximally different
    // from the fixed sources of the other two runtimes
  });
  const client = createTestWorldClient(transport);
  return {
    runtime: clientRuntime(client),
    shutdown: async () => {
      client.close();
      await worker.terminate();
    },
  };
}

test("PARITY: identical stream through direct engine, in-process adapter and WORKER adapter", async (t) => {
  const direct = await runParityStream(directEngineRuntime(), PARITY);
  const inProcess = await runParityStream(inProcessRuntime(), PARITY);
  const worker = await spawnWorkerRuntime();
  let viaWorker: Awaited<ReturnType<typeof runParityStream>>;
  try {
    viaWorker = await runParityStream(worker.runtime, PARITY);
  } finally {
    await worker.shutdown();
  }

  t.diagnostic(
    `direct: ${String(direct.report.eventCount)} events, hash ${direct.report.eventHash}`,
  );
  t.diagnostic(
    `inproc: ${String(inProcess.report.eventCount)} events, hash ${inProcess.report.eventHash}`,
  );
  t.diagnostic(
    `worker: ${String(viaWorker.report.eventCount)} events, hash ${viaWorker.report.eventHash}`,
  );

  assert.ok(
    direct.report.eventCount >= 8,
    "the parity stream journals a meaningful number of events",
  );
  assert.deepEqual(
    inProcess.report,
    direct.report,
    "in-process adapter: identical headless report (eventCount + eventHash)",
  );
  assert.deepEqual(
    viaWorker.report,
    direct.report,
    "WORKER adapter (real thread): identical headless report",
  );
  assert.deepEqual(
    inProcess.manifest,
    direct.manifest,
    "identical determinism manifests (in-process)",
  );
  assert.deepEqual(viaWorker.manifest, direct.manifest, "identical determinism manifests (worker)");
  assert.deepEqual(inProcess.events, direct.events, "identical event envelopes (in-process)");
  assert.deepEqual(viaWorker.events, direct.events, "identical event envelopes (worker)");
});

test("PARITY: the same stream run TWICE through the worker adapter is stable", async () => {
  const first = await spawnWorkerRuntime();
  const runA = await runParityStream(first.runtime, PARITY);
  await first.shutdown();
  const second = await spawnWorkerRuntime();
  const runB = await runParityStream(second.runtime, PARITY);
  await second.shutdown();
  assert.deepEqual(runB.report, runA.report, "worker adapter: run-to-run stability");
  assert.deepEqual(runB.manifest, runA.manifest);
});

test("PARITY: burst posting (no awaits) yields the same digest as sequential posting", async () => {
  const annotation = (i: number) => ({
    kind: "add-annotation",
    commandId: `burst-${String(i)}` as never,
    worldId: PARITY.worldId as never,
    issuedBy: PARITY.participant as never,
    issuedAt: (PARITY.start + i) as never,
    at: (PARITY.start + 100) as never,
    text: `burst ${String(i)}`,
  });

  // Sequential: await every op
  const sequential = createTestWorldClient(
    createInProcessWorldTransport({
      definition: testDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    }),
  );
  await sequential.call("clock", "play", []);
  for (let i = 0; i < 12; i += 1) {
    await sequential.call("clock", "step", [1_500]);
    await sequential.call("command", "addAnnotation", [annotation(i)]);
  }
  const sequentialReport = (await sequential.call("host", "headlessReport", [])) as {
    eventCount: number;
    eventHash: string;
  };

  // Burst: fire the same ops without awaiting, then drain — FIFO envelope +
  // engine queue ⇒ same arrival order ⇒ same digest
  const burst = createTestWorldClient(
    createInProcessWorldTransport({
      definition: testDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    }),
  );
  const pending: Promise<unknown>[] = [];
  pending.push(burst.call("clock", "play", []));
  for (let i = 0; i < 12; i += 1) {
    pending.push(burst.call("clock", "step", [1_500]));
    pending.push(burst.call("command", "addAnnotation", [annotation(i)]));
  }
  await Promise.all(pending);
  const burstReport = (await burst.call("host", "headlessReport", [])) as {
    eventCount: number;
    eventHash: string;
  };

  assert.equal(sequentialReport.eventCount, 12);
  assert.deepEqual(
    burstReport,
    sequentialReport,
    "burst posting == sequential posting (the transport never reorders)",
  );
  sequential.close();
  burst.close();
});
