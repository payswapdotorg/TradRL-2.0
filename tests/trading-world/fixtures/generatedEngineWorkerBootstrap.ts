/**
 * The `node:worker_threads` bootstrap for the W019 PARITY EXTENSION — a REAL
 * worker thread hosting the SAME W017 generated market the composed alpha
 * attachment hosts (`engineAttachment.ts`'s `createEngine` seam, mirrored
 * here on the worker side so both topologies run the identical engine).
 *
 * This fixture exists because the shipped W018 worker bootstrap
 * (`packages/tradrl-world-sim/adapter/test/fixtures/nodeWorkerBootstrap.ts`)
 * installs the DEFAULT session (the plain headless engine). The parity law
 * under test here needs the generated engine in BOTH topologies: the worker
 * host's `createSession` override composes the SAME real pieces
 * (`createWorldAdapterSession` + `createEngineAdapterRuntime` +
 * `createGeneratedWorldEngine`) with the SAME wiring the TL landed for the
 * alpha world. No product file is modified — everything imported here is a
 * real, merged source.
 *
 * TypeScript loading inside the thread: Node's native
 * `--experimental-transform-types` (passed by the spawner) + the W018
 * test-fixture `.js`→`.ts` resolver hook (re-used verbatim — tsx's loader
 * does not register inside worker threads).
 */

import { register } from "node:module";
import { parentPort } from "node:worker_threads";

if (parentPort === null) {
  throw new Error("generated-engine worker bootstrap requires a parent port");
}
const port = parentPort;

// The W018 resolver hook (the repo's `.js`→`.ts` specifier convention).
register(
  new URL(
    "../../../packages/tradrl-world-sim/adapter/test/fixtures/tsjsResolver.mjs",
    import.meta.url,
  ),
  { parentURL: import.meta.url },
);

const { installWorldWorkerHost } = await import(
  "../../../packages/tradrl-world-sim/adapter/workerHost.js"
);
const { createWorldAdapterSession, createEngineAdapterRuntime } = await import(
  "../../../packages/tradrl-world-sim/adapter/host.js"
);
const { createGeneratedWorldEngine } = await import(
  "../../../packages/tradrl-world-sim/generator/index.js"
);

const scope = {
  postMessage: (data: unknown) => port.postMessage(data),
  addEventListener: (_type: "message", listener: (event: { data: unknown }) => void) => {
    port.on("message", (message: unknown) => listener({ data: message }));
  },
};

// The SAME engine wiring `createAlphaEngineTransport` uses, on the worker
// side of the wire (the definition arrives in the `init` message; the
// generated engine is created INSIDE the thread).
installWorldWorkerHost(scope, {
  createSession: (sessionOptions) =>
    createWorldAdapterSession({
      emit: sessionOptions.emit,
      createRuntime: (runtimeInput) =>
        createEngineAdapterRuntime({
          ...runtimeInput,
          createEngine: (engineOptions) =>
            createGeneratedWorldEngine({
              definition: engineOptions.definition,
              wallTimeSource: engineOptions.wallTimeSource,
              onPublished: engineOptions.onPublished,
            }),
        }),
    }),
});
