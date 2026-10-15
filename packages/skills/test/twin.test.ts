/**
 * The W041 A9 twin tests: same trajectories + same registry ⇒ a
 * deep-equal extraction run with the same canonical ids — batch input
 * order never leaks, registry registration order never leaks (the
 * registry value is canonical), and the documented identity law holds:
 * the skill id does NOT weigh the run, so the same evidence re-extracted
 * against a CHANGED registry value (a fresh run id) yields the SAME
 * skills, byte for byte.
 *
 * Run: pnpm --filter skills test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCapabilityRegistry,
  deprecateCapability,
  registerCapability,
  revokeCapability,
} from "capability-registry";
import { extractSkills } from "../extract.js";
import { registrationFixture, registryFixture, SUBSTRATE_MEANREVERSION } from "./registry.js";
import { fixtureTrajectories } from "./fixtures.js";

/** The fixture registry rebuilt with a DIFFERENT registration order (the same VALUE). */
function reorderedRegistryFixture(): ReturnType<typeof registryFixture> {
  let registry = createCapabilityRegistry(registryFixture().scope);
  const retired = registerCapability(
    registry,
    registrationFixture({ name: "momentum execution (retired)" }),
  );
  assert.equal(retired.ok, true);
  registry = retired.registry;
  const legacy = registerCapability(
    registry,
    registrationFixture({ name: "momentum execution (legacy)" }),
  );
  assert.equal(legacy.ok, true);
  registry = legacy.registry;
  const meanReversion = registerCapability(
    registry,
    registrationFixture({
      name: "mean-reversion execution under stress",
      description: "measured execution quality of the mean-reversion substrate",
      bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
    }),
  );
  assert.equal(meanReversion.ok, true);
  registry = meanReversion.registry;
  const momentum = registerCapability(registry, registrationFixture());
  assert.equal(momentum.ok, true);
  registry = momentum.registry;
  const revoked = revokeCapability(registry, retired.capabilityId, "the measurement regime no longer applies");
  assert.equal(revoked.ok, true);
  registry = revoked.registry;
  const deprecated = deprecateCapability(registry, legacy.capabilityId, "superseded by the re-measured variant");
  assert.equal(deprecated.ok, true);
  return deprecated.registry;
}

test("the twin law: the same batch + the same registry yield a deep-equal run", () => {
  const trajectories = fixtureTrajectories();
  assert.deepEqual(
    extractSkills(trajectories, registryFixture()),
    extractSkills(trajectories, registryFixture()),
  );
});

test("batch input order never leaks into the run value", () => {
  const trajectories = fixtureTrajectories();
  const reversed = [...trajectories].reverse();
  assert.deepEqual(
    extractSkills(reversed, registryFixture()),
    extractSkills(trajectories, registryFixture()),
  );
});

test("registry registration order never leaks (the registry value is canonical)", () => {
  const trajectories = fixtureTrajectories();
  assert.deepEqual(
    extractSkills(trajectories, reorderedRegistryFixture()),
    extractSkills(trajectories, registryFixture()),
  );
});

test("the identity law: the skill id does not weigh the run — a changed registry value yields the same skills", () => {
  const trajectories = fixtureTrajectories();
  const base = extractSkills(trajectories, registryFixture());
  assert.equal(base.ok, true);
  let extended = registryFixture();
  const extra = registerCapability(
    extended,
    registrationFixture({
      name: "mean-reversion execution (extra)",
      description: "measured execution quality of the mean-reversion substrate",
      bearer: { kind: "substrate", substrateId: SUBSTRATE_MEANREVERSION },
    }),
  );
  assert.equal(extra.ok, true);
  extended = extra.registry;
  const grown = extractSkills(trajectories, extended);
  assert.equal(grown.ok, true);
  assert.notEqual(String(grown.run.extractionId), String(base.run.extractionId));
  assert.deepEqual(grown.run.scope, base.run.scope);
  // The identity law: same skill IDS (the id never weighs the run); the
  // fresh run provenance rides as DATA on each record, so the records
  // are compared with the provenance lifted out.
  assert.deepEqual(
    grown.run.skills.map((skill) => String(skill.skillId)),
    base.run.skills.map((skill) => String(skill.skillId)),
  );
  assert.deepEqual(
    grown.run.skills.map((skill) => ({ ...skill, provenance: undefined })),
    base.run.skills.map((skill) => ({ ...skill, provenance: undefined })),
  );
  assert.notEqual(
    String(grown.run.skills[0]!.provenance.extractionId),
    String(base.run.skills[0]!.provenance.extractionId),
  );
});

test("a lifecycle transition is a NEW run: the extraction id weighs the registry fingerprint", () => {
  const trajectories = fixtureTrajectories();
  const before = extractSkills(trajectories, registryFixture());
  assert.equal(before.ok, true);
  let changed = createCapabilityRegistry(registryFixture().scope);
  const momentum = registerCapability(changed, registrationFixture());
  assert.equal(momentum.ok, true);
  changed = momentum.registry;
  const deprecated = deprecateCapability(changed, momentum.capabilityId, "a newer measurement supersedes it");
  assert.equal(deprecated.ok, true);
  const after = extractSkills(trajectories, deprecated.registry);
  assert.equal(after.ok, true);
  assert.equal(after.run.skills.length, 0);
  assert.equal(after.run.refusals[0]!.code, "capability-deprecated");
  assert.notEqual(String(after.run.extractionId), String(before.run.extractionId));
});
