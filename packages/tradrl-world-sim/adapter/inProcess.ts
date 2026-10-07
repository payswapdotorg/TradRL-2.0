/**
 * The Node in-process World adapter — same typed surface, no Worker.
 *
 * Spec: spec/SIMULATION.md "Execution targets" (Node headless runner) and
 * spec/ACCEPTANCE-WORLD-ALPHA.md I (headless parity: the same command stream
 * run headlessly and through the UI produces the same deterministic result
 * hash) — this adapter is the headless half of that law; the provider
 * (`packages/ui/src/trading-world/runtime/`) runs IDENTICALLY against it and
 * against the Worker adapter.
 *
 * The loopback is deliberately worker-faithful:
 * - delivery is ASYNC and FIFO (a microtask queue mirrors postMessage;
 *   `delivery: "sync"` exists for diagnostics only),
 * - every message crosses a `structuredClone` boundary by default (the same
 *   wire discipline a real worker enforces; engine objects can never leak by
 *   reference into a client),
 * - the host is the SAME {@link createEngineAdapterRuntime} core the worker
 *   host uses after `init`.
 *
 * Determinism (A9): with the realtime driver off (the default) the run is a
 * pure function of (definition, command stream, explicit clock operations).
 */

import type { WallTimeMs } from "tradrl-world-contracts/time";
import type { WorldDefinition } from "../world/index.js";
import { createWorldTransportClosedError } from "./transportError.js";
import type { WorldAdapterWireOptions } from "./envelope.js";
import type { WorldClientMessage, WorldHostMessage } from "./envelope.js";
import { createEngineAdapterRuntime } from "./host.js";
import type { WorldTaskScheduler } from "./realtimeDriver.js";
import type { WorldTransport } from "./transport.js";

/** Options for {@link createInProcessWorldTransport}. */
export interface InProcessWorldTransportOptions {
  readonly definition: WorldDefinition;
  /** Injected wall-axis source (the engine-test pattern); default: host clock. */
  readonly wallTimeSource?: () => WallTimeMs;
  /** Realtime driver (transport-layer wall→simulation loop). Default: off. */
  readonly realtime?: WorldAdapterWireOptions["realtime"];
  /** Injectable driver scheduler for deterministic tests. */
  readonly scheduler?: WorldTaskScheduler;
  /**
   * Delivery mode. `"microtask"` (default): worker-like async FIFO.
   * `"sync"`: immediate delivery (diagnostics only — changes reentrancy).
   */
  readonly delivery?: "microtask" | "sync";
  /**
   * Serialization discipline. `"structuredClone"` (default): every message is
   * cloned both ways, exactly like a real worker wire. `"none"`: pass by
   * reference (perf-critical, trusted-client diagnostics only).
   */
  readonly serialization?: "structuredClone" | "none";
  readonly onDiagnostics?: (detail: string) => void;
}

/**
 * Create the in-process adapter transport: engine + host core + an async
 * loopback wire. The engine is created (and the definition validated)
 * synchronously at construction — a definition error fails fast here, exactly
 * like `createHeadlessWorldEngine` itself.
 */
export function createInProcessWorldTransport(
  options: InProcessWorldTransportOptions,
): WorldTransport {
  const serialization = options.serialization ?? "structuredClone";
  const delivery = options.delivery ?? "microtask";
  const hostListeners = new Set<(message: WorldHostMessage) => void>();
  const closeListeners = new Set<(reason?: unknown) => void>();
  const outbox: WorldHostMessage[] = [];
  let closed = false;
  let flushScheduled = false;

  function emit(message: WorldHostMessage): void {
    if (closed) {
      return;
    }
    outbox.push(message);
    if (delivery === "sync") {
      flush();
      return;
    }
    if (flushScheduled) {
      return;
    }
    flushScheduled = true;
    queueMicrotask(() => {
      flushScheduled = false;
      flush();
    });
  }

  function flush(): void {
    if (closed) {
      outbox.length = 0;
      return;
    }
    const batch = outbox.splice(0, outbox.length);
    for (const message of batch) {
      if (hostListeners.size === 0) {
        continue; // projection law: pushes may drop; requests keep their response
      }
      const wire =
        serialization === "none"
          ? message
          : (structuredClone(message) as WorldHostMessage);
      for (const listener of Array.from(hostListeners)) {
        listener(wire);
      }
    }
  }

  const runtime = createEngineAdapterRuntime({
    definition: options.definition,
    ...(options.wallTimeSource === undefined
      ? {}
      : { wallTimeSource: options.wallTimeSource }),
    ...(options.realtime === undefined ? {} : { wireOptions: { realtime: options.realtime } }),
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
    emit,
    ...(options.onDiagnostics === undefined ? {} : { onDiagnostics: options.onDiagnostics }),
  });

  return {
    postMessage(message: WorldClientMessage): void {
      if (closed) {
        throw createWorldTransportClosedError();
      }
      const wire =
        serialization === "none" ? message : (structuredClone(message) as WorldClientMessage);
      runtime.core.handleClientMessage(wire);
    },
    onHostMessage(listener) {
      hostListeners.add(listener);
      return () => {
        hostListeners.delete(listener);
      };
    },
    onTransportClosed(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      outbox.length = 0;
      runtime.core.dispose();
      for (const listener of Array.from(closeListeners)) {
        listener(undefined);
      }
    },
  };
}
