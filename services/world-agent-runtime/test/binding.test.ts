/**
 * The W044 binding gate laws — the happy paths (agent + organization)
 * and every refusal law, over REAL imports: REAL commissioned bodies
 * (through commissioning's own gate), a REAL compiled plan (through the
 * W039 compiler's own gate), REAL W040 registries, REAL W034 grants,
 * and the adapted W035 world (fixtures.ts, disclosed in-header).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { bindAgent, bindOrganization } from "../binding.js";
import { validateAgentBinding, validateOrganizationBinding } from "../validate.js";
import {
  ACCOUNT_SEAT,
  GRANTED_AT,
  ORG_POSITION,
  PARTICIPANT_SEAT,
  bindingWorldDefinition,
  commissionedBodyFixture,
  compiledPlanFixture,
  grantsFor,
  orgCommissionedBodyFixture,
} from "./fixtures.js";
import { deprecatedMomentumRegistry, revokedMomentumRegistry } from "../../body-forge/commissioning/test/evidence.js";
import type { CommissionedBody } from "body-forge/commissioning";

function codesOf(outcome: { readonly ok: boolean; readonly errors?: readonly { readonly code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((entry) => entry.code);
}

test("the happy agent binding: a commissioned body wires to its world slot", () => {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(bindingWorldDefinition(), commissioned, grantsFor(commissioned));
  if (!outcome.ok) {
    assert.fail(`expected a sealed binding, got ${codesOf(outcome).join(", ")}`);
  }
  const binding = outcome.binding;
  assert.ok(binding.bindingId.startsWith("binding-"));
  assert.equal(binding.kind, "agent");
  assert.equal(binding.slot.participantId, PARTICIPANT_SEAT);
  assert.equal(binding.slot.accountId, ACCOUNT_SEAT);
  assert.equal(binding.slot.worldId, commissioned.scope.worldId);
  assert.equal(String(binding.commissionedId), String(commissioned.commissionedId));
  assert.equal(String(binding.substrateId), String(commissioned.substrate.substrateId));
  assert.deepEqual(binding.observation.config.kinds, ["market-quote", "own-portfolio"]);
  assert.deepEqual(binding.action.channels.map((channel) => String(channel.commandKind)), ["close-position", "submit-order"]);
  const channel = binding.action.channels[0]!;
  assert.equal(channel.authority.length, 1);
  assert.equal(String(channel.authority[0]!.possessionId), String(commissioned.possession.possessionId));
  assert.ok(channel.authority[0]!.checked.includes("body-attachment"), "the W034 WITH-WORLD attach proof is carried");
  assert.equal(binding.provenance.boundAt, GRANTED_AT);
  assert.equal(binding.provenance.planId, String(commissioned.provenance.planId));
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(validateAgentBinding(binding).ok, true);
});

test("the happy organization binding: the compiled plan wires seat-by-seat", () => {
  const commissioned = orgCommissionedBodyFixture();
  const compiled = compiledPlanFixture(commissioned);
  const outcome = bindOrganization(bindingWorldDefinition(), compiled, [commissioned], grantsFor(commissioned));
  if (!outcome.ok) {
    assert.fail(`expected a sealed organization binding, got ${codesOf(outcome).join(", ")}`);
  }
  const binding = outcome.binding;
  assert.equal(binding.kind, "organization");
  assert.equal(binding.seats.length, 1);
  const seat = binding.seats[0]!;
  assert.equal(String(seat.positionId), String(ORG_POSITION));
  assert.equal(seat.executionIndex, 0);
  assert.equal(String(seat.commissionedId), String(commissioned.commissionedId));
  assert.equal(String(seat.substrateId), String(commissioned.substrate.substrateId));
  assert.deepEqual(binding.world.slots.map((slot) => String(slot.participantId)), [PARTICIPANT_SEAT]);
  assert.equal(binding.compiledOrganizationId, String(compiled.compiledOrganizationId));
  assert.equal(binding.provenance.planId, String(compiled.compiledOrganizationId));
  assert.equal(validateOrganizationBinding(binding).ok, true);
});

test("a deprecated endowment capability refuses the binding (the W040 lifecycle carried)", () => {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(bindingWorldDefinition(), commissioned, grantsFor(commissioned, deprecatedMomentumRegistry()));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("deprecated-capability"));
  const error = (outcome.errors ?? []).find((entry) => entry.code === "deprecated-capability")!;
  assert.deepEqual(error.lifecycle, [{ to: "deprecated", reason: "a newer measurement supersedes it" }]);
});

test("a revoked endowment capability refuses the binding (terminal, carried)", () => {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(bindingWorldDefinition(), commissioned, grantsFor(commissioned, revokedMomentumRegistry()));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("revoked-capability"));
});

test("a world-scope disagreement refuses the binding", () => {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(bindingWorldDefinition({ worldId: "world-other" }), commissioned, grantsFor(commissioned));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("scope-mismatch"));
});

test("an unknown participant slot refuses the binding", () => {
  const commissioned = commissionedBodyFixture();
  const world = bindingWorldDefinition({ participants: [] });
  const outcome = bindAgent(world, commissioned, grantsFor(commissioned));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("unknown-participant-slot"));
});

test("a released (revoked) possession never authorizes a channel", () => {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(
    bindingWorldDefinition(),
    commissioned,
    grantsFor(commissioned, undefined, { state: "released", releaseReason: "operator-request" }),
  );
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("revoked-possession"));
  const error = (outcome.errors ?? []).find((entry) => entry.code === "revoked-possession")!;
  assert.equal(error.possessionState, "released");
  assert.equal(error.releaseReason, "operator-request");
});

test("a grant entry whose record does not match its descriptor refuses the binding", () => {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(
    bindingWorldDefinition(),
    commissioned,
    grantsFor(commissioned, undefined, { bodyId: "body-not-this-one" as CommissionedBody["body"]["bodyId"] }),
  );
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("grant-record-mismatch"));
});

test("grants without the commissioned possession refuse the binding (A13: authority is granted)", () => {
  const commissioned = commissionedBodyFixture();
  const outcome = bindAgent(bindingWorldDefinition(), commissioned, {
    registry: grantsFor(commissioned).registry,
    grants: [],
  });
  assert.equal(outcome.ok, false);
  assert.deepEqual(codesOf(outcome), ["commissioned-grant-missing"]);
});

test("a possession incompatible WITH THE WORLD refuses the binding (W034 verbatim)", () => {
  const commissioned = commissionedBodyFixture();
  const world = bindingWorldDefinition({ venueAllowedOrderKinds: ["limit"] });
  const outcome = bindAgent(world, commissioned, grantsFor(commissioned));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("possession-incompatible"));
  const error = (outcome.errors ?? []).find((entry) => entry.code === "possession-incompatible")!;
  assert.equal(error.incompatibilities?.length, 1);
  assert.equal(error.incompatibilities?.[0]?.code, "body-attachment-failed");
});

test("a compiled plan with no commissioned body refuses (uncommissioned seat)", () => {
  const compiled = compiledPlanFixture();
  const outcome = bindOrganization(bindingWorldDefinition(), compiled, [], grantsFor(orgCommissionedBodyFixture()));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("uncommissioned-body"));
});

test("a commissioned body whose grant is not the plan's seat grant refuses", () => {
  const commissioned = commissionedBodyFixture();
  const compiled = compiledPlanFixture();
  const outcome = bindOrganization(bindingWorldDefinition(), compiled, [commissioned], grantsFor(commissioned));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("uncommissioned-body"));
  const error = (outcome.errors ?? []).find((entry) => entry.code === "uncommissioned-body")!;
  assert.ok(error.message.includes("seat grant"));
});

test("a tampered execution order refuses the organization binding (invalid plan)", () => {
  const commissioned = orgCommissionedBodyFixture();
  const compiled = compiledPlanFixture(commissioned);
  const tampered = { ...compiled, executionOrder: compiled.executionOrder.slice(1) };
  const outcome = bindOrganization(bindingWorldDefinition(), tampered, [commissioned], grantsFor(commissioned));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("invalid-plan"));
});

test("a compiled plan from another scope refuses the organization binding", () => {
  const commissioned = orgCommissionedBodyFixture();
  const compiled = compiledPlanFixture(commissioned);
  const tampered = { ...compiled, scope: { ...compiled.scope, worldId: "world-elsewhere" as never } };
  const outcome = bindOrganization(bindingWorldDefinition(), tampered, [commissioned], grantsFor(commissioned));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("plan-scope-mismatch"));
});
