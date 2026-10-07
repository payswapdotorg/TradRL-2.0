/**
 * The REAL engine-backed world client — W018's replacement for the W006
 * fail-closed noop provider, mounted through the EXISTING provider seam.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (TradingWorld UI → World
 * Client → Worker/Process Adapter) — this module is the "World Client" box:
 * a typed RPC client over the W018 adapter envelope
 * (packages/tradrl-world-sim/adapter/, re-exported type-only through
 * `./worldAdapterContracts.js`).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — the UI stays a pure projection: every
 * port call is forwarded verbatim over the envelope, every result is the
 * engine's own value (the transport is structured-clone disciplined), errors
 * are the engine's typed errors reconstructed client-side. NOTHING is
 * fabricated; when the transport dies the client FAILS CLOSED (typed
 * rejections, never fake data).
 *
 * Determinism guard (work order W018): the client never reorders — a port
 * method invocation synchronously posts its request (FIFO postMessage), the
 * engine's arrival-order queue is the single serializer, responses correlate
 * by requestId, and `published` pushes carry the engine's sequence numbers.
 *
 * UI/headless parity (ACCEPTANCE I): the SAME provider interface runs against
 * the Worker adapter and the Node in-process adapter — proven by
 * packages/ui/test/tradingWorldTransportParity.test.ts.
 */

import type {
  ClockPort,
  ClockView,
  CommandPort,
  EvidencePort,
  QueryPort,
} from "./worldContracts.js";
import type {
  WorldHostInfo,
  WorldHeadlessReport,
  WorldPortName,
  WorldPublishedProjection,
  WorldRemoteError,
  WorldTransport,
} from "./worldAdapterContracts.js";
import type { TradingWorldClient } from "./worldClient.js";

/**
 * An engine error that crossed the worker boundary, reconstructed client-side
 * (`remote.name` carries the engine's error class name — e.g.
 * "NotImplementedInSkeletonError", "ClockRejectionError"; `remote.data`
 * carries the typed extras like the clock rejection code).
 */
export class TradingWorldRemoteError extends Error {
  constructor(readonly remote: WorldRemoteError) {
    super(`${remote.name}: ${remote.message}`);
    this.name = "TradingWorldRemoteError";
  }

  get remoteName(): string {
    return this.remote.name;
  }

  get remoteData(): Readonly<Record<string, unknown>> | undefined {
    return this.remote.data;
  }
}

/** The transport can no longer deliver — every call fails closed with this. */
export class TradingWorldTransportClosedError extends Error {
  constructor() {
    super(
      "[trading-world] the world transport is closed (worker exit or dispose); " +
        "failing closed — a projection never fabricates (A6)",
    );
    this.name = "TradingWorldTransportClosedError";
  }
}

/** The attached runtime serves a different world than the pane expects. */
export class TradingWorldRuntimeMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `[trading-world] runtime mismatch: pane expects world '${expected}' but the ` +
        `adapter serves '${actual}'`,
    );
    this.name = "TradingWorldRuntimeMismatchError";
  }
}

/** Adapter-level control surface (`host.describe` / `host.headlessReport`). */
export interface EngineWorldHostSurface {
  describe(): Promise<WorldHostInfo>;
  /** The SIMULATION.md headless run report (eventCount + eventHash). */
  headlessReport(): Promise<WorldHeadlessReport>;
}

/**
 * The engine-backed client: the full W006 seam surface (`TradingWorldClient`)
 * plus the adapter control surface, the engine publication stream and
 * lifecycle disposal.
 */
export interface EngineWorldClient extends TradingWorldClient {
  /** Adapter/engine identity (worldId, engine, versions, journal cursor). */
  readonly host: EngineWorldHostSurface;
  /**
   * Subscribe to engine publications (the `onPublished` lifecycle step): the
   * ack plus the ordered, ENGINE-sequenced events of every applied command.
   * Projections may conflate/drop — they never renumber (WORLD-PROTOCOL.md).
   */
  onPublished(listener: (projection: WorldPublishedProjection) => void): () => void;
  /** Subscribe to settled clock views (after acked mutating clock calls). */
  onClock(listener: (clock: ClockView) => void): () => void;
  /** Fail-closed teardown: rejects pending, drops subscriptions, closes the transport. */
  dispose(): void;
}

