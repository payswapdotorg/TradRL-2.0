/**
 * The W045 founding gate laws — the happy path and every refusal, over
 * REAL imports: real W044 bindings (built through world-agent-runtime's
 * own gates, fixtures.ts, disclosed in-header), the real three-seat
 * world, real W040 registries. Deterministic (A9): the twin laws live
 * in twin.test.ts.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { foundPopulation } from "../population.js";
import { validatePopulation } from "../validate.js";
import type { PopulationError } from "../population.js";
import {
  GRANTED_AT,
  ghostMember,
  populationMembers,
  populationWorldDefinition,
  thaw,
} from "./fixtures.js";

function codesOf(outcome: { readonly ok: boolean; readonly errors?: readonly { readonly code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((entry) => entry.code);
}

test("the happy founding: three proven bindings compose one population", () => {
  const outcome = foundPopulation(populationWorldDefinition(), populationMembers());
  if (!outcome.ok) {
    assert.fail(`expected a founded population, got ${codesOf(outcome).join(", ")}`);
  }
  const population = outcome.population;
  assert.ok(population.populationId.startsWith("pop-"));
  assert.equal(population.kind, "population");
  assert.equal(population.membership.length, 3);
  const ids = population.membership.map((member) => String(member.bindingId));
  assert.deepEqual([...ids].sort(), ids, "the membership is in canonical binding-id order");
  assert.equal(population.lineage.parentPopulationId, null);
  assert.equal(population.lineage.generation, 0);
  assert.deepEqual(population.lineage.origin, { kind: "genesis" });
  assert.equal(population.provenance.foundedAt, GRANTED_AT);
  assert.equal(population.provenance.sealedAt, GRANTED_AT);
  assert.equal(population.provenance.registryFingerprint, null);
  assert.equal(Object.isFrozen(population), true);
  assert.equal(Object.isFrozen(population.membership), true);
  assert.equal(validatePopulation(population).ok, true);
});

test("the founding membership is ordered by binding id, whatever the input order", () => {
  const members = populationMembers();
  const forward = foundPopulation(populationWorldDefinition(), members);
  const backward = foundPopulation(populationWorldDefinition(), [...members].reverse());
  assert.equal(forward.ok, true);
  assert.equal(backward.ok, true);
  assert.deepEqual(forward.population, backward.population);
});

test("founding zero members is refused (empty-membership)", () => {
  const outcome = foundPopulation(populationWorldDefinition(), []);
  assert.equal(outcome.ok, false);
  assert.deepEqual(codesOf(outcome), ["empty-membership"]);
});

test("an unproven member is refused with W044's own errors carried verbatim (invalid-member)", () => {
  const first = populationMembers()[0]!;
  const tampered = thaw(first);
  tampered.provenance = { ...tampered.provenance, planId: "" };
  const outcome = foundPopulation(populationWorldDefinition(), [tampered, ...populationMembers().slice(1)]);
  assert.equal(outcome.ok, false);
  const codes = codesOf(outcome);
  assert.ok(codes.includes("invalid-member"));
  const invalid = (outcome.errors ?? []).find((entry) => entry.code === "invalid-member") as PopulationError;
  assert.ok((invalid.memberErrors ?? []).length > 0, "W044's validation errors ride verbatim");
  assert.ok(String(invalid.bindingId).startsWith("binding-"));
});

test("a member from another scope is refused (scope-mismatch)", () => {
  const first = populationMembers()[0]!;
  const foreign = thaw(first);
  foreign.scope = { ...foreign.scope, worldId: "world-other" };
  const outcome = foundPopulation(populationWorldDefinition(), [foreign]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("scope-mismatch"));
});

test("a member whose slot the world never declared is refused (unknown-member-slot)", () => {
  const outcome = foundPopulation(populationWorldDefinition(), [ghostMember()]);
  assert.equal(outcome.ok, false);
  assert.deepEqual(codesOf(outcome), ["unknown-member-slot"]);
  const slotError = (outcome.errors ?? [])[0]!;
  assert.equal(slotError.participantId, "participant-pop-ghost");
});

test("the same member binding twice is refused (duplicate-member)", () => {
  const members = populationMembers();
  const outcome = foundPopulation(populationWorldDefinition(), [members[0]!, members[0]!, members[1]!]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("duplicate-member"));
});

test("a slot attached to the wrong declared account is refused (unknown-member-slot)", () => {
  const first = populationMembers()[0]!;
  const mismatched = thaw(first);
  if (mismatched.kind === "agent") {
    mismatched.slot = { ...mismatched.slot, accountId: "account-pop-exec-b" };
  }
  const outcome = foundPopulation(populationWorldDefinition(), [mismatched]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("unknown-member-slot"));
});

test("an organization member's seats are slot-checked like agent members", () => {
  const org = populationMembers().find((member) => member.kind === "organization");
  assert.ok(org !== undefined, "the fixtures carry an organization member");
  const tampered = thaw(org);
  if (tampered.kind === "organization") {
    tampered.seats = tampered.seats.map((seat) => ({ ...seat, slot: { ...seat.slot, participantId: "participant-pop-ghost" } }));
  }
  const outcome = foundPopulation(populationWorldDefinition(), [tampered]);
  assert.equal(outcome.ok, false);
  const codes = codesOf(outcome);
  assert.ok(codes.includes("unknown-member-slot") || codes.includes("invalid-member"), `the seat tamper refuses loudly (${codes.join(", ")})`);
});
