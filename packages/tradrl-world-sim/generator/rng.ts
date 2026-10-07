/**
 * The seeded deterministic PRNG surface of the generator (W017).
 *
 * Spec: spec/SIMULATION.md "Synthetic regimes" (the generator must support
 * SEEDED regimes) and spec/ARCHITECTURE-LOCK.md A9 — same seed ⇒ same run.
 *
 * DESIGN LAW (the determinism core): every random draw is a PURE function of
 * (seed, domain, key…) — there is no sequential generator cursor anywhere.
 * A turn's draws depend only on the world seed, a purpose domain and the
 * turn's identifying keys (participant, instrument, simulation time), so
 * stepping 10×1000ms and seeking 10000ms produce the same per-turn draws,
 * and replaying any subsequence of turns reproduces it exactly.
 */

/** FNV-1a 32-bit over a string (the same checksum family W004 digests use). */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * mulberry32 — a small deterministic PRNG (pure function of the 32-bit
 * seed; the same PRNG the W013 golden test uses for its command stream).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive one deterministic PRNG for a purpose: the draw sequence is a pure
 * function of (seed, domain, keys). `domain` separates purposes (taker
 * decisions vs noise decisions vs …) so independent facts never share a
 * stream.
 */
export function derivedRandom(
  seed: string,
  domain: string,
  ...keys: readonly (string | number)[]
): () => number {
  const mixed = fnv1a32(`${seed}|${domain}|${keys.map(String).join("|")}`);
  return mulberry32(mixed);
}

/** A deterministic integer in [0, max) derived from one draw. */
export function drawInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

/** A deterministic yes/no from one draw with probability `p`. */
export function drawChance(rng: () => number, p: number): boolean {
  return rng() < p;
}
