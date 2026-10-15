/**
 * The skill re-validation gates (W041) — re-prove the skill laws from the
 * RECORDED data (the W037/W040 re-validation precedent): the closed
 * vocabularies (W040's own, never re-declared), the blank laws, the R052
 * evidence-presence law, the citation laws, the canonical order laws, the
 * summary-evidence agreement (the carry law), the lineage shape laws, the
 * identity law (the id is the canonical derivation of the record's own
 * content), and — for a COLLECTION — the duplicate/scope/lineage-chain
 * laws. The W037/W038 artifacts are NOT re-verified here: the extraction
 * gate proved them once; the skill records citations, not payloads. This
 * gate never re-scores, it re-proves.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  CAPABILITY_BEARER_KINDS,
  CAPABILITY_DOMAINS,
  CAPABILITY_KINDS,
} from "capability-registry";
import type { CapabilityBearer } from "capability-registry";
import { skillIdOf } from "./identity.js";
import type { SkillCanonicalInput } from "./identity.js";
import type { SkillError, SkillRecord, SkillSetValidationOutcome, SkillValidationOutcome } from "./record.js";

function error(code: SkillError["code"], message: string, skillId?: string): SkillError {
  return { code, message, ...(skillId === undefined ? {} : { skillId }) };
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

function inClosedSet<T extends string>(set: readonly T[], value: string): boolean {
  return set.some((member) => member === value);
}

function bearerIdOf(bearer: CapabilityBearer): string {
  // Defensive on runtime-malformed bearers: the blank law fires, never a crash.
  if (bearer.kind === "substrate") {
    return String(bearer.substrateId ?? "");
  }
  return String((bearer as { readonly bodyId?: string }).bodyId ?? "");
}

/**
 * The canonical identity projection of an ASSEMBLED record — the exact
 * input `skillIdOf` weighs. Public so consumers (and tests) can re-derive
 * an id after honestly re-shaping a record.
 */
export function canonicalSkillProjectionOf(record: SkillRecord): SkillCanonicalInput {
  return {
    capabilityId: String(record.competence.capabilityId),
    kind: record.competence.kind,
    domain: record.competence.domain,
    bearer: { kind: record.bearer.kind, id: bearerIdOf(record.bearer) },
    scope: record.scope,
    trajectoryIds: record.evidence.trajectoryIds.map(String),
    lineage: {
      parentSkillId:
        record.lineage.parentSkillId === null ? null : String(record.lineage.parentSkillId),
      version: record.lineage.version,
    },
  };
}

function sortedCopy(values: readonly string[]): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Re-validate ONE assembled skill record against the skill laws. Every
 * violation is a typed error with the law named in the message and the
 * offending skill id attached; all violations are collected, none silently
 * dropped. R052 is the headline: a record with no trajectory evidence is
 * the typed `unmeasured-capability` error naming the law.
 */
