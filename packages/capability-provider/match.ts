/**
 * Provider offer matching (W056) — deterministic demand adjudication over
 * a recorded provider registration, W040's demand-matching carried
 * VERBATIM.
 *
 * Spec: spec/REQUIREMENTS.md R053 — "Organization is optimizable":
 * provider offers must FEED the W039 demand-matching seam, so
 * organizations can compose with them. This module answers, typed and
 * with reasons, whether one of a provider's offers satisfies a W039
 * position's capability demand: W040's own `matchCapabilityDemand` runs
 * against each offer's registered capability (single-entry registry
 * view), its evidence lines and its refusal reasons carried verbatim —
 * this package never re-scores and never re-declares the matching laws.
 *
 * Determinism (A9): the offers are adjudicated in canonical offer-id
 * order (the tiebreak law — no registration-order leakage, no
 * backtracking), and the whole adjudication carries a content-addressed
 * id over the provider id + the demand + the registry's fingerprint, so
 * the same inputs always yield the same adjudication and any lifecycle
 * transition yields a NEW one.
 *
 * Carry, never re-score: deprecated and revoked offers fail LOUDLY with
 * W040's own refusal reasons, naming the capability and its state.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  matchCapabilityDemand,
  resolveCapability,
} from "capability-registry";
import type {
  CapabilityDemandQuery,
  CapabilityDemandRejection,
  CapabilityError,
  CapabilityId,
  CapabilityRegistry,
} from "capability-registry";
import { registryFingerprintOf } from "skills";
import { adjudicationIdOf } from "./identity.js";
import type { AdjudicationId, OfferId, ProviderId } from "./identity.js";
import type { ProviderRegistration } from "./registration.js";

// ---------------------------------------------------------------------------
// The adjudication result shapes (typed DATA — the contract mirror lives in
// contracts/capability)
// ---------------------------------------------------------------------------

/**
 * One offer's adjudication against the demand: matched or not, with W040's
 * own evidence lines (verbatim, non-empty iff matched), W040's own refusal
 * reasons (verbatim, present when the offer was adjudicated and did not
 * satisfy), and W040's resolution errors (verbatim, present when the offer's
 * capability is no longer in the registry — a drifted record, carried
 * loudly).
 */
export interface ProviderOfferAdjudication {
  readonly offerId: OfferId;
  readonly capabilityId: CapabilityId;
  readonly matched: boolean;
  readonly evidence: readonly string[];
  readonly reasons: readonly CapabilityDemandRejection[];
  readonly resolutionErrors: readonly CapabilityError[];
}

/** One non-matching offer, with W040's refusals carried verbatim. */
export interface ProviderMatchRejection {
  readonly offerId: OfferId;
  readonly capabilityId: CapabilityId;
  readonly reasons: readonly CapabilityDemandRejection[];
  /** W040's resolution errors, verbatim, when the capability left the registry. */
  readonly resolutionErrors: readonly CapabilityError[];
}

/**
 * The demand adjudication over one provider registration: typed yes/no with
 * everything carried. On yes — the winning offer (first in canonical
 * offer-id order) with W040's evidence lines carried verbatim plus the
 * tiebreak line; on no — the query-level refusals (when the query itself
 * was malformed) and/or every offer's refusal, carried verbatim. The
 * content-addressed adjudication id rides on both arms (A9).
 */
export type ProviderMatchOutcome =
  | {
      readonly ok: true;
      readonly adjudicationId: AdjudicationId;
      readonly providerId: ProviderId;
      readonly offerId: OfferId;
      readonly capabilityId: CapabilityId;
      readonly evidence: readonly string[];
      readonly considered: readonly ProviderOfferAdjudication[];
    }
  | {
      readonly ok: false;
      readonly adjudicationId: AdjudicationId;
      readonly providerId: ProviderId;
      /** Query-level refusals (W040's, verbatim) when the query itself was malformed. */
      readonly queryReasons: readonly CapabilityDemandRejection[];
      /** Every offer's refusal (W040's, verbatim) otherwise. */
      readonly offerRejections: readonly ProviderMatchRejection[];
      readonly considered: readonly ProviderOfferAdjudication[];
    };

