/**
 * The W043 A9 twin tests: determinism — the same forged plan + selection
 * + registry ALWAYS yield a byte-identical CommissionedBody and the same
 * content-addressed commissioned id. No clocks, no randomness, no env
 * reads; the commissioning time is the grant's declared grantedAt (DATA).
 * Purity: the inputs are never consumed or mutated by the gate.
 *
 * Run: pnpm --filter body-forge test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { commissionBody } from "../commission.js";
import { validateCommissionedBody } from "../validate.js";
import type { ForgedBodyPlan } from "../../contracts.js";
import type { SelectionPlan } from "../../../model-selection/index.js";
import { registerCapability } from "capability-registry";
import { commissioningFixture, forgedPlanFixture, selectionPlanFixture } from "./fixtures.js";
import { registryFixture, registrationFixture } from "./evidence.js";

test("the A9 twin: independently rebuilt inputs yield a deep-equal record and the same id", () => {
  const left = commissioningFixture();
  const right = {
    plan: forgedPlanFixture(),
    selection: selectionPlanFixture(),
    registry: registryFixture(),
  };
  const leftOutcome = commissionBody(left.plan, left.selection, left.registry);
  const rightOutcome = commissionBody(right.plan, right.selection, right.registry);
  assert.equal(leftOutcome.ok, true);
  assert.equal(rightOutcome.ok, true);
  assert.deepEqual(leftOutcome.body, rightOutcome.body);
  assert.equal(
    String(leftOutcome.body.commissionedId),
    String(rightOutcome.body.commissionedId),
  );
});

test("the A9 twin: the same inputs yield the same record twice (the gate is pure)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const before = structuredClone(plan);
  const first = commissionBody(plan, selection, registry);
  const second = commissionBody(plan, selection, registry);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual(first.body, second.body);
  // The inputs were never consumed or mutated by either run.
  assert.deepEqual(plan, before);
});

test("the twin across a REBUILT registry: the registry fingerprint rides the identity (A9)", () => {
  const { plan, selection } = commissioningFixture();
  const first = commissionBody(plan, selection, registryFixture());
  const second = commissionBody(plan, selection, registryFixture());
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(
    String(first.body.commissionedId),
    String(second.body.commissionedId),
  );
  assert.equal(
    first.body.provenance.registryFingerprint,
    second.body.provenance.registryFingerprint,
  );
});

test("a registry whose content changed is a DIFFERENT commissioning (the fingerprint commits to the content)", () => {
  const { plan, selection } = commissioningFixture();
  const first = commissionBody(plan, selection, registryFixture());
  const richer = registerCapability(registryFixture(), registrationFixture({ name: "momentum execution (bonus)" }));
  if (!richer.ok) {
    throw new Error("twin fixture: the bonus registration failed");
  }
  const second = commissionBody(plan, selection, richer.registry);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(
    String(first.body.commissionedId),
    String(second.body.commissionedId),
  );
});

test("both twins re-validate whole-record (the record is self-describing evidence)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const outcome = commissionBody(plan, selection, registry);
  assert.equal(outcome.ok, true);
  const validation = validateCommissionedBody(outcome.body);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.checked, [
    "commissioned-identity",
    "scope",
    "substrate-binding",
    "endowment-manifest",
    "attachment",
    "possession-digest",
    "lineage-anchor",
    "lineage-chain",
    "commissioned-generation",
    "provenance",
  ]);
});

test("tampered inputs are refused identically (the twin refuses deterministically too)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: ForgedBodyPlan = {
    ...plan,
    possession: { ...plan.possession, possessionDigest: "deadbeef" },
  };
  const first = commissionBody(tampered, selection, registry);
  const second = commissionBody(tampered, selection, registry);
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.deepEqual(first.errors, second.errors);
});

test("a tampered selection is refused deterministically across rebuilds", () => {
  const { plan, registry } = commissioningFixture();
  const selection: SelectionPlan = {
    ...selectionPlanFixture(),
    selected: { ...selectionPlanFixture().selected, selectedSubstrateId: "substrate-other" },
  };
  const first = commissionBody(plan, selection, registry);
  const second = commissionBody(plan, selection, registryFixture());
  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.deepEqual(first.errors, second.errors);
});
