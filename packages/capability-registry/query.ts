/**
 * Registry queries (W040) — deterministic, fail-closed lookups.
 *
 * The seam the W039 compiler consumes: `matchCapabilityDemand` answers,
 * typed and with reasons, whether a REGISTERED capability satisfies a
 * W039 position's capability demand (the organization's declared
 * capability + the demand on it, both in W039's own vocabulary — imported
 * from the organization package, never re-declared); and
 * `organizationOfferingsOf` projects the registry into the W039
 * component-registry's `providesCapabilities` shape, so that input is
 * BUILT from this package. Deprecated and revoked capabilities still
 * RESOLVE for lineage (`resolveCapability`) but fail demand-matching
 * LOUDLY — the rejection names the capability and its state, never a
 * silent no.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  OrganizationCapability,
  OrganizationCapabilityDemand,
  OrganizationCapabilityId,
  OrganizationScope,
} from "organization";
import { CAPABILITY_DOMAINS, CAPABILITY_KINDS } from "./descriptor.js";
import type {
  CapabilityBearer,
  CapabilityDomain,
  CapabilityError,
  CapabilityKind,
  CapabilityRegistry,
  RegistryEntry,
} from "./descriptor.js";
import type { CapabilityId, CapabilityScope } from "./identity.js";

// ---------------------------------------------------------------------------
// By id / by kind / by domain
// ---------------------------------------------------------------------------

export type CapabilityLookup =
  | { readonly ok: true; readonly entry: RegistryEntry }
  | { readonly ok: false; readonly errors: readonly CapabilityError[] };

/**
 * Resolve one capability by EXACT id — regardless of lifecycle state: a
 * deprecated or revoked capability still resolves for lineage (its
 * citations are historical facts). An unknown id is the typed
 * `unknown-capability` error, never a silent undefined.
 */
export function resolveCapability(
  registry: CapabilityRegistry,
  capabilityId: CapabilityId,
): CapabilityLookup {
  const entry = registry.entries.find(
    (candidate) => String(candidate.descriptor.capabilityId) === String(capabilityId),
  );
  if (entry === undefined) {
    return {
      ok: false,
      errors: [
        {
          code: "unknown-capability",
          message: `capability '${String(capabilityId)}' is not registered — the registry resolves exact ids only`,
          entryId: String(capabilityId),
        },
      ],
    };
  }
  return { ok: true, entry };
}

export type CapabilityEntryQueryOutcome =
  | { readonly ok: true; readonly entries: readonly RegistryEntry[] }
  | { readonly ok: false; readonly errors: readonly CapabilityError[] };

/**
 * All capabilities (any lifecycle state — the state rides on each entry)
 * of one closed kind, in the registry's canonical id order. A kind
 * outside the closed vocabulary is a typed error, never an empty
 * silently-answers-nothing list.
 */
export function capabilitiesOfKind(
  registry: CapabilityRegistry,
  kind: CapabilityKind,
): CapabilityEntryQueryOutcome {
  if (!CAPABILITY_KINDS.some((member) => member === kind)) {
    return {
      ok: false,
      errors: [
        {
          code: "unknown-capability-kind",
          message: `capability kind '${String(kind)}' is outside the closed vocabulary — the registry answers in ${CAPABILITY_KINDS.join(", ")} only`,
        },
      ],
    };
  }
  return { ok: true, entries: registry.entries.filter((entry) => entry.descriptor.kind === kind) };
}

/** All capabilities (any lifecycle state) of one closed domain, canonical order. */
export function capabilitiesInDomain(
  registry: CapabilityRegistry,
  domain: CapabilityDomain,
): CapabilityEntryQueryOutcome {
  if (!CAPABILITY_DOMAINS.some((member) => member === domain)) {
    return {
      ok: false,
      errors: [
        {
          code: "unknown-capability-domain",
          message: `capability domain '${String(domain)}' is outside the closed vocabulary — the registry answers in ${CAPABILITY_DOMAINS.join(", ")} only`,
        },
      ],
    };
  }
  return { ok: true, entries: registry.entries.filter((entry) => entry.descriptor.domain === domain) };
}

// ---------------------------------------------------------------------------
// The W039 demand-matching seam
// ---------------------------------------------------------------------------

/** The demand query: the demanding organization's scope + declared capability + the demand itself. */
export interface CapabilityDemandQuery {
  readonly scope: OrganizationScope;
  readonly capability: OrganizationCapability;
  readonly demand: OrganizationCapabilityDemand;
}

export type CapabilityDemandRejectionCode =
  | "inconsistent-demand" // the demand names a different capability than the declared one
  | "registry-scope-mismatch" // the demanding organization is out of this registry's scope
  | "unprovided-demand" // no registered capability provides the demanded organization capability
  | "capability-deprecated" // provided, measured — but deprecated: a loud no
  | "capability-revoked"; // provided, measured — but revoked: a loud no

export interface CapabilityDemandRejection {
  readonly code: CapabilityDemandRejectionCode;
  readonly message: string;
  readonly capabilityId?: CapabilityId;
}

export type CapabilityDemandMatch =
  | {
      readonly ok: true;
      readonly capabilityId: CapabilityId;
      readonly evidence: readonly string[];
    }
  | { readonly ok: false; readonly reasons: readonly CapabilityDemandRejection[] };

function sameScope(left: CapabilityScope, right: OrganizationScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.projectId === right.projectId &&
    left.worldId === right.worldId
  );
}

