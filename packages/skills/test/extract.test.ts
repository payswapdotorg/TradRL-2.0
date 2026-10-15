/**
 * The W041 extraction-gate tests: the pure walk (one skill per REGISTERED
 * measured capability the batch demonstrates), R052 enforced structurally
 * (no trajectory evidence ⇒ NO skill — the loud typed refusal names the
 * law), the W040 lifecycle carried loudly (deprecated/revoked derive
 * nothing), the demonstrating binding (experiment citation AND bearer
 * naming, both structural), and the fail-closed input gates (malformed
 * trajectories, scope mismatch, duplicates, an invalid registry — every
 * upstream error carried verbatim, nothing extracted).
 *
 * Run: pnpm --filter skills test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCapabilityRegistry,
  registerCapability,
} from "capability-registry";
import type { CapabilityRegistration } from "capability-registry";
import { extractSkills, registryFingerprintOf } from "../extract.js";
import type { TrajectoryRecord } from "trajectory";
import {
  MOMENTUM_CAPABILITY_ID,
  SCOPE,
  evaluationFixture,
  experimentFixture,
  findingsFixture,
  registrationFixture,
  registryFixture,
} from "./registry.js";
import { extractionFixture, fixtureTrajectories, foreignWorldTrajectory } from "./fixtures.js";

function refusalCodesOf(): Record<string, string> {
  const run = extractionFixture();
  const codes: Record<string, string> = {};
  for (const refusal of run.refusals) {
    codes[String(refusal.capabilityId)] = refusal.code;
  }
  return codes;
}

test("the walk derives one skill per demonstrated registered capability and refuses the rest loudly", () => {
  const run = extractionFixture();
  assert.equal(run.skills.length, 1);
  assert.equal(String(run.skills[0]!.competence.capabilityId), String(MOMENTUM_CAPABILITY_ID));
  const codes = refusalCodesOf();
  const expected = Object.keys(codes).length;
  assert.equal(expected, 3);
  for (const [capabilityId, code] of Object.entries(codes)) {
    assert.equal(
      code === "no-trajectory-evidence" || code === "capability-deprecated" || code === "capability-revoked",
      true,
      `unexpected refusal code '${code}' for '${capabilityId}'`,
    );
  }
});

test("R052: an empty batch derives NO skill — every registered capability refused with the law named", () => {
  const outcome = extractSkills([], registryFixture());
  assert.equal(outcome.ok, true);
  assert.equal(outcome.run.skills.length, 0);
  const noEvidence = outcome.run.refusals.filter((refusal) => refusal.code === "no-trajectory-evidence");
  assert.equal(noEvidence.length, 2);
  const momentum = noEvidence.find(
    (refusal) => String(refusal.capabilityId) === String(MOMENTUM_CAPABILITY_ID),
  );
  assert.ok(momentum !== undefined);
  assert.match(momentum.message, /R052/);
  assert.match(momentum.message, /EMPIRICAL/);
});

test("R052: a batch that demonstrates nothing for a capability refuses THAT capability (the mean-reversion bearer never acted)", () => {
  const run = extractionFixture();
  const meanReversion = run.refusals.find(
    (refusal) => refusal.code === "no-trajectory-evidence" && refusal.message.includes("mean-reversion"),
  );
  assert.ok(meanReversion !== undefined);
  assert.match(meanReversion.message, /R052/);
});

test("the W040 lifecycle is carried loudly: deprecated and revoked capabilities derive nothing", () => {
  const run = extractionFixture();
  const deprecated = run.refusals.find((refusal) => refusal.code === "capability-deprecated");
  const revoked = run.refusals.find((refusal) => refusal.code === "capability-revoked");
  assert.ok(deprecated !== undefined);
  assert.ok(revoked !== undefined);
  assert.match(deprecated.message, /DEPRECATED/);
  assert.match(revoked.message, /REVOKED/);
});

test("the demonstrating binding is structural: a trajectory from an experiment the capability does NOT cite demonstrates nothing", () => {
  const experiment = experimentFixture({ name: "exp-skill-other" });
  const evaluation = evaluationFixture(experiment);
  const findings = findingsFixture(String(evaluation.evaluationId));
  const registration: CapabilityRegistration = registrationFixture({
    name: "momentum execution (other experiment)",
    evidence: [{ experiment, evaluation, findings }],
  });
  let registry = createCapabilityRegistry(SCOPE);
  const registered = registerCapability(registry, registration);
  assert.equal(registered.ok, true);
  registry = registered.registry;
  const outcome = extractSkills(fixtureTrajectories(), registry);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.run.skills.length, 0);
  assert.equal(outcome.run.refusals[0]!.code, "no-trajectory-evidence");
});

test("a malformed trajectory is refused with W037's own errors carried verbatim", () => {
  const record = fixtureTrajectories()[0]!;
  const mangled: TrajectoryRecord = {
    ...record,
    scope: { ...record.scope, worldId: "" },
  };
  const outcome = extractSkills([mangled], registryFixture());
  assert.equal(outcome.ok, false);
  const malformed = outcome.errors.find((error) => error.code === "malformed-trajectory");
  assert.ok(malformed !== undefined);
  assert.ok(malformed.trajectoryErrors !== undefined && malformed.trajectoryErrors.length > 0);
  assert.match(malformed.message, /W037/);
});

test("a trajectory measured in another scope is refused (skills are extracted WHERE measured)", () => {
  const outcome = extractSkills([foreignWorldTrajectory("session-skill-foreign")], registryFixture());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0]!.code, "trajectory-scope-mismatch");
});

test("a duplicate trajectory in the batch is refused (duplicate-free input by law)", () => {
  const trajectories = fixtureTrajectories();
  const first = trajectories[0]!;
  const second = trajectories[1]!;
  const outcome = extractSkills([first, second, first], registryFixture());
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errors[0]!.code, "duplicate-trajectory");
});

test("an invalid registry is refused with W040's own errors carried verbatim, nothing extracted", () => {
  const registry = registryFixture();
  const mangled = {
    ...registry,
    entries: registry.entries.map((entry) => ({
      ...entry,
      descriptor: { ...entry.descriptor, name: "" },
    })),
  };
  const outcome = extractSkills(fixtureTrajectories(), mangled);
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "registry-invalid");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.registryErrors !== undefined && invalid.registryErrors.length > 0);
});

test("the registry fingerprint is deterministic and weighs the registry VALUE (lifecycle included)", () => {
  assert.equal(registryFingerprintOf(registryFixture()), registryFingerprintOf(registryFixture()));
  const sparse = createCapabilityRegistry(SCOPE);
  assert.notEqual(registryFingerprintOf(sparse), registryFingerprintOf(registryFixture()));
});

test("every registered capability resolves to exactly one derivation outcome (skill or refusal — never a silent drop)", () => {
  const run = extractionFixture();
  assert.equal(run.skills.length + run.refusals.length, registryFixture().entries.length);
});
