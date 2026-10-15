/**
 * The W043 commissioning tests: THE GATE — the happy path (the sealed
 * CommissionedBody: content-addressed id, the W032 attachment, the
 * selected-substrate binding, the endowment sealed VERBATIM, the
 * possession lineage EXTENDED to the commissioned generation) and every
 * refusal law (the forge-output re-proofs with W032 errors carried
 * verbatim, the W040 registry gate + scope, the W042 selection laws,
 * plan/selection coherence — substrate identity, endowment agreement,
 * scope — the live-capability laws with the W040 lifecycle carried
 * verbatim, the W034 incompatibilities carried verbatim, and the W034
 * lineage-extension refusal carried verbatim).
 *
 * Run: pnpm --filter body-forge test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { BodyDescriptor } from "agent-body";
import {
  checkPossessionCompatibility,
  extendPossessionLineage,
  possessionDigestOf,
} from "possession";
import type { PossessionDescriptor } from "possession";
import { stableDigest } from "skills";
import { commissionBody } from "../commission.js";
import { COMMISSIONED_ID_PREFIX } from "../contracts.js";
import type { ForgedBodyPlan } from "../../contracts.js";
import type { SelectionPlan } from "../../../model-selection/index.js";
import {
  GRANTED_AT,
  commissioningFixture,
} from "./fixtures.js";
import {
  SCOPE,
  SUBSTRATE_MOMENTUM,
  deprecatedMomentumRegistry,
  registryFixture,
  revokedMomentumRegistry,
  sparseRegistry,
} from "./evidence.js";

function codesOf(outcome: { readonly errors: readonly { readonly code: string }[] }): string[] {
  return outcome.errors.map((error) => error.code);
}

/** The plan's possession descriptor, reconstructed exactly as the gate does. */
function descriptorOf(plan: ForgedBodyPlan): PossessionDescriptor {
  return {
    possessionId: plan.possession.possessionId,
    body: plan.body,
    substrate: plan.substrate,
    grant: plan.possession.grant,
    scope: plan.possession.scope,
  };
}

test("the happy path: the commissioning seals the activation record", () => {
  const { plan, selection, registry } = commissioningFixture();
  const outcome = commissionBody(plan, selection, registry);
  assert.equal(outcome.ok, true);
  const body = outcome.body;
  assert.equal(String(body.commissionedId).startsWith(COMMISSIONED_ID_PREFIX), true);
  assert.deepEqual(body.body, plan.body);
  assert.deepEqual(body.attachment, plan.attachment);
  assert.equal(body.attachment.state, "unattached");
  assert.deepEqual(body.substrate, plan.substrate);
  assert.deepEqual(body.endowment, plan.endowment);
  assert.deepEqual(body.scope, {
    tenantId: SCOPE.tenantId,
    projectId: SCOPE.projectId,
    worldId: SCOPE.worldId,
  });
  assert.equal(Object.isFrozen(body), true);
  assert.equal(Object.isFrozen(body.substrateBinding), true);
  assert.equal(Object.isFrozen(body.possession), true);
  assert.equal(Object.isFrozen(body.provenance), true);
});

test("the commissioned id is the content address of plan id + selection id + lineage anchor + registry fingerprint", () => {
  const { plan, selection, registry } = commissioningFixture();
  const outcome = commissionBody(plan, selection, registry);
  assert.equal(outcome.ok, true);
  const fingerprintOf = (input: typeof registry): string =>
    stableDigest({
      scope: input.scope,
      entries: input.entries.map((entry) => ({
        capabilityId: String(entry.descriptor.capabilityId),
        state: entry.state,
        transitions: entry.transitions,
      })),
    });
  const expected = `${COMMISSIONED_ID_PREFIX}${stableDigest({
    planId: String(plan.planId),
    selectionId: String(selection.selectionId),
    lineageAnchor: String(plan.possession.lineageAnchor),
    registryFingerprint: fingerprintOf(registry),
  })}`;
  assert.equal(String(outcome.body.commissionedId), expected);
});

