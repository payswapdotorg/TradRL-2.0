/**
 * The W045 A9 twin laws — deterministic replay identity: same members +
 * same world ⇒ deep-equal population, same canonical id; transitions
 * likewise; any differing member ⇒ a different population identity.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { foundPopulation } from "../population.js";
import { addMembers } from "../transitions.js";
import type { Population } from "../population.js";
import {
  additionMember,
  populationMembers,
  populationWorldDefinition,
  registryFixture,
  thaw,
} from "./fixtures.js";

function founded(): Population {
  const outcome = foundPopulation(populationWorldDefinition(), populationMembers());
  if (!outcome.ok) {
    assert.fail(`fixture founding failed (${outcome.errors.map((entry) => entry.code).join(", ")})`);
  }
  return outcome.population;
}

test("the founding twin: same members + same world ⇒ deep-equal population, same canonical id", () => {
  const left = foundPopulation(populationWorldDefinition(), populationMembers());
  const right = foundPopulation(populationWorldDefinition(), [...populationMembers()].reverse());
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    return;
  }
  assert.deepEqual(left.population, right.population);
  assert.equal(String(left.population.populationId), String(right.population.populationId));
});

test("the transition twin: same parent + same addition ⇒ deep-equal generation, same canonical id", () => {
  const genesis = founded();
  const left = addMembers(genesis, registryFixture(), [additionMember()]);
  const right = addMembers(genesis, registryFixture(), [additionMember()]);
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  if (!left.ok || !right.ok) {
    return;
  }
  assert.deepEqual(left.population, right.population);
  assert.equal(String(left.population.populationId), String(right.population.populationId));
});

test("any differing member ⇒ a different population identity", () => {
  const base = foundPopulation(populationWorldDefinition(), populationMembers());
  // a VALID differing member (the declared addition seat — the ghost seat is
  // deliberately undeclared and is refused fail-closed, which is the OTHER
  // law, not this one)
  const varied = foundPopulation(populationWorldDefinition(), [
    ...populationMembers().slice(0, 2),
    additionMember(),
  ]);
  assert.equal(base.ok, true);
  assert.equal(varied.ok, true);
  if (!base.ok || !varied.ok) {
    return;
  }
  assert.notEqual(String(base.population.populationId), String(varied.population.populationId));
  assert.equal(base.population.membership.length, varied.population.membership.length);
});

test("a differing world scope ⇒ a different population identity", () => {
  const base = foundPopulation(populationWorldDefinition(), populationMembers());
  const other = foundPopulation(
    { ...populationWorldDefinition(), scope: { ...populationWorldDefinition().scope, worldId: "world-twin" as never } },
    populationMembers().map((member) => {
      const clone = thaw(member);
      clone.scope = { ...clone.scope, worldId: "world-twin" };
      clone.world = { ...clone.world, scope: { ...clone.world.scope, worldId: "world-twin" } };
      return clone;
    }),
  );
  assert.equal(base.ok, true);
  assert.equal(other.ok, false, "the cloned members are W044-inconsistent (their ids weigh the original scope) — refused loudly, never silently equated");
  if (base.ok && !other.ok) {
    assert.ok(other.errors.some((entry) => entry.code === "invalid-member" || entry.code === "scope-mismatch" || entry.code === "unknown-member-slot"));
  }
});