/** Input for {@link attachEngineWorldClient}. */
export interface AttachEngineWorldClientInput {
  /** A transport over a READY adapter host (in-process or worker). */
  readonly transport: WorldTransport;
  /** The world identity the pane expects; a mismatch fails the attach. */
  readonly expectedWorldId: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/**
 * Attach the engine-backed provider to a transport. Subscribes the
 * `published` + `clock` channels, performs the `host.describe` handshake and
 * resolves with a READY client. Rejects (typed) when the adapter is
 * unreachable, mis-versioned or serving another world — callers stay on the
 * fail-closed noop provider in that case.
 */
export function attachEngineWorldClient(
  input: AttachEngineWorldClientInput,
): Promise<EngineWorldClient> {
  const { transport, expectedWorldId } = input;
  const pending = new Map<number, PendingRequest>();
  const publishedListeners = new Set<(projection: WorldPublishedProjection) => void>();
  const clockListeners = new Set<(clock: ClockView) => void>();
  let nextRequestId = 1;
  let closed = false;

  function failClosed(): void {
    if (closed) {
      return;
    }
    closed = true;
    for (const request of Array.from(pending.values())) {
      request.reject(new TradingWorldTransportClosedError());
    }
    pending.clear();
    publishedListeners.clear();
    clockListeners.clear();
  }

  transport.onTransportClosed(failClosed);
  transport.onHostMessage((message) => {
    if (message.kind === "response") {
      const request = pending.get(message.requestId);
      if (request === undefined) {
        return;
      }
      pending.delete(message.requestId);
      if (message.outcome.status === "ok") {
        request.resolve(message.outcome.value);
      } else {
        request.reject(new TradingWorldRemoteError(message.outcome.error));
      }
      return;
    }
    if (message.kind === "published") {
      for (const listener of Array.from(publishedListeners)) {
        listener(message.projection);
      }
      return;
    }
    for (const listener of Array.from(clockListeners)) {
      listener(message.clock);
    }
  });

  function call<T>(port: WorldPortName, method: string, args: readonly unknown[]): Promise<T> {
    if (closed) {
      return Promise.reject(new TradingWorldTransportClosedError());
    }
    return new Promise<T>((resolve, reject) => {
      const requestId = nextRequestId;
      nextRequestId += 1;
      pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      try {
        // Synchronous + FIFO (post order) — the invocation order IS the wire
        // order; the engine's arrival queue is the only serializer.
        transport.postMessage({ kind: "request", requestId, call: { port, method, args } });
      } catch (error) {
        // The transport refused synchronously (already closed, or a
        // non-cloneable payload): fail THIS call closed with the transport's
        // own error, fail every OTHER pending call closed too, and never
        // leave a pending entry that can never settle.
        pending.delete(requestId);
        failClosed();
        reject(error instanceof Error ? error : new TradingWorldTransportClosedError());
      }
    });
  }

  const client: EngineWorldClient = {
    worldId: expectedWorldId,
    status: "ready",
    host: {
      describe: () => call<WorldHostInfo>("host", "describe", []),
      headlessReport: () => call<WorldHeadlessReport>("host", "headlessReport", []),
    },
    query: {
      getWorldMeta: () => call("query", "getWorldMeta", []),
      getSnapshot: (snapshotId) =>
        call("query", "getSnapshot", snapshotId === undefined ? [] : [snapshotId]),
      getInstrument: (instrumentId) => call("query", "getInstrument", [instrumentId]),
      getQuote: (instrumentId) => call("query", "getQuote", [instrumentId]),
      getOrderBook: (instrumentId, depth) =>
        call("query", "getOrderBook", depth === undefined ? [instrumentId] : [instrumentId, depth]),
      getTrades: (instrumentId, query) =>
        call("query", "getTrades", query === undefined ? [instrumentId] : [instrumentId, query]),
      getOrders: (query) => call("query", "getOrders", query === undefined ? [] : [query]),
      getPositions: (accountId) =>
        call("query", "getPositions", accountId === undefined ? [] : [accountId]),
      getPortfolio: (accountId) =>
        call("query", "getPortfolio", accountId === undefined ? [] : [accountId]),
      getRisk: (accountId) =>
        call("query", "getRisk", accountId === undefined ? [] : [accountId]),
      getNews: (query) => call("query", "getNews", query === undefined ? [] : [query]),
      getTimeline: (query) => call("query", "getTimeline", query === undefined ? [] : [query]),
    } satisfies QueryPort,
    command: {
      submitOrder: (command) => call("command", "submitOrder", [command]),
      cancelOrder: (command) => call("command", "cancelOrder", [command]),
      replaceOrder: (command) => call("command", "replaceOrder", [command]),
      closePosition: (command) => call("command", "closePosition", [command]),
      addAnnotation: (command) => call("command", "addAnnotation", [command]),
      createSnapshot: (command) => call("command", "createSnapshot", [command]),
      branchWorld: (command) => call("command", "branchWorld", [command]),
      setScenario: (command) => call("command", "setScenario", [command]),
    } satisfies CommandPort,
    clock: {
      play: () => call("clock", "play", []),
      pause: () => call("clock", "pause", []),
      step: (deltaMs) => call("clock", "step", deltaMs === undefined ? [] : [deltaMs]),
      seek: (to) => call("clock", "seek", [to]),
      jumpToEvent: (target) => call("clock", "jumpToEvent", [target]),
      setSpeed: (speed) => call("clock", "setSpeed", [speed]),
      followRealtime: (enabled) => call("clock", "followRealtime", [enabled]),
      getClock: () => call("clock", "getClock", []),
    } satisfies ClockPort,
    evidence: {
      getEvent: (eventId) => call("evidence", "getEvent", [eventId]),
      getEvents: (query) => call("evidence", "getEvents", [query ?? {}]),
      getProvenance: (eventId) => call("evidence", "getProvenance", [eventId]),
      getSnapshot: (snapshotId) => call("evidence", "getSnapshot", [snapshotId]),
      getBranchLineage: (worldId) =>
        call("evidence", "getBranchLineage", worldId === undefined ? [] : [worldId]),
      getInformationBoundary: (asOf) => call("evidence", "getInformationBoundary", [asOf]),
      getDeterminismManifest: () => call("evidence", "getDeterminismManifest", []),
    } satisfies EvidencePort,
    onPublished(listener) {
      publishedListeners.add(listener);
      return () => {
        publishedListeners.delete(listener);
      };
    },
    onClock(listener) {
      clockListeners.add(listener);
      return () => {
        clockListeners.delete(listener);
      };
    },
    dispose() {
      if (closed) {
        return;
      }
      try {
        transport.postMessage({ kind: "dispose" });
      } catch {
        // The transport already died: failClosed already ran.
      }
      transport.close();
      failClosed();
    },
  };

  return (async () => {
    try {
      transport.postMessage({ kind: "subscribe", channel: "published" });
      transport.postMessage({ kind: "subscribe", channel: "clock" });
      const info = await call<WorldHostInfo>("host", "describe", []);
      if (info.worldId !== expectedWorldId) {
        client.dispose();
        throw new TradingWorldRuntimeMismatchError(expectedWorldId, info.worldId);
      }
      if (info.envelopeVersion === undefined) {
        // unreachable with the W018 host; kept as a defensive fail-closed
        client.dispose();
        throw new TradingWorldRemoteError({
          name: "WorldAdapterError",
          message: "the adapter did not report an envelope version",
        });
      }
      return client;
    } catch (error) {
      // A refused/dead/mismatched attach NEVER leaks the transport: close it
      // (idempotent on every topology) and fail every pending call closed.
      transport.close();
      failClosed();
      throw error;
    }
  })();
}
