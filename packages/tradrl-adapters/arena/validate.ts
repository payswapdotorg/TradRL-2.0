/**
 * Arena registration re-validation (W057) — the whole arena registration
 * re-proved from its RECORDED data.
 *
 * The arena closed-set laws are re-proved loudly from the record (venue
 * kind, round kinds, regime kinds, leaderboard style, the top-k laws);
 * the round structure and citation laws are re-proved; the canonical
 * order laws (rounds by sequence, offers by canonical offer id) are
 * re-proved; every round id and the arena id itself are re-derived from
 * the record's own bytes and compared exactly (A9); the regime-vs-
 * evidence law is re-proved against the recorded provenance; and the
 * whole NEUTRAL side is re-proved by W056's own
 * `validateProviderRegistration`, its errors carried verbatim.
 *
 * Fail-closed, deterministic, pure: no I/O, no clocks, no arena round
 * execution (A14).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { validateProviderRegistration } from "capability-provider";
import type { CapabilityRegistry } from "capability-registry";
import {
  ARENA_LEADERBOARD_STYLES,
  ARENA_MEASUREMENT_REGIMES,
  ARENA_ROUND_KINDS,
  ARENA_VENUE_KINDS,
  arenaIdOf,
  arenaRoundIdOf,
  canonicalArenaVenue,
} from "./arena-identity.js";
import type {
  ArenaCanonicalInput,
  ArenaVenueCanonicalInput,
} from "./arena-identity.js";
import type { ArenaError, ArenaProviderRegistration } from "./arena-registration.js";

export type ArenaValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly ArenaError[] };

function error(
  code: ArenaError["code"],
  message: string,
  ids: { arenaId?: string; offerId?: string; roundId?: string } = {},
): ArenaError {
  return { code, message, ...ids };
}

/** The canonical venue input of one RECORDED venue — rebuilt from the record's own members. */
function recordedVenueInput(
  registration: ArenaProviderRegistration,
): ArenaVenueCanonicalInput {
  const leaderboard = registration.venue.leaderboard;
  return {
    name: registration.venue.name,
    venueKind: registration.venue.venueKind,
    rounds: registration.venue.rounds.map((round) => ({
      roundKind: round.roundKind,
      sequence: round.sequence,
    })),
    leaderboard: {
      style: leaderboard.style,
      ...(leaderboard.topK === undefined ? {} : { topK: leaderboard.topK }),
    },
  };
}

/**
 * Re-validate ONE recorded arena registration against the arena laws plus
 * W056's own provider-registration laws (carried verbatim). With
 * `registry` supplied, the offers' W040 descriptor agreement is re-proved
 * too (W056's own cross-check, delegated).
 */
