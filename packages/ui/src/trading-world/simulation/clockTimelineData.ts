/**
 * Simulation-clock/timeline data transforms — W012 (pure, framework-free).
 *
 * Spec: spec/UX-DESIGN.md "Clock" (the clock is world-owned; UI controls
 * send ClockPort commands: play, pause, step, speed, seek, jump-to-event)
 * and "Simulation disclosure"; spec/ARCHITECTURE-LOCK.md A7 (wall and
 * simulation axes are DISTINCT concepts — the wall axis is recorded by the
 * engine, never mixed into the simulation display) and A8 (history is
 * immutable: an in-place backward seek is the engine's typed
 * `rewind-requires-branch` rejection — branching is a command for later
 * work orders); spec/WORLD-PROTOCOL.md "ClockPort" + "UI projection law".
 *
 * All transforms are display projections of REAL engine values:
 * - the sim axis, status, speed and follow-mode come from the engine's
 *   `ClockView` (getClock + the W018 clock channel) — never a client-side
 *   timer;
 * - the WALL axis is NOT projected through the World Protocol ports (the
 *   `ClockView` carries no `wallTime`; the full `ClockState` stays
 *   engine-side), so the strip renders the honest not-projected note —
 *   never a local `Date.now()` invention, never mixed into the sim display;
 * - the timeline renders only ANNOUNCED regimes — `market.regime.changed`
 *   journal events read through `query.getTimeline` (the journal's regime
 *   truth, the W017 ORIGIN RULE), reusing the W008 market package's
 *   validated announcement parser (coordinated semantics, no duplicated
 *   logic) and enriching each entry with the journal identity the
 *   clock's `jumpToEvent` needs;
 * - clock rejections are the ENGINE's typed outcomes (W004's closed
 *   `ClockRejectionCode` set): surfaced verbatim with their codes, never
 *   silently swallowed, never re-invented client-side.
 */

import type { ClockRejection, ClockRejectionCode } from "tradrl-world-contracts/time";

import {
  formatSimulationTimestampMs,
  parseRegimeAnnouncements,
  REGIME_CHANGED_EVENT_TYPE,
} from "../market/marketData.js";
import type { MarketRegimeAnnouncement } from "../market/marketData.js";

/** Typed error for projection input that violates the canonical contracts. */
export class SimulationClockDataError extends Error {
  constructor(detail: string) {
    super(`[trading-world/simulation] refusing to project malformed clock data: ${detail}`);
    this.name = "SimulationClockDataError";
  }
}

/**
 * Structural slice of the W003 `ClockView` (`ClockPort.getClock` + the W018
 * clock channel) the strip renders — structural, not imported, so a
 * contracts change breaks this file at compile time (the W007/W008
 * structural-mirror rationale; the port signature itself stays checked via
 * the world-client seam).
 */
export interface SimulationClockView {
  readonly simulationTime: number;
  readonly status: string;
  readonly speed: number;
  readonly followingRealtime: boolean;
}

/**
 * Structural slice of the W003 `WorldEventEnvelope` the timeline reads (the
 * read is filtered server-side to `market.regime.changed`).
 */
export interface SimulationTimelineEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly occurredAt: number;
  readonly payload: unknown;
}

/**
 * The W004 closed rejection-code set, exhaustively explained (a
 * `Record<ClockRejectionCode, …>` forces this map to grow with the union —
 * a contracts change is a compile error here, never silent drift).
 */
export const CLOCK_REJECTION_EXPLANATIONS: Readonly<Record<ClockRejectionCode, string>> = {
  "invalid-speed":
    "the engine refused the speed: it must be a positive finite multiplier (clock.setSpeed)",
  "invalid-step-delta":
    "the engine refused the step: the delta must be a positive finite number of ms (clock.step)",
  "seek-before-start": "the target precedes the world origin — time does not exist there",
  "seek-beyond-end":
    "the target exceeds the finite timeline's end — this world declares an end bound",
  "unknown-event": "no journaled event matches the jump target (clock.jumpToEvent)",
  "rewind-requires-branch":
    "history is immutable (ARCHITECTURE-LOCK A8): an in-place backward move is refused — going back creates a branch from an immutable snapshot, which is a command for a later work order",
};

