/**
 * The commissioning gate (W043) — `commissionBody`: the PURE, typed act
 * that brings an autonomous Body INTO EXISTENCE as an attachable agent,
 * by sealing the activation record from a ForgedBodyPlan (W041) + a
 * SelectionPlan (W042).
 *
 * THE GATE (fail-closed, errors collected — never a silent drop): (1)
 * the W040 registry re-proven through its OWN validator (errors carried
 * verbatim) + scope; (2) the forged plan re-proven through the forge's
 * own validation seams — the W032 descriptor gate (carried verbatim),
 * the plan-id law, the manifest laws, the W032 initial-attachment law,
 * the W034 seams re-derived (digest, anchor, lineage verification);
 * (3) the selection plan re-proved through the W042 output laws over
 * its recorded data (selected-first rank, R052 measured chain,
 * live-at-selection states, honest counts, closed variant kinds) — W042
 * ships no whole-plan validator, so its OWN walk's output invariants
 * are re-proved here (disclosed); (4) plan/selection COHERENCE — scope,
 * substrate identity, endowment agreement; (5) every endowment AND
 * selected-chain capability LIVE in the registry AT COMMISSIONING TIME
 * (unregistered/deprecated/revoked — the W040 lifecycle carried
 * verbatim — refuses loudly; a STALE selection is refused here);
 * (6) possession compatibility through W034 VERBATIM (world-less — the
 * W039 no-world precedent; the attach proof is W044's), then the
 * lineage EXTENDED through W034's own `extendPossessionLineage` (the
 * anchor is immutable — the chain only grows).
 *
 * A14: commissioning COMPOSES the activation record — it never executes,
 * never trades, never runs a world. A9: no clocks (the commissioning
 * time is the grant's declared grantedAt — DATA), no randomness, no env
 * reads — the same inputs always yield a byte-identical record + id.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { initialBodyAttachment, validateBodyDescriptor } from "agent-body";
import {
  checkPossessionCompatibility,
  extendPossessionLineage,
  lineageAnchorOf,
  possessionDigestOf,
  verifyPossessionLineage,
} from "possession";
import type { PossessionDescriptor } from "possession";
import { validateCapabilityRegistry } from "capability-registry";
import type { CapabilityRegistry } from "capability-registry";
import { registryFingerprintOf, stableDigest } from "skills";
import { SELECTION_ID_PREFIX } from "../../model-selection/index.js";
import type { SelectionPlan } from "../../model-selection/index.js";
import { FORGED_PLAN_ID_PREFIX } from "../contracts.js";
import type { ForgedBodyPlan, SkillEndowmentManifest } from "../contracts.js";
import { COMMISSIONED_ID_PREFIX } from "./contracts.js";
import type {
  CommissionedBody,
  CommissionedId,
  CommissionError,
  CommissionOutcome,
} from "./contracts.js";

/** The optional extras every gate law may carry (the error family's own optional members). */
type CommissionExtras = Omit<CommissionError, "code" | "message">;

function error(
  code: CommissionError["code"],
  message: string,
  extras: CommissionExtras = {},
): CommissionError {
  return { code, message, ...extras };
}

function sameScope(
  left: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
  right: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
): boolean {
  return (
    String(left.tenantId) === String(right.tenantId) &&
    String(left.projectId) === String(right.projectId) &&
    String(left.worldId) === String(right.worldId)
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The plan's possession descriptor, reconstructed VERBATIM from the plan's own data. */
function possessionDescriptorOf(plan: ForgedBodyPlan): PossessionDescriptor {
  return {
    possessionId: plan.possession.possessionId,
    body: plan.body,
    substrate: plan.substrate,
    grant: plan.possession.grant,
    scope: plan.possession.scope,
  };
}

/** The endowment manifest's own internal laws (the sealed manifest must be honest). */
function manifestViolations(manifest: SkillEndowmentManifest): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    const skillId = String(entry.skillId);
    if (skillId.trim() === "" || String(entry.capabilityId).trim() === "") {
      violations.push("a blank skillId or capabilityId in the sealed endowment manifest");
    }
    if (seen.has(skillId)) {
      violations.push(`skill '${skillId}' is endowed twice — one skill, one endowment entry`);
    }
    seen.add(skillId);
  }
  const counted = manifest.entries.reduce(
    (total, entry) => total + entry.evidenceTrajectoryIds.length,
    0,
  );
  if (counted !== manifest.totalEvidenceCitations) {
    violations.push(
      `totalEvidenceCitations ${String(manifest.totalEvidenceCitations)} ≠ the honest count ${String(counted)} — a sealed count is never a re-score, but it must be true`,
    );
  }
  return violations;
}

