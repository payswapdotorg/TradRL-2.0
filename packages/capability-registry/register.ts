/**
 * The registration gate (W040) — R052 enforced STRUCTURALLY.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL":
 * a capability without measured provenance is REJECTED here with the
 * typed, loud error `unmeasured-capability` naming the law — never a
 * label-only entry, never silent acceptance. And the provenance must be
 * REAL as far as a pure registry can prove: every citation's W037
 * experiment is re-identified through `experimentIdOf` (a fabricated
 * experiment id is a typed mismatch), the W038 findings report's digest is
 * re-derived through `findingsDigestOf` (a fabricated digest is a typed
 * mismatch), the findings' subject must BE the cited evaluation, the
 * counts must agree with the findings themselves, and the cited
 * measurement must have PASSED (failures and empty verdicts establish
 * nothing). NO measurement execution happens here — the measuring lived
 * in the W037/W038 artifacts; the gate VERIFIES records, it never re-runs
 * them.
 *
 * A9: `registerCapability` is pure — it returns a NEW registry with the
 * entry inserted in canonical capability-id order (no clocks, no
 * randomness, no env reads; same inputs ⇒ deep-equal registry).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { experimentIdOf } from "experiments";
import type { ExperimentDescriptor } from "experiments";
import { findingsDigestOf } from "verification";
import type { FindingsReport } from "verification";
import type { ExperimentEvaluation } from "evaluation";
import type { OrganizationCapabilityId } from "organization";
import { capabilityIdOf } from "./identity.js";
import type { CapabilityCanonicalInput, CapabilityId, CapabilityScope } from "./identity.js";
import {
  CAPABILITY_BEARER_KINDS,
  CAPABILITY_DOMAINS,
  CAPABILITY_KINDS,
} from "./descriptor.js";
import type {
  CapabilityBearer,
  CapabilityError,
  CapabilityDomain,
  CapabilityKind,
  CapabilityLineage,
  CapabilityRegistry,
  RegistryEntry,
} from "./descriptor.js";

/**
 * One measured-evidence bundle: the W037 experiment descriptor (re-identified
 * through `experimentIdOf` at the gate), the W038 experiment evaluation
 * (the measurement — its `experimentId` must bind to the descriptor), and
 * the W038 findings report over THAT evaluation (its `subject` must be the
 * evaluation id; its digest is re-derived; its verdict must have PASSED).
 */
export interface MeasuredEvidence {
  readonly experiment: ExperimentDescriptor;
  readonly evaluation: ExperimentEvaluation;
  readonly findings: FindingsReport;
}

/**
 * The registration input: the declared capability (name, kind, domain,
 * bearer, scope, the W039 organization capabilities it provides, lineage)
 * plus the MEASURED evidence that empirically established it. The closed
 * sets are typed AND runtime-re-proved (the W037/W038 post-parse
 * malformed-member precedent) — a kind outside the table is a typed
 * error, not a type hole.
 */
export interface CapabilityRegistration {
  readonly name: string;
  readonly description?: string;
  readonly kind: CapabilityKind;
  readonly domain: CapabilityDomain;
  readonly bearer: CapabilityBearer;
  readonly scope: CapabilityScope;
  readonly providesOrganizationCapabilityIds: readonly OrganizationCapabilityId[];
  readonly lineage: CapabilityLineage;
  readonly evidence: readonly MeasuredEvidence[];
}

export type RegistrationOutcome =
  | {
      readonly ok: true;
      readonly registry: CapabilityRegistry;
      readonly capabilityId: CapabilityId;
    }
  | { readonly ok: false; readonly errors: readonly CapabilityError[] };

function error(code: CapabilityError["code"], message: string, entryId?: string): CapabilityError {
  return { code, message, ...(entryId === undefined ? {} : { entryId }) };
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

function bearerIdOf(bearer: CapabilityBearer): string {
  // Defensive on runtime-malformed bearers (a kind outside the closed set
  // may carry either member): the blank law fires, never a crash.
  if (bearer.kind === "substrate") {
    return String(bearer.substrateId ?? "");
  }
  return String((bearer as { readonly bodyId?: string }).bodyId ?? "");
}

function sameScope(
  left: CapabilityScope,
  right: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.projectId === right.projectId &&
    left.worldId === right.worldId
  );
}

