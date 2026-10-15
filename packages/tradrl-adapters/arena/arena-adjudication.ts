/**
 * The Arena adjudication surface (W057) — W056's demand adjudication
 * delegated VERBATIM, plus the arena-specific ranking projection.
 *
 * Spec: spec/REQUIREMENTS.md R053 (organizations compose with provider
 * offers) and R055 (the Arena is ONE optional provider): the demand
 * question itself is provider-NEUTRAL, so `adjudicateArenaOffers` does
 * not re-declare, re-implement or re-score any matching law — it calls
 * W056's `matchProviderOffers` over the recorded provider registration
 * and returns its outcome UNTOUCHED (W040's evidence lines and refusal
 * reasons carried verbatim, the content-addressed adjudication id and
 * all).
 *
 * The ranking projection (`projectArenaLeaderboard`) is the arena's OWN:
 * leaderboard-style rankings as CARRIED DATA — every entry's members are
 * carried verbatim from the recorded offers (the regime, the round
 * citation, the lifecycle), and the ORDER is canonical offer-id order,
 * never a re-scored statistic. A top-k leaderboard selects the first k
 * entries of that canonical order; k larger than the roster simply
 * yields the roster. The ordering law rides on the projection as data
 * (`ordering: "canonical-offer-id"`).
 *
 * A9: pure functions of the recorded registration — no clocks, no
 * randomness, no env reads, no I/O (A14).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { matchProviderOffers } from "capability-provider";
import type {
  OfferId,
  ProviderMatchOutcome,
  ProviderOffer,
} from "capability-provider";
import type { CapabilityDemandQuery, CapabilityId, CapabilityRegistry } from "capability-registry";
import { stableDigest } from "capability-registry";
import type { OpaqueId } from "capability-provider";
import type {
  ArenaError,
  ArenaMeasurementRegime,
  ArenaProviderRegistration,
} from "./arena-registration.js";
import { ARENA_LEADERBOARD_STYLES } from "./arena-identity.js";
import type { ArenaLeaderboardStyle, ArenaRoundId } from "./arena-identity.js";

// ---------------------------------------------------------------------------
// The ranking projection (carried data ordered by canonical ids)
// ---------------------------------------------------------------------------

/** The identity of one leaderboard projection (opaque; digest-derived). */
export type ArenaLeaderboardId = OpaqueId<"ArenaLeaderboardId">;
export const ARENA_LEADERBOARD_ID_PREFIX = "arena-leaderboard-";

/** The projection's ordering law, as carried data — never a re-scored statistic. */
export const ARENA_LEADERBOARD_ORDERING = "canonical-offer-id" as const;

/** One leaderboard entry: carried data only — rank, ids, regime, round, lifecycle. */
export interface ArenaLeaderboardEntry {
  readonly rank: number;
  readonly offerId: OfferId;
  readonly capabilityId: CapabilityId;
  readonly name: string;
  readonly regime: ArenaMeasurementRegime;
  readonly measuredInRoundId: ArenaRoundId;
  readonly lifecycle: ProviderOffer["lifecycle"];
}

/** The whole leaderboard projection, id-addressed and law-addressed. */
export interface ArenaLeaderboardProjection {
  readonly leaderboardId: ArenaLeaderboardId;
  readonly arenaId: string;
  readonly style: ArenaLeaderboardStyle;
  readonly topK?: number;
  /** The ordering law as data: the entries are in canonical offer-id order. */
  readonly ordering: typeof ARENA_LEADERBOARD_ORDERING;
  readonly entries: readonly ArenaLeaderboardEntry[];
}

export type ArenaLeaderboardProjectionOutcome =
  | { readonly ok: true; readonly projection: ArenaLeaderboardProjection }
  | { readonly ok: false; readonly errors: readonly ArenaError[] };

// ---------------------------------------------------------------------------
// The demand adjudication (W056, VERBATIM delegation)
// ---------------------------------------------------------------------------

/**
 * Does one of this arena's offers satisfy the W039 demand? W056's
 * `matchProviderOffers` answers — called over the recorded provider
 * registration with the SAME registry, and its outcome returned UNTOUCHED:
 * the query-level laws, the per-offer resolution and matching, the
 * canonical tiebreak, the evidence lines, the refusal reasons and the
 * content-addressed adjudication id are all W056's, carried verbatim.
 */
export function adjudicateArenaOffers(
  demand: CapabilityDemandQuery,
  registration: ArenaProviderRegistration,
  registry: CapabilityRegistry,
): ProviderMatchOutcome {
  return matchProviderOffers(demand, registration.provider, registry);
}

// ---------------------------------------------------------------------------
// The ranking projection
// ---------------------------------------------------------------------------

/**
 * Project the arena's leaderboard from its RECORDED registration: the
 * offers in canonical offer-id order (a top-k leaderboard keeps the first
 * k), each entry's members carried verbatim from the recorded offer —
 * never a re-scored statistic. Fail-closed on an internally inconsistent
 * record (the closed-set and top-k laws the gate and ./validate.ts
 * enforce; this seam refuses loudly regardless).
 */
export function projectArenaLeaderboard(
  registration: ArenaProviderRegistration,
): ArenaLeaderboardProjectionOutcome {
  const errors: ArenaError[] = [];
  const style = registration.venue.leaderboard.style;
  const topK = registration.venue.leaderboard.topK;
  if (!ARENA_LEADERBOARD_STYLES.some((member) => member === style)) {
    errors.push({
      code: "unknown-leaderboard-style",
      message: `leaderboard style '${String(style)}' is outside the closed vocabulary — leaderboards answer in ${ARENA_LEADERBOARD_STYLES.join(", ")} only`,
      arenaId: String(registration.arenaId),
    });
  } else if (style === "top-k" && (topK === undefined || !Number.isInteger(topK) || topK < 1)) {
    errors.push({
      code: "leaderboard-top-k-invalid",
      message: "a top-k leaderboard declares a positive integer k — fail-closed on an inconsistent record",
      arenaId: String(registration.arenaId),
    });
  } else if (style === "full-roster" && topK !== undefined) {
    errors.push({
      code: "leaderboard-top-k-invalid",
      message: `the '${style}' leaderboard carries a topK (${String(topK)}) — only a top-k leaderboard carries one`,
      arenaId: String(registration.arenaId),
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const ordered = [...registration.offers].sort((left, right) =>
    String(left.offer.offerId) < String(right.offer.offerId) ? -1 : 1,
  );
  const selected = style === "top-k" ? ordered.slice(0, topK) : ordered;
  const entries: ArenaLeaderboardEntry[] = selected.map((arenaOffer, index) => ({
    rank: index + 1,
    offerId: arenaOffer.offer.offerId,
    capabilityId: arenaOffer.offer.capabilityId,
    name: arenaOffer.offer.name,
    regime: arenaOffer.regime,
    measuredInRoundId: arenaOffer.measuredInRoundId,
    lifecycle: arenaOffer.offer.lifecycle,
  }));
  const leaderboardId = `${ARENA_LEADERBOARD_ID_PREFIX}${stableDigest({
    arenaId: String(registration.arenaId),
    style,
    ...(topK === undefined ? {} : { topK }),
    entries: entries.map((entry) => String(entry.offerId)),
  })}` as ArenaLeaderboardId;
  return {
    ok: true,
    projection: {
      leaderboardId,
      arenaId: String(registration.arenaId),
      style,
      ...(topK === undefined ? {} : { topK }),
      ordering: ARENA_LEADERBOARD_ORDERING,
      entries,
    },
  };
}