/**
 * Does a REGISTERED capability satisfy this position's capability demand?
 * Typed yes/no with reasons — the seam W039's compiler consumes:
 * - the query must be self-consistent (the demand names the declared
 *   capability) — else `inconsistent-demand`;
 * - the demanding organization must be in this registry's scope (field
 *   equality, never parsing) — else `registry-scope-mismatch` (the W039
 *   compiler's own law);
 * - at least one entry must PROVIDE the demanded organization capability
 *   (the compiler's `providesCapabilities` vocabulary) — else
 *   `unprovided-demand`;
 * - among the providers in canonical id order the first REGISTERED one
 *   satisfies (the W039 first-eligible determinism law — no
 *   backtracking); if EVERY provider is deprecated or revoked the match
 *   fails naming EACH provider and its state — loudly, never silently.
 */
export function matchCapabilityDemand(
  registry: CapabilityRegistry,
  query: CapabilityDemandQuery,
): CapabilityDemandMatch {
  if (String(query.demand.capabilityId) !== String(query.capability.capabilityId)) {
    return {
      ok: false,
      reasons: [
        {
          code: "inconsistent-demand",
          message: `the demand names capability '${String(query.demand.capabilityId)}' but the declared capability is '${String(query.capability.capabilityId)}' — a demand asks for the capability it is declared against`,
        },
      ],
    };
  }
  if (!sameScope(registry.scope, query.scope)) {
    return {
      ok: false,
      reasons: [
        {
          code: "registry-scope-mismatch",
          message: `the demanding organization declares scope (${query.scope.tenantId}, ${query.scope.projectId}, ${query.scope.worldId}) which disagrees with the registry's declared scope — the registry is single-scope`,
        },
      ],
    };
  }
  const demanded = String(query.demand.capabilityId);
  const providers = registry.entries.filter((entry) =>
    entry.descriptor.providesOrganizationCapabilityIds.some((provided) => String(provided) === demanded),
  );
  if (providers.length === 0) {
    return {
      ok: false,
      reasons: [
        {
          code: "unprovided-demand",
          message: `no registered capability provides organization capability '${demanded}' — the registry cannot satisfy a demand nothing offers`,
        },
      ],
    };
  }
  const active = providers.find((entry) => entry.state === "registered");
  if (active !== undefined) {
    const citations = active.descriptor.provenance
      .map((citation) => `${String(citation.experimentId)} / ${String(citation.evaluationId)} / digest ${citation.findingsDigest}`)
      .join("; ");
    return {
      ok: true,
      capabilityId: active.descriptor.capabilityId,
      evidence: [
        `scope agreed: tenant '${registry.scope.tenantId}', project '${registry.scope.projectId}', world '${registry.scope.worldId}' (field equality, never parsed)`,
        `provides the demanded organization capability '${demanded}' (first registered provider in canonical id order — the W039 first-eligible law)`,
        "lifecycle state: registered",
        `measured provenance: ${String(active.descriptor.provenance.length)} citation(s) — ${citations}`,
      ],
    };
  }
  return {
    ok: false,
    reasons: providers.map((entry) =>
      entry.state === "deprecated"
        ? {
            code: "capability-deprecated" as const,
            message: `capability '${String(entry.descriptor.capabilityId)}' provides '${demanded}' but is DEPRECATED — it still resolves for lineage, yet fails demand-matching loudly (never silently)`,
            capabilityId: entry.descriptor.capabilityId,
          }
        : {
            code: "capability-revoked" as const,
            message: `capability '${String(entry.descriptor.capabilityId)}' provides '${demanded}' but is REVOKED (terminal) — it still resolves for lineage, yet fails demand-matching loudly (never silently)`,
            capabilityId: entry.descriptor.capabilityId,
          },
    ),
  };
}

// ---------------------------------------------------------------------------
// The organization-offering projection (the W039 compiler's input shape)
// ---------------------------------------------------------------------------

/**
 * One bearer's offering, in the W039 component-registry's
 * `providesCapabilities` vocabulary: WHICH bearer (the W033 substrate or
 * body class) and WHICH organization capabilities it provides. The
 * compiler's `RegisteredBody`/`RegisteredSubstrate` inputs build from
 * this projection (their body/substrate descriptors come from W032/W033
 * — this package never holds those).
 */
export interface CapabilityOffering {
  readonly bearer: CapabilityBearer;
  readonly providesCapabilities: readonly OrganizationCapabilityId[];
}

function bearerKey(bearer: CapabilityBearer): string {
  // Defensive on runtime-malformed bearers (the closed-set law is enforced
  // at the gate; this projection only keys REAL entries).
  const id =
    bearer.kind === "substrate"
      ? String(bearer.substrateId ?? "")
      : String((bearer as { readonly bodyId?: string }).bodyId ?? "");
  return `${bearer.kind}\u0000${id}`;
}

/**
 * The offering projection of this registry: REGISTERED capabilities only
 * (deprecated/revoked bearers are not composable now — their lineage
 * still resolves), merged per bearer (one bearer measured twice offering
 * different organization capabilities offers the UNION, deduplicated,
 * sorted), offerings in canonical bearer order. Deterministic (A9).
 */
export function organizationOfferingsOf(
  registry: CapabilityRegistry,
): readonly CapabilityOffering[] {
  const byBearer = new Map<string, CapabilityOffering>();
  for (const entry of registry.entries) {
    if (entry.state !== "registered") {
      continue;
    }
    if (entry.descriptor.providesOrganizationCapabilityIds.length === 0) {
      continue;
    }
    const key = bearerKey(entry.descriptor.bearer);
    const existing = byBearer.get(key);
    const provided = entry.descriptor.providesOrganizationCapabilityIds;
    const merged = existing === undefined
      ? [...provided]
      : Array.from(new Set([...existing.providesCapabilities, ...provided]));
    byBearer.set(key, {
      bearer: entry.descriptor.bearer,
      providesCapabilities: merged.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    });
  }
  return Array.from(byBearer.values()).sort((left, right) =>
    bearerKey(left.bearer) < bearerKey(right.bearer) ? -1 : 1,
  );
}
