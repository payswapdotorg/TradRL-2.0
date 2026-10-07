/**
 * Framework-free live simulation-clock/timeline projection — W012.
 *
 * The controller behind `./SimulationClockToolSurface.tsx`: it reads the
 * engine's clock through the W006 world-client seam (`clock.getClock`) and
 * the announced-regime timeline (`query.getTimeline`, filtered server-side
 * to `market.regime.changed`), keeps them LIVE through the W018 push paths
 * (`onClock` — the settled view after acked mutating clock calls — and
 * `onPublished`), with a polling fallback for clients without push
 * channels. Mutating controls (step/seek/play/pause/setSpeed/jumpToEvent)
 * issue REAL ClockPort commands; the engine's typed outcomes (acks and the
 * W004 closed rejection set, `rewind-requires-branch` included) surface as
 * the visible outcome capsule — never silently swallowed, never re-invented
 * client-side. Every law is testable in plain Node; the React surface is a
 * thin `useSyncExternalStore` wrapper.
 *
 * Laws (work order W012 + ARCHITECTURE-LOCK A6/A7/A8):
 * - NEVER FABRICATE: the sim axis comes from the engine's ClockView only —
 *   never a client-side timer; the wall axis is not projected by the ports
 *   and is rendered as the honest not-projected note.
 * - ERRORS SURFACE, NEVER SWALLOW: a typed clock rejection is the outcome
 *   capsule; a timeline-read failure is a carried notice; a failed clock
 *   read (or a dead transport) fails the whole snapshot closed.
 * - FAIL CLOSED: when the transport dies, every call rejects and the
 *   snapshot becomes the typed error — the strip never keeps rendering a
 *   stale clock as if it were live.
 * - LIVE, COALESCED: clock pushes apply the engine's settled view directly
 *   and request a timeline refetch; publications request a refresh; an
 *   in-flight refresh absorbs bursts into ONE trailing refetch
 *   (WORLD-PROTOCOL "UI projection law": projections may batch/conflate).
 */

import {
  clockRejectionFromError,
  parseTimelineRegimeEntries,
  type ClockCommandOutcome,
  type SimulationClockView,
  type TimelineRegimeEntry,
} from "./clockTimelineData.js";
import { REGIME_CHANGED_EVENT_TYPE } from "../market/marketData.js";
import type { TradingWorldClient } from "../runtime/worldClient.js";
import { TradingWorldTransportClosedError } from "../runtime/engineWorldClient.js";

/** The snapshot the React surface renders (immutable; identity per change). */
export type ClockTimelineProjectionSnapshot =
  | { readonly status: "unattached" }
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      /** The engine's clock view — the sim axis of the strip (A7). */
      readonly clock: SimulationClockView;
      /** Announced regimes, journal order (the W017 ORIGIN RULE truth). */
      readonly timeline: readonly TimelineRegimeEntry[];
      /** Honest typed-error notice for the timeline read (rendered). */
      readonly timelineError?: string;
      /** The last issued command's typed outcome (visible, never swallowed). */
      readonly outcome?: ClockCommandOutcome;
      /** Label of the mutating clock command currently in flight. */
      readonly pending?: string;
    }
  | { readonly status: "error"; readonly message: string };

/** Input for {@link createClockTimelineProjectionController}. */
export interface ClockTimelineProjectionControllerInput {
  /** The seam client (noop fail-closed before W018 attaches, ready after). */
  readonly client: TradingWorldClient;
  /** Polling fallback cadence in ms; 0 disables polling (push stays). */
  readonly pollMs: number;
}

/** The live simulation-clock projection controller (one per mounted strip). */
export interface ClockTimelineProjectionController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ClockTimelineProjectionSnapshot;
  /** SSR snapshot: ALWAYS unattached (effects never run server-side). */
  getServerSnapshot(): ClockTimelineProjectionSnapshot;
  /** Begin fetching + subscribing. No-op when already running. */
  start(): void;
  /** Stop subscriptions + cancel polling (StrictMode-safe restart). */
  stop(): void;
  /** Manual refresh (the error state's Retry). Resolves when settled. */
  refresh(): Promise<void>;
  /** Issue `clock.step(deltaMs)` — the engine applies it (or rejects typed). */
  step(deltaMs: number): Promise<void>;
  /** Issue `clock.seek(to)` — backward targets surface the engine's A8 rejection. */
  seek(to: number): Promise<void>;
  /** Issue `clock.play()` (headless engines advance time only on step/seek). */
  play(): Promise<void>;
  /** Issue `clock.pause()`. */
  pause(): Promise<void>;
  /** Issue `clock.setSpeed(speed)`. */
  setSpeed(speed: number): Promise<void>;
  /** Issue `clock.jumpToEvent(sequence)` — journaled events only. */
  jumpToEvent(sequence: number): Promise<void>;
}

