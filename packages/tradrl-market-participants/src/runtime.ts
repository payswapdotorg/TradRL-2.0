/**
 * The reactive participant runtime (W023) — the deterministic event loop:
 * SETTLED VIEW → PURE DECIDE → COMMANDS THROUGH THE REAL PORT.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — participants terminate at the
 * same typed CommandPort humans use; there is no second execution path.
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — every command runs
 * validate → authorize → apply domain rules → mutate → journal → publish →
 * ack; the runtime consumes the typed outcomes verbatim (acks AND
 * rejections — never fabricated success).
 *
 * THE EVENT-LOOP DISCIPLINE (the W023 contract):
 * 1. REACT ONLY TO SETTLED VIEWS. The single trigger is the client's clock
 *    channel (`onClock`), which the adapter pushes AFTER acked mutating
 *    clock calls — never mid-flight. The `published` channel carries
 *    mid-command projections; the runtime does not subscribe to it for
 *    decisions (a participant never reacts to mid-flight state).
 * 2. ONE PASS AT A TIME. A pass reads one fresh settled view
 *    (src/views.ts — fixed read order), asks every agent to decide (pure),
 *    and issues the agents' intents through the CommandPort in declaration
 *    order, awaiting each typed outcome before the next (FIFO: the runtime's
 *    issuance order IS the wire order; the engine's arrival-order queue is
 *    the single serializer).
 * 3. COALESCING IS DECLARED. Settled views that arrive while a pass is in
 *    flight mark the runtime pending; ONE follow-up pass runs on the latest
 *    settled state (projections may conflate — they never renumber; the
 *    same law the protocol gives every projection).
 * 4. FAIL CLOSED. A thrown port/transport error stops the loop and is
 *    recorded (`status: "failed"`); the runtime never invents views or
 *    outcomes. Typed rejections are NOT failures — they are outcomes.
 *
 * DETERMINISM (A9): the runtime holds no clocks, no counters that depend on
 * wall time, and no random draws — `issuedAt` is the settled view's
 * simulation time and `commandId` is `agent:<participant>:p<pass>:c<seq>`.
 * The same world + the same settled-view sequence ⇒ the same command stream
 * (proven by the twin runs in test/determinism.twin.test.ts).
 */

import type {
  CancelOrderCommand,
  ClosePositionCommand,
  CommandId,
  CommandResult,
  ReplaceOrderCommand,
  SubmitOrderCommand,
  TimestampMs,
  WorldCommand,
  WorldId,
} from "tradrl-world-contracts";
import type {
  ParticipantCommandOutcome,
  ParticipantDecision,
  ParticipantOrderIntent,
  ParticipantPassRecord,
  ParticipantRuntimeStatus,
  ParticipantRuntimeTelemetry,
  ParticipantSettledView,
  ParticipantViewConfig,
  ReactiveParticipantAgent,
  ReactiveParticipantWorldClient,
} from "../../tradrl-world-contracts/src/participantProtocol.js";
// NOTE(tradrl-world-contracts): the W023 protocol module is imported by the
// relative source path because the package's `exports` map registration
// ("./participantProtocol") is a TL action item (the frozen write surface
// forbids editing the contracts manifest). Type-only; erased at runtime.
import { readSettledView } from "./views.js";

/** Input for {@link createParticipantRuntime}. */
export interface ParticipantRuntimeOptions {
  /** The provider surface (the same typed client the human surfaces use). */
  readonly client: ReactiveParticipantWorldClient;
  /** The reactive participants, in issuance order. */
  readonly agents: readonly ReactiveParticipantAgent[];
  /** The declared observation surface (A7 — the set IS the declaration). */
  readonly views: ParticipantViewConfig;
}

/** A live participant runtime (see the module docstring for the discipline). */
export interface ParticipantRuntime {
  /** Subscribe + run the initial pass at the settled present. Idempotent. */
  start(): void;
  /** Resolve when idle (no pass in flight, no pending view). Rejects when failed. */
  settle(): Promise<void>;
  /** Stop reacting (unsubscribe; in-flight commands still settle their pass). */
  stop(): void;
  /** The ordered record of what was observed and what was issued. */
  telemetry(): ParticipantRuntimeTelemetry;
  /** Observe each completed pass (live consumers; never reorders anything). */
  onPass(listener: (record: ParticipantPassRecord) => void): () => void;
}

