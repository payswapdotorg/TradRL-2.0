/**
 * Trading World client seam tests (W006).
 *
 * Guards the typed data boundary W007–W012 surfaces consume: the seam is the
 * W003 four-port World Protocol plus world identity; the shipped provider is
 * a simulated noop that FAILS CLOSED (every call rejects with a typed error —
 * never fabricated market/account state); and the seam's method surface
 * matches the canonical contracts EXACTLY (drift guard importing the real
 * W003 sources directly — the W005-established test-side pattern).
 *
 * Run: ../../node_modules/.bin/tsx --test test/tradingWorldWorldClient.test.ts
 * (from packages/ui).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  createSimulatedNoopWorldClient,
  TradingWorldClientContext,
  TradingWorldRuntimeUnavailableError,
  useTradingWorldClient,
  type TradingWorldClient,
} from "../src/trading-world/runtime/worldClient.js";
import type { WorldProtocol } from "../../tradrl-world-contracts/src/ports.js";

/** Canonical W003 port method names (must match the real contracts). */
const PORT_METHOD_NAMES: Readonly<Record<keyof WorldProtocol, readonly string[]>> = {
  query: [
    "getWorldMeta",
    "getSnapshot",
    "getInstrument",
    "getQuote",
    "getOrderBook",
    "getTrades",
    "getOrders",
    "getPositions",
    "getPortfolio",
    "getRisk",
    "getNews",
    "getTimeline",
  ],
  command: [
    "submitOrder",
    "cancelOrder",
    "replaceOrder",
    "closePosition",
    "addAnnotation",
    "createSnapshot",
    "branchWorld",
    "setScenario",
  ],
  clock: [
    "play",
    "pause",
    "step",
    "seek",
    "jumpToEvent",
    "setSpeed",
    "followRealtime",
    "getClock",
  ],
  evidence: [
    "getEvent",
    "getEvents",
    "getProvenance",
    "getSnapshot",
    "getBranchLineage",
    "getInformationBoundary",
    "getDeterminismManifest",
  ],
};

/**
 * Compile-time drift guard (type-level, never executed): the UI seam client
 * is a complete WorldProtocol implementation. Checked whenever this file is
 * type-checked; the runtime method-name parity below enforces the same law.
 */
type ExpectTrue<T extends true> = T;
type _NoopClientSatisfiesWorldProtocol = ExpectTrue<
  ReturnType<typeof createSimulatedNoopWorldClient> extends WorldProtocol ? true : false
>;

test("the noop client exposes the complete W003 four-port method surface", () => {
  const client = createSimulatedNoopWorldClient("world-alpha");
  const ports = Object.keys(PORT_METHOD_NAMES) as (keyof WorldProtocol)[];
  assert.deepEqual(ports.sort(), ["clock", "command", "evidence", "query"]);
  for (const port of ports) {
    const portObject = client[port] as unknown as Record<string, unknown>;
    for (const method of PORT_METHOD_NAMES[port]) {
      assert.equal(
        typeof portObject[method],
        "function",
        `${port}.${method} must exist (W003 contracts drift?)`,
      );
    }
    assert.deepEqual(
      Object.keys(portObject).sort(),
      [...PORT_METHOD_NAMES[port]].sort(),
      `${port} exposes exactly the W003 methods`,
    );
  }
  assert.equal(client.worldId, "world-alpha");
  assert.equal(client.status, "unattached");
});

test("every seam call fails closed with the typed unavailable error (no fabricated data)", async () => {
  const client = createSimulatedNoopWorldClient("world-alpha");
  const samples: Promise<unknown>[] = [
    client.query.getQuote("instrument" as never),
    client.query.getOrderBook("instrument" as never),
    client.query.getOrders(),
    client.query.getPositions(),
    client.query.getPortfolio(),
    client.query.getRisk(),
    client.query.getNews(),
    client.command.submitOrder({} as never),
    client.command.cancelOrder({} as never),
    client.clock.play(),
    client.clock.getClock(),
    client.evidence.getEvents({} as never),
    client.evidence.getDeterminismManifest(),
  ];
  for (const call of samples) {
    await assert.rejects(call, (error: unknown) => {
      assert.ok(error instanceof TradingWorldRuntimeUnavailableError);
      assert.match(error.message, /no world runtime attached/);
      return true;
    });
  }
  // Nothing ever resolves: a projection must not invent financial facts (A6).
  await assert.rejects(client.query.getWorldMeta(), TradingWorldRuntimeUnavailableError);
});

test("the client context defaults to the fail-closed noop (surfaces always get a client)", () => {
  function Probe() {
    const client = useTradingWorldClient();
    return createElement(
      "p",
      { "data-probe": "" },
      `${client.worldId}:${client.status}:${typeof client.query.getQuote}`,
    );
  }
  // Without a provider the hook still yields the unattached default client.
  const withoutProvider = ReactDOMServer.renderToStaticMarkup(createElement(Probe));
  assert.match(withoutProvider, /alpha:unattached:function/);

  const custom = createSimulatedNoopWorldClient("world-beta");
  const withProvider = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldClientContext.Provider, { value: custom }, createElement(Probe)),
  );
  assert.match(withProvider, /world-beta:unattached:function/);
});

test("the seam type compiles against the real W003 contracts (structural guard)", () => {
  // Runtime shadow of the compile-time guard: the noop client IS a full
  // WorldProtocol — every canonical method present, nothing extra.
  const client: TradingWorldClient = createSimulatedNoopWorldClient("drift-guard");
  assert.equal(client.status, "unattached");
  const clientRecord = client as unknown as Record<string, Record<string, unknown>>;
  for (const [port, methods] of Object.entries(PORT_METHOD_NAMES)) {
    for (const method of methods) {
      assert.equal(typeof clientRecord[port]![method], "function", `${port}.${method}`);
    }
  }
});
