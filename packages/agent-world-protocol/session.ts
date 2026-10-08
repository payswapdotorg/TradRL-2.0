/**
 * The agent-world session (W035): the composed lifecycle — attach →
 * observe → decide → act → detach — fail-closed at every seam, every state
 * transition typed, telemetry as data (the W023 pass-record precedent).
 *
 * THE ATTACH GATE (typed, fail-closed): the W034 possession check
 * (`checkPossessionCompatibility` — the descriptor structure, the
 * substrate's proposed command kinds vs the body's embodiment, the rate
 * envelope vs the grant, and the W032 `validateBodyAttachment` world
 * binding) projects the effective agent; the LIVE substrate must be the
 * declared one (content-addressed identity — a different mind never
 * possessess through this session); the client must serve the declared
 * world and the definition must be that world; the observation config may
 * only narrow the effective view; and a real clock handshake proves the
 * client is alive. Only then do the two composed machines turn: the W032
 * attachment (unattached → active) and the W034 possession (unpossessed →
 * possessed, gated on the compatibility evidence).
 *
 * THE EVENT LOOP (the W023 discipline, verbatim): react only to SETTLED
 * views (the client's clock channel, pushed after acked mutating clock
 * calls — never mid-flight); ONE pass at a time (a pass observes one
 * coherent settled view, asks the substrate to decide — the W033 state
 * laws threading the declared state — admits the stream through the W034
 * decision-level gate, and issues the admitted commands FIFO through the
 * CommandPort); views arriving mid-pass coalesce into one follow-up pass
 * at the latest settled position; the DECLARED rate spacing
 * (`minViewIntervalMs`, the tighter-of from the effective agent) governs
 * which settled views the substrate ever sees — a closer view is skipped
 * and counted, never silently observed.
 *
 * FAIL-CLOSED: a thrown port/transport error stops the loop and the
 * session (status "failed", the failure recorded, both machines released
 * with `protocol-error`); a substrate refusing its own granted view is a
 * protocol breach and fails the session the same way; the admission gate's
 * refusals and the port's typed rejections are OUTCOMES, not failures
 * (recorded as data; the session continues — the operator holds the kill
 * switch).
 *
 * DETERMINISM (A9): no wall reads, no unseeded randomness, no invented
 * identity — the pass counter, the settled asOf, the substrate's
 * deterministic decision/command ids and the engine's own journal make
 * the whole telemetry a pure function of world + agent + clock stream.
 */

import { stableDigest } from "tradrl-world-sim/world";
import type { TimestampMs } from "tradrl-world-contracts";
import type { SubstrateError } from "tradrl-world-contracts/cognitiveSubstrate";
import { initialBodyAttachment, transitionBodyAttachment, attachEvent } from "agent-body/lifecycle";
import { validateBodyAttachment } from "agent-body/validate";
import {
  checkPossessionCompatibility,
} from "possession/compatibility";
import { projectEffectiveAgent } from "possession/projection";
import {
  initialPossessionRecord,
  possessEvent,
  transitionPossession,
} from "possession/lifecycle";
import type {
  EffectiveAgent,
  PossessionCompatibilityOutcome,
} from "possession/contracts";
import { decisionStreamDigestOf } from "cognitive-substrate/validate";
import { observeAgentView, resolveObservationProtocol } from "./observation.js";
import { issueDecisionStream } from "./action.js";
import type {
  AgentPassRecord,
  AgentSession,
  AgentSessionAttachOutcome,
  AgentSessionDetachOutcome,
  AgentSessionDetachReason,
  AgentSessionOptions,
  AgentSessionStatus,
  AgentSessionTelemetry,
  ObservationFailure,
  ResolvedObservationProtocol,
} from "./contracts.js";

/**
 * A protocol breach the session fails closed on: the substrate refused a
 * view the protocol guarantees to be valid and granted (the W033 firewall
 * inside `decide` re-proves the view before the core runs), or the world
 * served something inconsistent with the grant. The typed errors ride
 * along as data.
 */
export class AgentProtocolBreachError extends Error {
  constructor(
    message: string,
    readonly errors: readonly (SubstrateError | ObservationFailure)[],
  ) {
    super(message);
    this.name = "AgentProtocolBreachError";
  }
}

/** The W032 detach reason a session detach reason maps onto. */
function bodyDetachReason(reason: AgentSessionDetachReason) {
  return reason;
}

