/**
 * The W040 A9 twin tests: same registrations (in ANY order) ⇒
 * deep-equal registry with the same canonical ids; the whole registry
 * value is a pure deterministic function of its inputs — no clocks, no
 * randomness, no env reads.
 *
 * Run: pnpm --filter capability-registry test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry, registerCapability } from "../register.js";
import type { CapabilityRegistration } from "../register.js";
import { deprecateCapability } from "../lifecycle.js";
import { capabilityIdOf, canonicalRegistration } from "../index.js";
import { SCOPE, SUBSTRATE_MEANREVERSION, evidenceFixture, registrationFixture } from "./fixtures.js";

function twoIndependentRegistrations(): readonly CapabilityRegistration[] {
  return [
    registrationFixture(),
    registrationFixture({
      name: "mean-reversion information synthesis",
      kind: "information-synthesis",
      bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
      evidence: [evidenceFixture()],
    }),
  ];
}

function registerAll(
  registrations: readonly CapabilityRegistration[],
): ReturnType<typeof createCapabilityRegistry> {
  let registry = createCapabilityRegistry(SCOPE);
  for (const registration of registrations) {
    const outcome = registerCapability(registry, registration);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      registry = outcome.registry;
    }
  }
  return registry;
}

test("the twin law: same registrations ⇒ deep-equal registry, same ids", () => {
  const left = registerAll(twoIndependentRegistrations());
  const right = registerAll(twoIndependentRegistrations());
  assert.deepStrictEqual(left, right);
  assert.deepEqual(
    left.entries.map((entry) => String(entry.descriptor.capabilityId)),
    right.entries.map((entry) => String(entry.descriptor.capabilityId)),
  );
});

test("registration order never leaks into the registry value", () => {
  const forward = registerAll(twoIndependentRegistrations());
  const [first, second] = twoIndependentRegistrations();
  assert.ok(first !== undefined && second !== undefined);
  const backward = registerAll([second, first]);
  assert.deepStrictEqual(forward, backward);
});

test("the twin law holds through a derived lineage and a lifecycle transition", () => {
  function build(): ReturnType<typeof createCapabilityRegistry> {
    const parent = registerCapability(createCapabilityRegistry(SCOPE), registrationFixture());
    assert.equal(parent.ok, true);
    let registry = parent.ok ? parent.registry : createCapabilityRegistry(SCOPE);
    const parentId = parent.ok ? parent.capabilityId : ("cap-none" as ReturnType<typeof capabilityIdOf>);
    const successor = registerCapability(registry, registrationFixture({
      name: "momentum execution, re-measured",
      lineage: { parentCapabilityId: parentId, version: 2 },
      evidence: [evidenceFixture()],
    }));
    assert.equal(successor.ok, true);
    if (successor.ok) {
      registry = successor.registry;
    }
    const deprecated = deprecateCapability(
      registry,
      parentId,
      "superseded by the re-measurement",
    );
    assert.equal(deprecated.ok, true);
    return deprecated.ok ? deprecated.registry : registry;
  }

  assert.deepStrictEqual(build(), build());
});

test("the capability id is a pure function of the canonical registration (twin ids)", () => {
  const registration = registrationFixture();
  const first = capabilityIdOf(canonicalRegistration(registration));
  const second = capabilityIdOf(
    canonicalRegistration(
      registrationFixture({
        providesOrganizationCapabilityIds: [
          ...registration.providesOrganizationCapabilityIds,
        ].reverse(),
      }),
    ),
  );
  assert.deepEqual(first, second);
});