/** Stamp one intent into a full typed CommandPort command. */
function stampCommand(input: {
  readonly agent: ReactiveParticipantAgent;
  readonly worldId: string;
  readonly observedAt: TimestampMs;
  readonly pass: number;
  readonly sequence: number;
  readonly intent: ParticipantOrderIntent;
}): WorldCommand {
  const { agent, intent } = input;
  const commandId = `agent:${String(agent.participantId)}:p${String(input.pass)}:c${String(input.sequence)}` as CommandId;
  const base = {
    commandId,
    worldId: input.worldId as WorldId,
    issuedBy: agent.participantId,
    issuedAt: input.observedAt,
  };
  switch (intent.kind) {
    case "submit-order":
      return {
        ...base,
        kind: "submit-order",
        accountId: agent.accountId,
        instrumentId: intent.instrumentId,
        submission: intent.submission,
      } satisfies SubmitOrderCommand;
    case "cancel-order":
      return {
        ...base,
        kind: "cancel-order",
        orderId: intent.orderId,
        ...(intent.reason === undefined ? {} : { reason: intent.reason }),
      } satisfies CancelOrderCommand;
    case "replace-order":
      return {
        ...base,
        kind: "replace-order",
        orderId: intent.orderId,
        ...(intent.quantity === undefined ? {} : { quantity: intent.quantity }),
        ...(intent.limitPrice === undefined ? {} : { limitPrice: intent.limitPrice }),
        ...(intent.stopPrice === undefined ? {} : { stopPrice: intent.stopPrice }),
        ...(intent.constraints === undefined ? {} : { constraints: intent.constraints }),
      } satisfies ReplaceOrderCommand;
    case "close-position":
      return {
        ...base,
        kind: "close-position",
        accountId: agent.accountId,
        instrumentId: intent.instrumentId,
      } satisfies ClosePositionCommand;
    default: {
      // Exhaustiveness guard: the intent union is closed; an escapee is a
      // protocol breach and fails closed (never silently dropped).
      const exhaustive: never = intent;
      throw new Error(`[participants] unknown intent kind: ${String(exhaustive)}`);
    }
  }
}

/** Issue one stamped command through the real port and return its outcome. */
async function issueCommand(
  client: ReactiveParticipantWorldClient,
  command: WorldCommand,
): Promise<CommandResult> {
  switch (command.kind) {
    case "submit-order":
      return client.command.submitOrder(command);
    case "cancel-order":
      return client.command.cancelOrder(command);
    case "replace-order":
      return client.command.replaceOrder(command);
    case "close-position":
      return client.command.closePosition(command);
    default: {
      // World-administration commands are not participant intents; the
      // protocol's intent union cannot express them (typed, fail-closed).
      throw new Error(`[participants] intent escaped the order-command family: ${command.kind}`);
    }
  }
}

/**
 * Create the participant runtime. Construction subscribes NOTHING — the
 * operator calls {@link ParticipantRuntime.start} to arm the event loop.
 */
