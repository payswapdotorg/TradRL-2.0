/**
 * The Web Worker ENTRY for the World adapter — W018.
 *
 * Spec: spec/SIMULATION.md "Execution targets" (Web Worker). Bundle this
 * module as the worker script (module type), then connect with
 * {@link "./workerTransport.js"}.`createWorkerWorldTransport`:
 *
 * ```ts
 * const worker = new Worker(new URL("./worker.ts", import.meta.url), {
 *   type: "module",
 * });
 * const transport = await createWorkerWorldTransport(asDomWorkerChannel(worker), {
 *   definition,
 * });
 * ```
 *
 * In a Dedicated Web Worker context this module self-installs the host
 * session on `self`. Importing it anywhere else (main window, Node process)
 * is a detected no-op — see {@link detectWorkerScope}. Node `worker_threads`
 * tests install explicitly via `installWorldWorkerHost`.
 */

import { detectWorkerScope, installWorldWorkerHost } from "./workerHost.js";

const workerScope = detectWorkerScope();
if (workerScope !== undefined) {
  installWorldWorkerHost(workerScope);
}

// Re-export for explicit installs (tests, worker_threads bootstraps).
export { installWorldWorkerHost } from "./workerHost.js";
export type { WorldWorkerHostOptions, WorldWorkerScope } from "./workerHost.js";
export { detectWorkerScope } from "./workerHost.js";
