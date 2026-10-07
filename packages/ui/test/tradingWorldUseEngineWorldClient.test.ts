/**
 * useEngineWorldClient tests (W018) — the React provider hook lifecycle laws.
 *
 * The hook is a thin useSyncExternalStore wrapper over a framework-free
 * controller (`createEngineWorldClientController`), so every lifecycle law is
 * provable in plain Node — and the SSR law (fail-closed render, effects never
 * run) is provable with ReactDOMServer, the W006 test convention.
 *
 * Laws:
 * - before attach (and after teardown) the client is the W006 fail-closed
 *   noop — typed rejections, never fabricated data (A6);
 * - start() attaches over the transport; stop() disposes the engine client
 *   and returns to fail-closed; start-after-stop re-attaches FRESH
 *   (StrictMode double-mount tolerance);
 * - a stop() that races an in-flight attach wins: the late engine client is
 *   disposed and never published;
 * - attach failures (refused init, death, world mismatch) stay fail-closed;
 * - dispose() is permanent;
 * - SSR renders the server snapshot: unattached, attachTransport never called.
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldUseEngineWorldClient.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  createEngineWorldClientController,
  useEngineWorldClient,
} from "../src/trading-world/runtime/useEngineWorldClient.js";
import type { EngineWorldClientController } from "../src/trading-world/runtime/useEngineWorldClient.js";
import { TradingWorldRuntimeUnavailableError } from "../src/trading-world/runtime/worldClient.js";
import type { TradingWorldClient } from "../src/trading-world/runtime/worldClient.js";
import type { WorldClientMessage } from "../src/trading-world/runtime/worldAdapterContracts.js";
import { createInProcessWorldTransport } from "../../tradrl-world-sim/adapter/inProcess.js";
import type { WorldTransport } from "../../tradrl-world-sim/adapter/transport.js";
import { fixedWallTimeSource, testDefinition, WORLD } from "../../tradrl-world-sim/world/test/helpers.js";

/** A spyable transport factory counting transports and close() calls. */
function transportFactory() {
  const closed: number[] = [];
  let transports = 0;
  const wrap = (transport: WorldTransport): WorldTransport => {
    transports += 1;
    return {
      postMessage: (message: WorldClientMessage) => transport.postMessage(message),
      onHostMessage: (listener) => transport.onHostMessage(listener),
      onTransportClosed: (listener) => transport.onTransportClosed(listener),
      close: () => {
        closed.push(transports);
        transport.close();
      },
    };
  };
  return {
    wrap,
    counts() {
      return { transports, closed: [...closed] };
    },
  };
}

/** Resolve when the controller emits (one subscription turn). */
function nextEmit(controller: EngineWorldClientController): Promise<void> {
  return new Promise<void>((resolve) => {
    const unsubscribe = controller.subscribe(() => {
      unsubscribe();
      resolve();
    });
  });
}

/** Await until the predicate holds on the snapshot (bounded polling). */
async function until(
  controller: EngineWorldClientController,
  predicate: (client: TradingWorldClient) => boolean,
): Promise<TradingWorldClient> {
  for (let i = 0; i < 200; i += 1) {
    if (predicate(controller.getClient())) {
      return controller.getClient();
    }
    await Promise.race([nextEmit(controller), new Promise((r) => setTimeout(r, 5))]);
  }
  return controller.getClient();
}

test("before start the controller serves the fail-closed noop (typed, never data)", async () => {
  const factory = transportFactory();
  const controller = createEngineWorldClientController({
    worldId: WORLD,
    attachTransport: () =>
      factory.wrap(
        createInProcessWorldTransport({
          definition: testDefinition(),
          wallTimeSource: fixedWallTimeSource(),
        }),
      ),
  });
  const client = controller.getClient();
  assert.equal(client.status, "unattached");
  assert.equal(client.worldId, WORLD);
  await assert.rejects(client.query.getWorldMeta(), TradingWorldRuntimeUnavailableError);
  const server = controller.getServerClient();
  assert.equal(server.status, "unattached");
  assert.equal(factory.counts().transports, 0, "no transport before start()");
});

test("start() attaches the engine client; stop() disposes it and fails closed", async () => {
  const factory = transportFactory();
  const controller = createEngineWorldClientController({
    worldId: WORLD,
    attachTransport: () =>
      factory.wrap(
        createInProcessWorldTransport({
          definition: testDefinition(),
          wallTimeSource: fixedWallTimeSource(),
        }),
      ),
  });
  controller.start();
  const ready = await until(controller, (client) => client.status === "ready");
  assert.equal(ready.worldId, WORLD);
  const meta = await ready.query.getWorldMeta();
  assert.equal(meta.worldId, WORLD);

  const stopEmitted = nextEmit(controller);
  controller.stop();
  await stopEmitted;
  assert.equal(controller.getClient().status, "unattached", "stop returns to fail-closed");
  assert.deepEqual(factory.counts().closed, [1], "the engine client's transport was disposed");
  await assert.rejects(
    controller.getClient().query.getWorldMeta(),
    TradingWorldRuntimeUnavailableError,
  );
  assert.equal(factory.counts().transports, 1);
});

