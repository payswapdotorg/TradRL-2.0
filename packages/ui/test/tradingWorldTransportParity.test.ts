/**
 * THE UI/HEADLESS TRANSPORT PARITY TEST — W018's ACCEPTANCE I law at the
 * PROVIDER level.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md I ("The same command stream run
 * headlessly and through the UI produces the same deterministic result hash")
 * and spec/SIMULATION.md "Runtime topology" (TradingWorld UI → World Client
 * → Worker/Process Adapter → World Engine).
 *
 * ONE fixed command+clock stream (the W018 shared parity stream), THREE
 * runtimes:
 *   (a) the direct in-process W013 engine — the HEADLESS control;
 *   (b) the REAL UI provider (attachEngineWorldClient) over the Node
 *       in-process adapter;
 *   (c) the REAL UI provider over a REAL worker_threads adapter — the engine
 *       in a separate thread, every message across a genuine postMessage +
 *       structured-clone boundary, on the REAL wall clock.
 *
 * All three must produce IDENTICAL headless reports (eventCount + eventHash —
 * the journal digest), identical determinism manifests and identical event
 * envelopes; and the two PROVIDER runs must observe IDENTICAL published
 * projection streams and settled clock views — the UI-side projection stream
 * is a pure function of the command stream (never renumbered, never
 * fabricated). Wall clocks differ across all three (wall time never enters
 * digests, A9 — proven here across a real thread).
 *
 * The adapter-level twin (the envelope client over both topologies) is
 * packages/tradrl-world-sim/adapter/test/parity.test.ts.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldTransportParity.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { attachEngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../src/trading-world/runtime/engineWorldClient.js";
import type { WorldPublishedProjection } from "../src/trading-world/runtime/worldAdapterContracts.js";
import { createInProcessWorldTransport } from "../../tradrl-world-sim/adapter/inProcess.js";
import {
  asNodeWorkerChannel,
  createWorkerWorldTransport,
} from "../../tradrl-world-sim/adapter/workerTransport.js";
import type { WorldTransport } from "../../tradrl-world-sim/adapter/transport.js";
import {
  runParityStream,
  spawnAdapterWorker,
} from "../../tradrl-world-sim/adapter/test/helpers.js";
import type { ParityWorldRuntime } from "../../tradrl-world-sim/adapter/test/helpers.js";
import { createHeadlessWorldEngine } from "../../tradrl-world-sim/world/index.js";
import {
  fixedWallTimeSource,
  START,
  testDefinition,
  TRADER,
  WALL_START,
  WORLD,
} from "../../tradrl-world-sim/world/test/helpers.js";
import type { WorldEventEnvelope } from "../../tradrl-world-contracts/src/events.js";

const PARITY = { worldId: WORLD, participant: TRADER, start: START } as const;

/** (a) The headless control: the direct engine, no transport at all. */
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

interface ProviderRun {
  readonly runtime: ParityWorldRuntime;
  readonly client: EngineWorldClient;
  readonly published: readonly WorldPublishedProjection[];
  readonly clockViews: readonly { simulationTime: number }[];
}

/** Wrap the REAL provider into the shared parity-stream surface. */
async function providerRun(transport: WorldTransport): Promise<ProviderRun> {
  const client = await attachEngineWorldClient({ transport, expectedWorldId: WORLD });
  const published: WorldPublishedProjection[] = [];
  const clockViews: { simulationTime: number }[] = [];
  client.onPublished((projection) => published.push(projection));
  client.onClock((clock) => clockViews.push(clock));
  return {
    client,
    published,
    clockViews,
    runtime: {
      command: client.command,
      clock: client.clock,
      evidence: client.evidence,
      headlessReport: () => client.host.headlessReport(),
    },
  };
}

/** (b) The REAL provider over the Node in-process adapter. */
function inProcessProviderRun(): Promise<ProviderRun> {
  return providerRun(
    createInProcessWorldTransport({
      definition: testDefinition(),
      wallTimeSource: fixedWallTimeSource(WALL_START + 123_456), // DIFFERENT wall clock
    }),
  );
}

/** (c) The REAL provider over a REAL worker thread (REAL Date.now wall). */
async function workerProviderRun(): Promise<{ run: ProviderRun; worker: ReturnType<typeof spawnAdapterWorker> }> {
  const worker = spawnAdapterWorker();
  const transport = await createWorkerWorldTransport(asNodeWorkerChannel(worker), {
    definition: testDefinition(),
    // no fixedWallTime: the worker host reads the real wall clock — maximally
    // different from the fixed sources of the other two runs
  });
  return { run: await providerRun(transport), worker };
}

/** Flatten the provider's published events (the UI projection stream). */
function publishedEvents(published: readonly WorldPublishedProjection[]): WorldEventEnvelope[] {
  return published.flatMap((projection) => [...projection.events]);
}

