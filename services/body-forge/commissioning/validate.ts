/**
 * The whole-record re-validation (W043) — `validateCommissionedBody`:
 * re-prove EVERY law of a CommissionedBody from its own recorded data,
 * fail-closed, never a silent skip.
 *
 * What is re-proved, from the record ALONE (no registry, no plan, no
 * selection — the record is self-describing evidence):
 * - the commissioned ID: the prefix law + the content-addressed identity
 *   re-derived from the recorded provenance (plan id + selection id +
 *   lineage anchor + registry fingerprint) — a forged or edited id is
 *   caught loudly;
 * - the scope: the body's scope and the record's declared scope agree by
 *   field equality (the W039/W040/W041 field-equality precedent);
 * - the selected-substrate binding: the bound substrate IS the record's
 *   substrate (R050), the selected capabilities are named, and the
 *   carried-citation count is at least one (R052 — a commissioning is
 *   justified by measured evidence);
 * - the sealed endowment manifest's internal laws (unique skills, honest
 *   citation count);
 * - the W032 attachment: still unattached (declared, never yet bound —
 *   W044 owns the world binding) and the initial attachment of the
 *   record's own body;
 * - the commissioned possession: the possession digest re-derived from
 *   the record's own declaration, the lineage anchor re-derived from the
 *   body identity, the WHOLE lineage re-verified through W034's own
 *   `verifyPossessionLineage`, the commissioned head equal to the
 *   lineage's head, and the last entry IS the commissioned generation
 *   (a possess event by the record's substrate under the record's
 *   possession id, committing to the recorded declaration digest);
 * - the commissioning provenance: a finite declared time equal to the
 *   grant's grantedAt (the time is DATA carried from the plan, never a
 *   clock read — A9).
 *
 * The honest limit (the W028 law, carried by W034's lineage design): a
 * recorded registry fingerprint commits to the registry CONTENT the
 * commissioning saw; whether that registry still exists is the consumer's
 * proof — this validator re-proves the RECORD, never the world.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { initialBodyAttachment } from "agent-body";
import {
  lineageAnchorOf,
  possessionDigestOf,
  verifyPossessionLineage,
} from "possession";
import type { PossessionDescriptor } from "possession";
import { stableDigest } from "skills";
import { COMMISSIONED_ID_PREFIX } from "./contracts.js";
import type { CommissionedBody } from "./contracts.js";

/** One whole-record validation law violation (fail-closed, typed). */
export interface CommissionedBodyValidationError {
  readonly code: CommissionedBodyValidationErrorCode;
  readonly message: string;
}

export type CommissionedBodyValidationErrorCode =
  | "identity-mismatch" // the commissioned id is not the content address of the recorded provenance
  | "scope-mismatch" // the record's scope disagrees with its own body's
  | "binding-mismatch" // the bound substrate is not the record's substrate
  | "unmeasured-commission" // R052 — the binding carries no measured citation
  | "invalid-endowment" // the sealed manifest's internal laws
  | "invalid-attachment" // not the W032 initial unattached attachment of this body
  | "possession-digest-mismatch" // the recorded digest is not the declaration's content address
  | "lineage-anchor-mismatch" // the recorded anchor is not the body identity's
  | "lineage-broken" // W034 verification fails (index/code/detail carried)
  | "head-mismatch" // the commissioned head is not the lineage's head
  | "commissioned-generation-mismatch" // the last entry is not this commissioning
  | "invalid-provenance"; // the declared time is not the grant's declared grantedAt

export type CommissionedBodyValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly CommissionedBodyValidationError[] };