/** The engine's typed rejection of a clock request, surfaced verbatim. */
export interface ClockRejectionCapsule {
  readonly code: ClockRejectionCode;
  readonly message: string;
  /** The honest explanation for the code (W004's closed set, above). */
  readonly explanation: string;
}

function isClockRejectionCode(value: unknown): value is ClockRejectionCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(CLOCK_REJECTION_EXPLANATIONS, value)
  );
}

/**
 * Extract the engine's typed clock rejection from an error thrown by a
 * ClockPort call. The W018 transport serializes the sim engine's
 * `ClockRejectionError` as `remote.data.rejection` (a
 * `TradingWorldRemoteError` client-side); a same-process engine (tests)
 * throws the original class carrying `.rejection`. Anything else is NOT a
 * typed clock rejection — `undefined` is the honest answer (the caller
 * surfaces the raw error instead of guessing).
 */
export function clockRejectionFromError(error: unknown): ClockRejectionCapsule | undefined {
  const candidates: unknown[] = [];
  if (error !== null && typeof error === "object") {
    const record = error as { rejection?: unknown; remote?: { data?: { rejection?: unknown } } };
    if (record.rejection !== undefined) {
      candidates.push(record.rejection);
    }
    const remoteRejection = record.remote?.data?.rejection;
    if (remoteRejection !== undefined) {
      candidates.push(remoteRejection);
    }
  }
  for (const candidate of candidates) {
    if (candidate === null || typeof candidate !== "object") {
      continue;
    }
    const rejection = candidate as { code?: unknown; message?: unknown };
    if (isClockRejectionCode(rejection.code) && typeof rejection.message === "string") {
      const code = rejection.code;
      return {
        code,
        message: rejection.message,
        explanation: CLOCK_REJECTION_EXPLANATIONS[code],
      };
    }
  }
  return undefined;
}

/** The typed outcome of one issued clock command (W010's capsule pattern). */
export interface ClockCommandOutcome {
  readonly kind: "acked" | "rejected";
  /** What the trader asked for, e.g. `step +10 s` / `seek 2023-11-14 22:14:00 UTC`. */
  readonly label: string;
  /** Present iff the engine rejected (its typed code, verbatim). */
  readonly rejection?: ClockRejectionCapsule;
  /** Present iff the call failed without a typed rejection (transport etc.). */
  readonly failure?: string;
}

/** The honest wall-axis display: the ports do not project it (A7). */
export interface WallAxisNote {
  readonly label: string;
  readonly title: string;
  readonly text: string;
}

/**
 * The wall axis is RECORDED by the engine (W004 `ClockState.wallTime`, the
 * host-axis reading) but NOT projected through the World Protocol ports:
 * `ClockPort.getClock` returns the minimal `ClockView` (sim time, status,
 * speed, follow mode) and the W018 clock channel pushes the same view. The
 * strip therefore renders the honest not-projected note — a local clock
 * would be a client-side timer, which the W012 law forbids, and mixing a
 * host reading into the sim display would violate A7.
 */
export function describeWallAxis(): WallAxisNote {
  return {
    label: "wall",
    title:
      "The wall axis (A7) is recorded by the engine (ClockState.wallTime) but not projected " +
      "through the World Protocol ports — ClockView carries no wallTime. Never a client-side " +
      "timer, never mixed into the simulation axis.",
    text: "not projected",
  };
}

/** One display projection of the engine's ClockView. */
export interface SimulationClockReadout {
  /** e.g. `2023-11-14 22:13:30 UTC` (deterministic UTC, no locale). */
  readonly timeText: string;
  /** `paused` | `playing` — the engine's own status, verbatim. */
  readonly statusText: string;
  /** e.g. `1×` (the engine's speed, verbatim). */
  readonly speedText: string;
  readonly followingRealtime: boolean;
}

/** Project the engine's ClockView into the strip's readout. */
export function describeSimulationClockView(view: SimulationClockView): SimulationClockReadout {
  return {
    timeText: formatSimulationTimestampMs(view.simulationTime),
    statusText: view.status,
    speedText: `${Number.isFinite(view.speed) ? view.speed : 1}×`,
    followingRealtime: view.followingRealtime === true,
  };
}

/**
 * The step sizes the strip offers (playback controls): each issues a REAL
 * `clock.step(deltaMs)` — the engine applies the delta (or its rejection).
 */
