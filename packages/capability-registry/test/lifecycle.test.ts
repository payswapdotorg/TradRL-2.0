/**
 * The W040 lifecycle tests: registered / deprecated / revoked as typed
 * data with IMMUTABLE transitions — the input registry never mutates, a
 * deprecated capability still resolves for lineage, and the transition
 * table (registered → deprecated → revoked; revoked terminal) is
 * enforced loudly.
 *
 * Run: pnpm --filter capability-registry test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, registerCapability } from "../register.js";
import { deprecateCapability, revokeCapability } from "../lifecycle.js";
import { resolveCapability } from "../query.js";
import type { CapabilityId } from "../identity.js";
import { SCOPE, registrationFixture } from "./fixtures.js";

function registered(): { registry: ReturnType<typeof createCapabilityRegistry>; id: CapabilityId } {
  const base = createCapabilityRegistry(SCOPE);
  const outcome = registerCapability(base, registrationFixture());
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    return { registry: outcome.registry, id: outcome.capabilityId };
  }
  return { registry: base, id: "cap-unreachable" as CapabilityId };
}

test("deprecation records the transition immutably and keeps lineage resolution", () => {
  const { registry, id } = registered();
  const outcome = deprecateCapability(registry, id, "superseded by a re-measurement");
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.entry.state, "deprecated");
    assert.deepEqual(outcome.entry.transitions, [
      { to: "deprecated", reason: "superseded by a re-measurement" },
    ]);
    // the descriptor is carried forward untouched:
    const before = resolveCapability(registry, id);
    assert.equal(before.ok, true);
    if (before.ok) {
      assert.deepEqual(outcome.entry.descriptor, before.entry.descriptor);
    }
    // the INPUT registry is untouched (immutability):
    assert.equal(registry.entries[0]?.state, "registered");
    assert.deepEqual(registry.entries[0]?.transitions, []);
    // a deprecated capability still resolves for lineage:
    const after = resolveCapability(outcome.registry, id);
    assert.equal(after.ok, true);
    if (after.ok) {
      assert.equal(after.entry.state, "deprecated");
    }
  }
});

test("the transition table is enforced loudly", () => {
  const { registry, id } = registered();
  const deprecated = deprecateCapability(registry, id, "superseded");
  assert.equal(deprecated.ok, true);
  const target = deprecated.ok ? deprecated.registry : registry;

  const redeprecated = deprecateCapability(target, id, "again");
  assert.equal(redeprecated.ok, false);
  if (!redeprecated.ok) {
    assert.deepEqual(redeprecated.errors.map((error) => error.code), [
      "invalid-lifecycle-transition",
    ]);
  }

  const revoked = revokeCapability(target, id, "the measurement was retracted");
  assert.equal(revoked.ok, true);
  const terminal = revoked.ok ? revoked.registry : target;

  const resurrected = deprecateCapability(terminal, id, "zombie");
  assert.equal(resurrected.ok, false);
  if (!resurrected.ok) {
    assert.deepEqual(resurrected.errors.map((error) => error.code), [
      "invalid-lifecycle-transition",
    ]);
  }
  const rerevoked = revokeCapability(terminal, id, "again");
  assert.equal(rerevoked.ok, false);
  if (!rerevoked.ok) {
    assert.deepEqual(rerevoked.errors.map((error) => error.code), [
      "invalid-lifecycle-transition",
    ]);
  }
});

test("revocation is reachable directly from registered", () => {
  const { registry, id } = registered();
  const outcome = revokeCapability(registry, id, "the experiment was retracted");
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.entry.state, "revoked");
    assert.equal(outcome.entry.transitions.length, 1);
  }
});

test("blank reasons and unknown ids are refused", () => {
  const { registry, id } = registered();
  const blank = deprecateCapability(registry, id, "   ");
  assert.equal(blank.ok, false);
  if (!blank.ok) {
    assert.deepEqual(blank.errors.map((error) => error.code), ["blank-reason"]);
  }
  const unknown = deprecateCapability(registry, "cap-unknown" as CapabilityId, "reason");
  assert.equal(unknown.ok, false);
  if (!unknown.ok) {
    assert.deepEqual(unknown.errors.map((error) => error.code), ["unknown-capability"]);
  }
});

test("lifecycle transitions keep the registry re-validatable", () => {
  const { registry, id } = registered();
  const deprecated = deprecateCapability(registry, id, "superseded");
  assert.equal(deprecated.ok, true);
  const revoked = revokeCapability(
    deprecated.ok ? deprecated.registry : registry,
    id,
    "retracted",
  );
  assert.equal(revoked.ok, true);
  if (revoked.ok) {
    const resolution = resolveCapability(revoked.registry, id);
    assert.equal(resolution.ok, true);
    if (resolution.ok) {
      assert.equal(resolution.entry.state, "revoked");
      assert.deepEqual(resolution.entry.transitions, [
        { to: "deprecated", reason: "superseded" },
        { to: "revoked", reason: "retracted" },
      ]);
    }
  }
});