function offerRejectionOf(
  adjudication: ProviderOfferAdjudication,
): {
  readonly offerId: OfferId;
  readonly capabilityId: CapabilityId;
  readonly reasons: readonly CapabilityDemandRejection[];
  readonly resolutionErrors: readonly CapabilityError[];
} {
  return {
    offerId: adjudication.offerId,
    capabilityId: adjudication.capabilityId,
    reasons: adjudication.reasons,
    resolutionErrors: adjudication.resolutionErrors,
  };
}

/**
 * Does one of this provider's offers satisfy the W039 demand?
 *
 * The demand is typed exactly as W040's seam consumes it (the W039
 * vocabulary: the demanding organization's scope, its declared
 * capability, and the demand itself — imported types, never
 * re-declared). Adjudication:
 * - the query-level laws (self-consistency, registry scope agreement)
 *   are proven by ONE W040 call over the full registry, its refusal
 *   reasons carried VERBATIM (short-circuit — a malformed query answers
 *   identically for every offer);
 * - each offer (in the registration's canonical offer-id order — the
 *   tiebreak law) is resolved in the registry by exact id (W040's
 *   `resolveCapability`, errors carried verbatim) and matched through
 *   W040's `matchCapabilityDemand` over a single-entry registry view,
 *   its evidence lines and refusal reasons carried VERBATIM;
 * - the FIRST matching offer in canonical order wins (canonical-id
 *   tiebreaks; no backtracking).
 */
export function matchProviderOffers(
  demand: CapabilityDemandQuery,
  registration: ProviderRegistration,
  registry: CapabilityRegistry,
): ProviderMatchOutcome {
  const adjudicationId: AdjudicationId = adjudicationIdOf({
    providerId: String(registration.providerId),
    demand,
    registryFingerprint: registryFingerprintOf(registry),
  });
  const providerId: ProviderId = registration.providerId;

  // The query-level laws, carried verbatim from W040 (identical for every
  // offer — answered once).
  const whole = matchCapabilityDemand(registry, demand);
  if (
    !whole.ok &&
    whole.reasons.length > 0 &&
    (whole.reasons[0]?.code === "inconsistent-demand" ||
      whole.reasons[0]?.code === "registry-scope-mismatch")
  ) {
    return {
      ok: false,
      adjudicationId,
      providerId,
      queryReasons: whole.reasons,
      offerRejections: [],
      considered: [],
    };
  }

  const considered: ProviderOfferAdjudication[] = [];
  for (const offer of registration.offers) {
    const lookup = resolveCapability(registry, offer.capabilityId);
    if (!lookup.ok) {
      considered.push({
        offerId: offer.offerId,
        capabilityId: offer.capabilityId,
        matched: false,
        evidence: [],
        reasons: [],
        resolutionErrors: lookup.errors,
      });
      continue;
    }
    const single: CapabilityRegistry = { scope: registry.scope, entries: [lookup.entry] };
    const match = matchCapabilityDemand(single, demand);
    if (match.ok) {
      considered.push({
        offerId: offer.offerId,
        capabilityId: offer.capabilityId,
        matched: true,
        evidence: match.evidence,
        reasons: [],
        resolutionErrors: [],
      });
      continue;
    }
    considered.push({
      offerId: offer.offerId,
      capabilityId: offer.capabilityId,
      matched: false,
      evidence: [],
      reasons: match.reasons,
      resolutionErrors: [],
    });
  }

  const winner = considered.find((candidate) => candidate.matched);
  if (winner !== undefined) {
    return {
      ok: true,
      adjudicationId,
      providerId,
      offerId: winner.offerId,
      capabilityId: winner.capabilityId,
      evidence: [
        `offer '${String(winner.offerId)}' is the first matching offer in canonical offer-id order (the W056 tiebreak law — declaration order never leaks, no backtracking)`,
        ...winner.evidence,
      ],
      considered,
    };
  }
  return {
    ok: false,
    adjudicationId,
    providerId,
    queryReasons: [],
    offerRejections: considered.map((candidate) => offerRejectionOf(candidate)),
    considered,
  };
}
