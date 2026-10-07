/**
 * Trading World client seam — W006.
 *
 * The typed data boundary every registered tool surface (W007–W012) consumes
 * for world data: the canonical W003 four-port World Protocol
 * (spec/ARCHITECTURE-LOCK.md A4/A5, spec/WORLD-PROTOCOL.md "Ports") plus the
 * pane's opaque world identity.
 *
 * W006 ships ONLY the type surface and a simulated-noop client:
 * - NO engine imports (W013 is parallel work; depending on unmerged code is
 *   forbidden). The seam compiles against W003 contract types only, through
 *   the type-only shim `./worldContracts.d.ts`.
 * - The noop FAILS CLOSED: every port call rejects with
 *   {@link TradingWorldRuntimeUnavailableError}. It never fabricates empty
 *   books, zero positions or flat quotes — a projection must not invent
 *   financial facts (ARCHITECTURE-LOCK A6: UI is a projection, never
 *   authoritative).
 * - W018 (World Worker adapter + UI transport) mounts a real client behind
 *   this interface (deterministic engine via the worker transport); nothing
 *   in the shell or the tool surfaces changes when that happens.
 */

import { createContext, useContext } from "react";
import type { WorldProtocol } from "./worldContracts.js";

/** Attachment state of the world runtime behind the seam. */
export type TradingWorldClientStatus = "unattached" | "ready";

/**
 * The client tool surfaces consume: the four W003 ports plus identity.
 * `status === "unattached"` means the W018 transport is not wired yet —
 * surfaces render their awaiting/unavailable states, never fake data.
 */
export interface TradingWorldClient extends WorldProtocol {
  /** Opaque world identity from the pane tab (W005). */
  readonly worldId: string;
  /** Runtime attachment state behind this client. */
  readonly status: TradingWorldClientStatus;
}

/** Typed fail-closed rejection for every seam call before W018 lands. */
export class TradingWorldRuntimeUnavailableError extends Error {
  constructor(call: string) {
    super(
      `[trading-world] ${call} rejected: no world runtime attached yet ` +
        "(deterministic engine lands with W013/W018; the shell is a projection, A6)",
    );
    this.name = "TradingWorldRuntimeUnavailableError";
  }
}

function unavailable(call: string): Promise<never> {
  return Promise.reject(new TradingWorldRuntimeUnavailableError(call));
}

/**
 * The simulated-noop client: a complete, correctly-typed World Protocol
 * implementation whose every call fails closed. Shared as the context
 * default so tool surfaces always receive a client instance.
 */
export function createSimulatedNoopWorldClient(worldId: string): TradingWorldClient {
  return {
    worldId,
    status: "unattached",
    query: {
      getWorldMeta: () => unavailable("query.getWorldMeta"),
      getSnapshot: () => unavailable("query.getSnapshot"),
      getInstrument: () => unavailable("query.getInstrument"),
      getQuote: () => unavailable("query.getQuote"),
      getOrderBook: () => unavailable("query.getOrderBook"),
      getTrades: () => unavailable("query.getTrades"),
      getOrders: () => unavailable("query.getOrders"),
      getPositions: () => unavailable("query.getPositions"),
      getPortfolio: () => unavailable("query.getPortfolio"),
      getRisk: () => unavailable("query.getRisk"),
      getNews: () => unavailable("query.getNews"),
      getTimeline: () => unavailable("query.getTimeline"),
    },
    command: {
      submitOrder: () => unavailable("command.submitOrder"),
      cancelOrder: () => unavailable("command.cancelOrder"),
      replaceOrder: () => unavailable("command.replaceOrder"),
      closePosition: () => unavailable("command.closePosition"),
      addAnnotation: () => unavailable("command.addAnnotation"),
      createSnapshot: () => unavailable("command.createSnapshot"),
      branchWorld: () => unavailable("command.branchWorld"),
      setScenario: () => unavailable("command.setScenario"),
    },
    clock: {
      play: () => unavailable("clock.play"),
      pause: () => unavailable("clock.pause"),
      step: () => unavailable("clock.step"),
      seek: () => unavailable("clock.seek"),
      jumpToEvent: () => unavailable("clock.jumpToEvent"),
      setSpeed: () => unavailable("clock.setSpeed"),
      followRealtime: () => unavailable("clock.followRealtime"),
      getClock: () => unavailable("clock.getClock"),
    },
    evidence: {
      getEvent: () => unavailable("evidence.getEvent"),
      getEvents: () => unavailable("evidence.getEvents"),
      getProvenance: () => unavailable("evidence.getProvenance"),
      getSnapshot: () => unavailable("evidence.getSnapshot"),
      getBranchLineage: () => unavailable("evidence.getBranchLineage"),
      getInformationBoundary: () => unavailable("evidence.getInformationBoundary"),
      getDeterminismManifest: () => unavailable("evidence.getDeterminismManifest"),
    },
  };
}

/**
 * Context default: the shared unattached client for the pane's world. The
 * shell (W006) provides this; W018's transport will provide the real one.
 */
export const TRADING_WORLD_CLIENT_CONTEXT_DEFAULT =
  createSimulatedNoopWorldClient("alpha");

/** React context carrying the world client to all mounted tool surfaces. */
export const TradingWorldClientContext = createContext<TradingWorldClient>(
  TRADING_WORLD_CLIENT_CONTEXT_DEFAULT,
);

/**
 * Consume the world client from the cockpit context. Always returns a
 * client; before W018 wires the transport it is the fail-closed noop
 * (`status === "unattached"`).
 */
export function useTradingWorldClient(): TradingWorldClient {
  return useContext(TradingWorldClientContext);
}
