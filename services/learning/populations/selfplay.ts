/**
 * The self-play composition op (W046) — `composeSelfPlay(population,
 * cohortPolicy)`: ONE population split into cooperating/competing cohorts
 * AS DATA. The population is re-proven through W045's own whole-record
 * validator (errors carried verbatim — a pairing is composed only over a
 * proven population); the split is declared by the cohort policy (the
 * canonical-order alternate split, or an explicit member partition — every
 * member assigned to EXACTLY one cohort, every id a REAL member); the
 * cooperation/competition structure is declared DATA over the closed
 * cohesion vocabulary (the cooperating cohort's cohesion IS cooperation —
 * a contradiction is refused; the two cohorts MEET in competition — that
 * is what self-play means here). The plan is sealed content-addressed
 * selfplay-<digest> with the cohorts in canonical member order (A9: input
 * order never leaks), the explicit scope, and deterministic provenance
 * (the population's own sealedAt — no clocks).
 *
 * A14: a pairing COMPOSES a typed plan — it never executes, never trains,
 * never steps a world. R054: method-neutral. W048 owns episode generation.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { stableDigest } from "skills";
import type { OpaqueId } from "skills";
import { validatePopulation } from "populations";
import type { Population, PopulationScope, PopulationValidationError } from "populations";

/** The identity of one self-play pairing (opaque; digest-derived). */
export type SelfPlayPairingId = OpaqueId<"SelfPlayPairingId">;

/** The self-play pairing id prefix (the W016 family convention). */
export const SELFPLAY_PAIRING_ID_PREFIX = "selfplay-";

/** The closed cohort cohesion vocabulary. */
export type CohortCohesion = "cooperation" | "competition";

/**
 * The declared cooperation/competition structure (DATA): the cohesion of
 * each cohort and how the two cohorts meet. The cooperating cohort's
 * cohesion is cooperation (the role names it — a contradiction is
 * refused); the competing cohort's cohesion is DECLARED (a competing
 * cohort may compete internally, or cooperate as a team against the other
 * side); the cohorts meet in competition — that is the self-play pairing.
 */
export interface SelfPlayStructure {
  readonly cooperatingCohort: CohortCohesion;
  readonly competingCohort: CohortCohesion;
  readonly acrossCohorts: "competition";
}

/**
 * The declared cohort policy (DATA): how the membership splits.
 * `alternate` assigns the canonical member order alternately (even seat →
 * cooperating, odd seat → competing); `explicit` names the member binding
 * ids of each cohort outright (a partition — every member exactly once).
 */
export type CohortPolicy =
  | { readonly kind: "alternate" }
  | {
    readonly kind: "explicit";
    readonly cooperating: readonly string[];
    readonly competing: readonly string[];
  };

/** The sealed cohorts: the member binding ids, each in canonical order. */
export interface SelfPlayCohorts {
  readonly cooperating: readonly string[];
  readonly competing: readonly string[];
}

/** The deterministic provenance (A9 — the population's own sealedAt, carried). */
export interface SelfPlayProvenance {
  readonly populationSealedAt: number;
}

/** The self-play pairing plan: typed DATA (A14). */
export interface SelfPlayPairing {
  readonly pairingId: SelfPlayPairingId;
  readonly kind: "self-play-pairing";
  readonly scope: PopulationScope;
  /** The population this pairing splits (carried reference). */
  readonly populationId: string;
  /** The population generation the pairing is composed over. */
  readonly generation: number;
  /** The membership census carried (the cohort coverage re-proof needs it). */
  readonly memberCount: number;
  readonly cohorts: SelfPlayCohorts;
  readonly structure: SelfPlayStructure;
  readonly provenance: SelfPlayProvenance;
}

// ---------------------------------------------------------------------------
// The typed composition error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type SelfPlayErrorCode =
  | "invalid-population" // W045's own validator refused the population (carried verbatim)
  | "empty-cohort" // a self-play split needs BOTH cohorts non-empty
  | "cohort-coverage" // the split is not a partition of the membership
  | "unknown-member" // an explicit cohort names a member the population does not carry
  | "duplicate-member" // the same member id declared in both cohorts
  | "structure-mismatch"; // the declared structure contradicts the roles

export interface SelfPlayError {
  readonly code: SelfPlayErrorCode;
  readonly message: string;
  readonly memberId?: string;
  /** Present on `invalid-population`: W045's own validation errors, verbatim. */
  readonly populationErrors?: readonly PopulationValidationError[];
}

export type SelfPlayOutcome =
  | { readonly ok: true; readonly pairing: SelfPlayPairing }
  | { readonly ok: false; readonly errors: readonly SelfPlayError[] };

function error(code: SelfPlayErrorCode, message: string, extras: Omit<SelfPlayError, "code" | "message"> = {}): SelfPlayError {
  return { code, message, ...extras };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Deep-freeze the sealed plan (the W043/W044/W045 precedent). */
export function freezePairing(value: unknown): void {
  if (value !== null && (typeof value === "object" || Array.isArray(value))) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freezePairing(child);
    }
  }
}