test("the selected-substrate binding RECORDS the selection (R050 — never assumes a substrate)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const outcome = commissionBody(plan, selection, registry);
  assert.equal(outcome.ok, true);
  const binding = outcome.body.substrateBinding;
  assert.equal(String(binding.selectionId), String(selection.selectionId));
  assert.equal(binding.selectedSubstrateId, String(selection.selected.selectedSubstrateId));
  assert.equal(binding.selectedSubstrateId, String(plan.substrate.substrateId));
  assert.equal(binding.selectedDisplayName, selection.selected.selectedDisplayName);
  assert.deepEqual(
    binding.selectedCapabilities,
    selection.selected.capabilities.map((capability) => String(capability.capabilityId)).sort(),
  );
  assert.equal(binding.totalCarriedCitations, selection.selected.totalCarriedCitations);
  assert.ok(binding.totalCarriedCitations >= 1);
});

test("the possession lineage is EXTENDED to the commissioned generation (the anchor never rewrites)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const before = structuredClone(plan.possession.lineage);
  const outcome = commissionBody(plan, selection, registry);
  assert.equal(outcome.ok, true);
  const possession = outcome.body.possession;
  assert.equal(String(possession.possessionId), String(plan.possession.possessionId));
  assert.deepEqual(possession.grant, plan.possession.grant);
  assert.deepEqual(possession.scope, plan.possession.scope);
  assert.equal(possession.possessionDigest, plan.possession.possessionDigest);
  assert.equal(possession.lineageAnchor, plan.possession.lineageAnchor);
  assert.equal(possession.commissionedHead, possession.lineage.head);
  assert.deepEqual(possession.lineage.entries.slice(0, -1), before.entries);
  assert.equal(possession.lineage.entries.length, before.entries.length + 1);
  const entry = possession.lineage.entries[possession.lineage.entries.length - 1]!;
  assert.equal(entry.sequence, before.entries.length);
  assert.equal(entry.event.kind, "possess");
  assert.equal(entry.resultingState, "possessed");
  assert.equal(String(entry.possessionId), String(plan.possession.possessionId));
  assert.equal(String(entry.substrateId), String(SUBSTRATE_MOMENTUM));
  assert.equal(String(entry.possessionDigest), plan.possession.possessionDigest);
  assert.equal(Number(entry.recordedAt), GRANTED_AT);
  assert.equal(entry.previousEntryDigest, null);
  assert.equal(entry.chainLink, possession.commissionedHead);
  // The commissioning never mutated the plan's own lineage (immutable inputs).
  assert.deepEqual(plan.possession.lineage, before);
});

test("the commissioning provenance names WHICH commissioning run (declared time, no clocks)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const outcome = commissionBody(plan, selection, registry);
  assert.equal(outcome.ok, true);
  const provenance = outcome.body.provenance;
  assert.equal(String(provenance.planId), String(plan.planId));
  assert.equal(String(provenance.selectionId), String(selection.selectionId));
  assert.equal(provenance.commissionedAt, GRANTED_AT);
  assert.equal(provenance.registryFingerprint.length > 0, true);
});

test("an invalid plan body is refused with W032's own errors carried verbatim", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: ForgedBodyPlan = {
    ...plan,
    body: { ...plan.body, bodyId: "" as BodyDescriptor["bodyId"] },
  };
  const outcome = commissionBody(tampered, selection, registry);
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "invalid-plan");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.bodyErrors !== undefined && invalid.bodyErrors.length > 0);
});

test("a plan whose possession digest does not match its own declaration is refused", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: ForgedBodyPlan = {
    ...plan,
    possession: { ...plan.possession, possessionDigest: "deadbeef" },
  };
  const outcome = commissionBody(tampered, selection, registry);
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "invalid-plan");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.planErrors !== undefined);
  assert.ok(invalid.planErrors.some((violation) => violation.includes("possession digest")));
});