function violation(
  code: CommissionedBodyValidationErrorCode,
  message: string,
): CommissionedBodyValidationError {
  return { code, message };
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

/** The record's possession descriptor, reconstructed from the record's own data. */
function descriptorOf(record: CommissionedBody): PossessionDescriptor {
  return {
    possessionId: record.possession.possessionId,
    body: record.body,
    substrate: record.substrate,
    grant: record.possession.grant,
    scope: record.possession.scope,
  };
}

/**
 * Re-prove the whole record from its own data. Pure, deterministic,
 * fail-closed — every violation collected, never dropped.
 */
export function validateCommissionedBody(
  record: CommissionedBody,
): CommissionedBodyValidationOutcome {
  const errors: CommissionedBodyValidationError[] = [];

  // --- The commissioned identity.
  const commissionedId = String(record.commissionedId ?? "");
  if (!commissionedId.startsWith(COMMISSIONED_ID_PREFIX)) {
    errors.push(
      violation(
        "identity-mismatch",
        `commissionedId '${commissionedId}' is not prefixed '${COMMISSIONED_ID_PREFIX}' — a commissioned body is content-addressed`,
      ),
    );
  }
  const expectedId = `${COMMISSIONED_ID_PREFIX}${stableDigest({
    planId: String(record.provenance?.planId),
    selectionId: String(record.provenance?.selectionId),
    lineageAnchor: String(record.possession?.lineageAnchor),
    registryFingerprint: String(record.provenance?.registryFingerprint),
  })}`;
  if (commissionedId !== expectedId) {
    errors.push(
      violation(
        "identity-mismatch",
        `commissionedId '${commissionedId}' is not the content address of the recorded provenance (expected '${expectedId}') — the id weighs the plan id, the selection id, the lineage anchor and the registry fingerprint, nothing else`,
      ),
    );
  }

  // --- The scope.
  if (!sameScope(record.body.scope, record.scope)) {
    errors.push(
      violation(
        "scope-mismatch",
        `the record declares scope (${String(record.scope?.tenantId)}, ${String(record.scope?.projectId)}, ${String(record.scope?.worldId)}) but its own body declares (${String(record.body.scope.tenantId)}, ${String(record.body.scope.projectId)}, ${String(record.body.scope.worldId)}) — one record, one scope`,
      ),
    );
  }

  // --- The selected-substrate binding (R050 + R052).
  if (String(record.substrateBinding?.selectedSubstrateId) !== String(record.substrate?.substrateId)) {
    errors.push(
      violation(
        "binding-mismatch",
        `the binding records substrate '${String(record.substrateBinding?.selectedSubstrateId)}' but the record's substrate is '${String(record.substrate?.substrateId)}' — the body is possessed by the VERY substrate the selection selected`,
      ),
    );
  }
  if ((record.substrateBinding?.selectedCapabilities ?? []).length === 0) {
    errors.push(
      violation(
        "unmeasured-commission",
        "the binding names no selected capability — R052: a commissioning is justified by measured evidence or refused",
      ),
    );
  }
  if (Number(record.substrateBinding?.totalCarriedCitations ?? 0) < 1) {
    errors.push(
      violation(
        "unmeasured-commission",
        "the binding carries no measured citation — R052 (Capability discovery is EMPIRICAL): a commissioning citing no measured evidence is invalid, never defaulted",
      ),
    );
  }

  // --- The sealed endowment manifest's internal laws.
  const seenSkills = new Set<string>();
  for (const entry of record.endowment?.entries ?? []) {
    const skillId = String(entry.skillId);
    if (skillId.trim() === "" || String(entry.capabilityId).trim() === "") {
      errors.push(violation("invalid-endowment", `endowment entry '${skillId}' declares a blank skillId or capabilityId — a sealed manifest names its skills`));
    }
    if (seenSkills.has(skillId)) {
      errors.push(violation("invalid-endowment", `skill '${skillId}' is endowed twice — one skill, one endowment entry`));
    }
    seenSkills.add(skillId);
  }
  let counted = 0;
  for (const entry of record.endowment.entries) {
    counted += entry.evidenceTrajectoryIds.length;
  }
  if (counted !== Number(record.endowment.totalEvidenceCitations)) {
    errors.push(
      violation(
        "invalid-endowment",
        `totalEvidenceCitations ${String(record.endowment?.totalEvidenceCitations)} ≠ the honest count ${String(counted)} — a sealed count is carried, never re-scored, and it must be true`,
      ),
    );
  }

  // --- The W032 attachment (declared, never yet bound).
  const expectedAttachment = initialBodyAttachment(record.body);
  if (
    String(record.attachment?.bodyId) !== String(expectedAttachment.bodyId) ||
    String(record.attachment?.worldId) !== String(expectedAttachment.worldId) ||
    String(record.attachment?.state) !== String(expectedAttachment.state) ||
    String(record.attachment?.state) !== "unattached"
  ) {
    errors.push(
      violation(
        "invalid-attachment",
        `the attachment (state '${String(record.attachment?.state)}') is not the W032 initial UNATTACHED attachment of the record's own body — a commissioned body EXISTS as an attachable agent; the world binding is W044's act`,
      ),
    );
  }

  // --- The commissioned possession.
  if (possessionDigestOf(descriptorOf(record)) !== String(record.possession?.possessionDigest)) {
    errors.push(
      violation(
        "possession-digest-mismatch",
        "the recorded possession digest is not the content address of the record's own possession declaration — the declaration was edited after sealing",
      ),
    );
  }
  const expectedAnchor = lineageAnchorOf({
    bodyId: record.body.bodyId,
    worldId: record.body.scope.worldId,
  });
  if (String(record.possession?.lineageAnchor) !== expectedAnchor) {
    errors.push(
      violation(
        "lineage-anchor-mismatch",
        `the recorded lineage anchor is not the body identity's anchor (expected '${expectedAnchor}') — the anchor is derived (W034's lineageAnchorOf), never asserted`,
      ),
    );
  }
  const intact = verifyPossessionLineage(record.possession.lineage);
  if (!intact.ok) {
    errors.push(
      violation(
        "lineage-broken",
        `the commissioned lineage fails W034 verification at index ${String(intact.index)} (${intact.code}: ${intact.detail}) — the chain was truncated, reordered or edited after sealing`,
      ),
    );
  }
  if (String(record.possession?.commissionedHead) !== String(record.possession?.lineage?.head)) {
    errors.push(
      violation(
        "head-mismatch",
        `the commissioned head '${String(record.possession?.commissionedHead)}' is not the lineage's head '${String(record.possession?.lineage?.head)}' — the commissioned generation is the chain's last link`,
      ),
    );
  }
  const last = record.possession.lineage.entries[record.possession.lineage.entries.length - 1];
  if (
    last === undefined ||
    String(last.event?.kind) !== "possess" ||
    String(last.resultingState) !== "possessed" ||
    String(last.possessionId) !== String(record.possession.possessionId) ||
    String(last.substrateId) !== String(record.substrate.substrateId) ||
    String(last.possessionDigest) !== String(record.possession.possessionDigest) ||
    String(last.bodyId) !== String(record.body.bodyId) ||
    String(last.worldId) !== String(record.body.scope.worldId)
  ) {
    errors.push(
      violation(
        "commissioned-generation-mismatch",
        `the lineage's last entry is not this commissioning (a possess event by substrate '${String(record.substrate?.substrateId)}' under possession '${String(record.possession?.possessionId)}' committing to the recorded declaration digest) — the commissioned generation extends the chain, it never rewrites it`,
      ),
    );
  }

  // --- The commissioning provenance (A9: the time is declared data).
  if (
    !Number.isFinite(Number(record.provenance?.commissionedAt)) ||
    Number(record.provenance?.commissionedAt) !== Number(record.possession?.grant?.grantedAt)
  ) {
    errors.push(
      violation(
        "invalid-provenance",
        `the recorded commissioning time '${String(record.provenance?.commissionedAt)}' is not the grant's declared grantedAt '${String(record.possession?.grant?.grantedAt)}' — commissioning time is declared DATA carried from the plan, never a clock read`,
      ),
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    checked: [
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
    ],
  };
}
