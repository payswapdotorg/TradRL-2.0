/**
 * The participant-side deterministic RNG (W023) — keyed, cursor-free draws.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 (determinism) and spec/SIMULATION.md
 * "Participants" (seeded participants). Every draw is a PURE function of the
 * declared seed plus an explicit key tuple (agent, purpose, observation
 * time): there is NO sequential cursor, so the same settled view always
 * produces the same draws — the same views ⇒ the same commands, structurally
 * (the twin-run proofs in test/determinism.twin.test.ts).
 *
 * WHY A LOCAL RNG: the generator's rng (tradrl-world-sim/generator/rng.ts)
 * is an engine internal — participants may not import engine internals (the
 * W023 law). This module is an INDEPENDENT implementation of the same
 * keyed-draw doctrine (FNV-1a key hashing → mulberry32 stream): same design,
 * no shared code, no dependency edge into the engine.
 */

/** FNV-1a 32-bit over UTF-16 code units — platform-independent, order-explicit. */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Canonical key text: parts joined with a delimiter that cannot appear in keys. */
function keyText(seed: string, keys: readonly (string | number)[]): string {
  return [seed, ...keys].join("\u0000");
}

/** The mulberry32 stream seeded from the key — a pure deterministic source. */
export function keyedRandom(seed: string, ...keys: readonly (string | number)[]): () => number {
  let state = fnv1a32(keyText(seed, keys));
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw a Bernoulli trial with the given probability [0, 1]. */
export function drawChance(next: () => number, probability: number): boolean {
  return next() < probability;
}

/** Draw an integer in [0, maxExclusive) (maxExclusive ≥ 1). */
export function drawInt(next: () => number, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new Error(`[participants] drawInt needs a positive integer bound: ${String(maxExclusive)}`);
  }
  return Math.floor(next() * maxExclusive);
}