export const CLOCK_STEP_SIZE_OPTIONS: readonly {
  readonly deltaMs: number;
  readonly label: string;
}[] = [
  { deltaMs: 100, label: "100 ms" },
  { deltaMs: 1_000, label: "1 s" },
  { deltaMs: 10_000, label: "10 s" },
  { deltaMs: 60_000, label: "1 min" },
];

/** The speed presets of the UX-DESIGN clock strip (0.1×/1×/10×/100×). */
export const CLOCK_SPEED_PRESET_OPTIONS: readonly {
  readonly speed: number;
  readonly label: string;
}[] = [
  { speed: 0.1, label: "0.1×" },
  { speed: 1, label: "1×" },
  { speed: 10, label: "10×" },
  { speed: 100, label: "100×" },
];

/** One announced regime on the timeline, with the journal identity. */
export interface TimelineRegimeEntry {
  /** The journal announcement (validated by the W008 market parser). */
  readonly announcement: MarketRegimeAnnouncement;
  /** Journal sequence — the `clock.jumpToEvent` target for this row. */
  readonly sequence: number;
  readonly eventId: string;
}

/**
 * Parse the announced regime entries of a timeline read. Only well-formed
 * `market.regime.changed` payloads pass — validation is the W008 market
 * package's own parser (one event at a time; coordinated semantics, no
 * duplicated logic), enriched here with the journal identity for
 * jump-to-event. Anything malformed under the regime event type is the
 * market parser's typed projection error.
 */
export function parseTimelineRegimeEntries(
  events: readonly SimulationTimelineEvent[],
): readonly TimelineRegimeEntry[] {
  const entries: TimelineRegimeEntry[] = [];
  for (const event of events) {
    if (event.eventType !== REGIME_CHANGED_EVENT_TYPE) {
      continue;
    }
    const announcements = parseRegimeAnnouncements([event]);
    const announcement = announcements[0];
    if (announcement === undefined) {
      throw new SimulationClockDataError(
        `regime event (seq ${event.sequence}) produced no announcement — the market parser disagreed`,
      );
    }
    entries.push({ announcement, sequence: event.sequence, eventId: event.eventId });
  }
  return entries;
}

/** The outcome of parsing a seek target from text. */
export type SeekTargetParse =
  | { readonly ok: true; readonly to: number; readonly normalizedText: string }
  | { readonly ok: false; readonly error: string };

const SEEK_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;

/**
 * Parse the seek input. Two honest forms, both absolute points on the
 * simulation axis (UTC, deterministic — no locale):
 * - a full date-time: `2023-11-14 22:14:00`, `2023-11-14T22:14`,
 *   optionally with `.ms` and a `Z` suffix;
 * - an absolute simulation-ms integer (the engine's own axis unit).
 *
 * The MOVE itself is always the engine's decision — this parses input only;
 * a backward target is SENT (the engine's typed `rewind-requires-branch`
 * rejection is the authority, never a client-side pre-rejection).
 */
export function parseSeekTargetText(text: string): SeekTargetParse {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "empty seek target" };
  }
  if (/^\d+$/.test(trimmed)) {
    const to = Number(trimmed);
    if (!Number.isSafeInteger(to)) {
      return { ok: false, error: `simulation-ms value ${trimmed} is not a safe integer` };
    }
    return { ok: true, to, normalizedText: String(to) };
  }
  const match = SEEK_DATE_TIME_PATTERN.exec(trimmed);
  if (match === null) {
    return {
      ok: false,
      error:
        "seek target must be a UTC date-time (YYYY-MM-DD HH:MM[:SS]) or an absolute simulation-ms integer",
    };
  }
  const year = match[1]!;
  const month = match[2]!;
  const day = match[3]!;
  const hour = match[4]!;
  const minute = match[5]!;
  const second = match[6] ?? "00";
  const ms = (match[7] ?? "").padEnd(3, "0");
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms}Z`;
  const to = Date.parse(iso);
  if (Number.isNaN(to)) {
    return { ok: false, error: `seek target ${trimmed} is not a valid UTC instant` };
  }
  return { ok: true, to, normalizedText: `${year}-${month}-${day} ${hour}:${minute}:${second} UTC` };
}
