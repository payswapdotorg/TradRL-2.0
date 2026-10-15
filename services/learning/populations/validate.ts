/**
 * Whole-pairing re-validation (W046) — re-proving a sealed pairing plan
 * from its own recorded data alone (the W045 `validatePopulation`
 * precedent): the content-addressed identity re-derivation, the cohort
 * laws (both cohorts non-empty, no member in both, canonical order, the
 * split covering the whole carried membership), the declared structure
 * laws, the adversarial generational laws (the challenger exactly one
 * generation past the champion), the substitution citation's shape laws
 * (the W039 operation vocabulary), and the deterministic provenance laws.
 * The population re-proofs need the population records, so they run at
 * COMPOSITION (where the populations are given); everything else is
 * re-provable from the record alone and is re-proved here. Pure,
 * deterministic, fail-closed — every violation collected.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { stableDigest } from "skills";
import type { SelfPlayPairing } from "./selfplay.js";
import { SELFPLAY_PAIRING_ID_PREFIX, structureErrors } from "./selfplay.js";
import type { AdversarialPairing } from "./adversarial.js";
import { ADVERSARIAL_PAIRING_ID_PREFIX } from "./adversarial.js";

// ---------------------------------------------------------------------------
// The shared law surface (closed error families — every law named)
// ---------------------------------------------------------------------------

export interface PairingValidationError {
  readonly code: PairingValidationErrorCode;
  readonly message: string;
}

export type PairingValidationErrorCode =
  | "invalid-kind" // the record is not the pairing kind it claims
  | "invalid-scope" // the scope carries a blank member
  | "empty-cohort" // a self-play cohort is empty
  | "duplicate-member" // the same member id in both cohorts
  | "canonical-order" // a cohort list is not in canonical member order
  | "cohort-coverage" // the cohorts do not cover the carried membership
  | "structure-mismatch" // the declared structure contradicts the roles
  | "generation-mismatch" // the challenger is not one generation past the champion
  | "substitution-invalid" // the substitution citation is outside the W039 vocabulary
  | "invalid-provenance" // the deterministic provenance's own laws
  | "identity-mismatch"; // the id is not the content address of the record

function violation(code: PairingValidationErrorCode, message: string): PairingValidationError {
  return { code, message };
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSorted(ids: readonly string[]): boolean {
  return ids.join(",") === [...ids].sort(compareStrings).join(",");
}

// ---------------------------------------------------------------------------
// The self-play whole-record re-validation
// ---------------------------------------------------------------------------

export type SelfPlayValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly PairingValidationError[] };

/**
 * Re-prove a sealed self-play pairing from its own recorded data alone.
 * The population's own re-proof ran at composition (the W045 founding
 * precedent); the cohort coverage law is re-proved here against the
 * CARRIED member census.
 */
export function validateSelfPlayPairing(pairing: SelfPlayPairing): SelfPlayValidationOutcome {
  const errors: PairingValidationError[] = [];
  if (pairing.kind !== "self-play-pairing") {
    return { ok: false, errors: [violation("invalid-kind", "the record is not a self-play pairing — kind is explicit, never inferred")] };
  }
  if (!nonBlank(pairing.scope.tenantId) || !nonBlank(pairing.scope.projectId) || !nonBlank(pairing.scope.worldId)) {
    errors.push(violation("invalid-scope", "the pairing scope carries a blank member — the explicit tenant/project/world identity law"));
  }
  if (!nonBlank(pairing.populationId)) {
    errors.push(violation("invalid-scope", "the pairing cites a blank population id — the population reference is content-addressed, never blank"));
  }
  const cooperating = pairing.cohorts.cooperating.map(String);
  const competing = pairing.cohorts.competing.map(String);
  if (cooperating.length === 0 || competing.length === 0) {
    errors.push(violation("empty-cohort", `a self-play pairing needs BOTH cohorts (${String(cooperating.length)} cooperating, ${String(competing.length)} competing)`));
  }
  if (!isSorted(cooperating)) {
    errors.push(violation("canonical-order", "the cooperating cohort is not in canonical member order (A9: input order never leaks)"));
  }
  if (!isSorted(competing)) {
    errors.push(violation("canonical-order", "the competing cohort is not in canonical member order (A9: input order never leaks)"));
  }
  const overlap = cooperating.filter((id) => competing.includes(id));
  if (overlap.length > 0) {
    errors.push(violation("duplicate-member", `member(s) ${overlap.join(", ")} appear in BOTH cohorts — the split is a partition, one cohort per member`));
  }
  const covered = new Set([...cooperating, ...competing]);
  if (covered.size !== pairing.memberCount) {
    errors.push(violation("cohort-coverage", `the cohorts cover ${String(covered.size)} member(s) but the population census carries ${String(pairing.memberCount)} — the split covers the WHOLE membership`));
  }
  for (const id of covered) {
    if (!nonBlank(id)) {
      errors.push(violation("cohort-coverage", "a cohort carries a blank member id — cohort members are explicit binding ids"));
    }
  }
  for (const entry of structureErrors(pairing.structure)) {
    errors.push(violation("structure-mismatch", entry.message));
  }
  if (typeof pairing.provenance.populationSealedAt !== "number" || !Number.isFinite(pairing.provenance.populationSealedAt)) {
    errors.push(violation("invalid-provenance", "the population seal time is not a finite declared number — deterministic DATA, never a clock read (A9)"));
  }
  const expected = `${SELFPLAY_PAIRING_ID_PREFIX}${stableDigest({
    kind: pairing.kind,
    scope: pairing.scope,
    populationId: pairing.populationId,
    generation: pairing.generation,
    memberCount: pairing.memberCount,
    cohorts: pairing.cohorts,
    structure: pairing.structure,
    provenance: pairing.provenance,
  })}`;
  if (expected !== String(pairing.pairingId)) {
    errors.push(violation("identity-mismatch", `the pairing id is not the content address of the recorded plan (expected ${expected.slice(0, 22)}…, recorded ${String(pairing.pairingId).slice(0, 22)}…)`));
  }
  return errors.length === 0
    ? { ok: true, checked: ["identity", "scope", "cohorts", "coverage", "structure", "provenance"] }
    : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The adversarial whole-record re-validation
// ---------------------------------------------------------------------------

export type AdversarialValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly PairingValidationError[] };

