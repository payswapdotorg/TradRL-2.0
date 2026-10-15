/**
 * The adversarial composition op (W046) — `composeAdversarial(champion,
 * challenger)`: champion-vs-challenger GENERATIONS as DATA. Both
 * populations are re-proven through W045's own whole-record validator
 * (errors carried verbatim, naming which side); the two must agree on
 * scope AND world (one world, one scope — disagreement is fail-closed);
 * the challenger must be the champion's DIRECT next generation (the
 * lineage cites the champion as parent, the generation is exactly one on)
 * — an adversarial pairing is generational, not an arbitrary match; and
 * the pairing CITES the W039 ablation/model-substitution vocabulary where
 * applicable: when the challenger generation came from an ablation
 * transition, the substitution citation is W039's own derived-origin
 * shape (the axis kind + the operation + the subject it acted on);
 * otherwise the citation is null (a plain add/retire generation
 * substitutes nothing). The plan is sealed content-addressed
 * adversarial-<digest>, deterministic (A9 — input order cannot leak: the
 * two sides are named roles).
 *
 * A14: a pairing COMPOSES a typed plan — it never executes, never trains,
 * never steps a world. R054: method-neutral.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { stableDigest } from "skills";
import type { OpaqueId } from "skills";
import { validatePopulation } from "populations";
import type { Population, PopulationValidationError } from "populations";
import type { OrganizationOrigin } from "organization";

/** The identity of one adversarial pairing (opaque; digest-derived). */
export type AdversarialPairingId = OpaqueId<"AdversarialPairingId">;

/** The adversarial pairing id prefix (the W016 family convention). */
export const ADVERSARIAL_PAIRING_ID_PREFIX = "adversarial-";

/**
 * The substitution citation — W039's own derived-origin shape (the
 * ablation/model-substitution operations: the axis kind, the operation,
 * the id it acted on). `substitute-substrate-requirement` is §13's
 * model-substitution axis; `substitute-body-requirement` the body-side
 * structural substitution. Carried VERBATIM from the challenger's
 * transition origin — never re-derived here.
 */
export type SubstitutionCitation = Extract<OrganizationOrigin, { readonly subject: string }>;

/** One side of the pairing: the population id + the generation it names. */
export interface AdversarialSide {
  readonly populationId: string;
  readonly generation: number;
}

/** The deterministic provenance (A9 — the challenger's own sealedAt, carried). */
export interface AdversarialProvenance {
  readonly challengerSealedAt: number;
}

/** The adversarial pairing plan: typed DATA (A14). */
export interface AdversarialPairing {
  readonly pairingId: AdversarialPairingId;
  readonly kind: "adversarial-pairing";
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
  readonly champion: AdversarialSide;
  readonly challenger: AdversarialSide;
  /** The W039 substitution citation, where the challenger generation is an ablation; else null. */
  readonly substitution: SubstitutionCitation | null;
  readonly provenance: AdversarialProvenance;
}

// ---------------------------------------------------------------------------
// The typed composition error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type AdversarialErrorCode =
  | "invalid-champion" // W045's own validator refused the champion (carried verbatim)
  | "invalid-challenger" // W045's own validator refused the challenger (carried verbatim)
  | "scope-mismatch" // the two populations disagree on scope/world
  | "not-descendant"; // the challenger is not the champion's direct next generation

export interface AdversarialError {
  readonly code: AdversarialErrorCode;
  readonly message: string;
  /** Present on `invalid-champion` / `invalid-challenger`: W045's own errors, verbatim. */
  readonly populationErrors?: readonly PopulationValidationError[];
}

export type AdversarialOutcome =
  | { readonly ok: true; readonly pairing: AdversarialPairing }
  | { readonly ok: false; readonly errors: readonly AdversarialError[] };

function error(code: AdversarialErrorCode, message: string, extras: Omit<AdversarialError, "code" | "message"> = {}): AdversarialError {
  return { code, message, ...extras };
}

/** Deep-freeze the sealed plan (the W043/W044/W045 precedent). */
export function freezeAdversarial(value: unknown): void {
  if (value !== null && (typeof value === "object" || Array.isArray(value))) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezeAdversarial(child);
    }
  }
}

