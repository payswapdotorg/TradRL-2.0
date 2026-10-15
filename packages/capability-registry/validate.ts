/**
 * The registry re-validation gate (W040) — re-proves the registry's own
 * laws from the RECORDED data (the W039 validateComponentRegistry
 * precedent): closed vocabularies, blank laws, scope agreement, canonical
 * order, duplicate identity, lineage chains (parent existence + version
 * continuity), the R052 provenance-presence law per entry, and the
 * lifecycle state/transition laws. The W037/W038 artifacts are NOT
 * re-verified here — the registration gate proved them once; the registry
 * records citations, not payloads.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  CAPABILITY_BEARER_KINDS,
  CAPABILITY_DOMAINS,
  CAPABILITY_KINDS,
  CAPABILITY_STATES,
} from "./descriptor.js";
import type { CapabilityError, CapabilityRegistry, RegistryEntry } from "./descriptor.js";

export type RegistryValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly CapabilityError[] };

function error(code: CapabilityError["code"], message: string, entryId?: string): CapabilityError {
  return { code, message, ...(entryId === undefined ? {} : { entryId }) };
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

function bearerIdOf(bearer: RegistryEntry["descriptor"]["bearer"]): string {
  // Defensive on runtime-malformed bearers: the blank law fires, never a crash.
  if (bearer.kind === "substrate") {
    return String(bearer.substrateId ?? "");
  }
  return String((bearer as { readonly bodyId?: string }).bodyId ?? "");
}

function inClosedSet<T extends string>(set: readonly T[], value: string): boolean {
  return set.some((member) => member === value);
}

function checkEntry(
  registry: CapabilityRegistry,
  entry: RegistryEntry,
  errors: CapabilityError[],
): void {
  const descriptor = entry.descriptor;
  const id = String(descriptor.capabilityId);

  if (blank(descriptor.name)) {
    errors.push(error("blank-capability-name", `capability '${id}' has a blank name`, id));
  }
  for (const [field, value] of [
    ["tenantId", registry.scope.tenantId],
    ["projectId", registry.scope.projectId],
    ["worldId", registry.scope.worldId],
  ] as const) {
    if (blank(value)) {
      errors.push(error("blank-scope-member", `the registry scope's '${field}' is blank — scope is explicit, never blank`));
    }
  }
  if (blank(descriptor.scope.tenantId) || blank(descriptor.scope.projectId) || blank(descriptor.scope.worldId)) {
    errors.push(error("blank-scope-member", `capability '${id}' declares a blank scope member`, id));
  }
  if (
    descriptor.scope.tenantId !== registry.scope.tenantId ||
    descriptor.scope.projectId !== registry.scope.projectId ||
    descriptor.scope.worldId !== registry.scope.worldId
  ) {
    errors.push(error("registry-scope-mismatch", `capability '${id}' declares scope (${descriptor.scope.tenantId}, ${descriptor.scope.projectId}, ${descriptor.scope.worldId}) which disagrees with the registry's declared scope — the registry is single-scope`, id));
  }
  if (!inClosedSet(CAPABILITY_KINDS, descriptor.kind)) {
    errors.push(error("unknown-capability-kind", `capability '${id}' carries kind '${descriptor.kind}' outside the closed vocabulary`, id));
  }
  if (!inClosedSet(CAPABILITY_DOMAINS, descriptor.domain)) {
    errors.push(error("unknown-capability-domain", `capability '${id}' carries domain '${descriptor.domain}' outside the closed vocabulary`, id));
  }
  if (!inClosedSet(CAPABILITY_BEARER_KINDS, descriptor.bearer.kind)) {
    errors.push(error("unknown-bearer-kind", `capability '${id}' carries bearer kind '${descriptor.bearer.kind}' outside the closed set (substrate, body)`, id));
  }
  if (blank(bearerIdOf(descriptor.bearer))) {
    errors.push(error("blank-bearer-id", `capability '${id}' carries a blank bearer id`, id));
  }
  const providesSeen = new Set<string>();
  for (const provided of descriptor.providesOrganizationCapabilityIds) {
    const providedId = String(provided);
    if (blank(providedId)) {
      errors.push(error("blank-provides-member", `capability '${id}' provides a blank organization capability id`, id));
    }
    if (providesSeen.has(providedId)) {
      errors.push(error("duplicate-provides", `capability '${id}' provides organization capability '${providedId}' twice (the W039 duplicate-offering law)`, id));
    }
    providesSeen.add(providedId);
  }
  if (!Number.isInteger(descriptor.lineage.version) || descriptor.lineage.version < 1) {
    errors.push(error("invalid-lineage-version", `capability '${id}' carries lineage version ${String(descriptor.lineage.version)} — versions are positive integers from 1`, id));
  }
  if (descriptor.lineage.version === 1 && descriptor.lineage.parentCapabilityId !== null) {
    errors.push(error("lineage-break", `capability '${id}' is version 1 but cites a parent — genesis is parentless`, id));
  }
  if (descriptor.lineage.version > 1 && descriptor.lineage.parentCapabilityId === null) {
    errors.push(error("lineage-break", `capability '${id}' carries lineage version ${String(descriptor.lineage.version)} without a parent`, id));
  }
  if (descriptor.provenance.length === 0) {
    errors.push(error("unmeasured-capability", `R052 (capability discovery is EMPIRICAL): capability '${id}' records no provenance citation — an unmeasured capability cannot sit in the registry`, id));
  }
  for (const citation of descriptor.provenance) {
    if (blank(String(citation.experimentId)) || blank(String(citation.evaluationId)) || blank(citation.findingsDigest)) {
      errors.push(error("blank-citation-member", `capability '${id}' records a citation with a blank member — citations are canonical ids, never blank`, id));
    }
  }
  if (!inClosedSet(CAPABILITY_STATES, entry.state)) {
    errors.push(error("unknown-capability-state", `capability '${id}' carries lifecycle state '${entry.state}' outside the closed set (registered, deprecated, revoked)`, id));
  }

  // The transition record: only moves away from "registered", reasons
  // non-blank, the replayed sequence must land exactly on the entry state.
  let replayed: string = "registered";
  for (const transition of entry.transitions) {
    const to = String(transition.to);
    if (to !== "deprecated" && to !== "revoked") {
      errors.push(error("invalid-lifecycle-transition", `capability '${id}' records a transition to '${to}' — transitions only target deprecated or revoked`, id));
      continue;
    }
    const legal =
      replayed === "registered" || (replayed === "deprecated" && to === "revoked");
    if (!legal) {
      errors.push(error("invalid-lifecycle-transition", `capability '${id}' records a transition '${replayed}' → '${to}' — lifecycle transitions are registered → deprecated → revoked, and revoked is terminal`, id));
    }
    if (blank(transition.reason)) {
      errors.push(error("blank-reason", `capability '${id}' records a transition with a blank reason — rationale-as-data is non-blank`, id));
    }
    replayed = to;
  }
  if (replayed !== entry.state) {
    errors.push(error("invalid-lifecycle-transition", `capability '${id}' is in state '${entry.state}' but its transition record replays to '${replayed}' — the state IS the last transition`, id));
  }
}

/**
 * The registry's own honesty gate: every entry's recorded laws re-proved,
 * cross-entry identity and lineage laws re-proved, the canonical A9 order
 * re-proved. A mangled registry value fails LOUDLY with the law named.
 */
