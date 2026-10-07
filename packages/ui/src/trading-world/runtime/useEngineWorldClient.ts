/**
 * The React provider hook for the engine-backed world client — W018.
 *
 * This is the TL's ONE-LINE wiring point (the W005-launcher pattern): the
 * provider SELECTION lives in `components/TradingWorldShell.tsx` (W006's
 * frozen surface — it still mounts `createSimulatedNoopWorldClient`), and the
 * swap is exactly:
 *
 * ```tsx
 * // components/TradingWorldShell.tsx (TL-owned one-liner)
 * const worldClient = useEngineWorldClient({
 *   worldId: tab.worldId,
 *   attachTransport: () =>
 *     createWorkerWorldTransport(
 *       asDomWorkerChannel(
 *         new Worker(
 *           new URL(
 *             "../../../../tradrl-world-sim/adapter/worker.ts",
 *             import.meta.url,
 *           ),
 *           { type: "module" },
 *         ),
 *       ),
 *       { definition }, // the world catalog (W016/W019) supplies definitions
 *     ),
 * });
 * ```
 *
 * Laws (work order W018 + ARCHITECTURE-LOCK A6):
 * - FAIL CLOSED: until the transport attaches (and again after teardown) the
 *   client is the W006 fail-closed noop — every port call rejects with the
 *   typed unavailable error; the UI NEVER renders fabricated world data.
 * - LIFECYCLE: attach on mount, dispose on unmount; a `worldId` change tears
 *   the old runtime down and attaches a fresh one. StrictMode double-mounting
 *   is tolerated (stop() cancels the in-flight attach; the next start()
 *   attaches a fresh transport).
 * - ATTACH FAILURES STAY FAIL-CLOSED: a transport that refuses init, dies, or
 *   serves another world leaves the noop in place (typed rejections, never
 *   fake data) — surfaces render their awaiting/unavailable states.
 *
 * The hook is a thin {@link useSyncExternalStore} wrapper (SSR-safe: the
 * server snapshot is the fail-closed noop) over a framework-free controller so
 * every lifecycle law is testable in plain Node
 * (packages/ui/test/tradingWorldUseEngineWorldClient.test.ts).
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

import { attachEngineWorldClient } from "./engineWorldClient.js";
import type { EngineWorldClient } from "./engineWorldClient.js";
import type { WorldTransport } from "./worldAdapterContracts.js";
import { createSimulatedNoopWorldClient } from "./worldClient.js";
import type { TradingWorldClient } from "./worldClient.js";

/** Input for {@link useEngineWorldClient}. */
export interface UseEngineWorldClientInput {
  /**
   * The world identity the pane expects. The attach FAILS CLOSED if the
   * runtime serves a different world (TradingWorldRuntimeMismatchError).
   */
  readonly worldId: string;
  /**
   * Creates the transport to attach (called once per start; may return a
   * promise — the worker topology resolves its `init` handshake here). The
   * identity of this function is irrelevant: the hook reads the latest one
   * at attach time, so inline lambdas are fine.
   */
  readonly attachTransport: () => WorldTransport | Promise<WorldTransport>;
}

/**
 * The framework-free lifecycle controller behind the hook. One controller
 * serves one `worldId` for one mounted pane.
 */
export interface EngineWorldClientController {
  /** External-store subscribe (notified when the client snapshot changes). */
  subscribe(listener: () => void): () => void;
  /** The current client snapshot (stable identity between changes). */
  getClient(): TradingWorldClient;
  /** SSR snapshot: ALWAYS the fail-closed noop (effects never run server-side). */
  getServerClient(): TradingWorldClient;
  /** Begin attaching. No-op when already started or disposed. */
  start(): void;
  /** Stop the current attachment (dispose the engine client). Idempotent. */
  stop(): void;
  /** Permanent teardown; later `start()` calls are refused. */
  dispose(): void;
}

/** Create the controller. Pure until {@link EngineWorldClientController.start}. */
export function createEngineWorldClientController(input: {
  readonly worldId: string;
  readonly attachTransport: () => WorldTransport | Promise<WorldTransport>;
}): EngineWorldClientController {
  const failClosedClient = createSimulatedNoopWorldClient(input.worldId);
  const serverClient = createSimulatedNoopWorldClient(input.worldId);
  const listeners = new Set<() => void>();
  let client: TradingWorldClient = failClosedClient;
  let started = false;
  let disposed = false;
  /** Bumped by every stop(): attaches from an older generation are void. */
  let generation = 0;

  function emit(): void {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  function isEngine(value: TradingWorldClient): value is EngineWorldClient {
    return value.status === "ready";
  }

  async function attach(startedGeneration: number): Promise<void> {
    let engineClient: EngineWorldClient;
    try {
      const transport = await input.attachTransport();
      engineClient = await attachEngineWorldClient({
        transport,
        expectedWorldId: input.worldId,
      });
    } catch {
      // Transport refused, died, mismatched or mis-versioned: stay fail
      // closed — the noop client keeps rejecting every call with the typed
      // unavailable error (never fabricated data, A6).
      return;
    }
    if (disposed || startedGeneration !== generation) {
      // A stop()/dispose() (or a newer start) won the race: nobody reads this
      // client anymore — dispose it immediately.
      engineClient.dispose();
      return;
    }
    client = engineClient;
    emit();
  }

  function stop(): void {
    if (!started) {
      return;
    }
    started = false;
    generation += 1;
    if (isEngine(client)) {
      const current = client;
      client = failClosedClient;
      current.dispose();
      emit();
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getClient: () => client,
    getServerClient: () => serverClient,
    start() {
      if (disposed || started) {
        return;
      }
      started = true;
      void attach(generation);
    },
    stop,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stop();
    },
  };
}

/**
 * The engine-backed world client for one mounted pane. Renders the fail-closed
 * noop until the transport attaches (and again after teardown) — identical to
 * the W006 shell contract, so tool surfaces need no changes.
 */
export function useEngineWorldClient(input: UseEngineWorldClientInput): TradingWorldClient {
  const worldId = input.worldId;
  // Latest-ref: the attach factory may be an inline lambda; the controller
  // must not re-attach on identity churn, only on worldId change.
  const attachRef = useRef(input.attachTransport);
  useEffect(() => {
    attachRef.current = input.attachTransport;
  });

  // One controller per worldId. Construction is side-effect-free; the
  // runtime attaches in the effect below (StrictMode-safe: stop() cancels an
  // in-flight attach, and a later start() attaches a FRESH transport).
  const controller = useMemo(
    () =>
      createEngineWorldClientController({
        worldId,
        attachTransport: () => attachRef.current(),
      }),
    [worldId],
  );
  useEffect(() => {
    controller.start();
    // stop() disposes the engine client (which closes the transport) — the
    // full teardown for unmount, a worldId change (the old controller is
    // dropped) and StrictMode's simulated unmount/remount alike.
    return () => controller.stop();
  }, [controller]);

  return useSyncExternalStore(
    controller.subscribe,
    controller.getClient,
    controller.getServerClient,
  );
}
