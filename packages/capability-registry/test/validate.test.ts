/**
 * The W040 registry re-validation tests: a valid registry passes with the
 * checked-laws list; every mangled registry value fails LOUDLY with the
 * named law (the W039 mangled-fixture precedent).
 *
 * Run: pnpm --filter capability-registry test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, registerCapability } from "../register.js";
import { validateCapabilityRegistry } from "../validate.js";
import { deprecateCapability } from "../lifecycle.js";
import type { CapabilityKind, CapabilityRegistry, CapabilityState, RegistryEntry } from "../descriptor.js";
import type { CapabilityId } from "../identity.js";
import { SCOPE, SUBSTRATE_MEANREVERSION, evidenceFixture, registrationFixture } from "./fixtures.js";

function buildRegistry(): CapabilityRegistry {
  let registry = createCapabilityRegistry(SCOPE);
  const first = registerCapability(registry, registrationFixture());
  assert.equal(first.ok, true);
  if (first.ok) {
    registry = first.registry;
  }
  const second = registerCapability(registry, registrationFixture({
    name: "mean-reversion information synthesis",
    kind: "information-synthesis",
    bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
    evidence: [evidenceFixture()],
  }));
  assert.equal(second.ok, true);
  if (second.ok) {
    registry = second.registry;
  }
  return registry;
}

function mangle(
  registry: CapabilityRegistry,
  mutate: (entry: RegistryEntry) => RegistryEntry,
): CapabilityRegistry {
  return {
    scope: registry.scope,
    entries: registry.entries.map((entry) => mutate(entry)),
  };
}

test("a valid registry (with a deprecated entry) passes with the checked-laws list", () => {
  const registry = buildRegistry();
  const first = registry.entries[0];
  assert.ok(first !== undefined);
  const deprecated = deprecateCapability(registry, first.descriptor.capabilityId, "superseded by a re-measurement");
  assert.equal(deprecated.ok, true);
  const target = deprecated.ok ? deprecated.registry : registry;
  const outcome = validateCapabilityRegistry(target);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.checked.length >= 10, true);
  }
});

test("an entry outside the closed vocabulary fails loudly", () => {
  const registry = buildRegistry();
  const outcome = validateCapabilityRegistry(
    mangle(registry, (entry) =>
      entry === registry.entries[0]
        ? { ...entry, descriptor: { ...entry.descriptor, kind: "telepathy" as CapabilityKind } }
        : entry,
    ),
  );
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.deepEqual(outcome.errors.map((error) => error.code), ["unknown-capability-kind"]);
  }
});

test("duplicate entry identity fails loudly", () => {
  const registry = buildRegistry();
  const first = registry.entries[0];
  const second = registry.entries[1];
  assert.ok(first !== undefined && second !== undefined);
  const outcome = validateCapabilityRegistry({
    scope: registry.scope,
    entries: [first, second, { ...second }],
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(
      outcome.errors.some((error) => error.code === "duplicate-capability"),
      true,
    );
  }
});

test("non-canonical entry order fails loudly (the A9 registry-value law)", () => {
  const registry = buildRegistry();
  const outcome = validateCapabilityRegistry({
    scope: registry.scope,
    entries: [...registry.entries].reverse(),
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.errors.some((error) => error.code === "non-canonical-order"), true);
  }
});

test("an entry stripped of provenance fails the R052 law loudly", () => {
  const registry = buildRegistry();
  const outcome = validateCapabilityRegistry(
    mangle(registry, (entry) => ({
      ...entry,
      descriptor: { ...entry.descriptor, provenance: [] },
    })),
  );
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(
      outcome.errors.every((error) => error.code === "unmeasured-capability"),
      true,
    );
    assert.equal(outcome.errors.length, registry.entries.length);
    assert.equal(outcome.errors[0]?.message.includes("R052"), true);
  }
});

test("a mangled lifecycle state or transition record fails loudly", () => {
  const registry = buildRegistry();
  const first = registry.entries[0];
  assert.ok(first !== undefined);

  const zombified = validateCapabilityRegistry(
    mangle(registry, (entry) => ({ ...entry, state: "zombie" as CapabilityState })),
  );
  assert.equal(zombified.ok, false);
  if (!zombified.ok) {
    assert.equal(zombified.errors.some((error) => error.code === "unknown-capability-state"), true);
  }

  const unrecorded = validateCapabilityRegistry(
    mangle(registry, (entry) => ({
      ...entry,
      state: "deprecated",
      transitions: [], // the state without its transition record
    })),
  );
  assert.equal(unrecorded.ok, false);
  if (!unrecorded.ok) {
    assert.equal(
      unrecorded.errors.some((error) => error.code === "invalid-lifecycle-transition"),
      true,
    );
  }

  const blanked = validateCapabilityRegistry(
    mangle(registry, (entry) => ({
      ...entry,
      state: "deprecated",
      transitions: [{ to: "deprecated", reason: "  " }],
    })),
  );
  assert.equal(blanked.ok, false);
  if (!blanked.ok) {
    assert.equal(blanked.errors.some((error) => error.code === "blank-reason"), true);
  }
});

test("a lineage chain with a missing or skipping parent fails loudly", () => {
  const registry = buildRegistry();
  const orphan = mangle(registry, (entry) => ({
    ...entry,
    descriptor: {
      ...entry.descriptor,
      lineage: { parentCapabilityId: "cap-vanished" as CapabilityId, version: 2 },
    },
  }));
  const outcome = validateCapabilityRegistry(orphan);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(
      outcome.errors.some((error) => error.code === "lineage-break"),
      true,
    );
  }

  // self-citation: version continuity can never hold
  const selfParent = mangle(registry, (entry) => ({
    ...entry,
    descriptor: {
      ...entry.descriptor,
      lineage: { parentCapabilityId: entry.descriptor.capabilityId, version: 2 },
    },
  }));
  const selfOutcome = validateCapabilityRegistry(selfParent);
  assert.equal(selfOutcome.ok, false);
  if (!selfOutcome.ok) {
    assert.equal(
      selfOutcome.errors.some((error) => error.code === "lineage-break"),
      true,
    );
  }
});
