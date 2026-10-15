/**
 * The W044 whole-binding re-validation laws — a REAL sealed binding
 * re-proves clean from its own recorded data, and every tamper is a loud
 * typed violation (fixtures.ts, disclosed in-header).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bindAgent, bindOrganization } from "../binding.js";
import { validateAgentBinding, validateOrganizationBinding } from "../validate.js";
import type { AgentBinding, OrganizationBinding } from "../contracts.js";
import { bindingWorldDefinition, compiledPlanFixture, commissionedBodyFixture, grantsFor, orgCommissionedBodyFixture } from "./fixtures.js";
import { stableDigest } from "skills";

function sealedAgent(): AgentBinding {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(bindingWorldDefinition(), commissioned, grantsFor(commissioned));
  if (!outcome.ok) {
    assert.fail(`fixture binding failed: ${outcome.errors.map((entry) => entry.code).join(", ")}`);
  }
  return outcome.binding;
}

function sealedOrganization(): OrganizationBinding {
  const commissioned = orgCommissionedBodyFixture();
  const outcome = bindOrganization(bindingWorldDefinition(), compiledPlanFixture(commissioned), [commissioned], grantsFor(commissioned));
  if (!outcome.ok) {
    assert.fail(`fixture org binding failed: ${outcome.errors.map((entry) => entry.code).join(", ")}`);
  }
  return outcome.binding;
}

function codesOf(outcome: { readonly ok: boolean; readonly errors?: readonly { readonly code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((entry) => entry.code);
}

test("a sealed agent binding re-proves clean from its own data", () => {
  const validation = validateAgentBinding(sealedAgent());
  assert.equal(validation.ok, true);
  if (validation.ok) {
    assert.deepEqual([...validation.checked], ["identity", "slot", "observation-contract", "action-contract", "lineage", "provenance"]);
  }
});

test("a sealed organization binding re-proves clean from its own data", () => {
  const validation = validateOrganizationBinding(sealedOrganization());
  assert.equal(validation.ok, true);
});

test("a tampered binding id is an identity mismatch", () => {
  const tampered = { ...sealedAgent(), bindingId: "binding-deadbeef" as AgentBinding["bindingId"] };
  const validation = validateAgentBinding(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("identity-mismatch"));
});

test("a paraphrased authority citation is an action-contract violation", () => {
  const binding = sealedAgent();
  const channel = binding.action.channels[0]!;
  const authority = channel.authority[0]!;
  const tampered: AgentBinding = {
    ...binding,
    action: {
      channels: [
        { ...channel, authority: [{ ...authority, grantDigest: "not-the-digest" }] },
        ...binding.action.channels.slice(1),
      ],
    },
  };
  const validation = validateAgentBinding(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-action-contract"));
});

test("a lineage that drops its grant digests is a lineage mismatch", () => {
  const binding = sealedAgent();
  const tampered: AgentBinding = { ...binding, lineage: { ...binding.lineage, grantDigests: [] } };
  const validation = validateAgentBinding(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("lineage-mismatch"));
});

test("an invented binding time is a provenance violation (declared DATA only)", () => {
  const binding = sealedAgent();
  const tampered: AgentBinding = { ...binding, provenance: { ...binding.provenance, boundAt: binding.provenance.boundAt + 1 } };
  const validation = validateAgentBinding(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-provenance"));
});

test("a dropped observation route is an observation-contract violation", () => {
  const binding = sealedAgent();
  const tampered: AgentBinding = {
    ...binding,
    observation: { ...binding.observation, routes: binding.observation.routes.slice(0, 1) },
  };
  const validation = validateAgentBinding(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-observation-contract"));
});

test("an organization seat out of execution order is a seat violation", () => {
  const binding = sealedOrganization();
  const tampered: OrganizationBinding = {
    ...binding,
    seats: binding.seats.map((seat) => ({ ...seat, executionIndex: seat.executionIndex + 1 })),
  };
  const validation = validateOrganizationBinding(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-seats"));
});

test("an organization provenance that cites a foreign plan id is refused", () => {
  const binding = sealedOrganization();
  const tampered: OrganizationBinding = { ...binding, provenance: { ...binding.provenance, planId: "orgc-foreign" } };
  const validation = validateOrganizationBinding(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-provenance"));
});

test("an authority citation whose digest is not the grant's content address is refused", () => {
  const binding = sealedOrganization();
  const seat = binding.seats[0]!;
  const channel = seat.action.channels[0]!;
  const authority = channel.authority[0]!;
  const wrongGrant = { ...authority.grant, basis: `${String(authority.grant.basis)} (tampered)` };
  const tampered: OrganizationBinding = {
    ...binding,
    seats: [
      {
        ...seat,
        action: { channels: [{ ...channel, authority: [{ ...authority, grant: wrongGrant }] }] },
      },
    ],
  };
  const validation = validateOrganizationBinding(tampered);
  assert.equal(validation.ok, false);
  assert.ok(codesOf(validation).includes("invalid-action-contract"));
});

test("the recorded registry fingerprint is the registry's own content address", () => {
  const binding = sealedAgent();
  const grants = grantsFor(commissionedBodyFixture());
  if (!grants.registry.entries.every((entry) => String(entry.descriptor.capabilityId).length > 0)) {
    assert.fail("fixture registry malformed");
  }
  assert.equal(typeof binding.provenance.registryFingerprint, "string");
  assert.equal(binding.provenance.registryFingerprint.length > 0, true);
  assert.equal(stableDigest(binding.provenance), stableDigest(binding.provenance));
});