/** The W042 selection's recorded-data laws (the walk's own output invariants). */
function selectionViolations(selection: SelectionPlan): string[] {
  const violations: string[] = [];
  const selectionId = String(selection.selectionId ?? "");
  if (selectionId.trim() === "" || !selectionId.startsWith(SELECTION_ID_PREFIX)) {
    violations.push(`selectionId '${selectionId}' is blank or not prefixed '${SELECTION_ID_PREFIX}' — a selection is content-addressed (the W042 identity law)`);
  }
  if (
    String(selection.scope?.tenantId ?? "").trim() === "" ||
    String(selection.scope?.projectId ?? "").trim() === "" ||
    String(selection.scope?.worldId ?? "").trim() === ""
  ) {
    violations.push("the selection declares a blank scope member — a selection scope is explicit, never blank");
  }
  if (selection.ranking.length === 0) {
    violations.push("the selection ranks no candidate — the walk always ranks its eligible candidates");
  } else if (String(selection.ranking[0]?.substrateId) !== String(selection.selected?.selectedSubstrateId)) {
    violations.push(
      `the selected substrate '${String(selection.selected?.selectedSubstrateId)}' is not the ranking's first '${String(selection.ranking[0]?.substrateId)}' — the selected candidate is always the top of the deterministic rank (A9)`,
    );
  }
  if (selection.selected?.capabilities?.length === 0) {
    violations.push("R052 (Capability discovery is EMPIRICAL): the selected evidence chain cites no measured capability — a commissioning is justified by measured evidence or refused");
  }
  for (const capability of selection.selected?.capabilities ?? []) {
    if (String(capability.state) !== "registered") {
      violations.push(
        `selected capability '${String(capability.capabilityId)}' records state '${String(capability.state)}' — the chain was not live at selection time (the W040 lifecycle law)`,
      );
    }
  }
  const counted =
    (selection.selected?.capabilities ?? []).reduce(
      (total, capability) => total + capability.provenance.length,
      0,
    ) +
    (selection.selected?.skills ?? []).reduce(
      (total, skill) => total + skill.trajectoryIds.length,
      0,
    );
  if (selection.selected !== undefined && counted !== selection.selected.totalCarriedCitations) {
    violations.push(
      `totalCarriedCitations ${String(selection.selected.totalCarriedCitations)} ≠ the honest carried count ${String(counted)} — carried citations are counted, never re-scored, and the count must be true`,
    );
  }
  for (const variant of selection.variants ?? []) {
    if (String(variant.kind) !== "model-substitution") {
      violations.push(
        `variant kind '${String(variant.kind)}' — the closed variant family is model-substitution only (W039's substitution axis)`,
      );
    }
  }
  return violations;
}

/**
 * THE COMMISSIONING. Input laws first (collected, never dropped), then
 * the W034 compatibility proof, then the lineage extension, then the
 * sealed record: the commissioned id is content-addressed over the plan
 * id + the selection id + the lineage anchor + the registry fingerprint
 * — the same inputs ALWAYS yield the same id (A9).
 */