export function createParticipantRuntime(
  options: ParticipantRuntimeOptions,
): ParticipantRuntime {
  const { client, agents, views } = options;
  if (agents.length === 0) {
    throw new Error("[participants] a runtime needs at least one reactive agent");
  }
  const seenAgentIds = new Set<string>();
  for (const agent of agents) {
    if (seenAgentIds.has(agent.agentId)) {
      throw new Error(`[participants] duplicate agentId: ${agent.agentId}`);
    }
    seenAgentIds.add(agent.agentId);
  }

  let status: ParticipantRuntimeStatus = "created";
  /** Read the status through a function boundary: closure mutation between
   * awaits is invisible to control-flow analysis, and a plain re-read keeps
   * the checker's stale narrowing (TS narrows through initializers); this
   * keeps the fail-closed/stopped guards live and honest. */
  const readStatus = (): ParticipantRuntimeStatus => status;
  let unsubscribeClock: (() => void) | undefined;
  const passes: ParticipantPassRecord[] = [];
  const outcomes: ParticipantCommandOutcome[] = [];
  const passListeners = new Set<(record: ParticipantPassRecord) => void>();
  let viewsReceived = 0;
  let pendingView = false;
  let reacting = false;
  let passCount = 0;
  let failure: unknown;

  /** One completed pass becomes immutable telemetry before notification. */
  function recordPass(record: ParticipantPassRecord): void {
    passes.push(record);
    for (const listener of Array.from(passListeners)) {
      listener(record);
    }
  }

  /** Run one pass: view → decide → command (the whole discipline). */
  async function runPass(): Promise<void> {
    status = "reacting";
    const pass = passCount;
    passCount += 1;
    const view: ParticipantSettledView = await readSettledView(client, views);
    const decisions = new Map<string, ParticipantDecision>();
    const passOutcomes: ParticipantCommandOutcome[] = [];
    let sequence = 0;
    for (const agent of agents) {
      const decision = agent.decide(view);
      decisions.set(agent.agentId, decision);
      for (const [intentIndex, intent] of decision.intents.entries()) {
        sequence += 1;
        const command = stampCommand({ agent, worldId: client.worldId, observedAt: view.observedAt, pass, sequence, intent });
        const result = await issueCommand(client, command);
        const outcome: ParticipantCommandOutcome = {
          agentId: agent.agentId,
          intentIndex,
          commandId: String(command.commandId),
          result,
        };
        outcomes.push(outcome);
        passOutcomes.push(outcome);
      }
    }
    recordPass({
      pass,
      observedAt: view.observedAt,
      view,
      decisions,
      outcomes: passOutcomes,
    });
  }

  /** The drain loop: run passes while settled views keep arriving. */
  async function drain(): Promise<void> {
    reacting = true;
    try {
      while (pendingView && status !== "failed" && status !== "stopped") {
        pendingView = false;
        await runPass();
      }
    } catch (error) {
      // Fail closed: stop reacting, record the failure, never fabricate.
      failure = error;
      status = "failed";
    } finally {
      reacting = false;
      if (status === "reacting") {
        status = "idle";
      }
    }
  }

  function onClockView(): void {
    viewsReceived += 1;
    pendingView = true;
    if (!reacting && status !== "failed" && status !== "stopped" && status !== "created") {
      void drain();
    }
  }

  /** Wait until no pass is in flight and no view is pending. */
  async function idle(): Promise<void> {
    while (reacting || pendingView) {
      if (status === "failed") {
        return;
      }
      if (status === "stopped") {
        pendingView = false; // no NEW passes; the in-flight one still settles
      }
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
    }
  }

  return {
    start() {
      if (status !== "created") {
        return;
      }
      status = "idle";
      unsubscribeClock = client.onClock(onClockView);
      // The initial pass: the world at the settled present (t0 or whenever
      // the operator arms the runtime) is settled truth, not mid-flight.
      pendingView = true;
      void drain();
    },
    async settle(): Promise<void> {
      // The quiet-round-trip protocol: an acked MUTATING clock call pushes its
      // settled view AFTER the call's own response resolves — one promise hop
      // later. A bare idle-wait can therefore return between the operator's
      // `await step()` and the view's arrival. settle() closes that gap with
      // full read-only round-trips: any view push queued before a round-trip
      // is delivered before the round-trip's own response, so the loop below
      // terminates exactly when a whole round-trip passes with NO new view
      // and NO pass in flight. getClock never journals (a pure read), so the
      // extra calls never touch the run identity (A9).
      for (;;) {
        await idle();
        if (status === "failed") {
          throw failure;
        }
        if (status === "stopped") {
          return;
        }
        const viewsBefore = viewsReceived;
        await client.clock.getClock();
        await idle();
        // The status can change under us mid-round-trip (drain's fail-closed
        // path, stop() from another task); re-read through the boundary so
        // the guards stay live for the checker too (closure mutation is not
        // tracked across awaits).
        if (readStatus() === "failed") {
          throw failure;
        }
        if (readStatus() === "stopped") {
          return;
        }
        if (viewsReceived === viewsBefore && !reacting && !pendingView) {
          return;
        }
      }
    },
    stop() {
      if (status === "failed" || status === "stopped") {
        return;
      }
      unsubscribeClock?.();
      unsubscribeClock = undefined;
      status = "stopped"; // an in-flight pass completes; no new passes start
      pendingView = false;
    },
    telemetry(): ParticipantRuntimeTelemetry {
      const acked = outcomes.filter((outcome) => outcome.result.status === "acked").length;
      return {
        status,
        worldId: client.worldId,
        passes,
        viewsReceived,
        outcomes,
        acked,
        rejected: outcomes.length - acked,
        ...(failure === undefined ? {} : { failure }),
      };
    },
    onPass(listener) {
      passListeners.add(listener);
      return () => {
        passListeners.delete(listener);
      };
    },
  };
}
