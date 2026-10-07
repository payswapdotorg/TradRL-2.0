/**
 * W019 suite helper: spawn a REAL `node:worker_threads` worker hosting the
 * W017 generated engine (the same wiring the composed alpha attachment uses)
 * and attach the REAL W018 provider to it. Shared by the honest-state
 * (worker-death fail-closed) and parity-extension tests.
 *
 * Run (repo root): node_modules/.bin/tsx --test tests/trading-world/*.test.ts
 */

import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";

import { attachEngineWorldClient } from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";
import type { WorldPublishedProjection } from "../../packages/ui/src/trading-world/runtime/worldAdapterContracts.js";
import {
  alphaWorldDefinition,
  createAlphaEngineTransport,
} from "../../packages/ui/src/trading-world/runtime/engineAttachment.js";
import type { WorldTransport } from "../../packages/tradrl-world-sim/adapter/transport.js";
import {
  asNodeWorkerChannel,
  createWorkerWorldTransport,
} from "../../packages/tradrl-world-sim/adapter/workerTransport.js";

const BOOTSTRAP = resolvePath(
  import.meta.dirname,
  "fixtures/generatedEngineWorkerBootstrap.ts",
);

/** Spawn a REAL worker thread hosting the generated engine (no engine yet). */
export function spawnGeneratedEngineWorker(): Worker {
  return new Worker(pathToFileURL(BOOTSTRAP), {
    execArgv: ["--experimental-transform-types"],
  });
}

/** A live projection collector over an attached provider. */
export interface AttachedRun {
  readonly client: EngineWorldClient;
  readonly published: readonly WorldPublishedProjection[];
  readonly clockViews: readonly { simulationTime: number }[];
}

/** Attach the REAL provider to a transport and collect both push channels. */
export async function attachRun(transport: WorldTransport, worldId: string): Promise<AttachedRun> {
  const client = await attachEngineWorldClient({ transport, expectedWorldId: worldId });
  const published: WorldPublishedProjection[] = [];
  const clockViews: { simulationTime: number }[] = [];
  client.onPublished((projection) => published.push(projection));
  client.onClock((clock) => clockViews.push(clock));
  return { client, published, clockViews };
}

/** The composed in-process attachment for `worldId` (the production path). */
export function inProcessTransport(worldId: string): WorldTransport {
  return createAlphaEngineTransport(worldId);
}

/** The worker-topology twin: the same definition over a REAL worker thread. */
export async function workerTransport(worldId: string): Promise<{ transport: WorldTransport; worker: Worker }> {
  const worker = spawnGeneratedEngineWorker();
  const transport = await createWorkerWorldTransport(asNodeWorkerChannel(worker), {
    definition: alphaWorldDefinition(worldId),
  });
  return { transport, worker };
}
