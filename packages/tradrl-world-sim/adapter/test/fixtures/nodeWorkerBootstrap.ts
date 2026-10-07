/**
 * The `node:worker_threads` bootstrap for the W018 worker tests.
 *
 * Wraps `parentPort` into the minimal {@link WorldWorkerScope} shape the
 * DOM-worker host expects, then installs the SAME worker host a browser
 * Dedicated Web Worker runs (`installWorldWorkerHost`). This is what makes
 * the worker-adapter tests real: the engine runs in a SEPARATE THREAD and
 * every message crosses a genuine postMessage/structured-clone boundary.
 *
 * TypeScript loading inside the thread: Node's native
 * `--experimental-transform-types` (passed by the test's spawn helper)
 * compiles the sources; the tiny `tsjsResolver.mjs` hook re-applies the
 * repo's `.js`→`.ts` specifier convention that tsx provides in the main
 * process but not inside worker threads.
 */

import { register } from "node:module";
import { parentPort } from "node:worker_threads";

if (parentPort === null) {
  throw new Error("world adapter worker bootstrap requires a parent port");
}
const port = parentPort;

register(new URL("./tsjsResolver.mjs", import.meta.url), {
  parentURL: import.meta.url,
});

const { installWorldWorkerHost } = await import("../../workerHost.js");
const scope = {
  postMessage: (data: unknown) => port.postMessage(data),
  addEventListener: (_type: "message", listener: (event: { data: unknown }) => void) => {
    port.on("message", (message: unknown) => listener({ data: message }));
  },
};

installWorldWorkerHost(scope);
