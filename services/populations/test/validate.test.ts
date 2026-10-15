/**
 * The W045 whole-population re-validation laws — the clean pass and
 * every tamper law, over REAL records: identity re-derivation, the
 * canonical membership laws, the W044 member re-proof (errors carried
 * verbatim), the CARRY law (the recorded view must deep-equal the pure
 * projection), the lineage laws, the provenance laws.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { foundPopulation } from "../population.js";
import { addMembers, retireMembers } from "../transitions.js";
import { validatePopulation } from "../validate.js";
import type { Population } from "../population.js";
import {
  additionMember,
  populationMembers,
  populationWorldDefinition,
  registryFixture,
  thaw,
} from "./fixtures.js";

function codesOf(outcome: { readonly ok: boolean; readonly errors?: readonly { readonly code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((entry) => entry.code);
}

function founded(): Population {
  const outcome = foundPopulation(populationWorldDefinition(), populationMembers());
  if (!outcome.ok) {
    assert.fail(`fixture founding failed (${codesOf(outcome).join(", ")})`);
  }
  return outcome.population;
}

test("a clean genesis population re-validates from recorded data alone", () => {
  const validation = validatePopulation(founded());
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.deepEqual(validation.checked, ["identity", "membership", "member-bindings", "scope", "view-carry", "lineage", "provenance"]);
  }
});

test("a clean derived generation re-validates from recorded data alone", () => {
  const outcome = addMembers(founded(), registryFixture(), [additionMember()]);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(validatePopulation(outcome.population).ok, true);
  }
});

test("an id tamper is refused (identity-mismatch)", () => {
  const tampered = thaw(founded());
  tampered.populationId = "pop-deadbeef" as Population["populationId"];
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.deepEqual(codesOf(validation), ["identity-mismatch"]);
});

test("a drifted carried view is refused (view-mismatch — the carry law)", () => {
  const tampered = thaw(founded());
  tampered.view = { ...tampered.view, census: { ...tampered.view.census, memberCount: 999 } };
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.deepEqual(codesOf(validation), ["view-mismatch"]);
});

test("a reordered membership is refused (membership-order)", () => {
  const tampered = thaw(founded());
  tampered.membership = [...tampered.membership].reverse();
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("membership-order"));
});

test("a duplicated membership is refused (duplicate-member)", () => {
  const genesis = founded();
  const tampered = thaw(genesis);
  tampered.membership = [...tampered.membership, tampered.membership[0]!];
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("duplicate-member"));
});

test("a tampered member is refused with W044's own errors carried verbatim (invalid-member)", () => {
  const tampered = thaw(founded());
  const member = thaw(tampered.membership[0]!);
  member.provenance = { ...member.provenance, planId: "" };
  tampered.membership = [member, ...tampered.membership.slice(1)];
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-member"));
});

test("a member from another scope is refused (scope-mismatch)", () => {
  const tampered = thaw(founded());
  const member = thaw(tampered.membership[0]!);
  member.scope = { ...member.scope, projectId: "project-other" };
  tampered.membership = [member, ...tampered.membership.slice(1)];
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("scope-mismatch"));
});

test("a blank population scope is refused (invalid-scope)", () => {
  const tampered = thaw(founded());
  tampered.scope = { ...tampered.scope, worldId: "  " };
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-scope"));
});

test("a genesis record with a parent is refused (lineage-invalid)", () => {
  const tampered = thaw(founded());
  tampered.lineage = { ...tampered.lineage, parentPopulationId: "pop-other" as Population["lineage"]["parentPopulationId"] };
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("lineage-invalid"));
});

test("a derived record without a parent is refused (lineage-invalid)", () => {
  const outcome = addMembers(founded(), registryFixture(), [additionMember()]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const tampered = thaw(outcome.population);
  tampered.lineage = { ...tampered.lineage, parentPopulationId: null };
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("lineage-invalid"));
});

test("an add-origin that records nobody is refused (lineage-invalid)", () => {
  const outcome = addMembers(founded(), registryFixture(), [additionMember()]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const tampered = thaw(outcome.population);
  if (tampered.lineage.origin.kind === "add") {
    tampered.lineage = { ...tampered.lineage, origin: { kind: "add", addedMemberIds: [] } };
  }
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("lineage-invalid"));
});

test("a retire-origin with a blank reason is refused (lineage-invalid)", () => {
  const genesis = founded();
  const memberId = genesis.membership.map((member) => String(member.bindingId)).sort()[0]!;
  const outcome = retireMembers(genesis, registryFixture(), [{ memberId, reason: "rotation" }]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const tampered = thaw(outcome.population);
  if (tampered.lineage.origin.kind === "retire") {
    tampered.lineage = { ...tampered.lineage, origin: { kind: "retire", retirements: [{ memberId, reason: "" }] } };
  }
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("lineage-invalid"));
});

test("a wrong seal time is refused (invalid-provenance)", () => {
  const tampered = thaw(founded());
  tampered.provenance = { ...tampered.provenance, sealedAt: 1 };
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.deepEqual(codesOf(validation), ["invalid-provenance"]);
});

test("a genesis record claiming a registry fingerprint is refused (invalid-provenance)", () => {
  const tampered = thaw(founded());
  tampered.provenance = { ...tampered.provenance, registryFingerprint: "fingerprint-ghost" };
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-provenance"));
});

test("a derived record without a registry fingerprint is refused (invalid-provenance)", () => {
  const outcome = addMembers(founded(), registryFixture(), [additionMember()]);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) {
    return;
  }
  const tampered = thaw(outcome.population);
  tampered.provenance = { ...tampered.provenance, registryFingerprint: null };
  const validation = validatePopulation(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-provenance"));
});
