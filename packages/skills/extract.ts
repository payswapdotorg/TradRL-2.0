/**
 * The skill extraction gate (W041) — R052 enforced STRUCTURALLY, the pure
 * empirical walk from trajectories to skills.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL":
 * a skill exists ONLY as the derivation of measured trajectory evidence
 * against a measured capability — no evidence ⇒ no skill (the loud typed
 * refusal `no-trajectory-evidence` names the law), and a deprecated or
 * revoked capability derives nothing (the W040 lifecycle carried loudly).
 * Nothing here measures anything: the measuring lived in the W037/W038
 * artifacts the inputs record; the gate WALKS records, it never re-runs
 * them.
 *
 * The demonstrating binding (the structural law, proven by field equality
 * — never by parsing): a trajectory DEMONSTRATES a capability iff
 * (a) the trajectory's scope experiment member equals one of the
 * capability's recorded provenance experiment citations (the same W037
 * experiment the capability's measured evidence cites), and (b) the
 * trajectory's session binding names the capability's bearer — the
 * substrate that decided (substrate bearers) or the body class that acted
 * (body bearers). A trajectory from another experiment, or another
 * bearer's session, demonstrates NOTHING for this capability.
 *
 * A9: `extractSkills` is pure — no clocks, no randomness, no env reads.
 * The registry fingerprint + the batch's trajectory ids (sorted) derive
 * the run id; the skills come out in canonical skill-id order; input
 * order never leaks into any value. The measured summaries CARRY the
 * records' own evaluation + session data verbatim (the W038 precedent:
 * carry, never re-score).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateTrajectoryRecord } from "trajectory";
import type { TrajectoryRecord } from "trajectory";
import { validateCapabilityRegistry } from "capability-registry";
import type { CapabilityBearer, CapabilityRegistry, RegistryEntry } from "capability-registry";
import { extractionIdOf, skillIdOf, stableDigest } from "./identity.js";
import type { ExtractionId, SkillCanonicalInput, SkillScope } from "./identity.js";
import type {
  ExtractionOutcome,
  SkillError,
  SkillRecord,
  SkillRefusal,
  SkillRefusalCode,
  TrajectoryOutcomeCarry,
} from "./record.js";

function error(
  code: SkillError["code"],
  message: string,
  trajectoryId?: string,
  trajectoryErrors?: SkillError["trajectoryErrors"],
  registryErrors?: SkillError["registryErrors"],
): SkillError {
  return {
    code,
    message,
    ...(trajectoryId === undefined ? {} : { trajectoryId }),
    ...(trajectoryErrors === undefined ? {} : { trajectoryErrors }),
    ...(registryErrors === undefined ? {} : { registryErrors }),
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function bearerIdOf(bearer: CapabilityBearer): string {
  // Defensive on runtime-malformed bearers (a kind outside the closed set
  // may carry either member): the downstream laws fire, never a crash.
  if (bearer.kind === "substrate") {
    return String(bearer.substrateId ?? "");
  }
  return String((bearer as { readonly bodyId?: string }).bodyId ?? "");
}

function sameScope(
  left: SkillScope,
  right: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.projectId === right.projectId &&
    left.worldId === right.worldId
  );
}

/**
 * The registry fingerprint: the canonical digest over the registry's
 * VALUE (scope + each entry's capability id, lifecycle state and
 * transition record) — the extraction run's identity input. Deterministic
 * (A9): the same registry value always yields the same fingerprint; a
 * lifecycle transition changes the fingerprint, so a new run is a NEW run.
 */
export function registryFingerprintOf(registry: CapabilityRegistry): string {
  return stableDigest({
    scope: registry.scope,
    entries: registry.entries.map((entry) => ({
      capabilityId: String(entry.descriptor.capabilityId),
      state: entry.state,
      transitions: entry.transitions,
    })),
  });
}

/** Does this trajectory's session name the capability's bearer? */
function bearerDemonstrated(
  bearer: CapabilityBearer,
  session: TrajectoryRecord["session"],
): boolean {
  if (bearer.kind === "substrate") {
    return String(bearer.substrateId ?? "") === String(session.substrateId);
  }
  return String((bearer as { readonly bodyId?: string }).bodyId ?? "") === String(session.bodyId);
}

/** Derive one skill record from a registered entry + its demonstrating trajectories. */
function skillOf(
  entry: RegistryEntry,
  demonstrating: readonly TrajectoryRecord[],
  extractionId: ExtractionId,
): SkillRecord {
  const descriptor = entry.descriptor;
  const trajectoryIds = demonstrating.map((record) => record.trajectoryId);
  const canonical: SkillCanonicalInput = {
    capabilityId: String(descriptor.capabilityId),
    kind: descriptor.kind,
    domain: descriptor.domain,
    bearer: { kind: descriptor.bearer.kind, id: bearerIdOf(descriptor.bearer) },
    scope: {
      tenantId: descriptor.scope.tenantId,
      projectId: descriptor.scope.projectId,
      worldId: descriptor.scope.worldId,
    },
    trajectoryIds: trajectoryIds.map(String),
    lineage: { parentSkillId: null, version: 1 },
  };
  const outcomeCarries: TrajectoryOutcomeCarry[] = demonstrating.map((record) => ({
    trajectoryId: record.trajectoryId,
    policyId: record.evaluation.policyId,
    combinedScore: record.evaluation.combinedScore,
    appliedSoftPenaltyTotal: record.evaluation.appliedSoftPenaltyTotal,
    compliance: record.evaluation.compliance,
    status: record.session.status,
    passCount: record.session.passCount,
    commandsIssued: record.session.commandsIssued,
    acked: record.session.acked,
    rejected: record.session.rejected,
  }));
  const record: SkillRecord = {
    skillId: skillIdOf(canonical),
    competence: {
      capabilityId: descriptor.capabilityId,
      name: descriptor.name,
      kind: descriptor.kind,
      domain: descriptor.domain,
    },
    bearer: descriptor.bearer,
    scope: canonical.scope,
    evidence: {
      trajectoryIds,
      experimentIds: Array.from(new Set(demonstrating.map((one) => one.scope.experimentId))).sort(
        compareStrings,
      ),
      capabilityProvenance: descriptor.provenance,
    },
    summary: { outcomeCarries, trajectoryCount: demonstrating.length },
    lineage: { parentSkillId: null, version: 1 },
    provenance: { extractionId },
  };
  Object.freeze(record);
  return record;
}