const W039_OPERATIONS = [
  "remove-position",
  "remove-unit",
  "substitute-body-requirement",
  "substitute-substrate-requirement",
] as const;

/** Re-prove a sealed adversarial pairing from its own recorded data alone. */
export function validateAdversarialPairing(pairing: AdversarialPairing): AdversarialValidationOutcome {
  const errors: PairingValidationError[] = [];
  if (pairing.kind !== "adversarial-pairing") {
    return { ok: false, errors: [violation("invalid-kind", "the record is not an adversarial pairing — kind is explicit, never inferred")] };
  }
  if (!nonBlank(pairing.scope.tenantId) || !nonBlank(pairing.scope.projectId) || !nonBlank(pairing.scope.worldId)) {
    errors.push(violation("invalid-scope", "the pairing scope carries a blank member — the explicit tenant/project/world identity law"));
  }
  if (!nonBlank(pairing.champion.populationId) || !nonBlank(pairing.challenger.populationId)) {
    errors.push(violation("invalid-scope", "the pairing cites a blank population id — population references are content-addressed, never blank"));
  }
  if (pairing.challenger.generation !== pairing.champion.generation + 1) {
    errors.push(violation("generation-mismatch", `the challenger names generation ${String(pairing.challenger.generation)} against the champion's ${String(pairing.champion.generation)} — an adversarial pairing is GENERATIONAL: the challenger is exactly one generation past the champion`));
  }
  if (pairing.champion.generation < 0 || pairing.challenger.generation < 0) {
    errors.push(violation("generation-mismatch", "a side carries a negative generation — generations count from zero"));
  }
  if (pairing.substitution !== null) {
    const citation = pairing.substitution;
    if (!nonBlank(citation.kind)) {
      errors.push(violation("substitution-invalid", "the substitution citation carries a blank axis kind — the W036/W039 axis vocabulary is explicit"));
    }
    if (!nonBlank(citation.subject)) {
      errors.push(violation("substitution-invalid", "the substitution citation carries a blank subject — the citation names what the operation acted on"));
    }
    if (!W039_OPERATIONS.includes(citation.operation as (typeof W039_OPERATIONS)[number])) {
      errors.push(violation("substitution-invalid", `the substitution citation's operation '${String(citation.operation)}' is outside the W039 origin operation vocabulary (${W039_OPERATIONS.join(", ")})`));
    }
  }
  if (typeof pairing.provenance.challengerSealedAt !== "number" || !Number.isFinite(pairing.provenance.challengerSealedAt)) {
    errors.push(violation("invalid-provenance", "the challenger seal time is not a finite declared number — deterministic DATA, never a clock read (A9)"));
  }
  const expected = `${ADVERSARIAL_PAIRING_ID_PREFIX}${stableDigest({
    kind: pairing.kind,
    scope: pairing.scope,
    champion: pairing.champion,
    challenger: pairing.challenger,
    substitution: pairing.substitution,
    provenance: pairing.provenance,
  })}`;
  if (expected !== String(pairing.pairingId)) {
    errors.push(violation("identity-mismatch", `the pairing id is not the content address of the recorded plan (expected ${expected.slice(0, 22)}…, recorded ${String(pairing.pairingId).slice(0, 22)}…)`));
  }
  return errors.length === 0
    ? { ok: true, checked: ["identity", "scope", "generations", "substitution", "provenance"] }
    : { ok: false, errors };
}