/** Structural narrowing of the W018 push channels (feature detection). */
type ClientWithPushChannels = TradingWorldClient & {
  onClock(listener: (clock: SimulationClockView) => void): () => void;
  onPublished(listener: () => void): () => void;
};

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isTransportClosed(error: unknown): boolean {
  if (error instanceof TradingWorldTransportClosedError) {
    return true;
  }
  // Structural check (a same-shape error from another realm/module instance).
  return error instanceof Error && error.name === "TradingWorldTransportClosedError";
}

/**
 * Create the controller. Pure until
 * {@link ClockTimelineProjectionController.start}.
 */
export function createClockTimelineProjectionController(
  input: ClockTimelineProjectionControllerInput,
): ClockTimelineProjectionController {
  const client = input.client;
  const listeners = new Set<() => void>();
  const unattached: ClockTimelineProjectionSnapshot = { status: "unattached" };
  // Synchronous initial state (the W007/W008 surface pattern): a READY client
  // means data is being fetched — the first snapshot is the honest loading
  // projection; a fail-closed client starts and stays unattached. Stable
  // reference: also the useSyncExternalStore server snapshot.
  const initialSnapshot: ClockTimelineProjectionSnapshot =
    client.status === "ready" ? { status: "loading" } : unattached;
  let snapshot: ClockTimelineProjectionSnapshot = initialSnapshot;
  let running = false;
  let inFlight = false;
  let pendingRefresh = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let outcome: ClockCommandOutcome | undefined;
  let pendingLabel: string | undefined;
  const unsubscribers: (() => void)[] = [];

  function emit(): void {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  function setSnapshot(next: ClockTimelineProjectionSnapshot): void {
    snapshot = next;
    emit();
  }

  /** Re-weave the carried command context into a fresh ready snapshot. */
  function withCommandContext(
    ready: Extract<ClockTimelineProjectionSnapshot, { status: "ready" }>,
  ): ClockTimelineProjectionSnapshot {
    return {
      ...ready,
      ...(outcome === undefined ? {} : { outcome }),
      ...(pendingLabel === undefined ? {} : { pending: pendingLabel }),
    };
  }

  /** Request a refresh: immediate when idle, ONE trailing refetch when busy. */
  function requestRefresh(): void {
    if (!running) {
      return;
    }
    if (inFlight) {
      pendingRefresh = true;
      return;
    }
    void runRefresh();
  }

  async function runRefresh(): Promise<void> {
    if (inFlight || !running) {
      return;
    }
    inFlight = true;
    try {
      const next = await fetchSnapshot();
      if (running) {
        setSnapshot(next);
      }
    } finally {
      inFlight = false;
      if (running && pendingRefresh) {
        pendingRefresh = false;
        void runRefresh();
      }
    }
  }

  async function fetchSnapshot(): Promise<ClockTimelineProjectionSnapshot> {
    try {
      // FATAL read: without the engine's clock there is no clock strip. A
      // rejection here usually means the transport died — fail closed.
      const clock = (await client.clock.getClock()) as SimulationClockView;
      let timeline: readonly TimelineRegimeEntry[] = [];
      let timelineError: string | undefined;
      try {
        const slice = await client.query.getTimeline({
          types: [REGIME_CHANGED_EVENT_TYPE],
        });
        timeline = parseTimelineRegimeEntries(slice.events as readonly never[]);
      } catch (error) {
        timelineError = errorText(error);
      }
      return withCommandContext({
        status: "ready",
        clock,
        timeline,
        ...(timelineError === undefined ? {} : { timelineError }),
      });
    } catch (error) {
      return { status: "error", message: errorText(error) };
    }
  }

  /** Apply a pushed settled clock view (the W018 law) + refetch the timeline. */
  function applyPushedClock(view: SimulationClockView): void {
    if (!running) {
      return;
    }
    if (snapshot.status === "ready") {
      setSnapshot(withCommandContext({ ...snapshot, clock: view }));
    }
    requestRefresh();
  }

  /**
   * Issue one mutating clock command through the port. The engine's typed
   * outcome becomes the visible capsule; the settled view arrives through
   * the clock push (and the trailing refresh for push-less clients).
   */
  async function issueCommand(label: string, run: () => Promise<void>): Promise<void> {
    if (!running || snapshot.status === "error") {
      return;
    }
    pendingLabel = label;
    if (snapshot.status === "ready") {
      setSnapshot(withCommandContext({ ...snapshot }));
    }
    let result: ClockCommandOutcome;
    try {
      await run();
      result = { kind: "acked", label };
    } catch (error) {
      if (isTransportClosed(error)) {
        // The transport is dead: fail the whole snapshot closed (never a
        // stale live-looking clock).
        outcome = undefined;
        pendingLabel = undefined;
        setSnapshot({ status: "error", message: errorText(error) });
        return;
      }
      const rejection = clockRejectionFromError(error);
      if (rejection !== undefined) {
        result = { kind: "rejected", label, rejection };
      } else {
        result = {
          kind: "rejected",
          label,
          failure: errorText(error),
        };
      }
    } finally {
      pendingLabel = undefined;
    }
    outcome = result;
    // Settle the view now (the clock push carries it for push clients; the
    // refetch carries it for polling clients — both honest, coalesced).
    requestRefresh();
  }

  function pushClient(): ClientWithPushChannels | undefined {
    const candidate = client as {
      onClock?: unknown;
      onPublished?: unknown;
    };
    if (typeof candidate.onClock === "function" && typeof candidate.onPublished === "function") {
      return client as ClientWithPushChannels;
    }
    return undefined;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    // Stable-reference server/initial snapshot: static renders (tests) and
    // real SSR (the fail-closed noop client) both render the honest state
    // derived from the seam client status — never fabricated data.
    getServerSnapshot: () => initialSnapshot,
    start() {
      if (running) {
        return;
      }
      running = true;
      if (client.status !== "ready") {
        // Fail-closed seam (W006 noop): the honest teaching state — the
        // strip renders it from the client status; nothing is fetched.
        setSnapshot(unattached);
        return;
      }
      setSnapshot({ status: "loading" });
      // LIVE (work order W012): subscribe the W018 push paths — the clock
      // channel pushes the SETTLED view after every acked mutating clock
      // call (the W018 law); publications (generated market events, regime
      // announcements included) request a timeline refresh.
      const withPush = pushClient();
      if (withPush !== undefined) {
        unsubscribers.push(withPush.onClock(applyPushedClock));
        unsubscribers.push(
          withPush.onPublished(() => {
            requestRefresh();
          }),
        );
      }
      if (input.pollMs > 0) {
        pollTimer = setInterval(() => {
          requestRefresh();
        }, input.pollMs);
      }
      requestRefresh();
    },
    stop() {
      if (!running) {
        return;
      }
      running = false;
      pendingRefresh = false;
      if (pollTimer !== undefined) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
      for (const unsubscribe of unsubscribers.splice(0)) {
        unsubscribe();
      }
      // An in-flight refresh may still settle; it observes `running` and
      // drops its result — the snapshot returns to the honest unattached
      // state until the next start() re-fetches from scratch.
      setSnapshot(unattached);
    },
    async refresh() {
      if (!running) {
        return;
      }
      if (inFlight) {
        pendingRefresh = true;
        while (inFlight || pendingRefresh) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return;
      }
      await runRefresh();
    },
    step(deltaMs: number) {
      return issueCommand(`step +${String(deltaMs)} ms`, () => client.clock.step(deltaMs));
    },
    seek(to: number) {
      return issueCommand(`seek ${String(to)}`, () =>
        // TimestampMs is a W003 branded primitive; the value is an absolute
        // point on the engine's own simulation axis (ms integer by parse).
        client.clock.seek(to as never),
      );
    },
    play() {
      return issueCommand("play", () => client.clock.play());
    },
    pause() {
      return issueCommand("pause", () => client.clock.pause());
    },
    setSpeed(speed: number) {
      return issueCommand(`set speed ${String(speed)}×`, () => client.clock.setSpeed(speed));
    },
    jumpToEvent(sequence: number) {
      return issueCommand(`jump to event #${String(sequence)}`, () =>
        // SequenceNumber is a W003 branded primitive; the journal sequence
        // is the engine's own value (numeric here by construction).
        client.clock.jumpToEvent(sequence as never),
      );
    },
  };
}
