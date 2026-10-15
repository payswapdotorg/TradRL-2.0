/**
 * The identity family (W042) — the opaque selection id, the explicit
 * scope, and the canonical content addressing (canonical JSON + FNV-1a
 * 32-bit, re-implemented in-package per the W037/W039/W040/W041
 * precedent — the identity laws are package-local by design).
 *
 * A9 determinism: the selection id is the content digest of the canonical
 * projection of EVERYTHING the selection weighed — same demand + same
 * registry + same skills + same benchmark surface ⇒ byte-identical plan
 * and id. No clocks, no randomness, no environment reads.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

/** The opaque-id brand (never parsed, never structurally inspected). */
export type OpaqueId<Brand extends string> = string & {
  readonly [brand in Brand]: never;
};

/** The opaque id of one derived selection plan. */
export type SelectionId = OpaqueId<"SelectionId">;

/** The id prefix (the W016 family convention). */
export const SELECTION_ID_PREFIX = "selection-";

/**
 * The explicit scope a selection is derived in (the W039 shape, mirrored
 * as the selection's own declarative data — field equality, never
 * parsed). Every input surface must agree with it by field equality.
 */
export interface SelectionScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

// ---------------------------------------------------------------------------
// Canonical content addressing (the W016 family, in-package)
// ---------------------------------------------------------------------------

/** Canonical JSON: sorted keys, no whitespace, JSON-shaped values only. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, member]) => member !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(",")}}`;
  }
  // Fail closed on anything exotic: selections are data (JSON-shaped) only.
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

/** The content digest of any JSON-shaped value: canonical JSON, then FNV-1a. */
export function stableDigest(value: unknown): string {
  return fnv1a32(canonicalJson(value));
}

// ---------------------------------------------------------------------------
// The selection identity
// ---------------------------------------------------------------------------

/**
 * The canonical input of a selection's identity: EVERYTHING the id
 * weighs. The demand projection (scope + the position's title,
 * requirements and capability demand ids + the benchmark policy + the
 * candidate substrate ids), the W040 registry fingerprint (re-used from
 * the skills package's own seam so the id commits to the exact registry
 * content), the skill ids, the catalogue benchmark ids, and the selected
 * substrate id. All id lists are sorted — declaration order never leaks
 * into the identity (A9).
 */
export interface SelectionCanonicalInput {
  readonly scope: SelectionScope;
  readonly positionTitle: string;
  readonly substrateRequirement: unknown;
  readonly bodyRequirement: unknown;
  readonly capabilityDemandIds: readonly string[];
  readonly benchmarkPolicy: readonly string[];
  readonly candidateSubstrateIds: readonly string[];
  readonly registryFingerprint: string;
  readonly skillIds: readonly string[];
  readonly benchmarkIds: readonly string[];
  readonly selectedSubstrateId: string;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** The canonical projection of a selection's identity input (sorted lists). */
export function canonicalSelection(input: SelectionCanonicalInput): SelectionCanonicalInput {
  return {
    ...input,
    capabilityDemandIds: sorted(input.capabilityDemandIds),
    benchmarkPolicy: sorted(input.benchmarkPolicy),
    candidateSubstrateIds: sorted(input.candidateSubstrateIds),
    skillIds: sorted(input.skillIds),
    benchmarkIds: sorted(input.benchmarkIds),
  };
}

/** The content-addressed selection id: `selection-<fnv1a32>`. */
export function selectionIdOf(input: SelectionCanonicalInput): SelectionId {
  const digest = stableDigest(canonicalSelection(input));
  return `${SELECTION_ID_PREFIX}${digest}` as SelectionId;
}
