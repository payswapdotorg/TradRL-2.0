/**
 * The W041 record tests: the typed DATA an extracted skill IS — carried
 * competence (never re-declared), carried bearer, evidence citations
 * (the demonstrating trajectories + their experiments + the capability's
 * measured provenance VERBATIM), the carry-never-re-score summary (the
 * outcome carries equal the trajectory records' own evaluation + session
 * values, byte for byte), genesis lineage, the run's own provenance, and
 * the canonical orderings of the run.
 *
 * Run: pnpm --filter skills test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { experimentIdOf } from "experiments";
import {
  MOMENTUM_CAPABILITY_ID,
  SCOPE,
  SUBSTRATE_MOMENTUM,
  experimentFixture,
  registryFixture,
} from "./registry.js";
import { extractionFixture, fixtureTrajectories } from "./fixtures.js";

test("the extraction run carries the registry scope and canonical orderings", () => {
  const run = extractionFixture();
  assert.deepEqual(run.scope, SCOPE);
  const skillIds = run.skills.map((skill) => String(skill.skillId));
  assert.deepEqual([...skillIds].sort(), skillIds);
  const refused = run.refusals.map((refusal) => String(refusal.capabilityId));
  assert.deepEqual([...refused].sort(), refused);
});

test("one skill is derived for the demonstrated capability, carried from the registry", () => {
  const run = extractionFixture();
  assert.equal(run.skills.length, 1);
  const skill = run.skills[0]!;
  assert.equal(String(skill.competence.capabilityId), String(MOMENTUM_CAPABILITY_ID));
  assert.equal(skill.competence.name, "momentum execution under stress");
  assert.equal(skill.competence.kind, "execution-quality");
  assert.equal(skill.competence.domain, "futures");
  assert.deepEqual(skill.bearer, { kind: "substrate", substrateId: SUBSTRATE_MOMENTUM });
  assert.deepEqual(skill.scope, SCOPE);
});

test("the evidence cites the demonstrating trajectories, their experiments, and the capability provenance verbatim", () => {
  const run = extractionFixture();
  const skill = run.skills[0]!;
  const expected = fixtureTrajectories()
    .map((record) => String(record.trajectoryId))
    .sort();
  assert.deepEqual(skill.evidence.trajectoryIds.map(String), expected);
  assert.deepEqual(
    skill.evidence.experimentIds.map(String),
    [String(experimentIdOf(experimentFixture()))],
  );
  const entry = registryFixture().entries.find(
    (candidate) => String(candidate.descriptor.capabilityId) === String(MOMENTUM_CAPABILITY_ID),
  );
  assert.ok(entry !== undefined);
  assert.deepEqual(skill.evidence.capabilityProvenance, entry.descriptor.provenance);
});

test("the measured summary CARRIES the records' own outcome data — never re-scored", () => {
  const run = extractionFixture();
  const skill = run.skills[0]!;
  const byId = new Map(
    fixtureTrajectories().map((record) => [String(record.trajectoryId), record]),
  );
  assert.equal(skill.summary.trajectoryCount, skill.evidence.trajectoryIds.length);
  assert.equal(skill.summary.outcomeCarries.length, skill.evidence.trajectoryIds.length);
  for (const carry of skill.summary.outcomeCarries) {
    const record = byId.get(String(carry.trajectoryId));
    assert.ok(record !== undefined);
    assert.equal(carry.policyId, record.evaluation.policyId);
    assert.equal(carry.combinedScore, record.evaluation.combinedScore);
    assert.equal(carry.appliedSoftPenaltyTotal, record.evaluation.appliedSoftPenaltyTotal);
    assert.deepEqual(carry.compliance, record.evaluation.compliance);
    assert.equal(carry.status, record.session.status);
    assert.equal(carry.passCount, record.session.passCount);
    assert.equal(carry.commandsIssued, record.session.commandsIssued);
    assert.equal(carry.acked, record.session.acked);
    assert.equal(carry.rejected, record.session.rejected);
  }
});

test("the outcome carries are in canonical trajectory-id order", () => {
  const skill = extractionFixture().skills[0]!;
  const carryIds = skill.summary.outcomeCarries.map((carry) => String(carry.trajectoryId));
  assert.deepEqual(carryIds, [...carryIds].sort());
});

test("extraction derives genesis lineage", () => {
  const skill = extractionFixture().skills[0]!;
  assert.deepEqual(skill.lineage, { parentSkillId: null, version: 1 });
});

test("the provenance names the run that derived the skill", () => {
  const run = extractionFixture();
  assert.equal(run.skills[0]!.provenance.extractionId, run.extractionId);
});

test("the derived skill record is frozen data (immutable value)", () => {
  assert.equal(Object.isFrozen(extractionFixture().skills[0]), true);
});
