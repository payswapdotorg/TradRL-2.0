/**
 * The whole-record re-validation laws (W046) — re-proving sealed pairing
 * plans from their own recorded data alone (the W045 validatePopulation
 * precedent): identity, cohort partition/coverage, canonical orders,
 * generational laws, substitution shape laws, provenance — every tamper
 * collected.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { composeAdversarial } from "../adversarial.js";
import type { AdversarialPairing } from "../adversarial.js";
import { composeSelfPlay } from "../selfplay.js";
import type { SelfPlayPairing } from "../selfplay.js";
import { validateAdversarialPairing, validateSelfPlayPairing } from "../validate.js";
import type { PairingValidationError } from "../validate.js";
import { ablatedChallenger, challengerPopulation, championPopulation, thaw } from "./fixtures.js";

function selfPlayViolations(pairing: SelfPlayPairing): readonly PairingValidationError[] {
  const proof = validateSelfPlayPairing(pairing);
  if (proof.ok) {
    assert.fail(`expected violations, got ${proof.checked.join(", ")}`);
  }
  return proof.errors;
}

function adversarialViolations(pairing: AdversarialPairing): readonly PairingValidationError[] {
  const proof = validateAdversarialPairing(pairing);
  if (proof.ok) {
    assert.fail(`expected violations, got ${proof.checked.join(", ")}`);
  }
  return proof.errors;
}

function selfPlay(): SelfPlayPairing {
  const outcome = composeSelfPlay(championPopulation(), { kind: "alternate" });
  if (!outcome.ok) {
    assert.fail(`expected a sealed pairing, got ${outcome.errors.map((entry) => entry.code).join(", ")}`);
  }
  return outcome.pairing;
}

function adversarial(ablated = false): AdversarialPairing {
  const outcome = composeAdversarial(championPopulation(), ablated ? ablatedChallenger() : challengerPopulation());
  if (!outcome.ok) {
    assert.fail(`expected a sealed pairing, got ${outcome.errors.map((entry) => entry.code).join(", ")}`);
  }
  return outcome.pairing;
}

test("a valid self-play pairing re-proves with the full checked surface", () => {
  const proof = validateSelfPlayPairing(selfPlay());
  assert.equal(proof.ok, true);
  assert.deepEqual(proof.checked, ["identity", "scope", "cohorts", "coverage", "structure", "provenance"]);
});

test("a valid adversarial pairing re-proves with the full checked surface (both origins)", () => {
  for (const pairing of [adversarial(), adversarial(true)]) {
    const proof = validateAdversarialPairing(pairing);
    assert.equal(proof.ok, true);
    assert.deepEqual(proof.checked, ["identity", "scope", "generations", "substitution", "provenance"]);
  }
});

test("a wrong kind is refused on both records", () => {
  const selfTampered = thaw(selfPlay());
  selfTampered.kind = "not-a-pairing" as never;
  assert.ok(selfPlayViolations(selfTampered).some((entry) => entry.code === "invalid-kind"));
  const adversarialTampered = thaw(adversarial());
  adversarialTampered.kind = "not-a-pairing" as never;
  assert.ok(adversarialViolations(adversarialTampered).some((entry) => entry.code === "invalid-kind"));
});

test("a tampered id is an identity mismatch on both records", () => {
  const selfTampered = thaw(selfPlay());
  selfTampered.pairingId = "selfplay-0000000000000000" as never;
  assert.ok(selfPlayViolations(selfTampered).some((entry) => entry.code === "identity-mismatch"));
  const adversarialTampered = thaw(adversarial());
  adversarialTampered.pairingId = "adversarial-0000000000000000" as never;
  assert.ok(adversarialViolations(adversarialTampered).some((entry) => entry.code === "identity-mismatch"));
});

test("a member moved between cohorts is caught (duplicate + coverage)", () => {
  const tampered = thaw(selfPlay());
  const moved = tampered.cohorts.competing[0]!;
  tampered.cohorts = { cooperating: [...tampered.cohorts.cooperating, moved], competing: tampered.cohorts.competing };
  assert.ok(selfPlayViolations(tampered).some((entry) => entry.code === "duplicate-member"));
});

test("an unsorted cohort is a canonical-order violation", () => {
  const tampered = thaw(selfPlay());
  tampered.cohorts = { cooperating: [...tampered.cohorts.cooperating].reverse(), competing: tampered.cohorts.competing };
  assert.ok(selfPlayViolations(tampered).some((entry) => entry.code === "canonical-order"));
});

test("a structure rewritten into contradiction is caught at re-validation", () => {
  const tampered = thaw(selfPlay());
  tampered.structure = { ...tampered.structure, cooperatingCohort: "competition" };
  assert.ok(selfPlayViolations(tampered).some((entry) => entry.code === "structure-mismatch"));
});

test("a challenger generation rewritten past the champion is a generation mismatch", () => {
  const tampered = thaw(adversarial());
  tampered.challenger = { ...tampered.challenger, generation: tampered.champion.generation + 2 };
  assert.ok(adversarialViolations(tampered).some((entry) => entry.code === "generation-mismatch" && entry.message.includes("GENERATIONAL")));
});

test("a substitution citation outside the W039 operation vocabulary is caught", () => {
  const tampered = thaw(adversarial(true));
  assert.ok(tampered.substitution !== null);
  tampered.substitution = { ...tampered.substitution, operation: "explode-population" as never };
  assert.ok(adversarialViolations(tampered).some((entry) => entry.code === "substitution-invalid" && entry.message.includes("W039 origin operation vocabulary")));
});

test("a blank substitution subject is caught", () => {
  const tampered = thaw(adversarial(true));
  assert.ok(tampered.substitution !== null);
  tampered.substitution = { ...tampered.substitution, subject: "" };
  assert.ok(adversarialViolations(tampered).some((entry) => entry.code === "substitution-invalid"));
});

test("a non-finite provenance seal time is caught on both records", () => {
  const selfTampered = thaw(selfPlay());
  selfTampered.provenance = { populationSealedAt: Number.NaN };
  assert.ok(selfPlayViolations(selfTampered).some((entry) => entry.code === "invalid-provenance"));
  const adversarialTampered = thaw(adversarial());
  adversarialTampered.provenance = { challengerSealedAt: Number.POSITIVE_INFINITY };
  assert.ok(adversarialViolations(adversarialTampered).some((entry) => entry.code === "invalid-provenance"));
});

test("a blank scope member is caught on both records", () => {
  const selfTampered = thaw(selfPlay());
  selfTampered.scope = { ...selfTampered.scope, tenantId: "" };
  assert.ok(selfPlayViolations(selfTampered).some((entry) => entry.code === "invalid-scope"));
  const adversarialTampered = thaw(adversarial());
  adversarialTampered.scope = { ...adversarialTampered.scope, worldId: "" };
  assert.ok(adversarialViolations(adversarialTampered).some((entry) => entry.code === "invalid-scope"));
});
