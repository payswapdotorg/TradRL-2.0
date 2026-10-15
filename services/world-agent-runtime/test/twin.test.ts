/**
 * The W044 A9 determinism twins — same commissioned body + same compiled
 * plan + same world identity ⇒ deep-equal binding with the SAME canonical
 * id; any differing byte of authority ⇒ a DIFFERENT id (fixtures.ts,
 * disclosed in-header).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bindAgent, bindOrganization } from "../binding.js";
import { bindingWorldDefinition, commissionedBodyFixture, compiledPlanFixture, grantsFor, orgCommissionedBodyFixture } from "./fixtures.js";

test("the agent twin: same inputs ⇒ deep-equal binding, same canonical id", () => {
  const commissioned = commissionedBodyFixture();
  const left = bindAgent(bindingWorldDefinition(), commissioned, grantsFor(commissioned));
  const right = bindAgent(bindingWorldDefinition(), commissionedBodyFixture(), grantsFor(commissioned));
  if (!left.ok || !right.ok) {
    assert.fail("the twin fixtures must bind cleanly");
  }
  assert.equal(left.binding.bindingId, right.binding.bindingId);
  assert.deepEqual(left.binding, right.binding);
});

test("the organization twin: same inputs ⇒ deep-equal binding, same canonical id", () => {
  const commissioned = orgCommissionedBodyFixture();
  const left = bindOrganization(bindingWorldDefinition(), compiledPlanFixture(commissioned), [commissioned], grantsFor(commissioned));
  const right = bindOrganization(bindingWorldDefinition(), compiledPlanFixture(orgCommissionedBodyFixture()), [orgCommissionedBodyFixture()], grantsFor(commissioned));
  if (!left.ok || !right.ok) {
    assert.fail("the twin fixtures must bind cleanly");
  }
  assert.equal(left.binding.bindingId, right.binding.bindingId);
  assert.deepEqual(left.binding, right.binding);
});

test("differing authority ⇒ a different canonical binding id", () => {
  const commissioningChannel = commissionedBodyFixture();
  const organizationChannel = orgCommissionedBodyFixture();
  const left = bindAgent(bindingWorldDefinition(), commissioningChannel, grantsFor(commissioningChannel));
  const right = bindAgent(bindingWorldDefinition(), organizationChannel, grantsFor(organizationChannel));
  if (!left.ok || !right.ok) {
    assert.fail("both channel fixtures must bind cleanly");
  }
  assert.notEqual(left.binding.bindingId, right.binding.bindingId);
  assert.equal(left.binding.slot.participantId, right.binding.slot.participantId);
});

test("the same world identity through fresh builder calls ⇒ the same canonical id", () => {
  const commissioned = commissionedBodyFixture();
  const grants = grantsFor(commissioned);
  const left = bindAgent(bindingWorldDefinition(), commissioned, grants);
  const right = bindAgent(bindingWorldDefinition(), commissioned, grants);
  if (!left.ok || !right.ok) {
    assert.fail("the world fixtures must bind cleanly");
  }
  assert.equal(left.binding.bindingId, right.binding.bindingId);
});