export function validateSkillRecord(record: SkillRecord): SkillValidationOutcome {
  const errors: SkillError[] = [];
  const id = String(record.skillId);

  for (const [field, value] of [
    ["tenantId", record.scope.tenantId],
    ["projectId", record.scope.projectId],
    ["worldId", record.scope.worldId],
  ] as const) {
    if (blank(value)) {
      errors.push(error("blank-scope-member", `the skill scope's '${field}' is blank — scope is explicit, never blank`, id));
    }
  }

  if (blank(String(record.competence.capabilityId)) || blank(record.competence.name)) {
    errors.push(error("blank-capability-reference", `skill '${id}' carries a blank capability reference (id or name) — the competence statement names the W040 capability it was measured as`, id));
  }
  if (!inClosedSet(CAPABILITY_KINDS, record.competence.kind)) {
    errors.push(error("unknown-capability-kind", `skill '${id}' carries kind '${record.competence.kind}' outside the W040 closed vocabulary — the competence statement never re-declares the vocabulary`, id));
  }
  if (!inClosedSet(CAPABILITY_DOMAINS, record.competence.domain)) {
    errors.push(error("unknown-capability-domain", `skill '${id}' carries domain '${record.competence.domain}' outside the W040 closed vocabulary`, id));
  }
  if (!inClosedSet(CAPABILITY_BEARER_KINDS, record.bearer.kind)) {
    errors.push(error("unknown-bearer-kind", `skill '${id}' carries bearer kind '${record.bearer.kind}' outside the W040 closed set (substrate, body) — the bearer dimension names WHO demonstrated it`, id));
  }
  if (blank(bearerIdOf(record.bearer))) {
    errors.push(error("blank-bearer-id", `skill '${id}' carries a blank bearer id — the bearer dimension is explicit, never blank`, id));
  }

  // R052 — THE law of this package.
  if (record.evidence.trajectoryIds.length === 0) {
    errors.push(error("unmeasured-capability", `R052 (capability discovery is EMPIRICAL): skill '${id}' records no trajectory evidence — a skill without trajectory evidence is REJECTED, never a label`, id));
  }

  const citedTrajectories = new Set<string>();
  for (const trajectoryId of record.evidence.trajectoryIds) {
    const cited = String(trajectoryId);
    if (blank(cited)) {
      errors.push(error("blank-citation-member", `skill '${id}' cites a trajectory with a blank id — citations are canonical ids, never blank`, id));
      continue;
    }
    if (citedTrajectories.has(cited)) {
      errors.push(error("duplicate-evidence-citation", `skill '${id}' cites trajectory '${cited}' twice — evidence citations are a set`, id));
    }
    citedTrajectories.add(cited);
  }
  for (const experimentId of record.evidence.experimentIds) {
    if (blank(String(experimentId))) {
      errors.push(error("blank-citation-member", `skill '${id}' cites an experiment with a blank id — citations are canonical ids, never blank`, id));
    }
  }
  for (const citation of record.evidence.capabilityProvenance) {
    if (
      blank(String(citation.experimentId)) ||
      blank(String(citation.evaluationId)) ||
      blank(citation.findingsDigest)
    ) {
      errors.push(error("blank-citation-member", `skill '${id}' carries a measured-provenance citation with a blank member — carried citations are canonical ids, never blank`, id));
    }
  }

  if (
    JSON.stringify(sortedCopy(record.evidence.trajectoryIds.map(String))) !==
    JSON.stringify(record.evidence.trajectoryIds.map(String))
  ) {
    errors.push(error("non-canonical-order", `skill '${id}' cites its trajectory evidence out of canonical (sorted id) order — declaration order must never leak into the record value (A9)`, id));
  }
  if (
    JSON.stringify(sortedCopy(record.evidence.experimentIds.map(String))) !==
    JSON.stringify(record.evidence.experimentIds.map(String))
  ) {
    errors.push(error("non-canonical-order", `skill '${id}' cites its experiments out of canonical (sorted id) order — declaration order must never leak into the record value (A9)`, id));
  }

  // The carry law: the summary summarizes the evidence, never invents it.
  const carryIds = record.summary.outcomeCarries.map((carry) => String(carry.trajectoryId));
  if (
    record.summary.trajectoryCount !== record.evidence.trajectoryIds.length ||
    record.summary.outcomeCarries.length !== record.evidence.trajectoryIds.length ||
    JSON.stringify(carryIds) !== JSON.stringify(record.evidence.trajectoryIds.map(String))
  ) {
    errors.push(error("summary-evidence-mismatch", `skill '${id}' carries a summary that disagrees with its evidence (${String(record.summary.outcomeCarries.length)} carry(ies) over ${String(record.summary.trajectoryCount)} declared of ${String(record.evidence.trajectoryIds.length)} cited trajectory(ies)) — the summary CARRIES the evidence, never replaces it`, id));
  }
  for (const carry of record.summary.outcomeCarries) {
    if (blank(carry.policyId)) {
      errors.push(error("summary-evidence-mismatch", `skill '${id}' carries an outcome summary with a blank policy id — carried data is never blank`, id));
    }
  }

  if (!Number.isInteger(record.lineage.version) || record.lineage.version < 1) {
    errors.push(error("invalid-lineage", `skill '${id}' carries lineage version ${String(record.lineage.version)} — versions are positive integers from 1`, id));
  }
  if (record.lineage.version === 1 && record.lineage.parentSkillId !== null) {
    errors.push(error("invalid-lineage", `skill '${id}' is version 1 but cites a parent — genesis is parentless`, id));
  }
  if (record.lineage.version > 1 && record.lineage.parentSkillId === null) {
    errors.push(error("invalid-lineage", `skill '${id}' carries lineage version ${String(record.lineage.version)} without a parent`, id));
  }

  if (blank(String(record.provenance.extractionId))) {
    errors.push(error("blank-provenance", `skill '${id}' carries a blank extraction provenance — WHICH run derived the skill is explicit, never blank`, id));
  }

  // The identity law: the id is the canonical derivation of the content.
  if (skillIdOf(canonicalSkillProjectionOf(record)) !== record.skillId) {
    errors.push(error("skill-id-mismatch", `skill '${id}' is not the canonical derivation of its own content — identity is a function of the measured evidence bytes (A9), never an arbitrary label`, id));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    checked: [
      "scope",
      "competence-vocabulary",
      "bearer",
      "evidence-presence",
      "evidence-citations",
      "canonical-order",
      "summary-agreement",
      "lineage-shape",
      "provenance",
      "identity",
    ],
  };
}

