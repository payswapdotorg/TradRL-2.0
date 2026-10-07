/**
 * The Web Worker host entry — W018.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" and "Execution targets"
 * (Web Worker). This module adapts a Dedicated Web Worker global scope (or
 * any postMessage-shaped scope) to the {@link WorldAdapterSession}: the
 * world definition arrives in the `init` envelope message, the engine is
 * created INSIDE the worker, and the four ports answer over postMessage.
 *
 * The scope interface is the minimal DOM-worker shape; Node `worker_threads`
 * tests satisfy it through a small adapter (see adapter/test/fixtures). The
 * engine stays headless and deterministic — the worker adds no state of its
 * own beyond the session.
 */

import { createWorldAdapterSession } from "./host.js";
import type { WorldAdapterSession } from "./host.js";

/**
 * The minimal postMessage surface the worker host needs. In a browser
 * Dedicated Web Worker, `self` satisfies this structurally.
 */
export interface WorldWorkerScope {
  postMessage(data: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void;
}

/** Options for {@link installWorldWorkerHost}. */
export interface WorldWorkerHostOptions {
  /** Non-fatal host diagnostics (malformed messages, driver stops). */
  readonly onDiagnostics?: (detail: string) => void;
  /** Overrides session creation (tests). */
  readonly createSession?: (options: {
    readonly emit: (data: unknown) => void;
  }) => WorldAdapterSession;
}

/**
 * Install the world adapter host on a worker scope. Idempotent per scope is
 * NOT enforced — install once per worker.
 */
export function installWorldWorkerHost(
  scope: WorldWorkerScope,
  options: WorldWorkerHostOptions = {},
): void {
  const createSession =
    options.createSession ??
    ((sessionOptions: { readonly emit: (data: unknown) => void }) =>
      createWorldAdapterSession({
        emit: sessionOptions.emit,
        ...(options.onDiagnostics === undefined
          ? {}
          : { onDiagnostics: options.onDiagnostics }),
      }));
  const session = createSession({ emit: (data) => scope.postMessage(data) });
  scope.addEventListener("message", (event) => {
    session.handleClientMessage(event.data);
  });
}

/**
 * True when the running global context looks like a Dedicated Web Worker
 * (has the worker postMessage/addEventListener surface and no `window`).
 * Used by the worker entry (`worker.ts`) so importing it in a main window or
 * a Node process is a harmless no-op.
 */
export function detectWorkerScope(): WorldWorkerScope | undefined {
  const candidate = globalThis as {
    self?: unknown;
    window?: unknown;
  };
  if (candidate.window !== undefined) {
    return undefined; // main window: never self-install
  }
  const scope = candidate.self;
  if (typeof scope !== "object" || scope === null) {
    return undefined;
  }
  const surface = scope as { postMessage?: unknown; addEventListener?: unknown };
  if (typeof surface.postMessage !== "function" || typeof surface.addEventListener !== "function") {
    return undefined;
  }
  return scope as WorldWorkerScope;
}
