/**
 * The W045 transition gate laws — the happy paths (add / retire /
 * ablate) and every refusal law, over REAL imports: real W044 bindings,
 * real W040 registries including the deprecated/revoked momentum
 * variants (the dead-endowment refusals), the real three-seat world
 * (fixtures.ts, disclosed in-header).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { addMembers, ablateMembers, retireMembers } from "../transitions.js";
import { foundPopulation } from "../population.js";
import type { Population } from "../population.js";
import type { PopulationTransitionError } from "../transitions.js";
import {
  ORG_POSITION,
  additionMember,
  deprecatedMomentumRegistry,
  populationMembers,
  populationWorldDefinition,
  registryFixture,
  revokedMomentumRegistry,
  thaw,
} from "./fixtures.js";
import { validateCapabilityRegistry } from "capability-registry";

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

function memberIds(population: Population): string[] {
  return population.membership.map((member) => String(member.bindingId));
}

test("the happy add: a new proven member joins and a NEW generation is sealed", () => {
  const genesis = founded();
  const addition = additionMember();
  const outcome = addMembers(genesis, registryFixture(), [addition]);
  if (!outcome.ok) {
    assert.fail(`expected a sealed generation, got ${codesOf(outcome).join(", ")}`);
  }
  const next = outcome.population;
  assert.equal(next.lineage.generation, 1);
  assert.equal(String(next.lineage.parentPopulationId), String(genesis.populationId));
  assert.equal(next.membership.length, 4);
  assert.ok(memberIds(next).includes(String(addition.bindingId)));
  assert.deepEqual(next.lineage.origin, { kind: "add", addedMemberIds: [String(addition.bindingId)] });
  assert.ok(next.populationId !== genesis.populationId);
  assert.notEqual(String(next.populationId), String(genesis.populationId));
  assert.ok(next.provenance.registryFingerprint !== null);
  assert.equal(next.scope.worldId, genesis.scope.worldId);
});

test("the parent generation is never mutated in place (generational immutability)", () => {
  const genesis = founded();
  const snapshot = thaw(genesis);
  const outcome = addMembers(genesis, registryFixture(), [additionMember()]);
  assert.equal(outcome.ok, true);
  assert.deepEqual(genesis, snapshot, "the parent record is unchanged");
  assert.equal(genesis.lineage.generation, 0);
  assert.deepEqual(genesis.membership.map((member) => String(member.bindingId)), snapshot.membership.map((member) => String(member.bindingId)));
});

test("the happy retire: members leave, cited by id with reasons as DATA", () => {
  const genesis = founded();
  const leaving = memberIds(genesis).slice(0, 2);
  const outcome = retireMembers(genesis, registryFixture(), leaving.map((memberId) => ({ memberId, reason: "the curriculum rotation retires the seat" })));
  if (!outcome.ok) {
    assert.fail(`expected a sealed generation, got ${codesOf(outcome).join(", ")}`);
  }
  const next = outcome.population;
  assert.equal(next.membership.length, 1);
  assert.equal(next.lineage.generation, 1);
  assert.equal(next.lineage.origin.kind, "retire");
  if (next.lineage.origin.kind === "retire") {
    assert.deepEqual(
      next.lineage.origin.retirements.map((retirement) => retirement.memberId),
      [...leaving].sort(),
    );
    assert.ok(next.lineage.origin.retirements.every((retirement) => retirement.reason === "the curriculum rotation retires the seat"));
  }
});

test("the happy ablate: the retirement cites the W039 axis vocabulary", () => {
  const genesis = founded();
  const orgMember = genesis.membership.find((member) => member.kind === "organization");
  assert.ok(orgMember !== undefined);
  const outcome = ablateMembers(genesis, registryFixture(), {
    ablation: { kind: "organization", operation: "remove-position", subject: ORG_POSITION },
    retirements: [{ memberId: String(orgMember.bindingId), reason: "the position was ablated away (W039 remove-position)" }],
  });
  if (!outcome.ok) {
    assert.fail(`expected a sealed generation, got ${codesOf(outcome).join(", ")}`);
  }
  const next = outcome.population;
  assert.equal(next.lineage.origin.kind, "ablate");
  if (next.lineage.origin.kind === "ablate") {
    assert.deepEqual(next.lineage.origin.ablation, { kind: "organization", operation: "remove-position", subject: ORG_POSITION });
    assert.equal(next.lineage.origin.retirements.length, 1);
  }
  assert.equal(next.membership.length, 2);
});

test("a broken parent generation refuses every transition (parent-invalid, carried verbatim)", () => {
  const genesis = founded();
  const broken = thaw(genesis);
  broken.view = { ...broken.view, census: { ...broken.view.census, memberCount: 999 } };
  const outcome = addMembers(broken, registryFixture(), [additionMember()]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("parent-invalid"));
  const parentError = (outcome.errors ?? []).find((entry) => entry.code === "parent-invalid") as PopulationTransitionError;
  assert.ok((parentError.parentErrors ?? []).length > 0, "the population validation errors ride verbatim");
});

test("an unproven registry refuses the transition (invalid-registry, W040 carried verbatim)", () => {
  const genesis = founded();
  const broken = thaw(registryFixture());
  broken.entries[0]!.state = "zombie" as never;
  const outcome = addMembers(genesis, broken, [additionMember()]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("invalid-registry"));
  const registryError = (outcome.errors ?? []).find((entry) => entry.code === "invalid-registry") as PopulationTransitionError;
  assert.ok((registryError.registryErrors ?? []).length > 0, "W040's own errors ride verbatim");
  assert.equal(validateCapabilityRegistry(broken).ok, false, "the fixture registry is genuinely invalid");
});

test("a registry from another scope refuses the transition (registry-scope-mismatch)", () => {
  const genesis = founded();
  const foreign = thaw(registryFixture());
  foreign.scope.worldId = "world-other" as never;
  const outcome = addMembers(genesis, foreign, [additionMember()]);
  assert.equal(outcome.ok, false);
  assert.deepEqual(codesOf(outcome), ["registry-scope-mismatch"]);
});

test("an unproven new member is refused with W044's own errors carried verbatim", () => {
  const genesis = founded();
  const tampered = thaw(additionMember());
  tampered.provenance = { ...tampered.provenance, planId: "" };
  const outcome = addMembers(genesis, registryFixture(), [tampered]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("invalid-member"));
  const invalid = (outcome.errors ?? []).find((entry) => entry.code === "invalid-member") as PopulationTransitionError;
  assert.ok((invalid.memberErrors ?? []).length > 0);
});

test("a new member from another scope is refused (scope-mismatch)", () => {
  const genesis = founded();
  const foreign = thaw(additionMember());
  foreign.scope = { ...foreign.scope, worldId: "world-other" };
  const outcome = addMembers(genesis, registryFixture(), [foreign]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("scope-mismatch"));
});

test("an already-member binding is refused (duplicate-member)", () => {
  const genesis = founded();
  const outcome = addMembers(genesis, registryFixture(), [genesis.membership[0]!]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("duplicate-member"));
});

test("adding zero members is refused (empty-addition)", () => {
  const outcome = addMembers(founded(), registryFixture(), []);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("empty-addition"));
});

test("a deprecated endowment capability at transition time refuses LOUDLY (the W040 lifecycle carried)", () => {
  const genesis = founded();
  const outcome = addMembers(genesis, deprecatedMomentumRegistry(), [additionMember()]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("deprecated-capability"));
  const dead = (outcome.errors ?? []).find((entry) => entry.code === "deprecated-capability") as PopulationTransitionError;
  assert.deepEqual(dead.lifecycle, [{ to: "deprecated", reason: "a newer measurement supersedes it" }]);
  assert.ok(String(dead.capabilityId).length > 0);
  assert.ok(String(dead.substrateId).startsWith("substrate-"));
});

test("a revoked endowment capability at transition time refuses LOUDLY (terminal)", () => {
  const genesis = founded();
  const outcome = retireMembers(genesis, revokedMomentumRegistry(), [{ memberId: memberIds(genesis)[0]!, reason: "rotation" }]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("revoked-capability"));
});

test("an unknown retirement is refused (unknown-retired-member)", () => {
  const outcome = retireMembers(founded(), registryFixture(), [{ memberId: "binding-ghost", reason: "rotation" }]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("unknown-retired-member"));
});

test("a duplicate retirement is refused (duplicate-retirement)", () => {
  const genesis = founded();
  const memberId = memberIds(genesis)[0]!;
  const outcome = retireMembers(genesis, registryFixture(), [
    { memberId, reason: "rotation" },
    { memberId, reason: "rotation again" },
  ]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("duplicate-retirement"));
});

test("a blank retirement reason is refused (blank-retirement-reason)", () => {
  const genesis = founded();
  const outcome = retireMembers(genesis, registryFixture(), [{ memberId: memberIds(genesis)[0]!, reason: "   " }]);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("blank-retirement-reason"));
});

test("retiring zero members is refused (empty-retirement)", () => {
  const outcome = retireMembers(founded(), registryFixture(), []);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("empty-retirement"));
});

test("retiring EVERY member is refused (empty-result — the lineage never dead-ends)", () => {
  const genesis = founded();
  const outcome = retireMembers(genesis, registryFixture(), memberIds(genesis).map((memberId) => ({ memberId, reason: "rotation" })));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("empty-result"));
});

test("an ablation axis outside the closed ABLATION_KINDS table is refused (invalid-ablation-kind)", () => {
  const genesis = founded();
  const outcome = ablateMembers(genesis, registryFixture(), {
    ablation: { kind: "curriculum" as never, operation: "remove-position", subject: ORG_POSITION },
    retirements: [{ memberId: memberIds(genesis)[0]!, reason: "ablation" }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("invalid-ablation-kind"));
});

test("an ablation operation outside the W039 origin vocabulary is refused (invalid-ablation-operation)", () => {
  const genesis = founded();
  const outcome = ablateMembers(genesis, registryFixture(), {
    ablation: { kind: "organization", operation: "explode-population" as never, subject: ORG_POSITION },
    retirements: [{ memberId: memberIds(genesis)[0]!, reason: "ablation" }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("invalid-ablation-operation"));
});

test("a blank ablation subject is refused (blank-ablation-subject)", () => {
  const genesis = founded();
  const outcome = ablateMembers(genesis, registryFixture(), {
    ablation: { kind: "model-substitution", operation: "substitute-substrate-requirement", subject: "  " },
    retirements: [{ memberId: memberIds(genesis)[0]!, reason: "ablation" }],
  });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("blank-ablation-subject"));
});

test("an ablation retiring nobody is refused (empty-retirement)", () => {
  const outcome = ablateMembers(founded(), registryFixture(), {
    ablation: { kind: "organization", operation: "remove-unit", subject: "unit-x" },
    retirements: [],
  });
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("empty-retirement"));
});

test("generations chain: add then retire cites the intermediate parent", () => {
  const genesis = founded();
  const first = addMembers(genesis, registryFixture(), [additionMember()]);
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  const second = retireMembers(first.population, registryFixture(), [{ memberId: memberIds(genesis)[0]!, reason: "rotation" }]);
  assert.equal(second.ok, true);
  if (!second.ok) {
    return;
  }
  assert.equal(second.population.lineage.generation, 2);
  assert.equal(String(second.population.lineage.parentPopulationId), String(first.population.populationId));
  assert.equal(first.population.lineage.generation, 1);
  assert.equal(String(first.population.lineage.parentPopulationId), String(genesis.populationId));
});
