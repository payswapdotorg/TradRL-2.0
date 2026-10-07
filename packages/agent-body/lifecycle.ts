/**
 * The Body attachment lifecycle as pure data transforms (W032).
 *
 * Spec: spec/WORK-ITEMS.md W032 — "a lifecycle (attach → active → detached;
 * fail-closed)". The transition LAW is the contracts table
 * (`BODY_LIFECYCLE_TRANSITIONS`); this module applies it. There is no
 * runtime here: no timers, no transports, no world calls — the caller
 * (W035's observation/action protocol) drives events.
 *
 * Fail-closed laws (pinned by tests):
 * - `detached` is terminal — every event is refused with
 *   `terminal-state`; a Body never re-attaches through the same
 *   attachment (a new lifecycle is a new attachment record).
 * - `attach` is legal only from `unattached` AND only carrying a PASSING
 *   validation outcome — a failing outcome keeps the Body unattached
 *   (`attach-validation-failed`), and attaching an already-attached Body
 *   is refused (`invalid-transition`).
 * - `detach` is always legal from `unattached` (discard before attach)
 *   and from `active` (the kill switch); the reason is recorded on the
 *   terminal state.
 * - Refusals NEVER mutate: the refused result carries the attachment
 *   unchanged, and the transforms are pure (no in-place edits).
 */

import type {
  AttachBodyEvent,
  BodyAttachment,
  BodyAttachmentEvent,
  BodyAttachmentTransitionResult,
  BodyDescriptor,
  BodyTransitionErrorCode,
  BodyValidationOutcome,
} from "./contracts.js";
import { BODY_LIFECYCLE_TRANSITIONS } from "./contracts.js";

/** The initial attachment record: declared, not yet bound (unattached). */
export function initialBodyAttachment(descriptor: BodyDescriptor): BodyAttachment {
  return {
    bodyId: descriptor.bodyId,
    worldId: descriptor.scope.worldId,
    state: "unattached",
  };
}

function refuse(
  code: BodyTransitionErrorCode,
  message: string,
  attachment: BodyAttachment,
): BodyAttachmentTransitionResult {
  return { ok: false, code, message, attachment };
}

/**
 * Apply one lifecycle event. The transition table is the authority: every
 * accepted move must be an edge of `BODY_LIFECYCLE_TRANSITIONS` from the
 * current state (the function never invents a path the table lacks).
 */
export function transitionBodyAttachment(
  attachment: BodyAttachment,
  event: BodyAttachmentEvent,
): BodyAttachmentTransitionResult {
  if (attachment.state === "detached") {
    return refuse(
      "terminal-state",
      `attachment of body ${String(attachment.bodyId)} is detached (terminal); no lifecycle events apply`,
      attachment,
    );
  }
  if (event.kind === "attach") {
    if (attachment.state !== "unattached") {
      return refuse(
        "invalid-transition",
        `attach is only legal from unattached (current state: ${attachment.state})`,
        attachment,
      );
    }
    if (!event.validation.ok) {
      return refuse(
        "attach-validation-failed",
        "attach was handed a failing validation outcome — the Body stays unattached (fail-closed)",
        attachment,
      );
    }
    return {
      ok: true,
      attachment: { ...attachment, state: "active" },
    };
  }
  if (!BODY_LIFECYCLE_TRANSITIONS[attachment.state].includes("detached")) {
    return refuse(
      "invalid-transition",
      `detach is not legal from ${attachment.state}`,
      attachment,
    );
  }
  return {
    ok: true,
    attachment: { ...attachment, state: "detached", detachReason: event.reason },
  };
}

/** True only while the attachment is `active` (may act and observe). */
export function isAttachmentActive(attachment: BodyAttachment): boolean {
  return attachment.state === "active";
}

/** The attach event for a validation outcome (pure construction helper). */
export function attachEvent(validation: BodyValidationOutcome): AttachBodyEvent {
  return { kind: "attach", validation };
}