/** The closed-set membership check (runtime; malformed post-parse members). */
function inClosedSet<T extends string>(set: readonly T[], value: string): boolean {
  return set.some((member) => member === value);
}

/** The scope a W037 experiment measured in (tenant/project + its world ref). */
function experimentScope(experiment: ExperimentDescriptor): CapabilityScope {
  return {
    tenantId: experiment.tenantId,
    projectId: experiment.projectId,
    worldId: experiment.world.worldId,
  };
}

/** Re-derive the findings' counts from the findings themselves. */
function findingsCounts(findings: FindingsReport): {
  pass: number;
  fail: number;
  partial: number;
  undeclared: number;
} {
  let pass = 0;
  let fail = 0;
  let partial = 0;
  let undeclared = 0;
  for (const finding of findings.findings) {
    if (finding.findingKind === "undeclared-failure") {
      undeclared += 1;
      continue;
    }
    if (finding.verdict === "PASS") {
      pass += 1;
    } else if (finding.verdict === "FAIL") {
      fail += 1;
    } else {
      partial += 1;
    }
  }
  return { pass, fail, partial, undeclared };
}

/**
 * The canonical projection of a registration — the capability id's input
 * (see ./identity.ts): the bearer flattened to { kind, id }, the id-typed
 * members rendered as strings, everything the identity weighs.
 */
export function canonicalRegistration(
  registration: CapabilityRegistration,
): CapabilityCanonicalInput {
  return {
    name: registration.name,
    ...(registration.description === undefined ? {} : { description: registration.description }),
    kind: registration.kind,
    domain: registration.domain,
    bearer: { kind: registration.bearer.kind, id: bearerIdOf(registration.bearer) },
    scope: registration.scope,
    providesOrganizationCapabilityIds: registration.providesOrganizationCapabilityIds.map((id) => String(id)),
    lineage: {
      parentCapabilityId:
        registration.lineage.parentCapabilityId === null
          ? null
          : String(registration.lineage.parentCapabilityId),
      version: registration.lineage.version,
    },
    provenance: registration.evidence.map((citation) => ({
      experimentId: String(experimentIdOf(citation.experiment)),
      evaluationId: String(citation.evaluation.evaluationId),
      findingsDigest: citation.findings.digest,
    })),
  };
}

/**
 * Create an EMPTY registry over one declared scope. Declaration only —
 * the scope laws are proven by `registerCapability` (per entry) and
 * `validateCapabilityRegistry` (whole-registry).
 */
export function createCapabilityRegistry(scope: CapabilityScope): CapabilityRegistry {
  return { scope, entries: [] };
}

/**
 * THE REGISTRATION GATE. Structure first (name, scope, closed vocabularies,
 * bearer, provides, lineage shape), then R052 (measured provenance — the
 * headline law), then each citation's empirical binding (experiment
 * identity, evaluation binding, findings subject, digest re-derivation,
 * counts, verdict), then the registry's own laws (single scope, lineage
 * parent existence + version continuity, duplicate identity). Every
 * violation is a typed error with the law named in the message; all
 * violations are collected, none silently dropped.
 */
