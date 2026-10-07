/**
 * The possession lifecycle as pure data transforms (W034) — the W032
 * attachment-lifecycle precedent, applied to the possession relation.
 *
 * Spec: spec/WORK-ITEMS.md W034 — "a lifecycle (unpossessed → possessed →
 * released; fail-closed)". The transition LAW is the contracts table
 * (`POSSESSION_LIFECYCLE_TRANSITIONS`); this module applies it. There is
 * no runtime here: no timers, no transports, no world calls — the caller
 * (W035's observation/action protocol, W044's runtime) drives events.
 *
 * Fail-closed laws (pinned by tests):
 * - `released` is terminal — every event is refused with
 *   `terminal-state`; a released possession never re-possesses through
 *   the same record (a new possession is a new record).
 * - `possess` is legal only from `unpossessed` AND only carrying a
 *   PASSING compatibility outcome (R051 — the evidence gates the
 *   possession; a failing outcome keeps the body unpossessed), and
 *   possessing an already-possessed record is refused
 *   (`invalid-transition`).
 * - `release` is always legal from `unpossessed` (the discard-before-
 *   possession path) and from `possessed` (the always-legal kill switch);
 *   the reason is recorded on the terminal state.
 * - Refusals NEVER mutate: the refused result carries the record
 *   unchanged, and the transforms are pure (no in-place edits).
 */

import type {
  PossessEvent,
  PossessionDescriptor,
  PossessionEvent,
  PossessionRecord,
  PossessionTransitionResult,
  PossessionTransitionErrorCode,
  PossessionCompatibilityOutcome,
} from "./contracts.js";
import { POSSESSION_LIFECYCLE_TRANSITIONS } from "./contracts.js";

/** The initial possession record: declared, not yet possessed. */
export function initialPossessionRecord(
  descriptor: PossessionDescriptor,
): PossessionRecord {
  return {
    possessionId: descriptor.possessionId,
    bodyId: descriptor.body.bodyId,
    substrateId: descriptor.substrate.substrateId,
    worldId: descriptor.body.scope.worldId,
    state: "unpossessed",
  };
}

function refuse(
  code: PossessionTransitionErrorCode,
  message: string,
  record: PossessionRecord,
): PossessionTransitionResult {
  return { ok: false, code, message, record };
}

/**
 * Apply one lifecycle event. The transition table is the authority: every
 * accepted move must be an edge of `POSSESSION_LIFECYCLE_TRANSITIONS`
 * from the current state (the function never invents a path the table
 * lacks).
 */
export function transitionPossession(
  record: PossessionRecord,
  event: PossessionEvent,
): PossessionTransitionResult {
  if (record.state === "released") {
    return refuse(
      "terminal-state",
      `possession ${String(record.possessionId)} of body ${String(record.bodyId)} is released (terminal); no lifecycle events apply`,
      record,
    );
  }
  if (event.kind === "possess") {
    if (record.state !== "unpossessed") {
      return refuse(
        "invalid-transition",
        `possess is only legal from unpossessed (current state: ${record.state})`,
        record,
      );
    }
    if (!event.compatibility.ok) {
      return refuse(
        "possess-compatibility-failed",
        "possess was handed a failing compatibility outcome — the body stays unpossessed (fail-closed, R051)",
        record,
      );
    }
    return {
      ok: true,
      record: { ...record, state: "possessed" },
    };
  }
  if (!POSSESSION_LIFECYCLE_TRANSITIONS[record.state].includes("released")) {
    return refuse(
      "invalid-transition",
      `release is not legal from ${record.state}`,
      record,
    );
  }
  return {
    ok: true,
    record: { ...record, state: "released", releaseReason: event.reason },
  };
}

/** True only while the possession is held (the sole state that may act/observe). */
export function isPossessionActive(record: PossessionRecord): boolean {
  return record.state === "possessed";
}

/** The possess event for a compatibility outcome (pure construction helper). */
export function possessEvent(
  compatibility: PossessionCompatibilityOutcome,
): PossessEvent {
  return { kind: "possess", compatibility };
}