export function commissionBody(
  forgedPlan: ForgedBodyPlan,
  selectionPlan: SelectionPlan,
  registry: CapabilityRegistry,
): CommissionOutcome {
  const errors: CommissionError[] = [];
  const planId = String(forgedPlan.planId);
  const selectionId = String(selectionPlan.selectionId);
  const identity = { planId, selectionId };

  // --- (1) The registry, through W040's OWN gate.
  const registryValidation = validateCapabilityRegistry(registry);
  if (!registryValidation.ok) {
    errors.push(error("invalid-registry", `the capability registry violates ${String(registryValidation.errors.length)} W040 law(s) — carried verbatim, nothing commissioned`, { ...identity, registryErrors: registryValidation.errors }));
  }
  if (!sameScope(registry.scope, forgedPlan.body.scope)) {
    errors.push(error("registry-scope-mismatch", `the registry scope (${String(registry.scope.tenantId)}, ${String(registry.scope.projectId)}, ${String(registry.scope.worldId)}) disagrees with the plan body's scope (${String(forgedPlan.body.scope.tenantId)}, ${String(forgedPlan.body.scope.projectId)}, ${String(forgedPlan.body.scope.worldId)}) — a body is commissioned WHERE its endowment is proven live`, identity));
  }

  // --- (2) The forged plan, through the forge's own validation seams.
  const planViolations: string[] = [];
  if (!planId.startsWith(FORGED_PLAN_ID_PREFIX)) {
    planViolations.push(`planId '${planId}' is not prefixed '${FORGED_PLAN_ID_PREFIX}' — a forged plan is content-addressed (the W041 identity law)`);
  }
  const bodyValidation = validateBodyDescriptor(forgedPlan.body);
  if (!bodyValidation.ok) {
    errors.push(error("invalid-plan", `the plan's body '${String(forgedPlan.body.bodyId)}' violates ${String(bodyValidation.errors.length)} W032 law(s) — carried verbatim, nothing commissioned`, { ...identity, bodyErrors: bodyValidation.errors }));
  }
  const manifest = manifestViolations(forgedPlan.endowment);
  planViolations.push(...manifest);
  const expectedAttachment = initialBodyAttachment(forgedPlan.body);
  if (
    String(forgedPlan.attachment?.bodyId) !== String(expectedAttachment.bodyId) ||
    String(forgedPlan.attachment?.worldId) !== String(expectedAttachment.worldId) ||
    String(forgedPlan.attachment?.state) !== String(expectedAttachment.state)
  ) {
    planViolations.push("the plan's attachment is not the W032 initial attachment of the plan's own body — the declared attachment is derived, never asserted");
  }
  const descriptor = possessionDescriptorOf(forgedPlan);
  if (possessionDigestOf(descriptor) !== String(forgedPlan.possession?.possessionDigest)) {
    planViolations.push("the plan's possession digest does not match its own declaration — the declaration was edited after forging, or the plan is not a forge output");
  }
  if (
    lineageAnchorOf({ bodyId: forgedPlan.body.bodyId, worldId: forgedPlan.body.scope.worldId }) !==
    String(forgedPlan.possession?.lineageAnchor)
  ) {
    planViolations.push("the plan's lineage anchor does not match the body's identity anchor (W034's lineageAnchorOf) — the anchor is derived, never asserted");
  }
  const intact = verifyPossessionLineage(forgedPlan.possession.lineage);
  if (!intact.ok) {
    planViolations.push(`the plan's possession lineage fails W034 verification at index ${String(intact.index)} (${intact.code}: ${intact.detail}) — commissioning never builds on a broken chain`);
  }
  if (planViolations.length > 0) {
    errors.push(error("invalid-plan", `the forged plan '${planId}' violates ${String(planViolations.length)} forge-output law(s) — the plan is re-proved, never trusted`, { ...identity, planErrors: planViolations }));
  }

  // --- (3) The selection plan, through the W042 output laws.
  const selectionLawViolations = selectionViolations(selectionPlan);
  if (selectionLawViolations.length > 0) {
    errors.push(error("invalid-selection", `the selection plan '${selectionId}' violates ${String(selectionLawViolations.length)} W042 selection-output law(s) — the selection is re-proved from its recorded data, never trusted`, { ...identity, selectionErrors: selectionLawViolations }));
  }

  // --- (4) Plan/selection coherence: scope + substrate identity + endowment agreement.
  if (!sameScope(selectionPlan.scope, forgedPlan.body.scope)) {
    errors.push(error("selection-scope-mismatch", `the selection scope (${String(selectionPlan.scope.tenantId)}, ${String(selectionPlan.scope.projectId)}, ${String(selectionPlan.scope.worldId)}) disagrees with the plan body's scope (${String(forgedPlan.body.scope.tenantId)}, ${String(forgedPlan.body.scope.projectId)}, ${String(forgedPlan.body.scope.worldId)}) — a body is commissioned in the scope its substrate was selected in`, identity));
  }
  const selectedSubstrateId = String(selectionPlan.selected?.selectedSubstrateId);
  const planSubstrateId = String(forgedPlan.substrate?.substrateId);
  if (selectedSubstrateId !== planSubstrateId) {
    errors.push(error("substrate-mismatch", `the selection selected substrate '${selectedSubstrateId}' but the forged plan's substrate reference is '${planSubstrateId}' — the commissioned body is possessed by the VERY substrate the selection selected and the forge forged (R050: the body records the selection, it never assumes a substrate)`, { ...identity, substrateId: selectedSubstrateId }));
  }
  for (const entry of forgedPlan.endowment.entries) {
    const skillId = String(entry.skillId);
    const capabilityId = String(entry.capabilityId);
    const carried = { ...identity, skillId, capabilityId };
    const linked = (selectionPlan.selected?.skills ?? []).find(
      (candidate) => String(candidate.skillId) === skillId,
    );
    if (
      linked === undefined ||
      String(linked.capabilityId) !== capabilityId ||
      !entry.evidenceTrajectoryIds.every((id) =>
        linked.trajectoryIds.some((trajectoryId) => String(trajectoryId) === String(id)),
      )
    ) {
      errors.push(error("endowment-mismatch", `endowment skill '${skillId}' (capability '${capabilityId}') is not justified by the selection's evidence chain — the sealed endowment's skills must be the plan's AND the selection chain's (the commission seals the plan the selection justifies)`, carried));
    }
    if (!(selectionPlan.selected?.capabilities ?? []).some((capability) => String(capability.capabilityId) === capabilityId)) {
      errors.push(error("endowment-mismatch", `endowment capability '${capabilityId}' (skill '${skillId}') is not among the selection's selected capabilities — the endowment is commissioned only where the selection carried its measured evidence`, carried));
    }
  }

  // --- (5) Liveness at commissioning time (the endowment AND the selection's chain).
  const cited = new Map<string, string>();
  for (const entry of forgedPlan.endowment.entries) {
    cited.set(String(entry.capabilityId), `the endowment skill '${String(entry.skillId)}'`);
  }
  for (const capability of selectionPlan.selected?.capabilities ?? []) {
    cited.set(String(capability.capabilityId), `the selection's selected chain`);
  }
  for (const [capabilityId, origin] of [...cited.entries()].sort((left, right) => compareStrings(left[0], right[0]))) {
    const registryEntry = registry.entries.find(
      (candidate) => String(candidate.descriptor.capabilityId) === capabilityId,
    );
    if (registryEntry === undefined) {
      errors.push(error("unregistered-capability", `capability '${capabilityId}' cited by ${origin} is NOT in the registry — R052: the registry is the measured truth, and a commissioning cites it or is refused`, { ...identity, capabilityId }));
      continue;
    }
    if (registryEntry.state === "deprecated" || registryEntry.state === "revoked") {
      errors.push(
        error(
          registryEntry.state === "deprecated" ? "deprecated-capability" : "revoked-capability",
          registryEntry.state === "deprecated"
            ? `capability '${capabilityId}' (${String(registryEntry.descriptor.name)}) cited by ${origin} is DEPRECATED at commissioning time — the W040 lifecycle law refuses it loudly (a stale selection or endowment is never silently accepted)`
            : `capability '${capabilityId}' (${String(registryEntry.descriptor.name)}) cited by ${origin} is REVOKED (terminal) at commissioning time — the W040 lifecycle law refuses it loudly`,
          {
            ...identity,
            capabilityId,
            lifecycle: registryEntry.transitions.map((transition) => ({ to: String(transition.to), reason: String(transition.reason) })),
          },
        ),
      );
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // --- (6) The W034 compatibility proof, VERBATIM (world-less: the W039 precedent).
  const compatibility = checkPossessionCompatibility(descriptor);
  if (!compatibility.ok) {
    return {
      ok: false,
      errors: [
        error(
          "incompatible-possession",
          `the possession of body '${String(forgedPlan.body.bodyId)}' by substrate '${planSubstrateId}' is incompatible — ${String(compatibility.incompatibilities.length)} W034 incompatibilit(ies) carried verbatim, nothing commissioned`,
          { ...identity, substrateId: planSubstrateId, incompatibilities: compatibility.incompatibilities },
        ),
      ],
    };
  }

  // --- (7) The lineage EXTENDED to the commissioned generation (W034's own seam).
  const commissionedAt = forgedPlan.possession.grant.grantedAt;
  const extension = extendPossessionLineage(
    forgedPlan.possession.lineage,
    descriptor,
    { kind: "possess", compatibility },
    commissionedAt,
  );
  if (!extension.ok) {
    return {
      ok: false,
      errors: [
        error(
          "lineage-extension-refused",
          `W034 refuses to extend the possession lineage of body '${String(forgedPlan.body.bodyId)}' to the commissioned generation (${extension.code}: ${extension.message}) — the refusal is carried verbatim, nothing commissioned`,
          { ...identity, lineageRefusal: { code: extension.code, message: extension.message } },
        ),
      ],
    };
  }

  // --- (8) The sealed record.
  const registryFingerprint = registryFingerprintOf(registry);
  const commissionedId = `${COMMISSIONED_ID_PREFIX}${stableDigest({
    planId,
    selectionId,
    lineageAnchor: String(forgedPlan.possession.lineageAnchor),
    registryFingerprint,
  })}` as CommissionedId;

  const body: CommissionedBody = {
    commissionedId,
    body: forgedPlan.body,
    attachment: forgedPlan.attachment,
    substrate: forgedPlan.substrate,
    substrateBinding: {
      selectionId: selectionPlan.selectionId,
      selectedSubstrateId,
      selectedDisplayName: String(selectionPlan.selected.selectedDisplayName),
      selectedCapabilities: [...selectionPlan.selected.capabilities]
        .map((capability) => String(capability.capabilityId))
        .sort(compareStrings),
      totalCarriedCitations: selectionPlan.selected.totalCarriedCitations,
    },
    endowment: forgedPlan.endowment,
    possession: {
      possessionId: forgedPlan.possession.possessionId,
      grant: forgedPlan.possession.grant,
      scope: forgedPlan.possession.scope,
      possessionDigest: forgedPlan.possession.possessionDigest,
      lineageAnchor: forgedPlan.possession.lineageAnchor,
      commissionedHead: extension.lineage.head,
      lineage: extension.lineage,
      compatibility: { checked: compatibility.checked },
    },
    scope: {
      tenantId: String(forgedPlan.body.scope.tenantId),
      projectId: String(forgedPlan.body.scope.projectId),
      worldId: String(forgedPlan.body.scope.worldId),
    },
    provenance: { planId: forgedPlan.planId, selectionId: selectionPlan.selectionId, registryFingerprint, commissionedAt },
  };
  Object.freeze(body);
  Object.freeze(body.substrateBinding);
  Object.freeze(body.possession);
  Object.freeze(body.provenance);
  Object.freeze(body.scope);
  return { ok: true, body };
}
