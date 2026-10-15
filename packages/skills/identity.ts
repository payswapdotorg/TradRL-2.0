/**
 * Skill identity (W041) — the deterministic canonical identity and the
 * opaque id family for the skill extraction contract.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL" —
 * carried forward: a skill's identity is content-addressed over the
 * MEASURED evidence it commits to (the W040 capability it was measured as
 * + the W037 trajectory canonical ids that demonstrated it): same
 * capability + same evidence ⇒ same id (A9), any differing byte ⇒ a
 * different id. A skill without evidence has no identity here because the
 * extraction gate refuses it before an id can mean anything.
 *
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — ids are opaque (never
 * parsed), tenant/project/world scope is explicit, composite ids use
 * canonical encoders, lineage is immutable.
 *
 * The hashing family is the repo's W004/W016 discipline re-implemented
 * in-package (the W037/W039/W040 precedent: canonical JSON with
 * recursively-sorted object keys, FNV-1a 32-bit, lowercase hex —
 * byte-compatible with the family).
 *
 * Identity law (documented, pinned by tests): the skill id weighs WHAT WAS
 * DEMONSTRATED (capability + kind/domain + bearer + scope + the sorted
 * trajectory ids + lineage) — it does NOT weigh the extraction run id, so
 * re-extracting the same evidence yields the SAME skill id with a fresh
 * run provenance riding as data; the extraction run has its own
 * content-addressed identity (`extraction-<digest>`).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

/** The opaque-id brand (the DOMAIN-MODEL identity law: never parsed). */
export type OpaqueId<Brand extends string> = string & {
  readonly __brand: Brand;
};

/** The identity of one extracted skill (opaque; digest-derived). */
export type SkillId = OpaqueId<"SkillId">;

/** The id prefix (a rendering convention, never a parse target). */
export const SKILL_ID_PREFIX = "skill-";

/** The identity of one extraction run (opaque; digest-derived). */
export type ExtractionId = OpaqueId<"ExtractionId">;

/** The extraction id prefix (a rendering convention, never a parse target). */
export const EXTRACTION_ID_PREFIX = "extraction-";

/**
 * The explicit scope of a skill: the tenant/project/world triple the
 * evidence was measured in. Structurally compatible with the W040
 * `CapabilityScope` — agreement is proven by field equality, never by
 * parsing.
 */
export interface SkillScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

/**
 * Canonical JSON (the W016 family): objects with recursively-sorted keys,
 * arrays in the GIVEN order (callers canonicalize semantic order — see
 * `canonicalSkill`), `undefined` omitted, everything else verbatim.
 * Deterministic: no key order, no spacing ambiguity.
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
  // Fail closed on anything exotic: skills are data (JSON-shaped) only.
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
 * The canonical input of a skill's identity: EVERYTHING the id weighs. The
 * bearer is flattened to { kind, id } so substrate and body bearers digest
 * through one shape; the trajectory id list is the measured evidence the
 * extraction gate already proved (see ./extract.ts).
 */
export interface SkillCanonicalInput {
  readonly capabilityId: string;
  readonly kind: string;
  readonly domain: string;
  readonly bearer: { readonly kind: string; readonly id: string };
  readonly scope: SkillScope;
  readonly trajectoryIds: readonly string[];
  readonly lineage: {
    readonly parentSkillId: string | null;
    readonly version: number;
  };
}

/**
 * The canonical projection of a skill derivation: the semantically
 * ORDERED trajectory id list is sorted, so two derivations differing ONLY
 * in evidence declaration order are the SAME skill (A9: same bytes ⇒ same
 * id).
 */
export function canonicalSkill(input: SkillCanonicalInput): SkillCanonicalInput {
  return {
    capabilityId: input.capabilityId,
    kind: input.kind,
    domain: input.domain,
    bearer: input.bearer,
    scope: input.scope,
    trajectoryIds: [...input.trajectoryIds].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    lineage: input.lineage,
  };
}

/**
 * The skill id: the canonical hash over the derivation's canonical
 * projection (A9 — the same capability + the same measured evidence always
 * yield the same id; any differing byte yields a different one). Key order
 * never matters (the canonical serializer sorts keys); evidence declaration
 * order never matters either (the projection sorts it).
 */
export function skillIdOf(input: SkillCanonicalInput): SkillId {
  return `${SKILL_ID_PREFIX}${stableDigest(canonicalSkill(input))}` as SkillId;
}

/**
 * The extraction run identity: the canonical digest over the registry
 * fingerprint + the batch's trajectory ids (sorted — input order never
 * leaks; the batch is duplicate-free by law, proven at the gate). Pure and
 * deterministic (A9): the same registry value + the same batch always
 * yield the same run id, so the run a skill was derived in is always
 * re-derivable from the recorded inputs.
 */
export function extractionIdOf(input: {
  readonly registryFingerprint: string;
  readonly trajectoryIds: readonly string[];
}): ExtractionId {
  return `${EXTRACTION_ID_PREFIX}${stableDigest({
    registryFingerprint: input.registryFingerprint,
    trajectoryIds: [...input.trajectoryIds].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  })}` as ExtractionId;
}