/**
 * The collection laws: every record valid (errors carried), no duplicate
 * skill ids, one scope for the whole collection, and every lineage parent
 * present with continuous versions. A mangled collection fails LOUDLY
 * with the law named.
 */
export function validateSkillSet(records: readonly SkillRecord[]): SkillSetValidationOutcome {
  const errors: SkillError[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const id = String(record.skillId);
    if (seen.has(id)) {
      errors.push(error("duplicate-skill", `skill '${id}' appears twice in the collection — skill identity is exact canonical-id identity`, id));
    }
    seen.add(id);
    const outcome = validateSkillRecord(record);
    if (!outcome.ok) {
      errors.push(...outcome.errors);
    }
  }

  const reference = records[0];
  if (reference !== undefined) {
    for (const record of records.slice(1)) {
      if (
        record.scope.tenantId !== reference.scope.tenantId ||
        record.scope.projectId !== reference.scope.projectId ||
        record.scope.worldId !== reference.scope.worldId
      ) {
        errors.push(error("scope-mismatch", `skill '${String(record.skillId)}' declares scope (${record.scope.tenantId}, ${record.scope.projectId}, ${record.scope.worldId}) which disagrees with the collection's scope (${reference.scope.tenantId}, ${reference.scope.projectId}, ${reference.scope.worldId}) — a skill collection is single-scope`, String(record.skillId)));
      }
    }
  }

  for (const record of records) {
    const parent = record.lineage.parentSkillId;
    if (parent === null) {
      continue;
    }
    const parentRecord = records.find((candidate) => String(candidate.skillId) === String(parent));
    const id = String(record.skillId);
    if (parentRecord === undefined) {
      errors.push(error("lineage-break", `skill '${id}' cites parent '${String(parent)}' which is not in the collection — a successor cites a REAL parent`, id));
    } else if (parentRecord.lineage.version !== record.lineage.version - 1) {
      errors.push(error("lineage-break", `skill '${id}' (version ${String(record.lineage.version)}) cites parent '${String(parent)}' (version ${String(parentRecord.lineage.version)}) — versions are continuous`, id));
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, checked: ["record-laws", "duplicate-identity", "single-scope", "lineage-chain"] };
}
