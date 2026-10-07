/**
 * The World adapter host — the W018 dispatch core between the RPC envelope
 * and the headless engine's four ports.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (Worker/Process Adapter →
 * World Engine) and "Execution targets" (Web Worker, Electron/local adapter,
 * Node headless runner — this module is the shared host for all three).
 * Spec: spec/WORLD-PROTOCOL.md "Ports" — every world-data call terminates at
 * one of the four canonical ports; the adapter NEVER touches engine state
 * directly and never fabricates a result (A6: the UI is a projection).
 *
 * Determinism guard (work order W018):
 * - ORDER: requests are dispatched in arrival order; the ENGINE's single
 *   arrival-order queue (commands + clock ops) is the only serializer — the
 *   adapter adds none of its own and reorders nothing.
 * - PURITY: responses carry the engine's return values verbatim; `published`
 *   pushes carry the engine's own sequence numbers; the host rejects (never
 *   answers) unknown ports/methods with a typed error.
 *
 * Two layers:
 * - {@link createEngineAdapterRuntime} + the core: over a LIVE engine (the
 *   in-process adapter and the post-init worker host both use this).
 * - {@link createWorldAdapterSession}: the `init` state machine a worker
 *   host exposes (definition arrives over the wire; requests before init fail
 *   closed with a typed `not-initialized` error).
 */

import type { ClockView } from "tradrl-world-contracts";
import type { WallTimeMs } from "tradrl-world-contracts/time";
import { createHeadlessWorldEngine } from "../world/index.js";
import type { HeadlessWorldEngine } from "../world/index.js";
import type { WorldDefinition } from "../world/index.js";
import {
  ADAPTER_ENVELOPE_VERSION,
  isWorldClientMessage,
  serializeTransportError,
  toWorldPublishedProjection,
  worldAdapterError,
} from "./envelope.js";
import type {
  WorldAdapterWireOptions,
  WorldCallOutcome,
  WorldChannel,
  WorldClientMessage,
  WorldHostInfo,
  WorldHostMessage,
  WorldPortCall,
  WorldPublishedProjection,
  WorldRemoteError,
} from "./envelope.js";
import {
  createRealtimeClockDriver,
  resolveAdapterWallTimeSource,
} from "./realtimeDriver.js";
import type { WorldRealtimeClockDriver, WorldTaskScheduler } from "./realtimeDriver.js";

/** Host-side channel subscription flags (one transport serves one client). */
export interface WorldChannelState {
  isSubscribed(channel: WorldChannel): boolean;
  subscribe(channel: WorldChannel): void;
  unsubscribe(channel: WorldChannel): void;
  clear(): void;
}

function createWorldChannelState(): WorldChannelState {
  const subscribed: Record<WorldChannel, boolean> = { published: false, clock: false };
  return {
    isSubscribed: (channel) => subscribed[channel],
    subscribe: (channel) => {
      subscribed[channel] = true;
    },
    unsubscribe: (channel) => {
      subscribed[channel] = false;
    },
    clear: () => {
      subscribed.published = false;
      subscribed.clock = false;
    },
  };
}

/** Internal error carrying a pre-serialized remote error through dispatch. */
class AdapterDispatchError extends Error {
  constructor(readonly remote: WorldRemoteError) {
    super(remote.message);
  }
}

/** Driver configuration for a host runtime. */
export interface WorldRealtimeDriverConfig {
  readonly enabled: boolean;
  readonly tickMs?: number;
  readonly scheduler?: WorldTaskScheduler;
  readonly wallTimeSource?: () => WallTimeMs;
}

/** The live host: message dispatch over one engine. */
export interface WorldAdapterCore {
  /** Handle one validated client message (never throws). */
  handleClientMessage(message: WorldClientMessage): void;
  /** Adapter/engine identity (the `host.describe` value). */
  describe(): Promise<WorldHostInfo>;
  /** Stop the driver, drop subscriptions. Idempotent. */
  dispose(): void;
}

/** Everything a host needs over a live engine. */
export interface EngineAdapterRuntime {
  readonly engine: HeadlessWorldEngine;
  readonly core: WorldAdapterCore;
}

/** Input for {@link createEngineAdapterRuntime}. */
export interface EngineAdapterRuntimeInput {
  readonly definition: WorldDefinition;
  /** Injected wall-axis source (tests/replays); wins over `wireOptions.fixedWallTime`. */
  readonly wallTimeSource?: () => WallTimeMs;
  /** Wire-shaped options (realtime driver, fixed wall time). */
  readonly wireOptions?: WorldAdapterWireOptions;
  readonly emit: (message: WorldHostMessage) => void;
  readonly onDiagnostics?: (detail: string) => void;
  readonly scheduler?: WorldTaskScheduler;
  readonly createEngine?: (options: {
    readonly definition: WorldDefinition;
    readonly wallTimeSource: () => WallTimeMs;
    readonly onPublished: (published: {
      readonly ack: { readonly status: "acked"; readonly ack: WorldPublishedProjection["ack"] };
      readonly events: WorldPublishedProjection["events"];
    }) => void;
  }) => HeadlessWorldEngine;
}