export function registerCapability(
  registry: CapabilityRegistry,
  registration: CapabilityRegistration,
): RegistrationOutcome {
  const errors: CapabilityError[] = [];

  // -- structure ------------------------------------------------------------
  if (blank(registration.name)) {
    errors.push(error("blank-capability-name", "the capability name is blank — a label needs a name, a measurement needs more"));
  }
  for (const [field, value] of [
    ["tenantId", registration.scope.tenantId],
    ["projectId", registration.scope.projectId],
    ["worldId", registration.scope.worldId],
  ] as const) {
    if (blank(value)) {
      errors.push(error("blank-scope-member", `the capability scope's '${field}' is blank — scope is explicit, never blank`));
    }
  }
  if (!inClosedSet(CAPABILITY_KINDS, registration.kind)) {
    errors.push(error("unknown-capability-kind", `capability kind '${registration.kind}' is outside the closed vocabulary — the registry answers in ${CAPABILITY_KINDS.join(", ")} only`));
  }
  if (!inClosedSet(CAPABILITY_DOMAINS, registration.domain)) {
    errors.push(error("unknown-capability-domain", `capability domain '${registration.domain}' is outside the closed vocabulary — the registry answers in ${CAPABILITY_DOMAINS.join(", ")} only`));
  }
  if (!inClosedSet(CAPABILITY_BEARER_KINDS, registration.bearer.kind)) {
    errors.push(error("unknown-bearer-kind", `bearer kind '${registration.bearer.kind}' is outside the closed set (substrate, body) — the bearer dimension names WHO demonstrated the capability`));
  }
  if (blank(bearerIdOf(registration.bearer))) {
    errors.push(error("blank-bearer-id", `the ${registration.bearer.kind} bearer id is blank — the bearer dimension is explicit, never blank`));
  }
  const providesSeen = new Set<string>();
  for (const provided of registration.providesOrganizationCapabilityIds) {
    const id = String(provided);
    if (blank(id)) {
      errors.push(error("blank-provides-member", "a provided organization capability id is blank"));
    }
    if (providesSeen.has(id)) {
      errors.push(error("duplicate-provides", `organization capability '${id}' is provided twice — an offering is declared once (the W039 duplicate-offering law)`));
    }
    providesSeen.add(id);
  }
  if (!Number.isInteger(registration.lineage.version) || registration.lineage.version < 1) {
    errors.push(error("invalid-lineage-version", `lineage version ${String(registration.lineage.version)} is not a positive integer — versions start at 1`));
  }
  if (registration.lineage.version === 1 && registration.lineage.parentCapabilityId !== null) {
    errors.push(error("lineage-break", "a version-1 capability is genesis: it cannot cite a parent"));
  }
  if (registration.lineage.version > 1 && registration.lineage.parentCapabilityId === null) {
    errors.push(error("lineage-break", `lineage version ${String(registration.lineage.version)} without a parent — only genesis (version 1) is parentless`));
  }

  // -- R052: the measured provenance ---------------------------------------
  if (registration.evidence.length === 0) {
    errors.push(error(
      "unmeasured-capability",
      "R052 (capability discovery is EMPIRICAL): a capability without measured provenance is refused — labels are not measurements; cite the W037/W038 artifacts that established it",
    ));
  }
  for (const citation of registration.evidence) {
    const experimentId = experimentIdOf(citation.experiment);
    const evaluationExperimentId = String(citation.evaluation.experimentId);
    if (
      blank(evaluationExperimentId) ||
      blank(String(citation.evaluation.evaluationId)) ||
      blank(citation.findings.digest)
    ) {
      errors.push(error("blank-citation-member", "a citation member (experimentId, evaluationId or findingsDigest) is blank — citations are canonical ids, never blank", evaluationExperimentId));
      continue;
    }
    if (!sameScope(registration.scope, experimentScope(citation.experiment))) {
      errors.push(error("scope-mismatch", `the cited experiment '${experimentId}' measured in scope (${citation.experiment.tenantId}, ${citation.experiment.projectId}, ${citation.experiment.world.worldId}) which disagrees with the capability's scope — a capability is measured WHERE it is claimed`, experimentId));
    }
    if (experimentId !== citation.evaluation.experimentId) {
      errors.push(error("citation-experiment-mismatch", `the cited evaluation '${String(citation.evaluation.evaluationId)}' is bound to experiment '${evaluationExperimentId}' but the cited descriptor's canonical id is '${experimentId}' — fabricated citations are refused`, experimentId));
    }
    if (String(citation.evaluation.evaluationId) !== citation.findings.subject) {
      errors.push(error("citation-findings-mismatch", `the cited findings report's subject '${citation.findings.subject}' is not the cited evaluation '${String(citation.evaluation.evaluationId)}' — the findings must verify the evaluation they are cited for`, String(citation.evaluation.evaluationId)));
    }
    const rederived = findingsDigestOf(citation.findings.subject, citation.findings.findings);
    if (rederived !== citation.findings.digest) {
      errors.push(error("citation-digest-mismatch", `the cited findings report's digest '${citation.findings.digest}' does not match its re-derivation '${rederived}' (findingsDigestOf over subject + findings) — the evidence chain is content-addressed`, citation.findings.subject));
    }
    const counts = findingsCounts(citation.findings);
    if (
      counts.pass !== citation.findings.passCount ||
      counts.fail !== citation.findings.failCount ||
      counts.partial !== citation.findings.partialCount ||
      counts.undeclared !== citation.findings.undeclaredCount
    ) {
      errors.push(error("citation-count-mismatch", `the cited findings report's counts (${String(citation.findings.passCount)} pass, ${String(citation.findings.failCount)} fail, ${String(citation.findings.partialCount)} partial, ${String(citation.findings.undeclaredCount)} undeclared) disagree with its own findings (${String(counts.pass)}/${String(counts.fail)}/${String(counts.partial)}/${String(counts.undeclared)})`, citation.findings.subject));
    }
    if (citation.findings.failCount > 0 || citation.findings.undeclaredCount > 0) {
      errors.push(error("failed-evidence", `the cited findings report over '${citation.findings.subject}' carries ${String(citation.findings.failCount)} failed and ${String(citation.findings.undeclaredCount)} undeclared findings — a FAILED measurement establishes no capability`, citation.findings.subject));
    }
    if (citation.findings.passCount === 0) {
      errors.push(error("unmeasured-evidence", `the cited findings report over '${citation.findings.subject}' has no PASS verdict — nothing was positively measured, so nothing is established`, citation.findings.subject));
    }
  }

  // -- the registry's own laws ---------------------------------------------
  if (!sameScope(registry.scope, registration.scope)) {
    errors.push(error("registry-scope-mismatch", `the capability declares scope (${registration.scope.tenantId}, ${registration.scope.projectId}, ${registration.scope.worldId}) which disagrees with the registry's declared scope — the registry is single-scope`));
  }

  const canonical = canonicalRegistration(registration);
  const capabilityId = capabilityIdOf(canonical);
  const parent = registration.lineage.parentCapabilityId;
  if (parent !== null) {
    const parentEntry = registry.entries.find(
      (entry) => String(entry.descriptor.capabilityId) === String(parent),
    );
    if (parentEntry === undefined) {
      errors.push(error("lineage-break", `lineage parent '${String(parent)}' is not registered — a successor cites a REAL parent, in THIS registry`, String(parent)));
    } else if (parentEntry.descriptor.lineage.version !== registration.lineage.version - 1) {
      errors.push(error("lineage-break", `lineage version ${String(registration.lineage.version)} must be exactly parent '${String(parent)}'s version (${String(parentEntry.descriptor.lineage.version)}) + 1 — versions are continuous`, String(parent)));
    }
  }
  if (registry.entries.some((entry) => String(entry.descriptor.capabilityId) === String(capabilityId))) {
    errors.push(error("duplicate-capability", `capability '${String(capabilityId)}' is already registered — registry identity is exact canonical-id identity`, String(capabilityId)));
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const entry: RegistryEntry = {
    descriptor: {
      capabilityId,
      name: registration.name,
      ...(registration.description === undefined ? {} : { description: registration.description }),
      kind: registration.kind,
      domain: registration.domain,
      bearer: registration.bearer,
      scope: registration.scope,
      providesOrganizationCapabilityIds: [...registration.providesOrganizationCapabilityIds].sort(
        (left, right) => (left < right ? -1 : left > right ? 1 : 0),
      ),
      lineage: registration.lineage,
      provenance: registration.evidence.map((citation) => ({
        experimentId: experimentIdOf(citation.experiment),
        evaluationId: citation.evaluation.evaluationId,
        findingsDigest: citation.findings.digest,
      })),
    },
    state: "registered",
    transitions: [],
  };
  const entries = [...registry.entries, entry].sort((left, right) =>
    String(left.descriptor.capabilityId) < String(right.descriptor.capabilityId) ? -1 : 1,
  );
  return { ok: true, registry: { scope: registry.scope, entries }, capabilityId };
}
