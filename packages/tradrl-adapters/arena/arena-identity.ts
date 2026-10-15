/**
 * The Arena identity family (W057) — the closed arena vocabularies and
 * the deterministic canonical identity derivations for the FIRST CONCRETE
 * capability provider.
 *
 * Spec: spec/REQUIREMENTS.md R055 — "Arena is optional": the arena
 * vocabulary (venue kinds, round kinds, measurement regimes, leaderboard
 * styles) is declared HERE and ONLY HERE — closed sets, fail-closed at
 * every seam — never in the neutral interface (frozen to this package).
 *
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — ids are opaque (never
 * parsed), composite ids use canonical encoders, and identity is a
 * function of content (A9): same declarations ⇒ same ids, any differing
 * byte ⇒ a different id. The hashing family is the repo's discipline
 * carried through the W040 `capability-registry` seam (`stableDigest`) —
 * byte-compatible with the family, never re-implemented (the W056
 * identity precedent).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { stableDigest } from "capability-registry";
import type { OpaqueId } from "capability-provider";

// ---------------------------------------------------------------------------
// The arena closed vocabularies (declared HERE and ONLY here — R055)
// ---------------------------------------------------------------------------

/** How the venue schedules its rounds (closed set — the venue vocabulary). */
export const ARENA_VENUE_KINDS = [
  "continuous-session",
  "periodic-batch",
  "staged-elimination",
] as const;
export type ArenaVenueKind = (typeof ARENA_VENUE_KINDS)[number];

/** The stage a round of measurement runs at (closed set — the round vocabulary). */
export const ARENA_ROUND_KINDS = ["screening", "trial", "final"] as const;
export type ArenaRoundKind = (typeof ARENA_ROUND_KINDS)[number];

/**
 * How an offer's measured evidence was produced inside the arena (closed
 * set — the measurement-regime vocabulary): one evaluation, or a consensus
 * of two or more. The regime is CARRIED DATA — the gates refuse a regime
 * that disagrees with the evidence count it rides on.
 */
export const ARENA_MEASUREMENT_REGIMES = [
  "single-evaluation",
  "consensus-of-evaluations",
] as const;
export type ArenaRegimeKind = (typeof ARENA_MEASUREMENT_REGIMES)[number];

/** The leaderboard's roster shape (closed set — the ranking vocabulary). */
export const ARENA_LEADERBOARD_STYLES = ["full-roster", "top-k"] as const;
export type ArenaLeaderboardStyle = (typeof ARENA_LEADERBOARD_STYLES)[number];

// ---------------------------------------------------------------------------
// The opaque id family (digest-derived — never parsed)
// ---------------------------------------------------------------------------

/** The identity of one registered arena (opaque; digest-derived). */
export type ArenaId = OpaqueId<"ArenaId">;
export const ARENA_ID_PREFIX = "arena-";

/** The identity of one round of one arena venue (opaque; digest-derived). */
export type ArenaRoundId = OpaqueId<"ArenaRoundId">;
export const ARENA_ROUND_ID_PREFIX = "arena-round-";

// ---------------------------------------------------------------------------
// The canonical projections + the identity derivations (A9)
// ---------------------------------------------------------------------------

/** The canonical venue projection: the rounds in sequence order (A9). */
export interface ArenaVenueCanonicalInput {
  readonly name: string;
  readonly venueKind: ArenaVenueKind;
  readonly rounds: readonly { readonly roundKind: ArenaRoundKind; readonly sequence: number }[];
  readonly leaderboard: { readonly style: ArenaLeaderboardStyle; readonly topK?: number };
}

export function byString(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Canonicalize one venue: rounds sorted by sequence, optional topK normalized. */
export function canonicalArenaVenue(input: ArenaVenueCanonicalInput): ArenaVenueCanonicalInput {
  return {
    name: input.name,
    venueKind: input.venueKind,
    rounds: [...input.rounds].sort((left, right) => left.sequence - right.sequence),
    leaderboard:
      input.leaderboard.style === "top-k"
        ? { style: input.leaderboard.style, topK: input.leaderboard.topK }
        : { style: input.leaderboard.style },
  };
}

/** The round id: the canonical hash over the venue digest + the round's own data. */
export function arenaRoundIdOf(
  venue: ArenaVenueCanonicalInput,
  round: { readonly roundKind: ArenaRoundKind; readonly sequence: number },
): ArenaRoundId {
  return `${ARENA_ROUND_ID_PREFIX}${stableDigest({
    venue: stableDigest(canonicalArenaVenue(venue)),
    roundKind: round.roundKind,
    sequence: round.sequence,
  })}` as ArenaRoundId;
}

/** The canonical arena registration input: everything the arena id weighs. */
export interface ArenaCanonicalInput {
  readonly providerId: string;
  readonly venue: ArenaVenueCanonicalInput;
  readonly offerRegimes: readonly {
    readonly offerId: string;
    readonly regimeKind: ArenaRegimeKind;
    readonly roundId: string;
  }[];
}

/** Canonicalize: the offer regimes sorted by offer id (A9 — order independence). */
export function canonicalArenaRegistration(input: ArenaCanonicalInput): ArenaCanonicalInput {
  return {
    providerId: input.providerId,
    venue: canonicalArenaVenue(input.venue),
    offerRegimes: [...input.offerRegimes].sort((left, right) => byString(left.offerId, right.offerId)),
  };
}

/**
 * The arena id: the canonical hash over the recorded provider id (itself
 * content-addressed over the whole neutral declaration) + the venue + the
 * per-offer regimes (A9 — same declaration + same venue ⇒ same id).
 */
export function arenaIdOf(input: ArenaCanonicalInput): ArenaId {
  return `${ARENA_ID_PREFIX}${stableDigest(canonicalArenaRegistration(input))}` as ArenaId;
}
