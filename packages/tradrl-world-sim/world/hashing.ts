/**
 * Deterministic canonical serialization and checksums for engine-side
 * (non-event) inputs: the world definition digest and the command stream
 * hash of the determinism manifest (spec/WORLD-PROTOCOL.md "Determinism").
 *
 * Same algorithm family as W004's event digest internals (canonical JSON
 * with sorted keys, undefined omitted, arrays in order; FNV-1a chain): two
 * structurally equal inputs always produce the same string and checksum.
 * Wall time and randomness never enter (A9).
 */

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
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

function fnv1aInto(input: string, seed: number): number {
  let hash = seed;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV32_PRIME);
  }
  return hash >>> 0;
}

function hex(hash: number): string {
  return hash.toString(16).padStart(8, "0");
}

/** FNV-1a chain over canonical serializations of ordered values. */
export function fnv1aChainHex(parts: readonly unknown[]): string {
  let hash = FNV32_OFFSET;
  for (const part of parts) {
    hash = fnv1aInto(canonicalize(part), hash);
  }
  return hex(hash);
}

/** Content digest of a single value (world definition digest). */
export function stableDigest(value: unknown): string {
  return hex(fnv1aInto(canonicalize(value), FNV32_OFFSET));
}

/**
 * Stateful FNV-1a hasher over canonical serializations — used for the
 * command stream hash (every submitted command updates it, in order).
 */
export interface Fnv1aHasher {
  update(part: unknown): void;
  hex(): string;
}

/** Create an incremental hasher (empty-stream digest = FNV offset). */
export function createFnv1aHasher(): Fnv1aHasher {
  let hash = FNV32_OFFSET;
  let parts = 0;
  return {
    update(part: unknown): void {
      hash = fnv1aInto(canonicalize(part), hash);
      parts += 1;
    },
    hex(): string {
      return hex(hash) + `:${String(parts)}`;
    },
  };
}
