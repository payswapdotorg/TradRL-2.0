/**
 * The host-side Worker connection — W018.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (TradingWorld UI → World
 * Client → Worker/Process Adapter). This module connects a REAL worker
 * (browser Dedicated Web Worker or Node `worker_threads` in tests) to the
 * client-side {@link WorldTransport} interface:
 *
 * 1. `asDomWorkerChannel(worker)` / `asNodeWorkerChannel(worker)` normalize
 *    the platform worker to one {@link WorldWorkerChannel},
 * 2. {@link createWorkerWorldTransport} performs the `init` handshake
 *    (definition over the wire), and
 * 3. returns a ready {@link WorldTransport} — byte-for-byte the same
 *    interface the Node in-process adapter returns (headless parity).
 *
 * The transport is a thin FIFO pipe: it forwards client messages in post
 * order and fans host messages out to listeners in arrival order. It never
 * inspects, derives or reorders world data (the determinism guard).
 */

import { isWorldHostMessage } from "./envelope.js";
import type { WorldAdapterWireOptions, WorldClientMessage, WorldHostMessage } from "./envelope.js";
import { WorldAdapterInitError } from "./transportError.js";
import type { WorldTransport } from "./transport.js";
import type { WorldDefinition } from "../world/index.js";

/** The requestId the init handshake uses (client-owned ids start at 1). */
const INIT_REQUEST_ID = 0;

/** Normalized, platform-agnostic worker channel. */
export interface WorldWorkerChannel {
  postMessage(message: unknown): void;
  /** Register a message listener; returns its unsubscribe function. */
  addMessageListener(listener: (message: unknown) => void): () => void;
  /** Fail-closed close signal: the worker died (error or exit). */
  addCloseListener(listener: (reason?: unknown) => void): () => void;
  terminate(): void;
}

/** Structural shape `asDomWorkerChannel` accepts (any DOM-style worker). */
export interface DomWorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
  terminate(): void;
}

/** Adapt a browser Dedicated Web Worker (or `new Worker(...)` handle). */
export function asDomWorkerChannel(worker: DomWorkerLike): WorldWorkerChannel {
  const messageHandler = (listener: (message: unknown) => void) =>
    ((event: { readonly data: unknown }) => listener(event.data)) as unknown as (
      event: never,
    ) => void;
  const closeHandler = (listener: (reason?: unknown) => void) =>
    listener as unknown as (event: never) => void;
  return {
    postMessage: (message) => worker.postMessage(message),
    addMessageListener(listener) {
      const handler = messageHandler(listener);
      worker.addEventListener("message", handler);
      return () => worker.removeEventListener("message", handler);
    },
    addCloseListener(listener) {
      const errorHandler = closeHandler(listener);
      const messageErrorHandler = closeHandler(listener);
      worker.addEventListener("error", errorHandler);
      worker.addEventListener("messageerror", messageErrorHandler);
      return () => {
        worker.removeEventListener("error", errorHandler);
        worker.removeEventListener("messageerror", messageErrorHandler);
      };
    },
    terminate: () => worker.terminate(),
  };
}

/** Structural shape `asNodeWorkerChannel` accepts (`node:worker_threads`). */
export interface NodeWorkerLike {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
  once(event: "error", listener: (error: unknown) => void): unknown;
  off(event: "error", listener: (error: unknown) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
  off(event: "exit", listener: (code: number) => void): unknown;
  terminate(): Promise<number> | number;
}

/** Adapt a Node `worker_threads` Worker (the test-side worker topology). */
export function asNodeWorkerChannel(worker: NodeWorkerLike): WorldWorkerChannel {
  return {
    postMessage: (message) => worker.postMessage(message),
    addMessageListener(listener) {
      worker.on("message", listener);
      return () => worker.off("message", listener);
    },
    addCloseListener(listener) {
      const onError = (error: unknown) => listener(error);
      const onExit = (code: number) =>
        listener(new Error(`world adapter worker exited with code ${code}`));
      worker.once("error", onError);
      worker.once("exit", onExit);
      return () => {
        worker.off("error", onError);
        worker.off("exit", onExit);
      };
    },
    terminate: () => {
      void worker.terminate();
    },
  };
}

/** Options for {@link createWorkerWorldTransport}. */
export interface WorkerWorldTransportOptions {
  /** The world definition the worker-side engine is created from. */
  readonly definition: WorldDefinition;
  /** Wire options forwarded to the worker host (realtime, fixed wall time). */
  readonly wireOptions?: WorldAdapterWireOptions;
}

/**
 * Connect to a world adapter worker: send `init`, await the host's describe
 * response, and resolve with the ready transport. Rejects (typed) if the
 * worker refuses init (bad definition) or dies during the handshake.
 */
export function createWorkerWorldTransport(
  channel: WorldWorkerChannel,
  options: WorkerWorldTransportOptions,
): Promise<WorldTransport> {
  return new Promise<WorldTransport>((resolve, reject) => {
    const hostListeners = new Set<(message: WorldHostMessage) => void>();
    const closeListeners = new Set<(reason?: unknown) => void>();
    let ready = false;
    let closed = false;

    const removeHandshakeListener = channel.addMessageListener((data) => {
      if (ready) {
        for (const listener of Array.from(hostListeners)) {
          listener(data as WorldHostMessage);
        }
        return;
      }
      if (!isWorldHostMessage(data) || data.kind !== "response") {
        return;
      }
      if (data.requestId !== INIT_REQUEST_ID) {
        return; // not the handshake answer — impossible before ready, ignore
      }
      if (data.outcome.status === "ok") {
        ready = true;
        resolve(makeTransport());
      } else {
        removeHandshakeListener();
        removeCloseListener();
        reject(new WorldAdapterInitError(data.outcome.error));
      }
    });

    const removeCloseListener = channel.addCloseListener((reason) => {
      if (closed) {
        return;
      }
      closed = true;
      const error =
        reason instanceof Error
          ? reason
          : new Error(`world adapter worker closed: ${String(reason)}`);
      for (const listener of Array.from(closeListeners)) {
        listener(error);
      }
      if (!ready) {
        removeHandshakeListener();
        reject(new WorldAdapterInitError({ name: error.name, message: error.message }));
      }
    });

    function makeTransport(): WorldTransport {
      return {
        postMessage(message: WorldClientMessage): void {
          if (closed) {
            for (const listener of Array.from(closeListeners)) {
              listener(new Error("world adapter worker transport is closed"));
            }
            return;
          }
          channel.postMessage(message);
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
          channel.terminate();
          for (const listener of Array.from(closeListeners)) {
            listener(undefined);
          }
        },
      };
    }

    channel.postMessage({
      kind: "init",
      requestId: INIT_REQUEST_ID,
      definition: options.definition,
      ...(options.wireOptions === undefined ? {} : { options: options.wireOptions }),
    } satisfies WorldClientMessage);
  });
}