/**
 * THE EXTRACTION GATE. Input laws first (the registry re-validated through
 * W040's own gate with errors carried verbatim; every trajectory
 * re-validated through W037's own gate with errors carried verbatim; scope
 * agreement by field equality; a duplicate-free batch) — any violation is
 * a typed error and NOTHING is extracted. Then the pure walk: one
 * candidate skill per REGISTERED measured capability the batch actually
 * demonstrates, every non-derivation a loud typed refusal (R052 and the
 * W040 lifecycle named), nothing silently dropped.
 */
export function extractSkills(
  trajectories: readonly TrajectoryRecord[],
  registry: CapabilityRegistry,
): ExtractionOutcome {
  const errors: SkillError[] = [];

  const registryValidation = validateCapabilityRegistry(registry);
  if (!registryValidation.ok) {
    errors.push(
      error(
        "registry-invalid",
        `the capability registry violates ${String(registryValidation.errors.length)} registry law(s) — carried verbatim, nothing extracted`,
        undefined,
        undefined,
        registryValidation.errors,
      ),
    );
  }

  const seen = new Set<string>();
  const valid: TrajectoryRecord[] = [];
  for (const record of trajectories) {
    const id = String(record.trajectoryId);
    const outcome = validateTrajectoryRecord(record);
    if (!outcome.ok) {
      errors.push(
        error(
          "malformed-trajectory",
          `trajectory '${id}' fails W037 re-validation (${String(outcome.errors.length)} error(s)) — carried verbatim, nothing extracted`,
          id,
          outcome.errors,
        ),
      );
      continue;
    }
    if (!sameScope(registry.scope, record.scope)) {
      errors.push(
        error(
          "trajectory-scope-mismatch",
          `trajectory '${id}' measured in scope (${record.scope.tenantId}, ${record.scope.projectId}, ${record.scope.worldId}) which disagrees with the registry's scope (${registry.scope.tenantId}, ${registry.scope.projectId}, ${registry.scope.worldId}) — skills are extracted WHERE the capability was measured`,
          id,
        ),
      );
      continue;
    }
    if (seen.has(id)) {
      errors.push(
        error(
          "duplicate-trajectory",
          `trajectory '${id}' appears twice in the batch — extraction input is duplicate-free by law`,
          id,
        ),
      );
      continue;
    }
    seen.add(id);
    valid.push(record);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const trajectoryIds = valid.map((record) => String(record.trajectoryId)).sort(compareStrings);
  const extractionId = extractionIdOf({
    registryFingerprint: registryFingerprintOf(registry),
    trajectoryIds,
  });

  const skills: SkillRecord[] = [];
  const refusals: SkillRefusal[] = [];
  for (const entry of registry.entries) {
    const capabilityId = entry.descriptor.capabilityId;
    if (entry.state !== "registered") {
      const code: SkillRefusalCode = entry.state === "deprecated" ? "capability-deprecated" : "capability-revoked";
      refusals.push({
        code,
        capabilityId,
        message:
          code === "capability-deprecated"
            ? `capability '${String(capabilityId)}' (${entry.descriptor.name}) is DEPRECATED — it still resolves for lineage, yet fails demand-matching loudly (the W040 lifecycle law) and the extraction derives no skill from it`
            : `capability '${String(capabilityId)}' (${entry.descriptor.name}) is REVOKED (terminal) — it still resolves for lineage, yet fails demand-matching loudly (the W040 lifecycle law) and the extraction derives no skill from it`,
      });
      continue;
    }
    const citedExperiments = new Set(
      entry.descriptor.provenance.map((citation) => String(citation.experimentId)),
    );
    const demonstrating = valid
      .filter(
        (record) =>
          citedExperiments.has(record.scope.experimentId) &&
          bearerDemonstrated(entry.descriptor.bearer, record.session),
      )
      .sort((left, right) =>
        compareStrings(String(left.trajectoryId), String(right.trajectoryId)),
      );
    if (demonstrating.length === 0) {
      refusals.push({
        code: "no-trajectory-evidence",
        capabilityId,
        message: `R052 (capability discovery is EMPIRICAL): no trajectory in the batch demonstrates capability '${String(capabilityId)}' (${entry.descriptor.name}) — no evidence, no skill (fail-closed, never a label)`,
      });
      continue;
    }
    skills.push(skillOf(entry, demonstrating, extractionId));
  }

  const sortedSkills = [...skills].sort((left, right) =>
    compareStrings(String(left.skillId), String(right.skillId)),
  );
  const scope: SkillScope = {
    tenantId: registry.scope.tenantId,
    projectId: registry.scope.projectId,
    worldId: registry.scope.worldId,
  };
  return { ok: true, run: { extractionId, scope, skills: sortedSkills, refusals } };
}
