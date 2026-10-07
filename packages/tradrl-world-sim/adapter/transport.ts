/**
 * The transport interface every World adapter exposes to a World Client —
 * the W018 seam `packages/ui/src/trading-world/runtime/` consumes.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (World Client ↔ Worker/Process
 * Adapter). Both adapter topologies implement THIS interface:
 * - the Node in-process adapter (loopback delivery, same thread),
 * - the Web Worker adapter (real postMessage across a thread boundary;
 *   `node:worker_threads` in tests).
 *
 * Laws (work order W018 "determinism guard"):
 * - FIFO: messages posted via `postMessage` reach the host in post order
 *   (postMessage is ordered per worker), and host messages reach listeners in
 *   emission order. The transport NEVER reorders.
 * - Data purity: every message is plain data (structured-clone safe).
 * - Fail-closed: once `onTransportClosed` fires, the transport can no longer
 *   deliver; clients must reject pending and future calls (never fabricate).
 *
 * One transport serves one client. The UI-side mirror of these types lives at
 * `packages/ui/src/trading-world/runtime/worldAdapterContracts.d.ts`
 * (type-only shim re-exporting THIS canonical source — the W006 pattern).
 */

import type { WorldClientMessage, WorldHostMessage } from "./envelope.js";

/**
 * The client-side handle to a World adapter host. Mirrors the postMessage
 * surface of a Dedicated Web Worker, generalized so a Node in-process
 * loopback satisfies it too.
 */
export interface WorldTransport {
  /**
   * Send one client message to the host. Synchronous and ordered (FIFO).
   * Throws (DataCloneError or a typed transport error) if the message is not
   * structured-clone safe or the transport is closed — it never silently
   * drops a message.
   */
  postMessage(message: WorldClientMessage): void;

  /**
   * Register a host-message listener. Returns an unsubscribe function.
   * Listeners are invoked in host emission order (transport FIFO).
   */
  onHostMessage(listener: (message: WorldHostMessage) => void): () => void;

  /**
   * Register a fail-closed close signal: the transport can no longer deliver
   * (worker exited/errored, explicit close). Fired at most once. Returns an
   * unsubscribe function.
   */
  onTransportClosed(listener: (reason?: unknown) => void): () => void;

  /** Tear the transport down (idempotent): stops delivery, closes the channel. */
  close(): void;
}