/** The content address of the pairing plan (A9). */
function pairingIdOf(pairing: Omit<AdversarialPairing, "pairingId">): AdversarialPairingId {
  return `${ADVERSARIAL_PAIRING_ID_PREFIX}${stableDigest(pairing)}` as AdversarialPairingId;
}

/**
 * The substitution citation carried from the challenger's transition
 * origin — the W039 ablation/model-substitution vocabulary WHERE
 * APPLICABLE (an ablate origin cites it; add/retire/genesis do not).
 */
export function substitutionCitationOf(challenger: Population): SubstitutionCitation | null {
  if (challenger.lineage.origin.kind !== "ablate") {
    return null;
  }
  const citation = challenger.lineage.origin.ablation;
  return { kind: citation.kind, operation: citation.operation, subject: citation.subject };
}

// ---------------------------------------------------------------------------
// THE COMPOSITION OP
// ---------------------------------------------------------------------------

/**
 * THE ADVERSARIAL OP: pair a champion population with its challenger
 * generation and seal the pairing plan. Deterministic (A9): same champion
 * + same challenger ⇒ deep-equal pairing, same canonical id.
 */
export function composeAdversarial(
  champion: Population,
  challenger: Population,
): AdversarialOutcome {
  const errors: AdversarialError[] = [];
  const championProof = validatePopulation(champion);
  if (!championProof.ok) {
    errors.push(error(
      "invalid-champion",
      `the champion population '${String(champion.populationId)}' failed W045's own whole-record re-validation (${String(championProof.errors.length)} error(s), carried verbatim) — an adversarial pairing is composed only over proven populations`,
      { populationErrors: championProof.errors },
    ));
  }
  const challengerProof = validatePopulation(challenger);
  if (!challengerProof.ok) {
    errors.push(error(
      "invalid-challenger",
      `the challenger population '${String(challenger.populationId)}' failed W045's own whole-record re-validation (${String(challengerProof.errors.length)} error(s), carried verbatim) — an adversarial pairing is composed only over proven populations`,
      { populationErrors: challengerProof.errors },
    ));
  }
  const sameScope = String(champion.scope.tenantId) === String(challenger.scope.tenantId)
    && String(champion.scope.projectId) === String(challenger.scope.projectId)
    && String(champion.scope.worldId) === String(challenger.scope.worldId);
  if (!sameScope) {
    errors.push(error(
      "scope-mismatch",
      `the champion belongs to scope (${String(champion.scope.tenantId)}, ${String(champion.scope.projectId)}, ${String(champion.scope.worldId)}) but the challenger to (${String(challenger.scope.tenantId)}, ${String(challenger.scope.projectId)}, ${String(challenger.scope.worldId)}) — one world, one scope: an adversarial pairing never crosses worlds (fail-closed)`,
    ));
  }
  const cites = String(challenger.lineage.parentPopulationId ?? "") === String(champion.populationId);
  const oneGenerationOn = challenger.lineage.generation === champion.lineage.generation + 1;
  if (!cites || !oneGenerationOn) {
    errors.push(error(
      "not-descendant",
      `the challenger '${String(challenger.populationId)}' (generation ${String(challenger.lineage.generation)}, parent '${String(challenger.lineage.parentPopulationId)}') is not the champion's '${String(champion.populationId)}' (generation ${String(champion.lineage.generation)}) direct next generation — an adversarial pairing is GENERATIONAL: the challenger is one lineage step past the champion`,
    ));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const plan: Omit<AdversarialPairing, "pairingId"> = {
    kind: "adversarial-pairing",
    scope: {
      tenantId: String(champion.scope.tenantId),
      projectId: String(champion.scope.projectId),
      worldId: String(champion.scope.worldId),
    },
    champion: { populationId: String(champion.populationId), generation: champion.lineage.generation },
    challenger: { populationId: String(challenger.populationId), generation: challenger.lineage.generation },
    substitution: substitutionCitationOf(challenger),
    provenance: { challengerSealedAt: challenger.provenance.sealedAt },
  };
  const pairing: AdversarialPairing = { pairingId: pairingIdOf(plan), ...plan };
  freezeAdversarial(pairing);
  return { ok: true, pairing };
}