export function validateArenaRegistration(
  registration: ArenaProviderRegistration,
  registry?: CapabilityRegistry,
): ArenaValidationOutcome {
  const errors: ArenaError[] = [];
  const arenaLabel = { arenaId: String(registration.arenaId) };

  // -- the arena closed sets + structure, from the record -------------------
  if (!ARENA_VENUE_KINDS.some((member) => member === registration.venue.venueKind)) {
    errors.push(error("unknown-venue-kind", `the recorded venue kind '${String(registration.venue.venueKind)}' is outside the closed vocabulary — the arena answers in ${ARENA_VENUE_KINDS.join(", ")} only`, arenaLabel));
  }
  if (registration.venue.rounds.length === 0) {
    errors.push(error("no-rounds", "the recorded venue schedules no rounds — a venue schedules at least one round of measurement", arenaLabel));
  }
  registration.venue.rounds.forEach((round, index) => {
    if (!ARENA_ROUND_KINDS.some((member) => member === round.roundKind)) {
      errors.push(error("unknown-round-kind", `the recorded round ${String(index + 1)}'s kind '${String(round.roundKind)}' is outside the closed vocabulary — rounds answer in ${ARENA_ROUND_KINDS.join(", ")} only`, { ...arenaLabel, roundId: String(round.roundId) }));
    }
    if (!Number.isInteger(round.sequence) || round.sequence < 1) {
      errors.push(error("round-sequence-break", `the recorded round ${String(index + 1)}'s sequence ${String(round.sequence)} is not a positive integer — sequences start at 1`, { ...arenaLabel, roundId: String(round.roundId) }));
    } else if (index > 0 && round.sequence <= (registration.venue.rounds[index - 1]?.sequence ?? 0)) {
      errors.push(error("round-sequence-break", `the recorded rounds are not in strictly increasing sequence order at ${String(index + 1)} — declaration order must never leak into the record value (A9)`, { ...arenaLabel, roundId: String(round.roundId) }));
    }
    if (registration.venue.rounds.some((other, otherIndex) =>
      otherIndex < index && String(other.roundId) === String(round.roundId),
    )) {
      errors.push(error("duplicate-round", `round '${String(round.roundId)}' is recorded twice — round identity is exact canonical-id identity`, { ...arenaLabel, roundId: String(round.roundId) }));
    }
  });
  const leaderboard = registration.venue.leaderboard;
  if (!ARENA_LEADERBOARD_STYLES.some((member) => member === leaderboard.style)) {
    errors.push(error("unknown-leaderboard-style", `the recorded leaderboard style '${String(leaderboard.style)}' is outside the closed vocabulary — leaderboards answer in ${ARENA_LEADERBOARD_STYLES.join(", ")} only`, arenaLabel));
  } else if (leaderboard.style === "top-k") {
    if (leaderboard.topK === undefined || !Number.isInteger(leaderboard.topK) || leaderboard.topK < 1) {
      errors.push(error("leaderboard-top-k-invalid", "the recorded top-k leaderboard carries no positive integer k — the roster shape is explicit, never implicit", arenaLabel));
    }
  } else if (leaderboard.topK !== undefined) {
    errors.push(error("leaderboard-top-k-invalid", `the recorded '${leaderboard.style}' leaderboard carries a topK (${String(leaderboard.topK)}) — only a top-k leaderboard carries one`, arenaLabel));
  }

  // -- the round ids: re-derived from the record's own bytes ----------------
  const venueInput = recordedVenueInput(registration);
  const derivedRoundIds = new Set(
    registration.venue.rounds.map((round) =>
      String(arenaRoundIdOf(venueInput, { roundKind: round.roundKind, sequence: round.sequence })),
    ),
  );
  registration.venue.rounds.forEach((round) => {
    if (
      String(arenaRoundIdOf(venueInput, { roundKind: round.roundKind, sequence: round.sequence })) !==
      String(round.roundId)
    ) {
      errors.push(error("round-id-mismatch", `round '${String(round.roundId)}' is not the canonical derivation of its own recorded content — identity is a function of the venue + round bytes (A9), never an arbitrary label`, { ...arenaLabel, roundId: String(round.roundId) }));
    }
  });

  // -- the offers: citations, regimes, order, identity -----------------------
  registration.offers.forEach((arenaOffer) => {
    const offerLabel = { ...arenaLabel, offerId: String(arenaOffer.offer.offerId) };
    if (!ARENA_MEASUREMENT_REGIMES.some((member) => member === arenaOffer.regime.regimeKind)) {
      errors.push(error("unknown-regime-kind", `the recorded offer's regime kind '${String(arenaOffer.regime.regimeKind)}' is outside the closed vocabulary — regimes answer in ${ARENA_MEASUREMENT_REGIMES.join(", ")} only`, offerLabel));
    }
    const citations = arenaOffer.offer.provenance.length;
    if (
      (arenaOffer.regime.regimeKind === "single-evaluation" && citations !== 1) ||
      (arenaOffer.regime.regimeKind === "consensus-of-evaluations" && citations < 2)
    ) {
      errors.push(error("regime-evidence-mismatch", `the recorded offer's regime '${String(arenaOffer.regime.regimeKind)}' disagrees with its ${String(citations)} recorded citation(s) — a regime never lies about its measurements`, offerLabel));
    }
    if (!derivedRoundIds.has(String(arenaOffer.measuredInRoundId))) {
      errors.push(error("unknown-round-citation", `the recorded offer cites round '${String(arenaOffer.measuredInRoundId)}' which the recorded venue never derived — a measurement ran in a REAL round`, offerLabel));
    }
  });
  const recordedOfferIds = registration.offers.map((arenaOffer) => String(arenaOffer.offer.offerId));
  if (JSON.stringify([...recordedOfferIds].sort()) !== JSON.stringify(recordedOfferIds)) {
    errors.push(error("non-canonical-order", "the recorded arena offers are out of canonical offer-id order — declaration order must never leak into the record value (A9)", arenaLabel));
  }

  // -- the arena id: re-derived from the record's own bytes ------------------
  const canonical: ArenaCanonicalInput = {
    providerId: String(registration.provider.providerId),
    venue: canonicalArenaVenue(venueInput),
    offerRegimes: registration.offers.map((arenaOffer) => ({
      offerId: String(arenaOffer.offer.offerId),
      regimeKind: arenaOffer.regime.regimeKind,
      roundId: String(arenaOffer.measuredInRoundId),
    })),
  };
  if (String(arenaIdOf(canonical)) !== String(registration.arenaId)) {
    errors.push(error("arena-id-mismatch", `arena '${String(registration.arenaId)}' is not the canonical derivation of its own recorded content — identity is a function of the provider + venue + regime bytes (A9), never an arbitrary label`, arenaLabel));
  }

  // -- the NEUTRAL side: W056's own re-validation, carried verbatim ----------
  const providerValidation = validateProviderRegistration(registration.provider, registry);
  if (!providerValidation.ok) {
    errors.push({
      code: "provider-registration-invalid",
      message: "the recorded provider registration fails W056's own laws — re-proved through W056's validateProviderRegistration (errors carried verbatim)",
      ...arenaLabel,
      providerErrors: providerValidation.errors,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    checked: [
      "arena-closed-sets",
      "round-laws",
      "offer-citations",
      "canonical-order",
      "arena-identity",
      ...(registry === undefined ? [] : ["registry-agreement"]),
    ],
  };
}