export function validateCapabilityRegistry(
  registry: CapabilityRegistry,
): RegistryValidationOutcome {
  const errors: CapabilityError[] = [];

  const seen = new Set<string>();
  for (const entry of registry.entries) {
    const id = String(entry.descriptor.capabilityId);
    if (seen.has(id)) {
      errors.push(error("duplicate-capability", `capability '${id}' is registered twice — registry identity is exact canonical-id identity`, id));
    }
    seen.add(id);
    checkEntry(registry, entry, errors);
  }

  for (let index = 1; index < registry.entries.length; index += 1) {
    const previous = registry.entries[index - 1];
    const current = registry.entries[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      String(previous.descriptor.capabilityId) > String(current.descriptor.capabilityId)
    ) {
      errors.push(error("non-canonical-order", `the registry is not in canonical capability-id order at index ${String(index)} ('${String(current.descriptor.capabilityId)}' before '${String(previous.descriptor.capabilityId)}') — registration order must never leak into the registry value (A9)`));
    }
  }

  for (const entry of registry.entries) {
    const parent = entry.descriptor.lineage.parentCapabilityId;
    if (parent === null) {
      continue;
    }
    const parentEntry = registry.entries.find(
      (candidate) => String(candidate.descriptor.capabilityId) === String(parent),
    );
    const id = String(entry.descriptor.capabilityId);
    if (parentEntry === undefined) {
      errors.push(error("lineage-break", `capability '${id}' cites parent '${String(parent)}' which is not in the registry — a successor cites a REAL parent`, id));
    } else if (parentEntry.descriptor.lineage.version !== entry.descriptor.lineage.version - 1) {
      errors.push(error("lineage-break", `capability '${id}' (version ${String(entry.descriptor.lineage.version)}) cites parent '${String(parent)}' (version ${String(parentEntry.descriptor.lineage.version)}) — versions are continuous`, id));
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    checked: [
      "entry-identity",
      "entry-scope",
      "entry-vocabulary",
      "entry-bearer",
      "entry-provides",
      "entry-provenance-presence",
      "entry-lineage-shape",
      "entry-lifecycle",
      "cross-entry-lineage",
      "canonical-order",
    ],
  };
}