/** The W034 release reason a session detach reason maps onto. */
function possessionReleaseReason(
  reason: AgentSessionDetachReason,
): "operator-request" | "body-detached" | "protocol-error" {
  if (reason === "world-closed") {
    return "body-detached";
  }
  return reason;
}

/**
 * Create the agent-world session. Construction subscribes NOTHING and
 * validates NOTHING — {@link AgentSession.attach} is the typed gate; a
 * refusal leaves the session (and both machines) untouched.
 */
export function createAgentWorldSession(options: AgentSessionOptions): AgentSession {
  const { client, possession, substrate, world } = options;

  let status: AgentSessionStatus = "created";
  /** Read the status through a function boundary (the W023 runtime law:
   * closure mutation between awaits is invisible to control-flow analysis,
   * and a plain re-read keeps stale narrowing; this keeps the guards live). */
  const readStatus = (): AgentSessionStatus => status;
  let started = false;
  let unsubscribeClock: (() => void) | undefined;

  let attachment = initialBodyAttachment(possession.body);
  let possessionRecord = initialPossessionRecord(possession);
  let agent: EffectiveAgent | undefined;
  let protocol: ResolvedObservationProtocol | undefined;

  const passes: AgentPassRecord[] = [];
  const outcomes: import("./contracts.js").AgentCommandOutcome[] = [];
  const passListeners = new Set<(record: AgentPassRecord) => void>();
  let viewsReceived = 0;
  let observationsSkipped = 0;
  let admissionRefused = 0;
  let failure: unknown;

  let pendingView = false;
  let reacting = false;
  let passCount = 0;
  let lastObservedAt: TimestampMs | undefined;
  let substrateState: import("tradrl-world-contracts/cognitiveSubstrate").SubstrateState | undefined =
    substrate.initialState;

  /** One completed pass becomes immutable telemetry before notification. */
  function recordPass(record: AgentPassRecord): void {
    passes.push(record);
    for (const listener of Array.from(passListeners)) {
      listener(record);
    }
  }

  /** Fail the session closed: stop the loop, record, release both machines. */
  function failSession(error: unknown): void {
    if (status === "failed" || status === "detached") {
      return;
    }
    failure = error;
    status = "failed";
    pendingView = false;
    unsubscribeClock?.();
    unsubscribeClock = undefined;
    // Both composed machines release with the protocol-error reason (their
    // own transitions are legal from active/possessed; results recorded).
    const bodyDetach = transitionBodyAttachment(attachment, {
      kind: "detach",
      reason: "protocol-error",
    });
    if (bodyDetach.ok) {
      attachment = bodyDetach.attachment;
    }
    const release = transitionPossession(possessionRecord, {
      kind: "release",
      reason: "protocol-error",
    });
    if (release.ok) {
      possessionRecord = release.record;
    }
  }

  /** Run one pass: observe → (rate) → decide → admit → act (the discipline). */
  async function runPass(): Promise<void> {
    const activeProtocol = protocol;
    const activeAgent = agent;
    if (activeProtocol === undefined || activeAgent === undefined) {
      throw new Error("[agent-world-protocol] a pass ran before attach — a protocol breach");
    }

    // OBSERVE: the coherence-guarded settled read + the W032 grant.
    const observation = await observeAgentView(client, activeProtocol);

    // THE DECLARED RATE SPACING: a settled view closer than the declared
    // minimum interval is never shown to the substrate (skipped + counted).
    const interval = activeAgent.decisionRate.minViewIntervalMs;
    if (
      lastObservedAt !== undefined &&
      interval !== undefined &&
      Number(observation.asOf) - Number(lastObservedAt) < interval
    ) {
      observationsSkipped += 1;
      return;
    }
    lastObservedAt = observation.asOf;

    // DECIDE: the substrate's pure decision function, with the declared
    // state threaded for declared-state minds (the W033 state-mode laws).
    const declaredState = activeAgent.substrate.stateMode === "declared-state";
    const decision = substrate.decide(
      declaredState ? { view: observation.view, state: substrateState } : { view: observation.view },
    );
    if (!decision.ok) {
      // The protocol guarantees the view is valid and granted (the grant
      // built it; the W033 firewall inside decide re-proves it) — a refusal
      // is a protocol breach and fails the session closed.
      throw new AgentProtocolBreachError(
        "[agent-world-protocol] the substrate refused a granted view (typed errors carried as data) — failing closed",
        decision.errors,
      );
    }
    if (decision.state !== undefined) {
      substrateState = decision.state;
    }

    // ACT: the admission gate, then the FIFO issuance with typed outcomes.
    const action = await issueDecisionStream(client, possession, decision.stream);
    if (!action.admission.ok) {
      admissionRefused += 1;
    }

    const record: AgentPassRecord = {
      pass: passCount,
      observedAt: observation.asOf,
      observation,
      stream: decision.stream,
      streamDigest: decisionStreamDigestOf(decision.stream),
      admission: action.admission,
      outcomes: action.outcomes,
    };
    passCount += 1;
    for (const outcome of action.outcomes) {
      outcomes.push(outcome);
    }
    recordPass(record);
  }

  /** The drain loop: run passes while settled views keep arriving. */
  async function drain(): Promise<void> {
    reacting = true;
    try {
      while (pendingView && readStatus() === "attached") {
        pendingView = false;
        await runPass();
      }
    } catch (error) {
      failSession(error);
    } finally {
      reacting = false;
    }
  }

  function onClockView(): void {
    viewsReceived += 1;
    pendingView = true;
    if (!reacting && readStatus() === "attached" && started) {
      void drain();
    }
  }

  /** Wait until no pass is in flight and no view is pending. */
  async function idle(): Promise<void> {
    while (reacting || pendingView) {
      if (readStatus() === "failed" || readStatus() === "detached") {
        return;
      }
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
    }
  }

  async function attach(): Promise<AgentSessionAttachOutcome> {
    if (status === "attached") {
      return {
        ok: false,
        code: "already-attached",
        message: "the session is already attached (a new possession is a new session)",
      };
    }
    if (status === "detached" || status === "failed") {
      return {
        ok: false,
        code: "session-terminal",
        message: `the session is ${status} (terminal); a detached/failed session never re-attaches (a new possession is a new session)`,
      };
    }

    // 1. The W034 possession check (descriptor structure, proposed command
    //    kinds vs the embodiment, the rate grant, and — with the world —
    //    the W032 attach constraints, errors verbatim).
    const compatibility: PossessionCompatibilityOutcome = checkPossessionCompatibility(
      possession,
      world,
    );
    if (!compatibility.ok) {
      return {
        ok: false,
        code: "possession-incompatible",
        message: `the possession is incompatible with the world ${String(world.scope.worldId)} (${String(compatibility.incompatibilities.length)} incompatibility(ies), carried verbatim) — the session stays unattached (fail-closed)`,
        incompatibilities: compatibility.incompatibilities,
      };
    }

    // 2. The effective agent (the same gate, projected).
    const projection = projectEffectiveAgent(possession, world);
    if (!projection.ok) {
      return {
        ok: false,
        code: "possession-incompatible",
        message: "the effective agent could not be projected (incompatibilities carried verbatim)",
        incompatibilities: projection.incompatibilities,
      };
    }

    // 3. The live substrate must BE the declared one (content-addressed).
    if (stableDigest(substrate.descriptor) !== stableDigest(possession.substrate)) {
      return {
        ok: false,
        code: "substrate-descriptor-mismatch",
        message:
          `the live substrate's descriptor is not the possession's declared substrate ` +
          `(${stableDigest(substrate.descriptor)} ≠ ${stableDigest(possession.substrate)}) — a different mind never possesses through this session`,
      };
    }

    // 4. The client must serve the declared world (and the definition must
    //    be that world — the gates ran against it).
    if (client.worldId !== String(possession.body.scope.worldId)) {
      return {
        ok: false,
        code: "client-world-mismatch",
        message: `the client serves world '${client.worldId}' but the possession declares '${String(possession.body.scope.worldId)}'`,
      };
    }
    if (String(world.scope.worldId) !== client.worldId) {
      return {
        ok: false,
        code: "definition-world-mismatch",
        message: `the definition is for world '${String(world.scope.worldId)}' but the client serves '${client.worldId}'`,
      };
    }

    // 5. The observation config may only narrow the effective view.
    const resolved = resolveObservationProtocol(
      options.observation,
      projection.agent,
      world.informationArtifacts ?? [],
    );
    if (!resolved.ok) {
      return {
        ok: false,
        code: "invalid-observation-config",
        message: `the observation protocol config is invalid (${String(resolved.errors.length)} error(s), carried verbatim) — the session stays unattached`,
        configErrors: resolved.errors,
      };
    }

    // 6. The live-world handshake: a real clock read proves the client is
    //    reachable before any lifecycle turns.
    try {
      await client.clock.getClock();
    } catch (error) {
      return {
        ok: false,
        code: "client-unreachable",
        message: `the attach clock handshake failed against world '${client.worldId}' — failing closed`,
        cause: error,
      };
    }

    // 7. Both machines turn (each transition is the pure table's own law;
    //    the W032 attach carries the W032 validation outcome; the W034
    //    possess carries the compatibility evidence, R051).
    const validation = validateBodyAttachment(possession.body, world);
    const bodyAttach = transitionBodyAttachment(attachment, attachEvent(validation));
    if (!bodyAttach.ok) {
      return {
        ok: false,
        code: "possession-incompatible",
        message: `the W032 attachment machine refused the attach (${bodyAttach.code}: ${bodyAttach.message})`,
      };
    }
    const possessionTransition = transitionPossession(
      possessionRecord,
      possessEvent(compatibility),
    );
    if (!possessionTransition.ok) {
      return {
        ok: false,
        code: "possession-incompatible",
        message: `the W034 possession machine refused the possess (${possessionTransition.code}: ${possessionTransition.message})`,
      };
    }

    attachment = bodyAttach.attachment;
    possessionRecord = possessionTransition.record;
    agent = projection.agent;
    protocol = resolved.protocol;
    status = "attached";
    return { ok: true };
  }

  return {
    attach,

    start() {
      if (status !== "attached" || started) {
        return;
      }
      started = true;
      unsubscribeClock = client.onClock(onClockView);
      // The initial pass: the world at the settled present (t0 or whenever
      // the operator arms the session) is settled truth, not mid-flight.
      pendingView = true;
      void drain();
    },

    async settle(): Promise<void> {
      // The quiet-round-trip protocol (the W023 law): an acked MUTATING
      // clock call pushes its settled view AFTER the call's own response
      // resolves — one promise hop later. A bare idle-wait can therefore
      // return between the operator's `await step()` and the view's
      // arrival. settle() closes that gap with full read-only round-trips;
      // getClock never journals, so the extra calls never touch the run
      // identity (A9).
      if (!started) {
        return;
      }
      for (;;) {
        await idle();
        if (readStatus() === "failed") {
          throw failure;
        }
        if (readStatus() === "detached") {
          return;
        }
        const viewsBefore = viewsReceived;
        await client.clock.getClock();
        await idle();
        if (readStatus() === "failed") {
          throw failure;
        }
        if (readStatus() === "detached") {
          return;
        }
        if (viewsReceived === viewsBefore && !reacting && !pendingView) {
          return;
        }
      }
    },

    detach(reason: AgentSessionDetachReason): AgentSessionDetachOutcome {
      if (status === "detached" || status === "failed") {
        return {
          ok: false,
          code: "session-terminal",
          message: `the session is already ${status} (terminal); no further lifecycle events apply`,
        };
      }
      // The always-legal kill switch — legal even before attach (the
      // discard path both machines honor). The in-flight pass (if any)
      // completes; no new passes start.
      unsubscribeClock?.();
      unsubscribeClock = undefined;
      pendingView = false;
      const bodyDetach = transitionBodyAttachment(attachment, {
        kind: "detach",
        reason: bodyDetachReason(reason),
      });
      if (bodyDetach.ok) {
        attachment = bodyDetach.attachment;
      }
      const release = transitionPossession(possessionRecord, {
        kind: "release",
        reason: possessionReleaseReason(reason),
      });
      if (release.ok) {
        possessionRecord = release.record;
      }
      status = "detached";
      return { ok: true, status };
    },

    telemetry(): AgentSessionTelemetry {
      const acked = outcomes.filter((outcome) => outcome.result.status === "acked").length;
      return {
        status,
        worldId: client.worldId,
        possessionId: possession.possessionId,
        bodyId: possession.body.bodyId,
        substrateId: possession.substrate.substrateId,
        ...(agent === undefined ? {} : { effectiveAgent: agent }),
        attachment,
        possession: possessionRecord,
        passes,
        viewsReceived,
        observationsSkipped,
        outcomes,
        acked,
        rejected: outcomes.length - acked,
        admissionRefused,
        ...(failure === undefined ? {} : { failure }),
      };
    },

    onPass(listener: (record: AgentPassRecord) => void): () => void {
      passListeners.add(listener);
      return () => {
        passListeners.delete(listener);
      };
    },
  };
}
