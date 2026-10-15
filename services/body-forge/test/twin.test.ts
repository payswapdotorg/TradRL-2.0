/**
 * The W041 body-forge A9 twin tests: the same components ALWAYS yield a
 * byte-identical plan and the same content-addressed id — the endowment
 * input order never leaks (the manifest is canonicalized into skill-id
 * order), and any differing component value yields a different plan id.
 *
 * Run: pnpm --filter body-forge test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { forgeBody } from "../forge.js";
import { bodyRequirements, forgeComponents, momentumSubstrate } from "./fixtures.js";

test("the twin law: the same components yield a deep-equal plan with the same id", () => {
  const first = forgeBody(forgeComponents());
  const second = forgeBody(forgeComponents());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.plan, second.plan);
  assert.deepEqual(first.plan.planId, second.plan.planId);
});

test("endowment input order never leaks into the plan value", () => {
  const components = forgeComponents();
  const reversed = { ...components, skills: [...components.skills].reverse() };
  const first = forgeBody(components);
  const second = forgeBody(reversed);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.plan, second.plan);
  const ids = second.plan.endowment.entries.map((entry) => String(entry.skillId));
  assert.deepEqual(ids, [...ids].sort());
});

test("a differing component value yields a different plan id (content addressing)", () => {
  const base = forgeBody(forgeComponents());
  assert.equal(base.ok, true);
  const otherSeed = forgeBody(forgeComponents({
    substrate: momentumSubstrate({ seed: "forge-other-seed" }),
  }));
  assert.equal(otherSeed.ok, true);
  assert.notEqual(String(otherSeed.plan.planId), String(base.plan.planId));
  const otherBody = forgeBody(forgeComponents({
    bodyRequirements: bodyRequirements({ displayName: "forge fixture execution body (renamed)" }),
  }));
  assert.equal(otherBody.ok, true);
  assert.notEqual(String(otherBody.plan.planId), String(base.plan.planId));
});

test("re-forging from freshly rebuilt fixtures is bit-stable (A9 through the whole seam chain)", () => {
  const first = forgeBody(forgeComponents());
  const second = forgeBody(forgeComponents());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(JSON.stringify(first.plan), JSON.stringify(second.plan));
});
