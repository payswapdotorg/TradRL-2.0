/**
 * The trajectory identity (W037) — the canonical id encoding over the
 * tenant/project/world/experiment/session scope.
 *
 * Spec: spec/DOMAIN-MODEL.md — Trajectory is a future-intelligence entity
 * under the identity laws: ids are OPAQUE; tenant/project/world scope is
 * EXPLICIT; composite ids use CANONICAL ENCODERS; business code never
 * parses opaque ids by delimiter; branch lineage is immutable.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the canonical encoding
 * and the digest are pure functions of the scope's bytes (no wall clocks,
 * no randomness, no env reads) — the same scope always yields the same
 * trajectory id.
 *
 * The canonical serializer + FNV-1a digest mirror the repository's own
 * hashing family (tradrl-world-sim/world/hashing.ts, the W004/W016 event
 * digest lineage). They are re-implemented IN-PACKAGE deliberately: this
 * contract package's dependency surface is agent-world-protocol +
 * learning-objectives only, and the encoding law is small enough that
 * importing a world-sim seam for it would couple the capture protocol to
 * the engine package. The family stays byte-compatible: canonical JSON
 * with sorted keys, undefined omitted, arrays in order, `<digits>n` for
 * bigint, FNV-1a 32 rendered as 8 lowercase hex.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

// ---------------------------------------------------------------------------
// The canonical serializer (the W004/W016 family, in-package)
// ---------------------------------------------------------------------------

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Canonical serialization: key order and undefined fields never matter. */
export function canonicalString(value: unknown): string {
  return canonicalize(value);
}

function fnv1aHex(input: string): string {
  let hash = FNV32_OFFSET;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV32_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The canonical content digest: FNV-1a over the canonical serialization of
 * one value (the same algorithm family as the world definition digest).
 */
export function canonicalDigestHex(value: unknown): string {
  return fnv1aHex(canonicalize(value));
}

// ---------------------------------------------------------------------------
// The trajectory scope (explicit identity, DOMAIN-MODEL)
// ---------------------------------------------------------------------------

/** The explicit identity scope every trajectory record carries. */
export interface TrajectoryScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
  readonly experimentId: string;
  readonly sessionId: string;
}

/** The scope members, in canonical order (validation + rendering order). */
export const TRAJECTORY_SCOPE_MEMBERS: readonly (keyof TrajectoryScope)[] = [
  "tenantId",
  "projectId",
  "worldId",
  "experimentId",
  "sessionId",
];

declare const trajectoryIdBrand: unique symbol;

/**
 * An OPAQUE trajectory id (a canonical digest rendering). It is produced
 * only by {@link trajectoryIdOf} and is never parsed — the scope is carried
 * explicitly on every record, never recovered by splitting the id.
 */
export type TrajectoryId = string & { readonly [trajectoryIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const TRAJECTORY_ID_PREFIX = "traj-";

/**
 * The blank scope members (the fail-closed identity gate's offender list).
 * A blank member means the scope is not explicit — the record is refused,
 * never defaulted.
 */
export function blankTrajectoryScopeMembers(scope: TrajectoryScope): readonly (keyof TrajectoryScope)[] {
  return TRAJECTORY_SCOPE_MEMBERS.filter((member) => String(scope[member]).trim().length === 0);
}

/** The canonical encoding of one scope (store keys, digest input). */
export function canonicalTrajectoryScope(scope: TrajectoryScope): string {
  return canonicalString(scope);
}

/**
 * The trajectory id: the canonical digest over the scope's five opaque ids.
 * Pure and deterministic (A9): the same scope always yields the same id, and
 * a scope differing in any member yields a different id.
 */
export function trajectoryIdOf(scope: TrajectoryScope): TrajectoryId {
  const digest = canonicalDigestHex(scope);
  return `${TRAJECTORY_ID_PREFIX}${digest}` as TrajectoryId;
}
