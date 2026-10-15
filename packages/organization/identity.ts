/**
 * Organization identity (W039) — the deterministic canonical identity and
 * the opaque id family for the organization model.
 *
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — ids are opaque (never
 * parsed), tenant/project/world scope is explicit, composite ids use
 * canonical encoders, and lineage is immutable.
 * Spec: spec/ARCHITECTURE.md A9 (determinism) — the SAME definition bytes
 * produce the SAME identity: the digest runs over a CANONICAL projection
 * of the definition (every semantically-ordered list sorted by its
 * canonical key), so definition equality is byte-equality of the
 * canonical form — never insertion order.
 *
 * The hashing family is the repo's W004/W016 discipline re-implemented
 * in-package (the W037 trajectory precedent: the canonical family lives
 * with the contract that needs it, byte-compatible — canonical JSON with
 * recursively-sorted object keys, FNV-1a 32-bit, lowercase hex).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

/** The opaque-id brand (the DOMAIN-MODEL identity law: never parsed). */
export type OpaqueId<Brand extends string> = string & {
  readonly __brand: Brand;
};

/** The identity of one organization (opaque; canonical digest-derived). */
export type OrganizationId = OpaqueId<"OrganizationId">;

/** The identity of one unit inside an organization (opaque). */
export type OrganizationUnitId = OpaqueId<"OrganizationUnitId">;

/** The identity of one position inside an organization (opaque). */
export type OrganizationPositionId = OpaqueId<"OrganizationPositionId">;

/** The identity of one capability an organization declares (opaque). */
export type OrganizationCapabilityId = OpaqueId<"OrganizationCapabilityId">;

/**
 * The explicit scope of an organization (the DOMAIN-MODEL identity law):
 * a tenant/project/world triple. Structurally compatible with the W032
 * `WorldScope` the consumed bodies carry — the compiler proves agreement
 * by field equality, never by parsing.
 */
export interface OrganizationScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

/**
 * Canonical JSON (the W016 family): objects with recursively-sorted keys,
 * arrays in the GIVEN order (callers canonicalize semantic order — see
 * `canonicalOrganizationDefinition`), `undefined` omitted, everything
 * else verbatim. Deterministic: no key order, no spacing ambiguity.
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
  // Fail closed on anything exotic: the model is data (JSON-shaped) only.
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
 * The canonical projection of an organization definition: every
 * semantically-ordered collection sorted by its canonical key (positions,
 * units, capabilities and bindings by id; the member/demand lists inside
 * them by id or by literal), so that two definitions differing ONLY in
 * declaration order are the SAME organization (A9: same bytes → same id).
 * Structural fields the digest does NOT weigh: nothing — the whole
 * definition is committed to.
 */
export function canonicalOrganizationDefinition(definition: {
  readonly displayName?: string;
  readonly scope: OrganizationScope;
  readonly capabilities: readonly {
    readonly capabilityId: string;
    readonly name: string;
    readonly description?: string;
  }[];
  readonly positions: readonly {
    readonly positionId: string;
    readonly title: string;
    readonly bodyRequirement: {
      readonly commandKinds: readonly string[];
      readonly instruments: readonly string[];
      readonly observations: readonly string[];
    };
    readonly substrateRequirement: {
      readonly stateMode?: string;
      readonly minMaxDecisionsPerView: number;
      readonly commandKinds: readonly string[];
    };
    readonly capabilityDemands: readonly {
      readonly capabilityId: string;
      readonly rationale: string;
    }[];
  }[];
  readonly units: readonly {
    readonly unitId: string;
    readonly name: string;
    readonly parentUnitId: string | null;
    readonly positionIds: readonly string[];
  }[];
  readonly bindings: readonly {
    readonly positionId: string;
    readonly grant: {
      readonly grantedBy: string;
      readonly channel: string;
      readonly grantedAt: number;
      readonly basis: string;
    };
    readonly scopeNarrowing?: {
      readonly instruments?: readonly string[];
      readonly commandKinds?: readonly string[];
      readonly observations?: readonly string[];
    };
  }[];
  readonly lineage: unknown;
}): unknown {
  return {
    scope: definition.scope,
    displayName: definition.displayName,
    capabilities: [...definition.capabilities]
      .map((capability) => ({ ...capability }))
      .sort(byKey("capabilityId")),
    positions: definition.positions
      .map((position) => ({
        positionId: position.positionId,
        title: position.title,
        bodyRequirement: {
          commandKinds: sortedCopy(position.bodyRequirement.commandKinds),
          instruments: sortedCopy(position.bodyRequirement.instruments),
          observations: sortedCopy(position.bodyRequirement.observations),
        },
        substrateRequirement: {
          stateMode: position.substrateRequirement.stateMode,
          minMaxDecisionsPerView: position.substrateRequirement.minMaxDecisionsPerView,
          commandKinds: sortedCopy(position.substrateRequirement.commandKinds),
        },
        capabilityDemands: [...position.capabilityDemands]
          .map((demand) => ({ ...demand }))
          .sort(byKey("capabilityId")),
      }))
      .sort(byKey("positionId")),
    units: definition.units
      .map((unit) => ({
        unitId: unit.unitId,
        name: unit.name,
        parentUnitId: unit.parentUnitId,
        positionIds: sortedCopy(unit.positionIds),
      }))
      .sort(byKey("unitId")),
    bindings: definition.bindings
      .map((binding) => ({
        positionId: binding.positionId,
        grant: binding.grant,
        scopeNarrowing: binding.scopeNarrowing === undefined
          ? undefined
          : {
              instruments: binding.scopeNarrowing.instruments === undefined
                ? undefined
                : sortedCopy(binding.scopeNarrowing.instruments),
              commandKinds: binding.scopeNarrowing.commandKinds === undefined
                ? undefined
                : sortedCopy(binding.scopeNarrowing.commandKinds),
              observations: binding.scopeNarrowing.observations === undefined
                ? undefined
                : sortedCopy(binding.scopeNarrowing.observations),
            },
      }))
      .sort(byKey("positionId")),
    lineage: definition.lineage,
  };
}

function byKey(key: string): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
  return (a, b) => {
    const left = String(a[key]);
    const right = String(b[key]);
    return left < right ? -1 : left > right ? 1 : 0;
  };
}

function sortedCopy(values: readonly string[]): string[] {
  return [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The digest of an organization definition: FNV-1a over the canonical
 * projection (A9 — deterministic; the same definition content yields the
 * same digest regardless of declaration order).
 */
export function organizationDigestOf(definition: Parameters<
  typeof canonicalOrganizationDefinition
>[0]): string {
  return stableDigest(canonicalOrganizationDefinition(definition));
}

/**
 * The identity of an organization definition: `org-<digest>` (opaque —
 * the id is never parsed; membership is exact string identity).
 */
export function organizationIdOf(definition: Parameters<
  typeof canonicalOrganizationDefinition
>[0]): OrganizationId {
  return `org-${organizationDigestOf(definition)}` as OrganizationId;
}
