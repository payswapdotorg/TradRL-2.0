/**
 * The body-forge gate (W041) — `forgeBody`: the PURE composition of a
 * Body endowed with skills, as a typed plan.
 *
 * The forge NEVER executes, never possesses, never runs (A14): it
 * composes the ForgedBodyPlan the runtime commissioning path (W043+)
 * consumes. Determinism (A9): no clocks, no randomness, no env reads —
 * the same components ALWAYS yield a byte-identical plan and the same
 * content-addressed id; the endowment is canonicalized into skill-id
 * order so input order never leaks into any value.
 *
 * Fail-closed at every seam (never a silent drop): the composed body is
 * validated through W032's OWN gate (errors carried verbatim); the
 * registry through W040's OWN gate (errors carried verbatim); the body,
 * registry and every skill must agree on scope by field equality; every
 * skill is re-validated through the skills package's OWN gate (errors
 * carried verbatim); the endowment is duplicate-free; every endowed
 * skill's capability must be REGISTERED (an unregistered skill, or a
 * deprecated/revoked capability — the W040 lifecycle carried loudly —
 * refuses the forge); every endowed skill must have been demonstrated by
 * the FORGING substrate (§12: the substrate carries its competence into
 * the body it will possess); and the W034 possession declaration is
 * proven through `checkPossessionCompatibility` world-less (the W039
 * no-world precedent — the runtime owns the attach proof), with
 * incompatibilities carried verbatim.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { initialBodyAttachment, validateBodyDescriptor } from "agent-body";
import type { BodyDescriptor } from "agent-body";
import {
  checkPossessionCompatibility,
  initialPossessionLineage,
  lineageAnchorOf,
  possessionDigestOf,
} from "possession";
import type {
  PossessionDescriptor,
  PossessionId,
  PossessionIncompatibility,
} from "possession";
import { validateCapabilityRegistry } from "capability-registry";
import { stableDigest, validateSkillRecord } from "skills";
import type { SkillRecord } from "skills";
import { FORGED_PLAN_ID_PREFIX } from "./contracts.js";
import type {
  ForgeComponents,
  ForgeError,
  ForgeOutcome,
  ForgedBodyPlan,
  ForgedPlanId,
  SkillEndowmentEntry,
} from "./contracts.js";

function error(
  code: ForgeError["code"],
  message: string,
  extras: {
    readonly skillId?: string;
    readonly capabilityId?: string;
    readonly bodyErrors?: readonly unknown[];
    readonly registryErrors?: readonly unknown[];
    readonly skillErrors?: readonly unknown[];
    readonly incompatibilities?: readonly PossessionIncompatibility[];
  } = {},
): ForgeError {
  return { code, message, ...extras };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameScope(
  left: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
  right: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.projectId === right.projectId &&
    left.worldId === right.worldId
  );
}

/** The bearer id of a skill's carried bearer (defensive, never a crash). */
function bearerIdOf(skill: SkillRecord): string {
  if (skill.bearer.kind === "substrate") {
    return String(skill.bearer.substrateId ?? "");
  }
  return String((skill.bearer as { readonly bodyId?: string }).bodyId ?? "");
}

/** Compose the W032 BodyDescriptor from the requirements, VERBATIM. */
export function composeBodyDescriptor(components: ForgeComponents): BodyDescriptor {
  const requirements = components.bodyRequirements;
  return {
    bodyId: requirements.bodyId,
    scope: requirements.scope,
    participantId: requirements.participantId,
    accountId: requirements.accountId,
    participantKind: requirements.participantKind,
    ...(requirements.displayName === undefined ? {} : { displayName: requirements.displayName }),
    embodiment: requirements.embodiment,
    riskEnvelope: requirements.riskEnvelope,
  };
}

/**
 * The deterministic possession id: the content digest of the possession
 * RELATION (which body, which substrate, under which grant). The same
 * relation always yields the same id (A9); the grant's authority data is
 * part of the relation's identity.
 */
