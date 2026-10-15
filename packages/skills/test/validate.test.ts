/**
 * The W041 re-validation tests: validateSkillRecord / validateSkillSet
 * re-prove the skill laws from the RECORDED data — the closed W040
 * vocabularies, the blank laws, R052 evidence-presence (the headline:
 * `unmeasured-capability` names the law), the citation laws, the
 * canonical order laws, the summary-evidence carry law, the lineage shape
 * and chain laws, the collection laws (duplicates, single scope), and the
 * identity law (the id IS the canonical derivation of the record's own
 * content — re-derived through canonicalSkillProjectionOf).
 *
 * Run: pnpm --filter skills test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalSkillProjectionOf, validateSkillRecord, validateSkillSet } from "../validate.js";
import { skillIdOf } from "../identity.js";
import type { SkillId } from "../identity.js";
import type { SkillRecord } from "../record.js";
import { extractionFixture } from "./fixtures.js";

function extractedSkill(): SkillRecord {
  return extractionFixture().skills[0]!;
}

function codesOf(outcome: { readonly errors: readonly { readonly code: string }[] }): string[] {
  return outcome.errors.map((error) => error.code);
}

test("an extracted skill re-validates clean, with every law named as checked", () => {
  const outcome = validateSkillRecord(extractedSkill());
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.checked, [
    "scope",
    "competence-vocabulary",
    "bearer",
    "evidence-presence",
    "evidence-citations",
    "canonical-order",
    "summary-agreement",
    "lineage-shape",
    "provenance",
    "identity",
  ]);
});

test("the identity law round-trips: the id is the canonical derivation of the record's own content", () => {
  const skill = extractedSkill();
  assert.deepEqual(skillIdOf(canonicalSkillProjectionOf(skill)), skill.skillId);
});

test("R052: a skill with no trajectory evidence is REJECTED with the law named", () => {
  const skill = extractedSkill();
  const mangled: SkillRecord = {
    ...skill,
    evidence: { ...skill.evidence, trajectoryIds: [] },
    summary: { outcomeCarries: [], trajectoryCount: 0 },
  };
  const outcome = validateSkillRecord(mangled);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("unmeasured-capability"));
  const headline = outcome.errors.find((error) => error.code === "unmeasured-capability");
  assert.ok(headline !== undefined);
  assert.match(headline.message, /R052/);
  assert.match(headline.message, /EMPIRICAL/);
});

test("a tampered id is refused: identity is a function of the measured evidence bytes", () => {
  const skill = extractedSkill();
  const mangled: SkillRecord = { ...skill, skillId: "skill-deadbeef" as SkillId };
  const outcome = validateSkillRecord(mangled);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("skill-id-mismatch"));
});

test("a competence kind outside the W040 closed vocabulary is refused", () => {
  const skill = extractedSkill();
  const mangled = { ...skill, competence: { ...skill.competence, kind: "not-a-kind" } };
  const outcome = validateSkillRecord(mangled as SkillRecord);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("unknown-capability-kind"));
});

test("a blank bearer id is refused (the bearer dimension is explicit)", () => {
  const skill = extractedSkill();
  const mangled = {
    ...skill,
    bearer: { kind: "substrate", substrateId: "" } as SkillRecord["bearer"],
  };
  const outcome = validateSkillRecord(mangled);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("blank-bearer-id"));
});

test("a blank scope member is refused (scope is explicit, never blank)", () => {
  const skill = extractedSkill();
  const mangled: SkillRecord = { ...skill, scope: { ...skill.scope, worldId: "" } };
  const outcome = validateSkillRecord(mangled);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("blank-scope-member"));
});

test("evidence cited out of canonical order is refused (declaration order never leaks)", () => {
  const skill = extractedSkill();
  const reversed = [...skill.evidence.trajectoryIds].reverse();
  const mangled: SkillRecord = {
    ...skill,
    evidence: { ...skill.evidence, trajectoryIds: reversed },
  };
  const outcome = validateSkillRecord(mangled);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("non-canonical-order"));
});

test("a summary that disagrees with the evidence is refused (the carry law)", () => {
  const skill = extractedSkill();
  const mangled: SkillRecord = {
    ...skill,
    summary: { outcomeCarries: skill.summary.outcomeCarries.slice(1), trajectoryCount: skill.summary.trajectoryCount },
  };
  const outcome = validateSkillRecord(mangled);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("summary-evidence-mismatch"));
});

test("lineage shape laws: version 0, a parented genesis, and a parentless successor are all refused", () => {
  const skill = extractedSkill();
  const zero = { ...skill, lineage: { parentSkillId: null, version: 0 } };
  const parented = { ...skill, lineage: { parentSkillId: skill.skillId, version: 1 } };
  const parentless = { ...skill, lineage: { parentSkillId: null, version: 2 } };
  for (const mangled of [zero, parented, parentless]) {
    const outcome = validateSkillRecord(mangled as SkillRecord);
    assert.equal(outcome.ok, false);
    assert.ok(codesOf(outcome).includes("invalid-lineage"));
  }
});

test("a blank provenance is refused (WHICH run derived the skill is explicit)", () => {
  const skill = extractedSkill();
  const mangled = {
    ...skill,
    provenance: { extractionId: "" as SkillRecord["provenance"]["extractionId"] },
  };
  const outcome = validateSkillRecord(mangled);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("blank-provenance"));
});

test("the collection laws: a valid run's skill set re-validates clean", () => {
  const run = extractionFixture();
  const outcome = validateSkillSet(run.skills);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.checked, ["record-laws", "duplicate-identity", "single-scope", "lineage-chain"]);
});

test("a duplicate skill id in a collection is refused", () => {
  const skill = extractedSkill();
  const outcome = validateSkillSet([skill, skill]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("duplicate-skill"));
});

test("a collection whose scopes disagree is refused", () => {
  const skill = extractedSkill();
  const foreign: SkillRecord = { ...skill, scope: { ...skill.scope, worldId: "world-skill-other" } };
  const outcome = validateSkillSet([skill, foreign]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("scope-mismatch"));
});

test("a successor citing a parent outside the collection is a lineage break", () => {
  const skill = extractedSkill();
  const successor: SkillRecord = {
    ...skill,
    lineage: { parentSkillId: "skill-missing" as SkillId, version: 2 },
  };
  const outcome = validateSkillSet([skill, successor]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("lineage-break"));
});
