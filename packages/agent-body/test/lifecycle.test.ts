/**
 * The Body attachment lifecycle laws (W032): attach → active → detached,
 * fail-closed — refusals are typed results that never mutate state, and
 * `detached` is terminal.
 *
 * Run: ../../node_modules/.bin/tsx --test test/lifecycle.test.ts
 * (from packages/agent-body).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  attachEvent,
  initialBodyAttachment,
  isAttachmentActive,
  transitionBodyAttachment,
  validateBodyAttachment,
} from "../index.js";
import type { BodyAttachmentEvent, BodyDetachReason } from "../index.js";
import { fixtureWorld, traderBody } from "./fixtures.js";

function validEvent() {
  return attachEvent(validateBodyAttachment(traderBody(), fixtureWorld()));
}

test("a Body starts unattached", () => {
  const attachment = initialBodyAttachment(traderBody());
  assert.equal(attachment.state, "unattached");
  assert.equal(attachment.detachReason, undefined);
  assert.equal(isAttachmentActive(attachment), false);
  assert.equal(attachment.bodyId, traderBody().bodyId);
});

test("the happy path: attach (validated) → active → detach → detached", () => {
  const initial = initialBodyAttachment(traderBody());
  const attached = transitionBodyAttachment(initial, validEvent());
  assert.equal(attached.ok, true);
  if (!attached.ok) return;
  assert.equal(attached.attachment.state, "active");
  assert.equal(isAttachmentActive(attached.attachment), true);
  assert.equal(attached.attachment.detachReason, undefined);

  const detached = transitionBodyAttachment(attached.attachment, {
    kind: "detach",
    reason: "operator-request",
  });
  assert.equal(detached.ok, true);
  if (!detached.ok) return;
  assert.equal(detached.attachment.state, "detached");
  assert.equal(detached.attachment.detachReason, "operator-request");
  assert.equal(isAttachmentActive(detached.attachment), false);
});

test("fail-closed: attach with a FAILING validation keeps the Body unattached", () => {
  const initial = initialBodyAttachment(traderBody());
  const failing = attachEvent({ ok: false, errors: [{ code: "unknown-instrument", message: "x" }] });
  const refused = transitionBodyAttachment(initial, failing);
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.code, "attach-validation-failed");
  assert.match(refused.message, /fail-closed/);
  // the refusal NEVER mutates: the attachment is returned unchanged
  assert.deepEqual(refused.attachment, initial);
  assert.equal(refused.attachment.state, "unattached");
});

test("fail-closed: structural garbage never attaches (validation drives the gate)", () => {
  const broken = traderBody({ bodyId: "" as never });
  const outcome = validateBodyAttachment(broken, fixtureWorld());
  assert.equal(outcome.ok, false);
  const refused = transitionBodyAttachment(
    initialBodyAttachment(broken),
    attachEvent(outcome),
  );
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.code, "attach-validation-failed");
});

test("double attach is refused (invalid-transition)", () => {
  const attached = transitionBodyAttachment(initialBodyAttachment(traderBody()), validEvent());
  assert.equal(attached.ok, true);
  if (!attached.ok) return;
  const again = transitionBodyAttachment(attached.attachment, validEvent());
  assert.equal(again.ok, false);
  if (again.ok) return;
  assert.equal(again.code, "invalid-transition");
  assert.deepEqual(again.attachment, attached.attachment);
});

test("detach from unattached is the discard path (legal, recorded)", () => {
  const initial = initialBodyAttachment(traderBody());
  const discarded = transitionBodyAttachment(initial, {
    kind: "detach",
    reason: "operator-request",
  });
  assert.equal(discarded.ok, true);
  if (!discarded.ok) return;
  assert.equal(discarded.attachment.state, "detached");
  assert.equal(discarded.attachment.detachReason, "operator-request");
});

test("every detach reason is recordable (the honest failure states)", () => {
  const reasons: readonly BodyDetachReason[] = [
    "operator-request",
    "world-closed",
    "embodiment-violation",
    "envelope-violation",
    "protocol-error",
  ];
  for (const reason of reasons) {
    const attached = transitionBodyAttachment(
      initialBodyAttachment(traderBody()),
      validEvent(),
    );
    assert.equal(attached.ok, true, `attach failed before detach (${reason})`);
    if (!attached.ok) return;
    const detached = transitionBodyAttachment(attached.attachment, {
      kind: "detach",
      reason,
    });
    assert.equal(detached.ok, true);
    if (!detached.ok) return;
    assert.equal(detached.attachment.detachReason, reason);
  }
});

test("detached is terminal: every event is refused with terminal-state", () => {
  const attached = transitionBodyAttachment(
    initialBodyAttachment(traderBody()),
    validEvent(),
  );
  assert.equal(attached.ok, true);
  if (!attached.ok) return;
  const detached = transitionBodyAttachment(attached.attachment, {
    kind: "detach",
    reason: "world-closed",
  });
  assert.equal(detached.ok, true);
  if (!detached.ok) return;
  const terminal = detached.attachment;
  const events: readonly BodyAttachmentEvent[] = [
    validEvent(),
    { kind: "detach", reason: "operator-request" },
    { kind: "detach", reason: "protocol-error" },
  ];
  for (const event of events) {
    const refused = transitionBodyAttachment(terminal, event);
    assert.equal(refused.ok, false);
    if (refused.ok) return;
    assert.equal(refused.code, "terminal-state");
    assert.deepEqual(refused.attachment, terminal);
  }
});

test("the transforms are pure: no transition mutates its input", () => {
  const initial = initialBodyAttachment(traderBody());
  const snapshot = JSON.stringify(initial);
  transitionBodyAttachment(initial, validEvent());
  transitionBodyAttachment(initial, { kind: "detach", reason: "operator-request" });
  assert.equal(JSON.stringify(initial), snapshot);
  const attached = transitionBodyAttachment(initial, validEvent());
  assert.equal(attached.ok, true);
  if (!attached.ok) return;
  const attachedSnapshot = JSON.stringify(attached.attachment);
  transitionBodyAttachment(attached.attachment, { kind: "detach", reason: "world-closed" });
  transitionBodyAttachment(attached.attachment, validEvent());
  assert.equal(JSON.stringify(attached.attachment), attachedSnapshot);
});