test("a plan whose sealed manifest lies about its citation count is refused", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: ForgedBodyPlan = {
    ...plan,
    endowment: { ...plan.endowment, totalEvidenceCitations: 99 },
  };
  const outcome = commissionBody(tampered, selection, registry);
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "invalid-plan");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.planErrors !== undefined);
  assert.ok(invalid.planErrors.some((violation) => violation.includes("honest count")));
});

test("an invalid registry is refused with W040's own errors carried verbatim", () => {
  const { plan, selection } = commissioningFixture();
  const registry = registryFixture();
  const mangled = {
    ...registry,
    entries: registry.entries.map((entry) => ({
      ...entry,
      descriptor: { ...entry.descriptor, name: "" },
    })),
  };
  const outcome = commissionBody(plan, selection, mangled);
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "invalid-registry");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.registryErrors !== undefined && invalid.registryErrors.length > 0);
});

test("a registry scoped elsewhere than the plan body is refused (multi-law output, both codes present)", () => {
  const { plan, selection } = commissioningFixture();
  const registry = registryFixture();
  const foreign = { ...registry, scope: { ...SCOPE, worldId: "world-commissioning-other" as BodyDescriptor["scope"]["worldId"] } };
  const outcome = commissionBody(plan, selection, foreign);
  assert.equal(outcome.ok, false);
  const codes = codesOf(outcome);
  assert.ok(codes.includes("registry-scope-mismatch"));
});

test("a body scoped elsewhere than the selection is refused (scope + plan re-proof fire together)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: ForgedBodyPlan = {
    ...plan,
    body: { ...plan.body, scope: { ...plan.body.scope, worldId: "world-commissioning-other" as BodyDescriptor["scope"]["worldId"] } },
  };
  const outcome = commissionBody(tampered, selection, registry);
  assert.equal(outcome.ok, false);
  const codes = codesOf(outcome);
  assert.ok(codes.includes("selection-scope-mismatch"));
  assert.ok(codes.includes("registry-scope-mismatch"));
});

test("a selection whose recorded data violates the W042 output laws is refused (R052 named)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: SelectionPlan = {
    ...selection,
    selected: { ...selection.selected, capabilities: [] },
  };
  const outcome = commissionBody(plan, tampered, registry);
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "invalid-selection");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.selectionErrors !== undefined);
  assert.ok(invalid.selectionErrors.some((violation) => violation.includes("R052")));
});

test("a selection whose ranking does not put the selected candidate first is refused (the A9 rank law)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const ranking = [...selection.ranking];
  const [first, second] = ranking;
  if (first !== undefined && second !== undefined) {
    ranking[0] = second;
    ranking[1] = first;
  }
  const tampered: SelectionPlan = { ...selection, ranking };
  const outcome = commissionBody(plan, tampered, registry);
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "invalid-selection");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.selectionErrors !== undefined);
  assert.ok(invalid.selectionErrors.some((violation) => violation.includes("deterministic rank")));
});

test("a selection scoped elsewhere is refused", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: SelectionPlan = {
    ...selection,
    scope: { ...selection.scope, worldId: "world-commissioning-other" },
  };
  const outcome = commissionBody(plan, tampered, registry);
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("selection-scope-mismatch"));
});

test("a selection that selected ANOTHER substrate than the plan's is refused (substrate identity)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: SelectionPlan = {
    ...selection,
    selected: { ...selection.selected, selectedSubstrateId: "substrate-mean-reversion-mind" },
  };
  const outcome = commissionBody(plan, tampered, registry);
  assert.equal(outcome.ok, false);
  const mismatch = outcome.errors.find((error) => error.code === "substrate-mismatch");
  assert.ok(mismatch !== undefined);
  assert.match(mismatch.message, /never assumes a substrate/);
});

