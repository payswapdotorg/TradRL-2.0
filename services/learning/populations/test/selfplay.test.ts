/**
 * The self-play composition laws (W046) — REAL imports only: the REAL W045
 * population fixture lineage. Every composition law gets its own probe.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { composeSelfPlay } from "../selfplay.js";
import type { SelfPlayError, SelfPlayOutcome } from "../selfplay.js";
import { championMemberIds, championPopulation, thaw } from "./fixtures.js";

function refusals(outcome: SelfPlayOutcome): readonly SelfPlayError[] {
  if (outcome.ok) {
    assert.fail(`expected a refusal, got ${String(outcome.pairing.pairingId)}`);
  }
  return outcome.errors;
}

test("the alternate split pairs the canonical member order into both cohorts", () => {
  const outcome = composeSelfPlay(championPopulation(), { kind: "alternate" });
  if (!outcome.ok) {
    assert.fail(`expected a pairing, got ${refusals(outcome).map((entry) => entry.code).join(", ")}`);
  }
  const pairing = outcome.pairing;
  assert.equal(pairing.kind, "self-play-pairing");
  assert.match(String(pairing.pairingId), /^selfplay-/);
  assert.equal(pairing.memberCount, 3);
  const ids = championMemberIds();
  assert.deepEqual(pairing.cohorts.cooperating, [ids[0]!, ids[2]!]);
  assert.deepEqual(pairing.cohorts.competing, [ids[1]!]);
  assert.deepEqual(pairing.structure, {
    cooperatingCohort: "cooperation",
    competingCohort: "competition",
    acrossCohorts: "competition",
  });
  assert.equal(pairing.generation, championPopulation().lineage.generation);
  assert.equal(pairing.provenance.populationSealedAt, championPopulation().provenance.sealedAt);
  assert.ok(Object.isFrozen(pairing));
  assert.ok(Object.isFrozen(pairing.cohorts));
});

test("the explicit split declares the partition outright and canonicalizes it", () => {
  const ids = championMemberIds();
  const outcome = composeSelfPlay(championPopulation(), {
    kind: "explicit",
    cooperating: [ids[1]!, ids[0]!],
    competing: [ids[2]!],
  });
  if (!outcome.ok) {
    assert.fail("expected a pairing");
  }
  assert.deepEqual(outcome.pairing.cohorts.cooperating, [ids[0]!, ids[1]!]);
  assert.deepEqual(outcome.pairing.cohorts.competing, [ids[2]!]);
});

test("an explicit split that misses a member is refused (a partition covers the whole membership)", () => {
  const ids = championMemberIds();
  const outcome = composeSelfPlay(championPopulation(), {
    kind: "explicit",
    cooperating: [ids[0]!],
    competing: [ids[1]!],
  });
  assert.ok(!outcome.ok);
  assert.ok(refusals(outcome).some((entry) => entry.code === "cohort-coverage" && entry.message.includes("WHOLE membership")));
});

test("an explicit split that doubles a member into both cohorts is refused", () => {
  const ids = championMemberIds();
  const outcome = composeSelfPlay(championPopulation(), {
    kind: "explicit",
    cooperating: [ids[0]!, ids[1]!, ids[2]!],
    competing: [ids[0]!],
  });
  assert.ok(!outcome.ok);
  assert.ok(refusals(outcome).some((entry) => entry.code === "duplicate-member"));
});

test("an explicit split naming a member the population does not carry is refused", () => {
  const ids = championMemberIds();
  const outcome = composeSelfPlay(championPopulation(), {
    kind: "explicit",
    cooperating: [ids[0]!, "binding-ghost"],
    competing: [ids[1]!, ids[2]!],
  });
  assert.ok(!outcome.ok);
  assert.ok(refusals(outcome).some((entry) => entry.code === "unknown-member" && entry.message.includes("binding-ghost")));
});

test("a structure that contradicts the roles is refused", () => {
  const outcome = composeSelfPlay(championPopulation(), { kind: "alternate" }, {
    cooperatingCohort: "competition",
    competingCohort: "competition",
    acrossCohorts: "competition",
  });
  assert.ok(!outcome.ok);
  assert.ok(refusals(outcome).some((entry) => entry.code === "structure-mismatch" && entry.message.includes("cooperating cohort's cohesion IS cooperation")));
});

test("a structure where the cohorts do not meet in competition is refused", () => {
  const outcome = composeSelfPlay(championPopulation(), { kind: "alternate" }, {
    cooperatingCohort: "cooperation",
    competingCohort: "cooperation",
    acrossCohorts: "cooperation" as never,
  });
  assert.ok(!outcome.ok);
  assert.ok(refusals(outcome).some((entry) => entry.code === "structure-mismatch" && entry.message.includes("MEETING in competition")));
});

test("an invalid population is refused through W045's own validator, errors carried verbatim", () => {
  const tampered = thaw(championPopulation());
  tampered.provenance.sealedAt = tampered.provenance.sealedAt + 1;
  const outcome = composeSelfPlay(tampered, { kind: "alternate" });
  assert.ok(!outcome.ok);
  const refusal = refusals(outcome).find((entry) => entry.code === "invalid-population");
  assert.ok(refusal !== undefined);
  assert.ok(refusal.populationErrors !== undefined && refusal.populationErrors.length > 0);
});
