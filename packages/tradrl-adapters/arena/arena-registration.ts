/**
 * The Arena provider registration (W057) — the venue-specific DATA the
 * FIRST CONCRETE capability provider is, its typed error family, and its
 * registration gate. The closed vocabularies and the canonical identity
 * derivations live in ./arena-identity.ts (the W056 identity/registration
 * split precedent).
 *
 * Spec: spec/REQUIREMENTS.md R055 — "Arena is optional": the Arena is ONE
 * optional provider, an equal member of the pluggable class; the arena
 * vocabulary lives in this package and ONLY in this package.
 *
 * Spec: spec/REQUIREMENTS.md R052 carried forward: every offer's evidence
 * is re-proved by W056's own `registerProvider` gate, run VERBATIM over
 * the projected provider-neutral declaration; an unmeasured offer is
 * refused THERE and carried here verbatim — never bypassed, never
 * weakened. The arena's own regime law additionally refuses a
 * measurement regime that disagrees with its evidence count (a
 * "single-evaluation" regime over two citations, a "consensus" over one —
 * a regime that lies about its measurements).
 *
 * Spec: spec/DOMAIN-MODEL.md identity laws — opaque ids, canonical
 * encoders, explicit scope, immutable lineage (W056's vocabulary VERBATIM).
 *
 * A14: this module COMPOSES typed data; it never executes an arena round,
 * never calls a network. License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalRegistration } from "capability-registry";
import type { CapabilityRegistry } from "capability-registry";
import { offerIdOf, registerProvider } from "capability-provider";
import type {
  OfferCanonicalInput,
  ProviderDeclaration,
  ProviderError,
  ProviderIdentity,
  ProviderLineage,
  ProviderOffer,
  ProviderOfferDeclaration,
  ProviderRegistration,
  ProviderScope,
} from "capability-provider";
import type { SkillRecord } from "skills";
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
  ArenaId,
  ArenaLeaderboardStyle,
  ArenaRegimeKind,
  ArenaRoundId,
  ArenaRoundKind,
  ArenaVenueCanonicalInput,
  ArenaVenueKind,
} from "./arena-identity.js";

// ---------------------------------------------------------------------------
// The declaration (the gate's input)
// ---------------------------------------------------------------------------

/** The leaderboard as DECLARED: the roster shape, top-k's k when the style is top-k. */
export interface ArenaLeaderboardDeclaration {
  readonly style: ArenaLeaderboardStyle;
  readonly topK?: number;
}

/** One round as DECLARED: its stage and its strictly-increasing sequence. */
export interface ArenaRoundDeclaration {
  readonly roundKind: ArenaRoundKind;
  readonly sequence: number;
}

/** The venue as DECLARED: name, scheduling kind, the rounds, the leaderboard. */
export interface ArenaVenueDeclaration {
  readonly name: string;
  readonly venueKind: ArenaVenueKind;
  readonly rounds: readonly ArenaRoundDeclaration[];
  readonly leaderboard: ArenaLeaderboardDeclaration;
}

/** The arena-specific measurement regime of one offer, as CARRIED DATA. */
export interface ArenaMeasurementRegime {
  readonly regimeKind: ArenaRegimeKind;
}

/**
 * One arena offer as DECLARED: the W056 provider offer declaration VERBATIM
 * (the W040 descriptor vocabulary + MeasuredEvidence citations + optional
 * skill endowments — the neutral vocabulary ONLY, never arena keys), plus
 * the arena measurement regime and the round (cited by sequence) the
 * measurement ran in.
 */
export interface ArenaOfferDeclaration {
  readonly offer: ProviderOfferDeclaration;
  readonly regime: ArenaMeasurementRegime;
  readonly measuredInRoundSequence: number;
}

/** The arena provider declaration: identity, scope, venue, offers, lineage. */
export interface ArenaProviderDeclaration {
  readonly identity: ProviderIdentity;
  readonly scope: ProviderScope;
  readonly venue: ArenaVenueDeclaration;
  readonly offers: readonly ArenaOfferDeclaration[];
  /** W056's lineage vocabulary VERBATIM — the arena's lineage IS the provider lineage it projects. */
  readonly lineage: ProviderLineage;
}

// ---------------------------------------------------------------------------
// The recorded registration (typed DATA)
// ---------------------------------------------------------------------------

/** One round as RECORDED: its opaque canonical round id, kind, sequence. */
export interface ArenaRound {
  readonly roundId: ArenaRoundId;
  readonly roundKind: ArenaRoundKind;
  readonly sequence: number;
}

