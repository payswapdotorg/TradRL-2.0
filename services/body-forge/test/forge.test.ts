/**
 * The W041 body-forge tests: the composition gate — the happy path (the
 * ForgedBodyPlan: composed BodyDescriptor, endowment manifest, possession
 * plan re-proved through W034's own seams, initial attachment,
 * content-addressed plan id) and the fail-closed family (invalid body /
 * registry / skill with upstream errors carried verbatim, scope laws,
 * unregistered / deprecated / revoked capability refusals, bearer
 * mismatch, duplicate endowment, incompatible possession with W034
 * incompatibilities carried verbatim).
 *
 * Run: pnpm --filter body-forge test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { initialBodyAttachment } from "agent-body";
import type { BodyDescriptor } from "agent-body";
import {
  initialPossessionLineage,
  lineageAnchorOf,
  possessionDigestOf,
} from "possession";
import type { PossessionDescriptor, PossessionGrant } from "possession";
import type { SkillId } from "skills";
import { composeBodyDescriptor, forgeBody, possessionIdOf } from "../forge.js";
import { FORGED_PLAN_ID_PREFIX } from "../contracts.js";
import type { ForgeComponents } from "../contracts.js";
import {
  SCOPE,
  deprecatedMomentumRegistry,
  registryFixture,
  revokedMomentumRegistry,
  sparseRegistry,
} from "./evidence.js";
import { bodyRequirements, extractedSkills, forgeComponents, momentumSubstrate } from "./fixtures.js";

function codesOf(outcome: { readonly errors: readonly { readonly code: string }[] }): string[] {
  return outcome.errors.map((error) => error.code);
}

test("the forge composes the plan: the descriptor is composed VERBATIM from the requirements", () => {
  const components = forgeComponents();
  const outcome = forgeBody(components);
  assert.equal(outcome.ok, true);
  const requirements = components.bodyRequirements;
  assert.deepEqual(outcome.plan.body, {
    bodyId: requirements.bodyId,
    scope: requirements.scope,
    participantId: requirements.participantId,
    accountId: requirements.accountId,
    participantKind: requirements.participantKind,
    displayName: requirements.displayName,
    embodiment: requirements.embodiment,
    riskEnvelope: requirements.riskEnvelope,
  });
  assert.deepEqual(composeBodyDescriptor(components), outcome.plan.body);
  assert.deepEqual(outcome.plan.substrate, components.substrate);
});

test("the endowment manifest names which skills, which capability, which evidence", () => {
  const components = forgeComponents();
  const outcome = forgeBody(components);
  assert.equal(outcome.ok, true);
  const [skill] = components.skills;
  assert.ok(skill !== undefined);
  assert.equal(outcome.plan.endowment.entries.length, 1);
  const entry = outcome.plan.endowment.entries[0]!;
  assert.equal(String(entry.skillId), String(skill.skillId));
  assert.equal(String(entry.capabilityId), String(skill.competence.capabilityId));
  assert.deepEqual(entry.evidenceTrajectoryIds, skill.evidence.trajectoryIds);
  assert.equal(outcome.plan.endowment.totalEvidenceCitations, skill.evidence.trajectoryIds.length);
});

test("the possession plan is re-provable through W034's own seams", () => {
  const components = forgeComponents();
  const outcome = forgeBody(components);
  assert.equal(outcome.ok, true);
  const plan = outcome.plan;
  const descriptor: PossessionDescriptor = {
    possessionId: plan.possession.possessionId,
    body: plan.body,
    substrate: plan.substrate,
    grant: components.bodyRequirements.grant,
    scope: components.bodyRequirements.possessionScope,
  };
  assert.equal(String(plan.possession.possessionId).startsWith("poss-"), true);
  assert.equal(plan.possession.possessionDigest, possessionDigestOf(descriptor));
  assert.equal(
    plan.possession.lineageAnchor,
    lineageAnchorOf({ bodyId: plan.body.bodyId, worldId: plan.body.scope.worldId }),
  );
  assert.deepEqual(plan.possession.lineage, initialPossessionLineage(plan.body));
  assert.equal(plan.possession.lineage.entries.length, 0);
  assert.equal(plan.possession.lineage.head, plan.possession.lineageAnchor);
  assert.deepEqual(plan.possession.grant, components.bodyRequirements.grant);
  assert.deepEqual(plan.possession.scope, components.bodyRequirements.possessionScope);
  assert.ok(plan.possession.compatibility.checked.includes("descriptor-structure"));
  assert.ok(plan.possession.compatibility.checked.includes("embodied-command-kinds"));
});

test("the plan carries the W032 initial attachment (declared, not yet bound) and a content-addressed id", () => {
  const outcome = forgeBody(forgeComponents());
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.plan.attachment, initialBodyAttachment(outcome.plan.body));
  assert.equal(outcome.plan.attachment.state, "unattached");
  assert.equal(String(outcome.plan.planId).startsWith(FORGED_PLAN_ID_PREFIX), true);
  assert.equal(Object.isFrozen(outcome.plan), true);
});

test("an invalid body is refused with W032's own errors carried verbatim", () => {
  const components = forgeComponents({
    bodyRequirements: bodyRequirements({ bodyId: "" as BodyDescriptor["bodyId"] }),
  });
  const outcome = forgeBody(components);
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "invalid-body");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.bodyErrors !== undefined && invalid.bodyErrors.length > 0);
});

test("an invalid registry is refused with W040's own errors carried verbatim", () => {
  const registry = registryFixture();
  const mangled = {
    ...registry,
    entries: registry.entries.map((entry) => ({
      ...entry,
      descriptor: { ...entry.descriptor, name: "" },
    })),
  };
  const outcome = forgeBody(forgeComponents({ registry: mangled }));
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "registry-invalid");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.registryErrors !== undefined && invalid.registryErrors.length > 0);
});

test("an invalid skill is refused with the skills package's own errors carried verbatim", () => {
  const [skill] = extractedSkills();
  assert.ok(skill !== undefined);
  const tampered = { ...skill, skillId: "skill-deadbeef" as SkillId };
  const outcome = forgeBody(forgeComponents({ skills: [tampered] }));
  assert.equal(outcome.ok, false);
  const invalid = outcome.errors.find((error) => error.code === "invalid-skill");
  assert.ok(invalid !== undefined);
  assert.ok(invalid.skillErrors !== undefined && invalid.skillErrors.length > 0);
});

test("a duplicate skill in the endowment is refused", () => {
  const skills = extractedSkills();
  const outcome = forgeBody(forgeComponents({ skills: [...skills, ...skills] }));
  assert.equal(outcome.ok, false);
  assert.ok(codesOf(outcome).includes("duplicate-skill"));
});

test("an UNREGISTERED skill is refused loudly (the registry is the measured truth)", () => {
  const outcome = forgeBody(forgeComponents({ registry: sparseRegistry() }));
  assert.equal(outcome.ok, false);
  const unregistered = outcome.errors.find((error) => error.code === "unregistered-skill");
  assert.ok(unregistered !== undefined);
  assert.match(unregistered.message, /NOT in the registry/);
  assert.ok(unregistered.capabilityId !== undefined);
});

test("a DEPRECATED capability in the endowment is refused loudly (the W040 lifecycle carried)", () => {
  const outcome = forgeBody(forgeComponents({ registry: deprecatedMomentumRegistry() }));
  assert.equal(outcome.ok, false);
  const deprecated = outcome.errors.find((error) => error.code === "deprecated-capability");
  assert.ok(deprecated !== undefined);
  assert.match(deprecated.message, /DEPRECATED/);
});

test("a REVOKED capability in the endowment is refused loudly (terminal)", () => {
  const outcome = forgeBody(forgeComponents({ registry: revokedMomentumRegistry() }));
  assert.equal(outcome.ok, false);
  const revoked = outcome.errors.find((error) => error.code === "revoked-capability");
  assert.ok(revoked !== undefined);
  assert.match(revoked.message, /REVOKED/);
});

test("a body forged in another scope is refused (registry AND skill scope laws)", () => {
  const components = forgeComponents({
    bodyRequirements: bodyRequirements({
      scope: { ...SCOPE, worldId: "world-forge-other" } as BodyDescriptor["scope"],
    }),
  });
  const outcome = forgeBody(components);
  assert.equal(outcome.ok, false);
  const codes = codesOf(outcome);
  assert.ok(codes.includes("registry-scope-mismatch"));
  assert.ok(codes.includes("skill-scope-mismatch"));
});

test("a skill demonstrated by ANOTHER substrate is refused (the bearer law)", () => {
  const outcome = forgeBody(forgeComponents({
    substrate: momentumSubstrate({
      substrateId: "substrate-forge-other" as ReturnType<typeof momentumSubstrate>["substrateId"],
    }),
  }));
  assert.equal(outcome.ok, false);
  const bearer = outcome.errors.find((error) => error.code === "bearer-mismatch");
  assert.ok(bearer !== undefined);
  assert.match(bearer.message, /demonstrated by bearer/);
  assert.ok(bearer.skillId !== undefined);
});

test("an incompatible possession is refused with W034's incompatibilities carried verbatim", () => {
  const outcome = forgeBody(forgeComponents({
    bodyRequirements: bodyRequirements({
      embodiment: {
        ...bodyRequirements().embodiment,
        commandKinds: ["submit-order", "cancel-order"],
      },
      possessionScope: {
        ...bodyRequirements().possessionScope,
        commandKinds: ["submit-order"],
      },
    }),
  }));
  assert.equal(outcome.ok, false);
  assert.deepEqual(codesOf(outcome), ["incompatible-possession"]);
  const incompatible = outcome.errors[0]!;
  assert.ok(incompatible.incompatibilities !== undefined);
  assert.ok(
    incompatible.incompatibilities.some((entry) => entry.code === "command-kind-not-embodied"),
  );
});

test("the possession id is deterministic over the possession relation (grant included)", () => {
  const components: ForgeComponents = forgeComponents();
  assert.equal(possessionIdOf(components), possessionIdOf(forgeComponents()));
  const other = forgeComponents({
    bodyRequirements: bodyRequirements({
      grant: {
        ...components.bodyRequirements.grant,
        grantedAt: (components.bodyRequirements.grant.grantedAt + 1) as PossessionGrant["grantedAt"],
      },
    }),
  });
  assert.notEqual(possessionIdOf(other), possessionIdOf(components));
});