test("PARITY: the REAL provider over BOTH adapters == the headless engine (identical journal digests)", async (t) => {
  const direct = await runParityStream(directEngineRuntime(), PARITY);
  const inProcess = await inProcessProviderRun();
  const viaWorker = await workerProviderRun();
  let inProcessResult: Awaited<ReturnType<typeof runParityStream>>;
  let workerResult: Awaited<ReturnType<typeof runParityStream>>;
  try {
    inProcessResult = await runParityStream(inProcess.runtime, PARITY);
    workerResult = await runParityStream(viaWorker.run.runtime, PARITY);
  } finally {
    inProcess.client.dispose();
    viaWorker.run.client.dispose();
    await viaWorker.worker.terminate();
  }

  t.diagnostic(
    `direct   : ${String(direct.report.eventCount)} events, hash ${direct.report.eventHash}`,
  );
  t.diagnostic(
    `inproc/ui: ${String(inProcessResult.report.eventCount)} events, hash ${inProcessResult.report.eventHash}`,
  );
  t.diagnostic(
    `worker/ui: ${String(workerResult.report.eventCount)} events, hash ${workerResult.report.eventHash}`,
  );

  assert.ok(
    direct.report.eventCount >= 8,
    "the parity stream journals a meaningful number of events",
  );
  // THE journal-digest parity law (ACCEPTANCE I):
  assert.deepEqual(
    inProcessResult.report,
    direct.report,
    "PROVIDER over in-process adapter: identical headless report (eventCount + eventHash)",
  );
  assert.deepEqual(
    workerResult.report,
    direct.report,
    "PROVIDER over WORKER adapter (real thread, real wall clock): identical headless report",
  );
  // The full determinism evidence:
  assert.deepEqual(
    inProcessResult.manifest,
    direct.manifest,
    "identical determinism manifests (in-process provider)",
  );
  assert.deepEqual(
    workerResult.manifest,
    direct.manifest,
    "identical determinism manifests (worker provider)",
  );
  assert.deepEqual(
    inProcessResult.events,
    direct.events,
    "identical event envelopes (in-process provider)",
  );
  assert.deepEqual(
    workerResult.events,
    direct.events,
    "identical event envelopes (worker provider)",
  );
});

test("PARITY: both adapters deliver IDENTICAL provider projection streams (never renumbered)", async (t) => {
  const inProcess = await inProcessProviderRun();
  const viaWorker = await workerProviderRun();
  let inProcessResult: Awaited<ReturnType<typeof runParityStream>>;
  let workerResult: Awaited<ReturnType<typeof runParityStream>>;
  try {
    inProcessResult = await runParityStream(inProcess.runtime, PARITY);
    workerResult = await runParityStream(viaWorker.run.runtime, PARITY);
  } finally {
    inProcess.client.dispose();
    viaWorker.run.client.dispose();
    await viaWorker.worker.terminate();
  }

  // The published channel is the UI's projection stream: identical across
  // adapters — the transport topology is invisible above the seam.
  assert.deepEqual(
    workerResult.report,
    inProcessResult.report,
    "both provider runs journal identical digests (per-run defense of the law above)",
  );
  assert.deepEqual(
    viaWorker.run.published,
    inProcess.published,
    "identical published projections (ack + engine-sequenced events) across both adapters",
  );
  assert.deepEqual(
    viaWorker.run.clockViews,
    inProcess.clockViews,
    "identical settled clock views across both adapters",
  );

  // Projection law: the provider stream IS the engine journal — every
  // journaled event was published, in order, with the engine's sequences.
  const stream = publishedEvents(inProcess.published);
  assert.equal(
    stream.length,
    inProcessResult.report.eventCount,
    "every journaled event crossed the published channel exactly once",
  );
  let expectedSequence = 1;
  for (const event of stream) {
    assert.equal(event.sequence, expectedSequence, "sequences are contiguous from 1 (never renumbered)");
    expectedSequence += 1;
  }
  assert.deepEqual(
    stream,
    inProcessResult.events,
    "the flattened published stream equals the journal events verbatim",
  );
  t.diagnostic(
    `provider stream: ${String(stream.length)} published events, sequences 1..${String(stream.length)}`,
  );
});

test("PARITY: the same stream run TWICE through the provider+worker adapter is stable", async () => {
  const first = await workerProviderRun();
  const runA = await runParityStream(first.run.runtime, PARITY);
  first.run.client.dispose();
  await first.worker.terminate();

  const second = await workerProviderRun();
  const runB = await runParityStream(second.run.runtime, PARITY);
  second.run.client.dispose();
  await second.worker.terminate();

  assert.deepEqual(runB.report, runA.report, "provider+worker: run-to-run stability");
  assert.deepEqual(runB.manifest, runA.manifest);
  assert.deepEqual(second.run.published, first.run.published, "identical published streams run-to-run");
});
