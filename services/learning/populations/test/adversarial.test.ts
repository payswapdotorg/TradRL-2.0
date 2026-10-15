/**
 * The adversarial composition laws (W046) — REAL imports only: the REAL
 * W045 champion/challenger fixture lineage (the challenger is the
 * champion's REAL next generation through W045's own transition gates).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { composeAdversarial } from "../adversarial.js";
import { substitutionCitationOf } from "../adversarial.js";
import type { AdversarialError, AdversarialOutcome } from "../adversarial.js";
import { ablatedChallenger, challengerPopulation, championPopulation, grandchildPopulation, thaw } from "./fixtures.js";

function refusals(outcome: AdversarialOutcome): readonly AdversarialError[] {
  if (outcome.ok) {
    assert.fail(`expected a refusal, got ${String(outcome.pairing.pairingId)}`);
  }
  return outcome.errors;
}

test("a champion is paired with its direct next generation, content-addressed adversarial- id", () => {
  const outcome = composeAdversarial(championPopulation(), challengerPopulation());
  if (!outcome.ok) {
    assert.fail(`expected a pairing, got ${refusals(outcome).map((entry) => entry.code).join(", ")}`);
  }
  const pairing = outcome.pairing;
  assert.equal(pairing.kind, "adversarial-pairing");
  assert.match(String(pairing.pairingId), /^adversarial-/);
  assert.equal(pairing.champion.populationId, String(championPopulation().populationId));
  assert.equal(pairing.champion.generation, championPopulation().lineage.generation);
  assert.equal(pairing.challenger.populationId, String(challengerPopulation().populationId));
  assert.equal(pairing.challenger.generation, challengerPopulation().lineage.generation);
  assert.equal(pairing.challenger.generation, pairing.champion.generation + 1);
  assert.equal(pairing.substitution, null); // an add-origin challenger substitutes nothing
  assert.equal(pairing.provenance.challengerSealedAt, challengerPopulation().provenance.sealedAt);
  assert.ok(Object.isFrozen(pairing));
});

test("an ablate-origin challenger carries the W039 model-substitution citation verbatim", () => {
  const challenger = ablatedChallenger();
  const outcome = composeAdversarial(championPopulation(), challenger);
  if (!outcome.ok) {
    assert.fail(`expected a pairing, got ${refusals(outcome).map((entry) => entry.code).join(", ")}`);
  }
  const citation = outcome.pairing.substitution;
  assert.ok(citation !== null);
  assert.equal(citation.kind, "model-substitution");
  assert.equal(citation.operation, "substitute-substrate-requirement");
  const origin = challenger.lineage.origin;
  if (origin.kind !== "ablate") {
    assert.fail(`expected an ablate-origin challenger, got ${String(origin.kind)}`);
  }
  assert.equal(citation.subject, String(origin.ablation.subject));
  // the citation is EXACTLY W039's derived-origin shape, carried verbatim
  assert.deepEqual(substitutionCitationOf(challenger), {
    kind: origin.ablation.kind,
    operation: origin.ablation.operation,
    subject: origin.ablation.subject,
  });
});

test("a challenger that is not the champion's direct next generation is refused", () => {
  // the champion paired with itself: same generation, no parent citation
  const outcome = composeAdversarial(championPopulation(), championPopulation());
  assert.ok(!outcome.ok);
  const refusal = refusals(outcome).find((entry) => entry.code === "not-descendant");
  assert.ok(refusal !== undefined);
  assert.match(refusal.message, /GENERATIONAL/);
});

test("a grandchild challenger (two generations on) is refused", () => {
  const challenger = challengerPopulation();
  const grandchild = thaw(challenger);
  grandchild.lineage = {
    ...grandchild.lineage,
    parentPopulationId: challenger.populationId,
    generation: challenger.lineage.generation + 1,
  };
  const outcome = composeAdversarial(championPopulation(), grandchild);
  assert.ok(!outcome.ok);
  assert.ok(refusals(outcome).some((entry) => entry.code === "not-descendant"));
});

test("a grandchild challenger (two generations on) is refused", () => {
  // a REAL generation-2 population: valid, but not the champion's DIRECT next generation
  const outcome = composeAdversarial(championPopulation(), grandchildPopulation());
  assert.ok(!outcome.ok);
  assert.ok(refusals(outcome).some((entry) => entry.code === "not-descendant"));
});

test("a scope-tampered challenger is refused through W045's own validator (carried verbatim, W045 scope law)", () => {
  const challenger = thaw(challengerPopulation());
  challenger.scope = { ...challenger.scope, worldId: "world-not-the-same-one" };
  const outcome = composeAdversarial(championPopulation(), challenger);
  assert.ok(!outcome.ok);
  const refusal = refusals(outcome).find((entry) => entry.code === "invalid-challenger");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.populationErrors !== undefined);
  assert.ok(refusal.populationErrors.some((carried) => carried.code === "scope-mismatch"));
});

test("an invalid champion is refused through W045's own validator, errors carried verbatim", () => {
  const champion = thaw(championPopulation());
  champion.scope = { ...champion.scope, worldId: "" };
  const outcome = composeAdversarial(champion, challengerPopulation());
  assert.ok(!outcome.ok);
  const refusal = refusals(outcome).find((entry) => entry.code === "invalid-champion");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.populationErrors !== undefined && refusal.populationErrors.length > 0);
});

test("an invalid challenger is refused through W045's own validator, errors carried verbatim", () => {
  const challenger = thaw(challengerPopulation());
  challenger.provenance.foundedAt = Number.NaN;
  const outcome = composeAdversarial(championPopulation(), challenger);
  assert.ok(!outcome.ok);
  const refusal = refusals(outcome).find((entry) => entry.code === "invalid-challenger");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.populationErrors !== undefined && refusal.populationErrors.length > 0);
});