/** The content address of the pairing plan (A9). */
function pairingIdOf(pairing: Omit<SelfPlayPairing, "pairingId">): SelfPlayPairingId {
  return `${SELFPLAY_PAIRING_ID_PREFIX}${stableDigest(pairing)}` as SelfPlayPairingId;
}

/** The declared structure's own laws (the role/structure agreements). */
export function structureErrors(structure: SelfPlayStructure): SelfPlayError[] {
  const errors: SelfPlayError[] = [];
  if (structure.cooperatingCohort !== "cooperation") {
    errors.push(error("structure-mismatch", `the cooperating cohort declares '${String(structure.cooperatingCohort)}' cohesion — the role names it: the cooperating cohort's cohesion IS cooperation`));
  }
  if (structure.acrossCohorts !== "competition") {
    errors.push(error("structure-mismatch", `the cohorts declare '${String(structure.acrossCohorts)}' across cohorts — a self-play pairing is two cohorts MEETING in competition (that is the pairing)`));
  }
  if (structure.competingCohort !== "cooperation" && structure.competingCohort !== "competition") {
    errors.push(error("structure-mismatch", `the competing cohort declares '${String(structure.competingCohort)}' cohesion — outside the closed cohesion vocabulary (cooperation, competition)`));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// THE COMPOSITION OP
// ---------------------------------------------------------------------------

/**
 * THE SELF-PLAY OP: split one proven population into cooperating/competing
 * cohorts and seal the pairing plan. Deterministic (A9): same population +
 * same policy ⇒ deep-equal pairing, same canonical id — input order never
 * matters (explicit cohort lists are canonicalized; the alternate split
 * derives from the canonical membership order).
 */
export function composeSelfPlay(
  population: Population,
  cohortPolicy: CohortPolicy,
  structure: SelfPlayStructure = {
    cooperatingCohort: "cooperation",
    competingCohort: "competition",
    acrossCohorts: "competition",
  },
): SelfPlayOutcome {
  const errors: SelfPlayError[] = [];
  const populationProof = validatePopulation(population);
  if (!populationProof.ok) {
    errors.push(error(
      "invalid-population",
      `population '${String(population.populationId)}' failed W045's own whole-record re-validation (${String(populationProof.errors.length)} error(s), carried verbatim) — a self-play pairing is composed only over a proven population`,
      { populationErrors: populationProof.errors },
    ));
  }
  errors.push(...structureErrors(structure));
  const memberIds = population.membership.map((member) => String(member.bindingId)).sort(compareStrings);
  if (memberIds.length < 2) {
    errors.push(error("empty-cohort", `population '${String(population.populationId)}' carries ${String(memberIds.length)} member(s) — a self-play split needs at least two (one per cohort)`));
  }
  let cooperating: string[];
  let competing: string[];
  if (cohortPolicy.kind === "alternate") {
    cooperating = memberIds.filter((_, index) => index % 2 === 0);
    competing = memberIds.filter((_, index) => index % 2 === 1);
  } else {
    const known = new Set(memberIds);
    for (const id of [...cohortPolicy.cooperating, ...cohortPolicy.competing]) {
      if (!known.has(String(id))) {
        errors.push(error("unknown-member", `the explicit cohort policy names member '${String(id)}', which population '${String(population.populationId)}' does not carry — cohorts are splits of the REAL membership`, { memberId: String(id) }));
      }
    }
    cooperating = cohortPolicy.cooperating.map(String).sort(compareStrings);
    competing = cohortPolicy.competing.map(String).sort(compareStrings);
    const seen = new Set<string>();
    for (const id of [...cooperating, ...competing]) {
      if (seen.has(id)) {
        errors.push(error("duplicate-member", `member '${id}' is declared in both cohorts — the split is a partition, one cohort per member`, { memberId: id }));
      }
      seen.add(id);
    }
    const covered = new Set([...cooperating, ...competing]);
    for (const id of memberIds) {
      if (!covered.has(id)) {
        errors.push(error("cohort-coverage", `member '${id}' belongs to neither cohort — the split covers the WHOLE membership (a self-play split is a partition)`, { memberId: id }));
      }
    }
  }
  if (cooperating.length === 0 || competing.length === 0) {
    errors.push(error("empty-cohort", `the split leaves a cohort empty (${String(cooperating.length)} cooperating, ${String(competing.length)} competing) — a self-play pairing needs BOTH sides`));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const plan: Omit<SelfPlayPairing, "pairingId"> = {
    kind: "self-play-pairing",
    scope: population.scope,
    populationId: String(population.populationId),
    generation: population.lineage.generation,
    memberCount: memberIds.length,
    cohorts: { cooperating, competing },
    structure,
    provenance: { populationSealedAt: population.provenance.sealedAt },
  };
  const pairing: SelfPlayPairing = { pairingId: pairingIdOf(plan), ...plan };
  freezePairing(pairing);
  return { ok: true, pairing };
}