/**
 * Compose engine + host core. The engine's `onPublished` seam (the explicit
 * `publish projections` lifecycle step) is routed to the transport — but only
 * while a client subscribes to the `published` channel.
 */
export function createEngineAdapterRuntime(
  input: EngineAdapterRuntimeInput,
): EngineAdapterRuntime {
  const channels = createWorldChannelState();
  const wallTimeSource = input.wallTimeSource ?? resolveAdapterWallTimeSource();
  const realtime = input.wireOptions?.realtime;
  const onPublished = (published: {
    readonly ack: { readonly status: "acked"; readonly ack: WorldPublishedProjection["ack"] };
    readonly events: WorldPublishedProjection["events"];
  }): void => {
    if (channels.isSubscribed("published")) {
      input.emit({
        kind: "published",
        projection: toWorldPublishedProjection(published),
      });
    }
  };
  const engine =
    input.createEngine?.({
      definition: input.definition,
      wallTimeSource,
      onPublished,
    }) ??
    createHeadlessWorldEngine({
      definition: input.definition,
      wallTimeSource,
      onPublished,
    });

  let driver: WorldRealtimeClockDriver | undefined;
  if (realtime?.enabled) {
    driver = createRealtimeClockDriver({
      clock: engine.clock,
      clockState: engine.clockState,
      wallTimeSource,
      ...(realtime.tickMs === undefined ? {} : { tickMs: realtime.tickMs }),
      ...(input.scheduler === undefined ? {} : { scheduler: input.scheduler }),
      onStep: (clock) => {
        if (channels.isSubscribed("clock")) {
          input.emit({ kind: "clock", clock });
        }
      },
      onDiagnostics: input.onDiagnostics,
    });
    driver.start();
  }

  function portObject(port: WorldPortCall["port"]): Record<string, unknown> | undefined {
    switch (port) {
      case "query":
        return engine.query as unknown as Record<string, unknown>;
      case "command":
        return engine.command as unknown as Record<string, unknown>;
      case "clock":
        return engine.clock as unknown as Record<string, unknown>;
      case "evidence":
        return engine.evidence as unknown as Record<string, unknown>;
      default:
        return undefined;
    }
  }

  async function dispatchHostMethod(method: string): Promise<unknown> {
    if (method === "describe") {
      return describeCore();
    }
    if (method === "headlessReport") {
      return engine.headlessReport();
    }
    throw new AdapterDispatchError(
      worldAdapterError("unknown-method", `host has no method '${method}'`),
    );
  }

  async function describeCore(): Promise<WorldHostInfo> {
    const meta = await engine.query.getWorldMeta();
    return {
      worldId: engine.worldId,
      engine: meta.engine,
      engineVersion: meta.engineVersion,
      journalCursor: engine.journal.getCursor(),
      envelopeVersion: ADAPTER_ENVELOPE_VERSION,
    };
  }

  async function dispatchCall(call: WorldPortCall): Promise<unknown> {
    if (call.port === "host") {
      return dispatchHostMethod(call.method);
    }
    const port = portObject(call.port);
    if (port === undefined) {
      throw new AdapterDispatchError(
        worldAdapterError("unknown-port", `unknown port '${call.port}'`),
      );
    }
    const method = port[call.method];
    if (typeof method !== "function") {
      throw new AdapterDispatchError(
        worldAdapterError(
          "unknown-method",
          `port '${call.port}' has no method '${call.method}'`,
        ),
      );
    }
    return (method as (...args: unknown[]) => unknown).apply(port, [...call.args]);
  }

  /** After an acked MUTATING clock call, push the settled clock view. */
  function pushClockView(): void {
    if (!channels.isSubscribed("clock")) {
      return;
    }
    void engine.clock
      .getClock()
      .then((clock: ClockView) => input.emit({ kind: "clock", clock }))
      .catch(() => undefined); // getClock cannot fail on a live engine
  }

  function respond(requestId: number, outcome: WorldCallOutcome): void {
    input.emit({ kind: "response", requestId, outcome });
  }

  const core: WorldAdapterCore = {
    handleClientMessage(message) {
      switch (message.kind) {
        case "request": {
          void dispatchCall(message.call).then(
            (value) => {
              respond(message.requestId, { status: "ok", value });
              if (message.call.port === "clock" && message.call.method !== "getClock") {
                pushClockView();
              }
            },
            (error) => {
              respond(message.requestId, {
                status: "error",
                error:
                  error instanceof AdapterDispatchError
                    ? error.remote
                    : serializeTransportError(error),
              });
            },
          );
          return;
        }
        case "subscribe":
          channels.subscribe(message.channel);
          return;
        case "unsubscribe":
          channels.unsubscribe(message.channel);
          return;
        case "dispose":
          core.dispose();
          return;
        case "init":
          // The engine exists since runtime creation (in-process factory or a
          // session that already ran init): a duplicate init fails closed.
          respond(message.requestId, {
            status: "error",
            error: worldAdapterError(
              "already-initialized",
              "this adapter host already has an engine; init once",
            ),
          });
          return;
      }
    },
    describe: describeCore,
    dispose() {
      driver?.stop();
      channels.clear();
    },
  };

  return { engine, core };
}

