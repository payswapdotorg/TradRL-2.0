/**
 * The component registry contracts (W039 compile service) — the typed
 * registry INPUT the compiler resolves positions against.
 *
 * The registry is DATA, never discovery: the concrete W032 bodies and
 * W033 substrates available to compose into an organization, each with
 * the capabilities it offers. Fail-closed validation proves the
 * registry's own honesty before any position is resolved (duplicate
 * component ids, scope agreement with the registry's declared scope,
 * descriptor validity delegated to the components' OWN validators with
 * errors carried verbatim).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateBodyDescriptor } from "agent-body";
import type { BodyDescriptor } from "agent-body";
import { validateSubstrateDescriptor } from "cognitive-substrate";
import type { CognitiveSubstrateDescriptor } from "cognitive-substrate";
import type { OrganizationCapabilityId, OrganizationScope } from "organization";

/** One registered W032 Body, with the capabilities it offers. */
export interface RegisteredBody {
  readonly body: BodyDescriptor;
  readonly providesCapabilities: readonly OrganizationCapabilityId[];
}

/** One registered W033 Cognitive Substrate, with the capabilities it offers. */
export interface RegisteredSubstrate {
  readonly substrate: CognitiveSubstrateDescriptor;
  readonly providesCapabilities: readonly OrganizationCapabilityId[];
}

/**
 * The component registry: the declared scope every registered component
 * must agree with, plus the bodies and substrates. Declaration only —
 * resolution belongs to ./compile.ts.
 */
export interface OrganizationComponentRegistry {
  readonly scope: OrganizationScope;
  readonly bodies: readonly RegisteredBody[];
  readonly substrates: readonly RegisteredSubstrate[];
}

/** The typed error of one violated registry law. */
export interface ComponentRegistryError {
  readonly code: ComponentRegistryErrorCode;
  readonly message: string;
  readonly field?: string;
}

export type ComponentRegistryErrorCode =
  | "duplicate-body" // the same body registered twice
  | "duplicate-substrate" // the same substrate registered twice
  | "duplicate-offering" // the same capability offered twice by one component
  | "registry-scope-mismatch" // a component's scope disagrees with the registry's
  | "invalid-body" // the W032 validator refused the body (carried verbatim)
  | "invalid-substrate"; // the W033 validator refused the substrate (carried verbatim)

export type ComponentRegistryValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | {
      readonly ok: false;
      readonly errors: readonly ComponentRegistryError[];
      /** The W032/W033 errors carried verbatim, keyed by component id. */
      readonly bodyErrors?: readonly { readonly bodyId: string; readonly errors: readonly unknown[] }[];
      readonly substrateErrors?: readonly { readonly substrateId: string; readonly errors: readonly unknown[] }[];
    };

function error(
  code: ComponentRegistryError["code"],
  message: string,
  field?: string,
): ComponentRegistryError {
  return { code, message, ...(field === undefined ? {} : { field }) };
}

function sameScope(
  scope: OrganizationScope,
  candidate: { readonly tenantId: string; readonly projectId: string; readonly worldId: string },
): boolean {
  return (
    scope.tenantId === String(candidate.tenantId) &&
    scope.projectId === String(candidate.projectId) &&
    scope.worldId === String(candidate.worldId)
  );
}

function checkDuplicateOfferings(
  offerings: readonly OrganizationCapabilityId[],
  label: string,
  errors: ComponentRegistryError[],
): void {
  const seen = new Set<string>();
  for (const capabilityId of offerings) {
    const id = String(capabilityId);
    if (seen.has(id)) {
      errors.push(error("duplicate-offering", `${label} offers capability '${id}' twice — an offering is declared once`, "providesCapabilities"));
    }
    seen.add(id);
  }
}

/**
 * The registry's own honesty gate: duplicate components, duplicate
 * offerings, scope agreement and descriptor validity (delegated to the
 * W032/W033 validators, errors carried verbatim — never re-derived).
 */
export function validateComponentRegistry(
  registry: OrganizationComponentRegistry,
): ComponentRegistryValidationOutcome {
  const errors: ComponentRegistryError[] = [];
  const bodyErrors: { readonly bodyId: string; readonly errors: readonly unknown[] }[] = [];
  const substrateErrors: { readonly substrateId: string; readonly errors: readonly unknown[] }[] = [];

  const bodyIds = new Set<string>();
  for (const entry of registry.bodies) {
    const id = String(entry.body.bodyId);
    if (bodyIds.has(id)) {
      errors.push(error("duplicate-body", `body '${id}' is registered twice — registry identity is exact string identity`, "body.bodyId"));
    }
    bodyIds.add(id);
    if (!sameScope(registry.scope, entry.body.scope)) {
      errors.push(error("registry-scope-mismatch", `body '${id}' declares scope (${String(entry.body.scope.tenantId)}, ${String(entry.body.scope.projectId)}, ${String(entry.body.scope.worldId)}) which disagrees with the registry's declared scope — the registry is single-scope`, "body.scope"));
    }
    const validation = validateBodyDescriptor(entry.body);
    if (!validation.ok) {
      errors.push(error("invalid-body", `body '${id}' failed the W032 validator (${String(validation.errors.length)} error(s), carried verbatim)`, "body"));
      bodyErrors.push({ bodyId: id, errors: validation.errors });
    }
    checkDuplicateOfferings(entry.providesCapabilities, `body '${id}'`, errors);
  }

  const substrateIds = new Set<string>();
  for (const entry of registry.substrates) {
    const id = String(entry.substrate.substrateId);
    if (substrateIds.has(id)) {
      errors.push(error("duplicate-substrate", `substrate '${id}' is registered twice — registry identity is exact string identity`, "substrate.substrateId"));
    }
    substrateIds.add(id);
    const validation = validateSubstrateDescriptor(entry.substrate);
    if (!validation.ok) {
      errors.push(error("invalid-substrate", `substrate '${id}' failed the W033 validator (${String(validation.errors.length)} error(s), carried verbatim)`, "substrate"));
      substrateErrors.push({ substrateId: id, errors: validation.errors });
    }
    checkDuplicateOfferings(entry.providesCapabilities, `substrate '${id}'`, errors);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      ...(bodyErrors.length > 0 ? { bodyErrors } : {}),
      ...(substrateErrors.length > 0 ? { substrateErrors } : {}),
    };
  }
  return {
    ok: true,
    checked: ["body-identity", "body-scope", "body-validity", "substrate-identity", "substrate-validity", "offering-uniqueness"],
  };
}