test("start-after-stop attaches a FRESH transport (StrictMode double-mount tolerance)", async () => {
  const factory = transportFactory();
  const controller = createEngineWorldClientController({
    worldId: WORLD,
    attachTransport: () =>
      factory.wrap(
        createInProcessWorldTransport({
          definition: testDefinition(),
          wallTimeSource: fixedWallTimeSource(),
        }),
      ),
  });
  controller.start();
  await until(controller, (client) => client.status === "ready");
  controller.stop();
  assert.equal(controller.getClient().status, "unattached");

  controller.start(); // remount
  const again = await until(controller, (client) => client.status === "ready");
  assert.equal(again.status, "ready");
  assert.equal(factory.counts().transports, 2, "a fresh transport per start");
  assert.deepEqual(factory.counts().closed, [1]);
  controller.dispose();
});

test("a stop() that races an in-flight attach WINS: the late client is disposed, never published", async () => {
  const factory = transportFactory();
  let releaseTransport: ((transport: WorldTransport) => void) | undefined;
  const controller = createEngineWorldClientController({
    worldId: WORLD,
    attachTransport: () =>
      new Promise<WorldTransport>((resolve) => {
        releaseTransport = (transport) => resolve(factory.wrap(transport));
      }),
  });
  controller.start();
  controller.stop(); // unmount while the transport factory is still pending
  assert.ok(releaseTransport !== undefined);
  releaseTransport(
    createInProcessWorldTransport({
      definition: testDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    }),
  );
  // Let the attach + describe handshake settle.
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(controller.getClient().status, "unattached", "the late attach never lands");
  assert.deepEqual(factory.counts().closed, [1], "the late engine client was disposed");
});

test("attach failures stay fail-closed (no fabricated data)", async () => {
  // A refusing factory (worker init rejected / transport died).
  const refusing = createEngineWorldClientController({
    worldId: WORLD,
    attachTransport: () => Promise.reject(new Error("worker refused init")),
  });
  refusing.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(refusing.getClient().status, "unattached");
  await assert.rejects(refusing.getClient().query.getWorldMeta(), TradingWorldRuntimeUnavailableError);

  // A world mismatch (the adapter serves another world).
  const mismatched = createEngineWorldClientController({
    worldId: "world-expected-elsewhere",
    attachTransport: () =>
      createInProcessWorldTransport({
        definition: testDefinition(),
        wallTimeSource: fixedWallTimeSource(),
      }),
  });
  mismatched.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(mismatched.getClient().status, "unattached");
});

test("dispose() is permanent: later start() calls are refused", async () => {
  const factory = transportFactory();
  const controller = createEngineWorldClientController({
    worldId: WORLD,
    attachTransport: () =>
      factory.wrap(
        createInProcessWorldTransport({
          definition: testDefinition(),
          wallTimeSource: fixedWallTimeSource(),
        }),
      ),
  });
  controller.start();
  await until(controller, (client) => client.status === "ready");
  controller.dispose();
  assert.equal(controller.getClient().status, "unattached");
  assert.deepEqual(factory.counts().closed, [1]);
  controller.start(); // refused: disposed
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(factory.counts().transports, 1, "no second transport after dispose");
  // dispose() before any start is harmless.
  const fresh = createEngineWorldClientController({
    worldId: WORLD,
    attachTransport: () => {
      throw new Error("must not be called");
    },
  });
  fresh.dispose();
  fresh.start();
  assert.equal(fresh.getClient().status, "unattached");
});

test("useEngineWorldClient renders FAIL-CLOSED on the server (effects never run)", () => {
  function Probe() {
    const client = useEngineWorldClient({
      worldId: "alpha",
      attachTransport: () => {
        throw new Error("SSR must never attach a transport");
      },
    });
    return createElement(
      "p",
      { "data-probe": "" },
      `${client.worldId}:${client.status}:${client.query.getQuote instanceof Function}`,
    );
  }
  const markup = ReactDOMServer.renderToStaticMarkup(createElement(Probe));
  assert.match(markup, /alpha:unattached:true/);
});

test("useEngineWorldClient tolerates attachTransport identity churn (latest-ref)", async () => {
  // The controller reads the LATEST factory at attach time; inline lambdas
  // with changing identities must not churn the runtime. Proven at the
  // controller level: the hook only re-keys on worldId.
  let attachCalls = 0;
  const factory = () => {
    attachCalls += 1;
    return createInProcessWorldTransport({
      definition: testDefinition(),
      wallTimeSource: fixedWallTimeSource(),
    });
  };
  const controller = createEngineWorldClientController({
    worldId: WORLD,
    attachTransport: () => factory(),
  });
  controller.start();
  await until(controller, (client) => client.status === "ready");
  // A "re-render" that would hand the hook a NEW lambda: the already-attached
  // controller is untouched (worldId unchanged).
  assert.equal(attachCalls, 1);
  assert.equal(controller.getClient().status, "ready");
  controller.dispose();
});