export function possessionIdOf(components: ForgeComponents): PossessionId {
  const grant = components.bodyRequirements.grant;
  return `poss-${stableDigest({
    bodyId: String(components.bodyRequirements.bodyId),
    substrateId: String(components.substrate.substrateId),
    grantedBy: String(grant.grantedBy),
    channel: grant.channel,
    grantedAt: grant.grantedAt,
  })}` as PossessionId;
}

/**
 * THE FORGE. Input laws first (collected, never dropped): the composed
 * body through W032's gate, the registry through W040's gate, scope
 * agreement by field equality, then the per-skill endowment laws in
 * canonical skill-id order. Any violation refuses the forge with NOTHING
 * composed. Then the W034 world-less compatibility proof, then the plan:
 * composed descriptor + endowment manifest + possession plan (id, grant,
 * scope, digest, initial lineage + anchor, compatibility evidence) + the
 * W032 initial attachment + the content-addressed plan id.
 */
export function forgeBody(components: ForgeComponents): ForgeOutcome {
  const errors: ForgeError[] = [];
  const body = composeBodyDescriptor(components);

  const bodyValidation = validateBodyDescriptor(body);
  if (!bodyValidation.ok) {
    errors.push(
      error(
        "invalid-body",
        `the composed body '${String(body.bodyId)}' violates ${String(bodyValidation.errors.length)} W032 law(s) — carried verbatim, nothing forged`,
        { bodyErrors: bodyValidation.errors },
      ),
    );
  }

  const registryValidation = validateCapabilityRegistry(components.registry);
  if (!registryValidation.ok) {
    errors.push(
      error(
        "registry-invalid",
        `the capability registry violates ${String(registryValidation.errors.length)} W040 law(s) — carried verbatim, nothing forged`,
        { registryErrors: registryValidation.errors },
      ),
    );
  }

  if (!sameScope(components.registry.scope, body.scope)) {
    errors.push(
      error(
        "registry-scope-mismatch",
        `the registry scope (${components.registry.scope.tenantId}, ${components.registry.scope.projectId}, ${components.registry.scope.worldId}) disagrees with the composed body's scope (${body.scope.tenantId}, ${body.scope.projectId}, ${body.scope.worldId}) — the endowment is proven WHERE the skills were measured`,
      ),
    );
  }

  const endowed = [...components.skills].sort((left, right) =>
    compareStrings(String(left.skillId), String(right.skillId)),
  );
  const seenSkillIds = new Set<string>();
  for (const skill of endowed) {
    const skillId = String(skill.skillId);
    const capabilityId = String(skill.competence.capabilityId);
    const carried = { skillId, capabilityId };
    if (seenSkillIds.has(skillId)) {
      errors.push(
        error(
          "duplicate-skill",
          `skill '${skillId}' appears twice in the endowment — skill identity is exact canonical-id identity`,
          carried,
        ),
      );
      continue;
    }
    seenSkillIds.add(skillId);
    const skillValidation = validateSkillRecord(skill);
    if (!skillValidation.ok) {
      errors.push(
        error(
          "invalid-skill",
          `skill '${skillId}' violates ${String(skillValidation.errors.length)} skill law(s) — carried verbatim, nothing forged`,
          { ...carried, skillErrors: skillValidation.errors },
        ),
      );
      continue;
    }
    const entry = components.registry.entries.find(
      (candidate) => String(candidate.descriptor.capabilityId) === capabilityId,
    );
    if (entry === undefined) {
      errors.push(
        error(
          "unregistered-skill",
          `skill '${skillId}' cites capability '${capabilityId}' which is NOT in the registry — the forge endows only REGISTERED capabilities (R052: the registry is the measured truth)`,
          carried,
        ),
      );
      continue;
    }
    if (entry.state === "deprecated" || entry.state === "revoked") {
      errors.push(
        error(
          entry.state === "deprecated" ? "deprecated-capability" : "revoked-capability",
          entry.state === "deprecated"
            ? `skill '${skillId}' cites capability '${capabilityId}' (${entry.descriptor.name}) which is DEPRECATED — it still resolves for lineage, yet fails demand-matching loudly (the W040 lifecycle law) and the forge refuses to endow it`
            : `skill '${skillId}' cites capability '${capabilityId}' (${entry.descriptor.name}) which is REVOKED (terminal) — the W040 lifecycle law refuses it loudly and the forge refuses to endow it`,
          carried,
        ),
      );
      continue;
    }
    if (!sameScope(skill.scope, body.scope)) {
      errors.push(
        error(
          "skill-scope-mismatch",
          `skill '${skillId}' was measured in scope (${skill.scope.tenantId}, ${skill.scope.projectId}, ${skill.scope.worldId}) which disagrees with the composed body's scope (${body.scope.tenantId}, ${body.scope.projectId}, ${body.scope.worldId}) — a body is endowed WHERE its skills were measured`,
          carried,
        ),
      );
    }
    if (
      skill.bearer.kind !== "substrate" ||
      bearerIdOf(skill) !== String(components.substrate.substrateId)
    ) {
      errors.push(
        error(
          "bearer-mismatch",
          `skill '${skillId}' was demonstrated by bearer (${skill.bearer.kind}, ${bearerIdOf(skill)}) — the forge endows a body only with skills demonstrated by the VERY substrate that will possess it (§12: the substrate carries its competence into the body)`,
          carried,
        ),
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const possessionId = possessionIdOf(components);
  const descriptor: PossessionDescriptor = {
    possessionId,
    body,
    substrate: components.substrate,
    grant: components.bodyRequirements.grant,
    scope: components.bodyRequirements.possessionScope,
  };
  const compatibility = checkPossessionCompatibility(descriptor);
  if (!compatibility.ok) {
    return {
      ok: false,
      errors: [
        error(
          "incompatible-possession",
          `the possession of body '${String(body.bodyId)}' by substrate '${String(components.substrate.substrateId)}' is incompatible — ${String(compatibility.incompatibilities.length)} W034 incompatibilit(ies) carried verbatim, nothing forged`,
          { incompatibilities: compatibility.incompatibilities },
        ),
      ],
    };
  }

  const lineage = initialPossessionLineage(body);
  const possessionDigest = possessionDigestOf(descriptor);
  const entries: SkillEndowmentEntry[] = endowed.map((skill) => ({
    skillId: skill.skillId,
    capabilityId: skill.competence.capabilityId,
    evidenceTrajectoryIds: skill.evidence.trajectoryIds,
  }));
  const planId = `${FORGED_PLAN_ID_PREFIX}${stableDigest({
    bodyId: String(body.bodyId),
    substrateId: String(components.substrate.substrateId),
    possessionId: String(possessionId),
    possessionDigest,
    endowment: entries.map((entry) => ({
      skillId: String(entry.skillId),
      capabilityId: String(entry.capabilityId),
    })),
    lineageHead: lineage.head,
  })}` as ForgedPlanId;

  const plan: ForgedBodyPlan = {
    planId,
    body,
    substrate: components.substrate,
    endowment: {
      entries,
      totalEvidenceCitations: entries.reduce(
        (total, entry) => total + entry.evidenceTrajectoryIds.length,
        0,
      ),
    },
    possession: {
      possessionId,
      grant: components.bodyRequirements.grant,
      scope: components.bodyRequirements.possessionScope,
      possessionDigest,
      lineageAnchor: lineageAnchorOf({ bodyId: body.bodyId, worldId: body.scope.worldId }),
      lineage,
      compatibility: { checked: compatibility.checked },
    },
    attachment: initialBodyAttachment(body),
  };
  Object.freeze(plan);
  Object.freeze(plan.endowment);
  Object.freeze(plan.possession);
  return { ok: true, plan };
}