test("an endowment the selection's chain does not justify is refused (endowment agreement)", () => {
  const { plan, selection, registry } = commissioningFixture();
  const tampered: SelectionPlan = {
    ...selection,
    selected: { ...selection.selected, skills: [] },
  };
  const outcome = commissionBody(plan, tampered, registry);
  assert.equal(outcome.ok, false);
  const mismatch = outcome.errors.find((error) => error.code === "endowment-mismatch");
  assert.ok(mismatch !== undefined);
  assert.ok(mismatch.skillId !== undefined);
  assert.match(mismatch.message, /selection's evidence chain/);
});

test("a STALE selection over a now-DEPRECATED capability is refused loudly (the W040 lifecycle carried)", () => {
  const { plan, selection } = commissioningFixture();
  const outcome = commissionBody(plan, selection, deprecatedMomentumRegistry());
  assert.equal(outcome.ok, false);
  const deprecated = outcome.errors.find((error) => error.code === "deprecated-capability");
  assert.ok(deprecated !== undefined);
  assert.match(deprecated.message, /DEPRECATED at commissioning time/);
  assert.ok(deprecated.lifecycle !== undefined && deprecated.lifecycle.length > 0);
});

test("a STALE selection over a now-REVOKED capability is refused loudly (terminal)", () => {
  const { plan, selection } = commissioningFixture();
  const outcome = commissionBody(plan, selection, revokedMomentumRegistry());
  assert.equal(outcome.ok, false);
  const revoked = outcome.errors.find((error) => error.code === "revoked-capability");
  assert.ok(revoked !== undefined);
  assert.match(revoked.message, /REVOKED/);
});

test("an endowment capability missing from the registry is refused (unregistered)", () => {
  const { plan, selection } = commissioningFixture();
  const outcome = commissionBody(plan, selection, sparseRegistry());
  assert.equal(outcome.ok, false);
  const unregistered = outcome.errors.find((error) => error.code === "unregistered-capability");
  assert.ok(unregistered !== undefined);
  assert.match(unregistered.message, /R052/);
  assert.ok(unregistered.capabilityId !== undefined);
});

test("an incompatible possession is refused with W034's incompatibilities carried verbatim", () => {
  const { plan, selection, registry } = commissioningFixture();
  // The substrate proposes a command kind this body's embodiment does not
  // declare (the W034 embodied-command-kinds law) — and an attacker who
  // re-computes the digest after editing the substrate is STILL caught:
  // the LAW refuses them (the W028 honest limit does not apply to laws).
  const substrate = {
    ...plan.substrate,
    commandKinds: [...plan.substrate.commandKinds, "create-snapshot"] as ForgedBodyPlan["substrate"]["commandKinds"],
  };
  const digest = possessionDigestOf({ ...descriptorOf(plan), substrate });
  const tampered: ForgedBodyPlan = {
    ...plan,
    substrate,
    possession: { ...plan.possession, possessionDigest: digest },
  };
  const outcome = commissionBody(tampered, selection, registry);
  assert.equal(outcome.ok, false);
  const incompatible = outcome.errors.find((error) => error.code === "incompatible-possession");
  assert.ok(incompatible !== undefined);
  assert.ok(incompatible.incompatibilities !== undefined);
  assert.ok(
    incompatible.incompatibilities.some((entry) => entry.code === "command-kind-not-embodied"),
  );
});

test("a lineage W034 refuses to extend is refused with W034's own refusal carried verbatim", () => {
  const { plan, selection, registry } = commissioningFixture();
  const descriptor = descriptorOf(plan);
  const compatibility = checkPossessionCompatibility(descriptor);
  assert.equal(compatibility.ok, true);
  const pre = extendPossessionLineage(
    plan.possession.lineage,
    descriptor,
    { kind: "possess", compatibility },
    plan.possession.grant.grantedAt,
  );
  assert.equal(pre.ok, true);
  const alreadyPossessed: ForgedBodyPlan = {
    ...plan,
    possession: { ...plan.possession, lineage: pre.lineage },
  };
  const outcome = commissionBody(alreadyPossessed, selection, registry);
  assert.equal(outcome.ok, false);
  const refused = outcome.errors.find((error) => error.code === "lineage-extension-refused");
  assert.ok(refused !== undefined);
  assert.ok(refused.lineageRefusal !== undefined);
  assert.equal(refused.lineageRefusal.code, "illegal-event");
  assert.match(refused.message, /W034 refuses/);
});
