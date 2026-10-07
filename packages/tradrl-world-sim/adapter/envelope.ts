/**
 * The typed RPC envelope for the W018 World Worker/process adapter.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" —
 * ```
 * TradingWorld UI → World Client → Worker/Process Adapter → World Engine
 * ```
 * This module owns the WIRE between "World Client" and "Worker/Process
 * Adapter": one discriminated envelope for client→host messages (requests,
 * channel subscriptions, init, dispose) and host→client messages (correlated
 * responses, engine-published projections, clock views).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Ports" — world data crosses as
 * `{ port, method, args }` calls against the four canonical ports
 * (QueryPort/CommandPort/ClockPort/EvidencePort); the `host` pseudo-port
 * carries ONLY adapter-level control (`describe`, `headlessReport`) and never
 * world data — the four ports stay the single world-protocol surface (A4/A5).
 *
 * Determinism guard (work order W018): the transport NEVER fabricates or
 * reorders. Requests carry no derived values (the engine is the only state
 * authority); responses and pushes carry engine-produced data verbatim —
 * projections carry the engine's own sequence numbers; commands serialize
 * through the envelope in the order their port methods were invoked (FIFO
 * postMessage), matching the engine's arrival-order queue.
 *
 * Everything in this envelope is structured-clone safe (plain data): it must
 * survive a real Web Worker / worker_threads postMessage boundary.
 */

import type {
  CommandAck,
  ClockView,
  WorldEventEnvelope,
} from "tradrl-world-contracts";
import type { HeadlessRunReport } from "../world/index.js";

/**
 * Envelope wire version. Bumped on any breaking envelope change; carried in
 * `WorldHostInfo` so a client can refuse a mismatched adapter loudly.
 */
export const ADAPTER_ENVELOPE_VERSION = "w018-adapter@1";

/** The four canonical World Protocol ports plus the adapter `host` control surface. */
export type WorldPortName = "query" | "command" | "clock" | "evidence" | "host";

/**
 * The adapter-level host methods exposed through the `host` pseudo-port.
 * `describe` — adapter/engine identity; `headlessReport` — the SIMULATION.md
 * headless run report (the parity artifact: eventCount + eventHash).
 */
export type WorldHostMethodName = "describe" | "headlessReport";

/** Client-side request correlation id (host echoes it in the response). */
export type WorldRequestId = number;

/** Host→client push channels. */
export type WorldChannel = "published" | "clock";