/** Options for {@link createWorldAdapterSession} (the worker-host layer). */
export interface WorldAdapterSessionOptions {
  readonly emit: (message: WorldHostMessage) => void;
  readonly onDiagnostics?: (detail: string) => void;
  /** Overrides runtime creation (tests). */
  readonly createRuntime?: (input: EngineAdapterRuntimeInput) => EngineAdapterRuntime;
  readonly scheduler?: WorldTaskScheduler;
}

/** A `init`-gated host session: uninitialized → ready → disposed. */
export interface WorldAdapterSession {
  /** Feed one raw client message (validated here; never throws). */
  handleClientMessage(message: unknown): void;
  dispose(): void;
}

/**
 * The session state machine. The worker host installs this; `init` carries
 * the WorldDefinition over the wire, engine creation failures come back as a
 * typed error response (the session stays initializable), and any request
 * before init fails closed with `not-initialized`.
 */
export function createWorldAdapterSession(
  options: WorldAdapterSessionOptions,
): WorldAdapterSession {
  let state: "uninitialized" | "ready" | "disposed" = "uninitialized";
  let runtime: EngineAdapterRuntime | undefined;
  const createRuntime = options.createRuntime ?? createEngineAdapterRuntime;

  function handleInit(message: Extract<WorldClientMessage, { kind: "init" }>): void {
    if (state === "disposed" || state === "ready") {
      options.emit({
        kind: "response",
        requestId: message.requestId,
        outcome: {
          status: "error",
          error: worldAdapterError(
            state === "disposed" ? "disposed" : "already-initialized",
            `init refused: adapter host is ${state}`,
          ),
        },
      });
      return;
    }
    if (typeof message.definition !== "object" || message.definition === null) {
      options.emit({
        kind: "response",
        requestId: message.requestId,
        outcome: {
          status: "error",
          error: worldAdapterError(
            "malformed-message",
            "init.definition must be a world definition object",
          ),
        },
      });
      return;
    }
    let created: EngineAdapterRuntime;
    try {
      created = createRuntime({
        definition: message.definition as WorldDefinition,
        ...(message.options === undefined ? {} : { wireOptions: message.options }),
        emit: options.emit,
        ...(options.onDiagnostics === undefined
          ? {}
          : { onDiagnostics: options.onDiagnostics }),
        ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
      });
    } catch (error) {
      // Definition validation failed fast: typed error, session stays initializable.
      options.emit({
        kind: "response",
        requestId: message.requestId,
        outcome: { status: "error", error: serializeTransportError(error) },
      });
      return;
    }
    runtime = created;
    state = "ready";
    void created.core.describe().then(
      (info) => {
        options.emit({
          kind: "response",
          requestId: message.requestId,
          outcome: { status: "ok", value: info },
        });
      },
      (error) => {
        options.emit({
          kind: "response",
          requestId: message.requestId,
          outcome: { status: "error", error: serializeTransportError(error) },
        });
      },
    );
  }

  return {
    handleClientMessage(message) {
      if (!isWorldClientMessage(message)) {
        options.onDiagnostics?.(
          `malformed-message dropped: ${typeof message === "object" && message !== null ? JSON.stringify((message as { kind?: unknown }).kind) : typeof message}`,
        );
        return;
      }
      switch (message.kind) {
        case "init":
          handleInit(message);
          return;
        case "dispose":
          state = "disposed";
          runtime?.core.dispose();
          return;
        default:
          break;
      }
      if (state !== "ready" || runtime === undefined) {
        if (message.kind === "request") {
          options.emit({
            kind: "response",
            requestId: message.requestId,
            outcome: {
              status: "error",
              error: worldAdapterError(
                state === "disposed" ? "disposed" : "not-initialized",
                `${message.kind} refused: adapter host is ${state} (init required first)`,
              ),
            },
          });
        } else {
          options.onDiagnostics?.(`not-initialized: ${message.kind} dropped`);
        }
        return;
      }
      runtime.core.handleClientMessage(message);
    },
    dispose() {
      state = "disposed";
      runtime?.core.dispose();
    },
  };
}
