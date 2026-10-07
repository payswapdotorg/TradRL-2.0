/**
 * Typed transport-level errors shared by the adapter surfaces (W018).
 *
 * Kept in its own module so every adapter file (and the UI-side mirror) can
 * reference them without pulling in host internals.
 */

/** Thrown when a message is posted to an already-closed transport. */
export class WorldTransportClosedError extends Error {
  constructor() {
    super(
      "[world-adapter] transport closed: the world runtime is no longer " +
        "reachable (fail closed — no fabricated results, A6)",
    );
    this.name = "WorldTransportClosedError";
  }
}

/** Build the closed-transport error (allocated at throw time for clean stacks). */
export function createWorldTransportClosedError(): WorldTransportClosedError {
  return new WorldTransportClosedError();
}

/**
 * Thrown by {@link "./workerTransport.js"}.`createWorkerWorldTransport` when
 * the worker host rejects or never answers the `init` handshake.
 */
export class WorldAdapterInitError extends Error {
  constructor(
    readonly remote: { readonly name: string; readonly message: string },
  ) {
    super(`world adapter init failed: ${remote.name}: ${remote.message}`);
    this.name = "WorldAdapterInitError";
  }
}