/** One port method call, serialized as plain data. */
export interface WorldPortCall {
  readonly port: WorldPortName;
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Adapter/engine identity returned by `host.describe`. */
export interface WorldHostInfo {
  readonly worldId: string;
  readonly engine: string;
  readonly engineVersion: string;
  /** Journal cursor at describe time (engine-sourced, informational). */
  readonly journalCursor: number;
  readonly envelopeVersion: string;
}

/**
 * Realtime clock driver options — the TRANSPORT-layer wall→simulation loop
 * (spec/SIMULATION.md "Phase 1"; the engine's `followRealtime` is only a mode
 * flag and the headless engine has no wall-clock timers). Disabled by
 * default: headless determinism (A9) requires the run to be a pure function
 * of (definition, command stream, explicit clock operations).
 */
export interface WorldRealtimeOptions {
  readonly enabled: boolean;
  /** Driver cadence in ms; default {@link DEFAULT_REALTIME_TICK_MS}. */
  readonly tickMs?: number;
}

/** Default driver cadence. */
export const DEFAULT_REALTIME_TICK_MS = 250;

/**
 * Adapter options that cross the wire in `init`. All optional; the defaults
 * keep the host fully deterministic (real host clock for the wall axis only,
 * driver off).
 */
export interface WorldAdapterWireOptions {
  /**
   * Fix the wall-axis reading (clock readouts only — wall time never enters
   * events, digests or the manifest, A9). For deterministic tests.
   */
  readonly fixedWallTime?: number;
  readonly realtime?: WorldRealtimeOptions;
}

/** client → host messages. */
export type WorldClientMessage =
  | {
      readonly kind: "init";
      readonly requestId: WorldRequestId;
      /** The WorldDefinition the host engine is created from (plain data). */
      readonly definition: unknown;
      readonly options?: WorldAdapterWireOptions;
    }
  | {
      readonly kind: "request";
      readonly requestId: WorldRequestId;
      readonly call: WorldPortCall;
    }
  | { readonly kind: "subscribe"; readonly channel: WorldChannel }
  | { readonly kind: "unsubscribe"; readonly channel: WorldChannel }
  | { readonly kind: "dispose" };

/** host → client messages. */
export type WorldHostMessage =
  | {
      readonly kind: "response";
      readonly requestId: WorldRequestId;
      readonly outcome: WorldCallOutcome;
    }
  | { readonly kind: "published"; readonly projection: WorldPublishedProjection }
  | { readonly kind: "clock"; readonly clock: ClockView };

/** A serialized call outcome: a structured-clone-safe value or a typed error. */
export type WorldCallOutcome =
  | { readonly status: "ok"; readonly value: unknown }
  | { readonly status: "error"; readonly error: WorldRemoteError };

/**
 * An engine error, serialized as data so its identity survives the worker
 * boundary (structured clone drops error subclasses). `name` carries the
 * engine's error class name (e.g. "NotImplementedInSkeletonError",
 * "ClockRejectionError"); `data` carries the typed extras.
 */
export interface WorldRemoteError {
  readonly name: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

/**
 * One engine publication (the `onPublished` lifecycle step): the ack plus the
 * ordered, engine-sequenced events the command produced. Events carry the
 * journal's own `sequence` numbers — projections never renumber.
 */
export interface WorldPublishedProjection {
  readonly ack: CommandAck;
  readonly events: readonly WorldEventEnvelope[];
}

/** Convenience alias: the headless report as returned by `host.headlessReport`. */
export type WorldHeadlessReport = HeadlessRunReport;

/** Typed adapter-level failure codes (`WorldAdapterError.data.code`). */
export type WorldAdapterErrorCode =
  | "not-initialized" // request arrived before `init` (worker hosts only)
  | "already-initialized" // duplicate `init`
  | "disposed" // host was disposed
  | "unknown-port" // call targets a port the adapter does not expose
  | "unknown-method" // port has no such method
  | "malformed-message"; // message failed envelope validation

/** Build a {@link WorldRemoteError} for an adapter-level failure. */
export function worldAdapterError(
  code: WorldAdapterErrorCode,
  message: string,
): WorldRemoteError {
  return { name: "WorldAdapterError", message, data: { code } };
}

/**
 * Serialize a thrown error into {@link WorldRemoteError}. Known engine error
 * classes keep their typed extras in `data`; everything else keeps
 * name+message. Never throws.
 */
export function serializeTransportError(error: unknown): WorldRemoteError {
  if (error instanceof Error) {
    // Known engine error classes carry typed extras; keep whatever is plain
    // data on the instance (rejection/surface/operation/kind/id/errors).
    const props = error as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    if (typeof props.rejection === "object" && props.rejection !== null) {
      data.rejection = props.rejection;
    }
    for (const key of ["surface", "operation", "kind", "id"] as const) {
      if (typeof props[key] === "string") {
        data[key] = props[key];
      }
    }
    if (Array.isArray(props.errors)) {
      data.errors = props.errors;
    }
    return {
      name: error.name,
      message: error.message,
      ...(Object.keys(data).length === 0 ? {} : { data }),
    };
  }
  return {
    name: "NonErrorThrow",
    message: typeof error === "string" ? error : String(error),
  };
}

/** Structural guard: does a value look like a {@link WorldClientMessage}? */
export function isWorldClientMessage(value: unknown): value is WorldClientMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const message = value as { kind?: unknown; requestId?: unknown; channel?: unknown };
  switch (message.kind) {
    case "init":
    case "request":
      return (
        typeof message.requestId === "number" &&
        Number.isFinite(message.requestId)
      );
    case "subscribe":
    case "unsubscribe":
      return message.channel === "published" || message.channel === "clock";
    case "dispose":
      return true;
    default:
      return false;
  }
}

/** Structural guard: does a value look like a {@link WorldHostMessage}? */
export function isWorldHostMessage(value: unknown): value is WorldHostMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const message = value as { kind?: unknown; requestId?: unknown };
  switch (message.kind) {
    case "response":
      return (
        typeof message.requestId === "number" &&
        Number.isFinite(message.requestId)
      );
    case "published":
    case "clock":
      return true;
    default:
      return false;
  }
}

/** Map the engine's `onPublished` payload to the wire projection shape. */
export function toWorldPublishedProjection(published: {
  readonly ack: { readonly status: "acked"; readonly ack: CommandAck };
  readonly events: readonly WorldEventEnvelope[];
}): WorldPublishedProjection {
  return { ack: published.ack.ack, events: published.events };
}
