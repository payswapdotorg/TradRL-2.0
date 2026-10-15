/**
 * Capability registry identity (W040) — the deterministic canonical
 * identity and the opaque id family for the empirical capability registry.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL" —
 * the registry's identity is content-addressed over the capability's
 * DECLARED data PLUS its measured provenance citations (the W037/W038
 * canonical ids): same declarations + same citations ⇒ same id (A9), any
 * differing byte ⇒ a different id. A label-only capability has no identity
 * here because the gate refuses it before an id can mean anything.
 *
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — ids are opaque (never
 * parsed), tenant/project/world scope is explicit, composite ids use
 * canonical encoders, and lineage is immutable.
 *
 * The hashing family is the repo's W004/W016 discipline re-implemented
 * in-package (the W037/W039 precedent: canonical JSON with
 * recursively-sorted object keys, FNV-1a 32-bit, lowercase hex —
 * byte-compatible with the family).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

/** The opaque-id brand (the DOMAIN-MODEL identity law: never parsed). */
export type OpaqueId<Brand extends string> = string & {
  readonly __brand: Brand;
};

/** The identity of one registered capability (opaque; digest-derived). */
export type CapabilityId = OpaqueId<"CapabilityId">;

/** The id prefix (a rendering convention, never a parse target). */
export const CAPABILITY_ID_PREFIX = "cap-";

/**
 * The explicit scope of a capability (the DOMAIN-MODEL identity law): a
 * tenant/project/world triple. Structurally compatible with the W039
 * `OrganizationScope` the demand-matching query consumes — agreement is
 * proven by field equality, never by parsing.
 */
export interface CapabilityScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

/**
 * Canonical JSON (the W016 family): objects with recursively-sorted keys,
 * arrays in the GIVEN order (callers canonicalize semantic order — see
 * `canonicalCapabilityRegistration`), `undefined` omitted, everything else
 * verbatim. Deterministic: no key order, no spacing ambiguity.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => serialize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(",")}}`;
  }
  // Fail closed on anything exotic: the registry is data (JSON-shaped) only.
  throw new Error(`canonicalJson: unsupported value of type '${typeof value}'`);
}

/** FNV-1a 32-bit over the UTF-8 bytes of `text` (the W016 family). */
export function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hash ^= code & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= (code >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The content digest of any JSON-shaped value: canonical JSON, then
 * FNV-1a 32-bit over its bytes.
 */
export function stableDigest(value: unknown): string {
  return fnv1a32(canonicalJson(value));
}

/**
 * The canonical input of a capability's identity: EVERYTHING the id weighs.
 * The bearer is flattened to { kind, id } so substrate and body bearers
 * digest through one shape; the citation list is the measured provenance
 * the registration gate already proved (see ./register.ts).
 */
export interface CapabilityCanonicalInput {
  readonly name: string;
  readonly description?: string;
  readonly kind: string;
  readonly domain: string;
  readonly bearer: { readonly kind: string; readonly id: string };
  readonly scope: CapabilityScope;
  readonly providesOrganizationCapabilityIds: readonly string[];
  readonly lineage: {
    readonly parentCapabilityId: string | null;
    readonly version: number;
  };
  readonly provenance: readonly {
    readonly experimentId: string;
    readonly evaluationId: string;
    readonly findingsDigest: string;
  }[];
}

/** The canonical sort key of one provenance citation (deterministic total order). */
function citationKey(
  citation: CapabilityCanonicalInput["provenance"][number],
): string {
  return `${citation.experimentId}\u0000${citation.evaluationId}\u0000${citation.findingsDigest}`;
}

/**
 * The canonical projection of a capability registration: the semantically
 * ORDERED collections (the organization capabilities it provides; the
 * provenance citations) are sorted by their canonical keys, so two
 * registrations differing ONLY in declaration order are the SAME
 * capability (A9: same bytes ⇒ same id).
 */
export function canonicalCapabilityRegistration(
  input: CapabilityCanonicalInput,
): CapabilityCanonicalInput {
  return {
    name: input.name,
    ...(input.description === undefined ? {} : { description: input.description }),
    kind: input.kind,
    domain: input.domain,
    bearer: input.bearer,
    scope: input.scope,
    providesOrganizationCapabilityIds: [...input.providesOrganizationCapabilityIds].sort(
      (left, right) => (left < right ? -1 : left > right ? 1 : 0),
    ),
    lineage: input.lineage,
    provenance: [...input.provenance].sort((left, right) => {
      const leftKey = citationKey(left);
      const rightKey = citationKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    }),
  };
}

/**
 * The capability id: the canonical hash over the registration's canonical
 * projection (A9 — the same declarations + the same measured citations
 * always yield the same id; any differing byte yields a different one).
 * Key order never matters (the canonical serializer sorts keys);
 * declaration order of the sorted collections never matters either.
 */
export function capabilityIdOf(input: CapabilityCanonicalInput): CapabilityId {
  return `${CAPABILITY_ID_PREFIX}${stableDigest(canonicalCapabilityRegistration(input))}` as CapabilityId;
}