/** The venue as RECORDED: rounds in canonical sequence order. */
export interface ArenaVenue {
  readonly name: string;
  readonly venueKind: ArenaVenueKind;
  readonly rounds: readonly ArenaRound[];
  readonly leaderboard: ArenaLeaderboardDeclaration;
}

/**
 * One arena offer as RECORDED: W056's recorded provider offer VERBATIM,
 * plus the carried regime and the canonical round id the measurement ran
 * in. Carried data only — never a re-scored anything.
 */
export interface ArenaOffer {
  readonly offer: ProviderOffer;
  readonly regime: ArenaMeasurementRegime;
  readonly measuredInRoundId: ArenaRoundId;
}

/**
 * An arena provider registration as RECORDED: the opaque canonical arena
 * id, W056's recorded provider registration VERBATIM (the neutral surface
 * the port and the adjudication consume), the recorded venue, and the
 * offers in CANONICAL offer-id order (A9: declaration order never leaks
 * into the record value).
 */
export interface ArenaProviderRegistration {
  readonly arenaId: ArenaId;
  readonly provider: ProviderRegistration;
  readonly venue: ArenaVenue;
  readonly offers: readonly ArenaOffer[];
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type ArenaErrorCode =
  // declaration laws (arena-specific vocabulary + structure)
  | "blank-arena-name"
  | "blank-venue-name"
  | "unknown-venue-kind" // closed set
  | "unknown-round-kind" // closed set
  | "unknown-regime-kind" // closed set
  | "unknown-leaderboard-style" // closed set
  | "no-rounds"
  | "round-sequence-break" // non-positive or non-increasing sequences
  | "unknown-round-citation" // an offer cites a round the venue never declared
  | "regime-evidence-mismatch" // the regime disagrees with its evidence count
  | "leaderboard-top-k-invalid" // top-k without a positive k, or a k on a full roster
  // the W056 gate, carried verbatim (R052, the endowment laws, the
  // provider lineage and duplicate laws all live THERE)
  | "provider-gate-refused"
  // re-validation laws (./validate.ts)
  | "arena-id-mismatch"
  | "round-id-mismatch"
  | "non-canonical-order"
  | "duplicate-round"
  | "provider-registration-invalid"; // W056's validate errors, verbatim

/** One typed arena error (fail-closed; the law named in the message). */
export interface ArenaError {
  readonly code: ArenaErrorCode;
  readonly message: string;
  readonly arenaId?: string;
  readonly offerId?: string;
  readonly roundId?: string;
  /** Present on provider-gate-refused / provider-registration-invalid: W056's own errors, verbatim. */
  readonly providerErrors?: readonly ProviderError[];
}

export type ArenaRegistrationOutcome =
  | {
      readonly ok: true;
      readonly registration: ArenaProviderRegistration;
      readonly registry: CapabilityRegistry;
    }
  | { readonly ok: false; readonly errors: readonly ArenaError[] };

// ---------------------------------------------------------------------------
// The registration gate
// ---------------------------------------------------------------------------

function error(
  code: ArenaError["code"],
  message: string,
  ids: { arenaId?: string; offerId?: string; roundId?: string } = {},
): ArenaError {
  return { code, message, ...ids };
}

function blank(value: string): boolean {
  return value.trim().length === 0;
}

/**
 * The W056 canonical offer input of one declared arena offer — the same
 * helper W056's own gate runs internally (its `register.ts` precedent,
 * re-implemented in-package so the adapter can correlate its declared
 * offers with the gate's recorded offers by canonical id).
 */
function offerCanonicalInputOf(
  scope: ProviderScope,
  offer: ProviderOfferDeclaration,
): OfferCanonicalInput {
  const endowments: readonly SkillRecord[] = offer.skillEndowments ?? [];
  return {
    ...canonicalRegistration({
      name: offer.name,
      ...(offer.description === undefined ? {} : { description: offer.description }),
      kind: offer.kind,
      domain: offer.domain,
      bearer: offer.bearer,
      scope,
      providesOrganizationCapabilityIds: offer.providesOrganizationCapabilityIds,
      lineage: offer.capabilityLineage,
      evidence: offer.evidence,
    }),
    endowmentSkillIds: endowments.map((skill) => String(skill.skillId)).sort(),
  };
}

/**
 * THE ARENA REGISTRATION GATE. The arena-specific laws first (the closed
 * vocabularies, the round structure, the round citations, the
 * regime-vs-evidence law, the leaderboard laws — all collected, none
 * dropped), then W056's `registerProvider` run VERBATIM over the
 * projected provider-neutral declaration: the projection carries ONLY the
 * neutral vocabulary (identity/scope/lineage/offers), so R052, the
 * endowment laws, the W040 evidence re-proof and the provider lineage and
 * duplicate laws are all enforced AT THAT GATE, its errors carried
 * verbatim here. Pure (A9): same declaration + same registry + same known
 * arena registrations ⇒ deep-equal outputs; no clocks, no randomness, no
 * env reads, no I/O (A14).
 */
export function registerArenaProvider(
  registry: CapabilityRegistry,
  declaration: ArenaProviderDeclaration,
  known: readonly ArenaProviderRegistration[] = [],
): ArenaRegistrationOutcome {
  const errors: ArenaError[] = [];

  // -- the arena structure + closed-set laws --------------------------------
  if (blank(declaration.identity.name)) {
    errors.push(error("blank-arena-name", "the arena's display name is blank — a venue needs a name"));
  }
  if (blank(declaration.venue.name)) {
    errors.push(error("blank-venue-name", "the arena venue's name is blank — a venue needs a name"));
  }
  if (!ARENA_VENUE_KINDS.some((member) => member === declaration.venue.venueKind)) {
    errors.push(error("unknown-venue-kind", `venue kind '${String(declaration.venue.venueKind)}' is outside the closed vocabulary — the arena answers in ${ARENA_VENUE_KINDS.join(", ")} only`));
  }
  if (declaration.venue.rounds.length === 0) {
    errors.push(error("no-rounds", "the arena venue declares no rounds — a venue schedules at least one round of measurement"));
  }
  declaration.venue.rounds.forEach((round, index) => {
    if (!ARENA_ROUND_KINDS.some((member) => member === round.roundKind)) {
      errors.push(error("unknown-round-kind", `round ${String(index + 1)}'s kind '${String(round.roundKind)}' is outside the closed vocabulary — rounds answer in ${ARENA_ROUND_KINDS.join(", ")} only`));
    }
    if (!Number.isInteger(round.sequence) || round.sequence < 1) {
      errors.push(error("round-sequence-break", `round ${String(index + 1)}'s sequence ${String(round.sequence)} is not a positive integer — sequences start at 1`));
    } else if (index > 0 && round.sequence <= (declaration.venue.rounds[index - 1]?.sequence ?? 0)) {
      errors.push(error("round-sequence-break", `round ${String(index + 1)}'s sequence ${String(round.sequence)} does not increase — sequences are strictly increasing in declaration order`));
    }
  });
  const leaderboard = declaration.venue.leaderboard;
  if (!ARENA_LEADERBOARD_STYLES.some((member) => member === leaderboard.style)) {
    errors.push(error("unknown-leaderboard-style", `leaderboard style '${String(leaderboard.style)}' is outside the closed vocabulary — leaderboards answer in ${ARENA_LEADERBOARD_STYLES.join(", ")} only`));
  } else if (leaderboard.style === "top-k") {
    if (leaderboard.topK === undefined || !Number.isInteger(leaderboard.topK) || leaderboard.topK < 1) {
      errors.push(error("leaderboard-top-k-invalid", "a top-k leaderboard declares a positive integer k — the roster shape is explicit, never implicit"));
    }
  } else if (leaderboard.topK !== undefined) {
    errors.push(error("leaderboard-top-k-invalid", `the '${leaderboard.style}' leaderboard carries a topK (${String(leaderboard.topK)}) — only a top-k leaderboard carries one (fail-closed, never silently ignored)`));
  }

  // -- the offers: regime laws + round citations -----------------------------
  const declaredSequences = new Set(declaration.venue.rounds.map((round) => round.sequence));
  declaration.offers.forEach((arenaOffer, index) => {
    const offerLabel = { offerId: `#${String(index + 1)}` };
    if (!ARENA_MEASUREMENT_REGIMES.some((member) => member === arenaOffer.regime.regimeKind)) {
      errors.push(error("unknown-regime-kind", `offer ${String(index + 1)}'s regime kind '${String(arenaOffer.regime.regimeKind)}' is outside the closed vocabulary — regimes answer in ${ARENA_MEASUREMENT_REGIMES.join(", ")} only`, offerLabel));
    }
    const citations = arenaOffer.offer.evidence.length;
    if (
      (arenaOffer.regime.regimeKind === "single-evaluation" && citations !== 1) ||
      (arenaOffer.regime.regimeKind === "consensus-of-evaluations" && citations < 2)
    ) {
      errors.push(error("regime-evidence-mismatch", `offer ${String(index + 1)}'s regime '${String(arenaOffer.regime.regimeKind)}' disagrees with its ${String(citations)} evidence citation(s) — a regime never lies about its measurements (single-evaluation is exactly one; consensus-of-evaluations is two or more)`, offerLabel));
    }
    if (!declaredSequences.has(arenaOffer.measuredInRoundSequence)) {
      errors.push(error("unknown-round-citation", `offer ${String(index + 1)} cites round sequence ${String(arenaOffer.measuredInRoundSequence)} which the venue never declared — a measurement ran in a REAL round`, offerLabel));
    }
  });

  // -- W056's gate, VERBATIM over the projected neutral declaration ----------
  const projected: ProviderDeclaration = {
    identity: declaration.identity,
    scope: declaration.scope,
    lineage: declaration.lineage,
    offers: declaration.offers.map((arenaOffer) => arenaOffer.offer),
  };
  const gate = registerProvider(registry, projected, known.map((knownArena) => knownArena.provider));
  if (!gate.ok) {
    errors.push({
      code: "provider-gate-refused",
      message: "the W056 provider gate refused the projected provider-neutral declaration — R052, the endowment laws, the W040 evidence re-proof, the lineage and duplicate laws are all enforced THERE (errors carried verbatim)",
      providerErrors: gate.errors,
    });
    return { ok: false, errors };
  }

  // -- the recorded registration (canonical order, canonical ids) -----------
  const venueCanonical: ArenaVenueCanonicalInput = canonicalArenaVenue({
    name: declaration.venue.name,
    venueKind: declaration.venue.venueKind,
    rounds: declaration.venue.rounds.map((round) => ({
      roundKind: round.roundKind,
      sequence: round.sequence,
    })),
    leaderboard: { style: leaderboard.style, ...(leaderboard.topK === undefined ? {} : { topK: leaderboard.topK }) },
  });
  const rounds: ArenaRound[] = declaration.venue.rounds.map((round) => ({
    roundId: arenaRoundIdOf(venueCanonical, { roundKind: round.roundKind, sequence: round.sequence }),
    roundKind: round.roundKind,
    sequence: round.sequence,
  }));
  const roundIdBySequence = new Map(rounds.map((round) => [round.sequence, round.roundId]));

  const declaredIds = declaration.offers.map((arenaOffer) =>
    String(offerIdOf(offerCanonicalInputOf(declaration.scope, arenaOffer.offer))),
  );
  const arenaOffers: ArenaOffer[] = [];
  for (const recorded of gate.registration.offers) {
    const index = declaredIds.findIndex((declaredId) => declaredId === String(recorded.offerId));
    const arenaOffer = declaration.offers[index];
    if (arenaOffer === undefined) {
      // Unreachable by construction (the gate recorded this offer id); fail-closed regardless.
      errors.push(error("provider-gate-refused", `recorded offer '${String(recorded.offerId)}' did not correlate with any declared arena offer — fail-closed`, { offerId: String(recorded.offerId) }));
      continue;
    }
    const roundId = roundIdBySequence.get(arenaOffer.measuredInRoundSequence);
    if (roundId === undefined) {
      // Unreachable: the citation law above already refused unknown sequences.
      errors.push(error("unknown-round-citation", `offer '${String(recorded.offerId)}' cites round sequence ${String(arenaOffer.measuredInRoundSequence)} which the venue never declared — fail-closed`, { offerId: String(recorded.offerId) }));
      continue;
    }
    arenaOffers.push({ offer: recorded, regime: arenaOffer.regime, measuredInRoundId: roundId });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const arenaId = arenaIdOf({
    providerId: String(gate.registration.providerId),
    venue: venueCanonical,
    offerRegimes: arenaOffers.map((arenaOffer) => ({
      offerId: String(arenaOffer.offer.offerId),
      regimeKind: arenaOffer.regime.regimeKind,
      roundId: String(arenaOffer.measuredInRoundId),
    })),
  });

  const registration: ArenaProviderRegistration = {
    arenaId,
    provider: gate.registration,
    venue: {
      name: declaration.venue.name,
      venueKind: declaration.venue.venueKind,
      rounds: [...rounds].sort((left, right) => left.sequence - right.sequence),
      leaderboard: declaration.venue.leaderboard,
    },
    offers: arenaOffers,
  };
  return { ok: true, registration, registry: gate.registry };
}
