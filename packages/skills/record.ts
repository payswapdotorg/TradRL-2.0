/**
 * Skill record contracts (W041) — the typed DATA an extracted skill IS,
 * plus the package's closed typed error and refusal families.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL":
 * a skill cites the W037 trajectories that DEMONSTRATED it and the W040
 * capability it was measured as; the measured summaries CARRY the records'
 * own outcome data verbatim (the W038 precedent: carry, never re-score —
 * this package never computes a score that was not already computed by the
 * evaluation the trajectory records hold).
 *
 * Spec: spec/DOMAIN-MODEL.md "Skill" (future-intelligence entity, under
 * the identity laws): opaque ids, canonical encoders, explicit scope,
 * immutable lineage.
 *
 * This module is types + closed sets (the contracts-family law): the
 * extraction gate lives in ./extract.ts, re-validation in ./validate.ts,
 * identity in ./identity.ts. No execution, no model calls, no training.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { TrajectoryError, TrajectoryId, TrajectoryRecord } from "trajectory";
import type {
  CapabilityBearer,
  CapabilityDomain,
  CapabilityError,
  CapabilityId,
  CapabilityKind,
  EvidenceCitation,
} from "capability-registry";
import type { ExtractionId, SkillId, SkillScope } from "./identity.js";

// ---------------------------------------------------------------------------
// The skill record
// ---------------------------------------------------------------------------

/**
 * The measured outcome data of ONE demonstrating trajectory, CARRIED
 * verbatim from the record's own evaluation + session binding (never
 * re-scored, never aggregated beyond counting): the W036 policy evaluation
 * the W037 record already holds, and the session counters that say what
 * actually happened.
 */
export interface TrajectoryOutcomeCarry {
  readonly trajectoryId: TrajectoryId;
  /** The W036 policy id the trajectory was evaluated under (carried). */
  readonly policyId: string;
  readonly combinedScore: number;
  readonly appliedSoftPenaltyTotal: number;
  readonly compliance: TrajectoryRecord["evaluation"]["compliance"];
  /** The terminal session status ("detached" | "failed", carried). */
  readonly status: TrajectoryRecord["session"]["status"];
  readonly passCount: number;
  readonly commandsIssued: number;
  readonly acked: number;
  readonly rejected: number;
}

/**
 * The versioned immutable lineage of a skill: genesis skills have no
 * parent and version 1; a successor skill cites its parent and is exactly
 * parent.version + 1. Extraction produces GENESIS skills (parent null,
 * version 1) — successors are a consumer-side derivation law, and lineage
 * is never edited in place.
 */
export interface SkillLineage {
  readonly parentSkillId: SkillId | null;
  readonly version: number;
}

/**
 * The evidence citations (A6 — evidence-linked truth): the W037 trajectory
 * canonical ids that demonstrated the skill (canonical sorted order), the
 * experiments those trajectories ran in (the trajectories' own scope
 * experiment members, sorted unique), and the W040 capability's measured
 * provenance carried VERBATIM from the registry descriptor.
 */
export interface SkillEvidence {
  readonly trajectoryIds: readonly TrajectoryId[];
  readonly experimentIds: readonly string[];
  readonly capabilityProvenance: readonly EvidenceCitation[];
}

/**
 * The competence statement: the W040 capability this skill was measured
 * as, carried from the registry descriptor (kind/domain from the W040
 * closed vocabularies — never re-declared here). The capabilityId commits
 * to the name/kind/domain/bearer/provenance transitively through W040's
 * own content addressing.
 */
export interface SkillCompetence {
  readonly capabilityId: CapabilityId;
  readonly name: string;
  readonly kind: CapabilityKind;
  readonly domain: CapabilityDomain;
}

/** The carried measured summary: one carry per demonstrating trajectory. */
export interface SkillSummary {
  readonly outcomeCarries: readonly TrajectoryOutcomeCarry[];
  readonly trajectoryCount: number;
}

/** The deterministic extraction provenance: WHICH run derived this skill. */
export interface SkillProvenance {
  readonly extractionId: ExtractionId;
}

/**
 * A skill as the extraction gate derives it: identity, the competence
 * statement (carried), the bearer dimension (carried — WHO demonstrated
 * it), the explicit scope, the evidence citations, the carried measured
 * summary, the immutable lineage, and the extraction provenance. DATA
 * only: laws live in ./extract.ts and ./validate.ts.
 */
export interface SkillRecord {
  readonly skillId: SkillId;
  readonly competence: SkillCompetence;
  readonly bearer: CapabilityBearer;
  readonly scope: SkillScope;
  readonly evidence: SkillEvidence;
  readonly summary: SkillSummary;
  readonly lineage: SkillLineage;
  readonly provenance: SkillProvenance;
}

// ---------------------------------------------------------------------------
// The extraction run + the refusal family (typed data, never silent)
// ---------------------------------------------------------------------------

/**
 * Why one capability produced no skill in a run — typed, loud,
 * deterministic. A refusal is not an error: the inputs were valid, the
 * walk simply derived nothing for this capability, and the refusal names
 * the law so nothing is silently dropped.
 */
export type SkillRefusalCode =
  | "no-trajectory-evidence" // R052 — THE law: no evidence, no skill
  | "capability-deprecated" // the W040 lifecycle, carried loudly
  | "capability-revoked"; // terminal: carried loudly

/** One refusal entry, in canonical capability-id order (the walk order). */
export interface SkillRefusal {
  readonly code: SkillRefusalCode;
  readonly capabilityId: CapabilityId;
  readonly message: string;
}

/** One extraction run: the deterministic record of WHAT was derived. */
export interface ExtractionRun {
  readonly extractionId: ExtractionId;
  readonly scope: SkillScope;
  /** The derived skills, in canonical skill-id order (A9). */
  readonly skills: readonly SkillRecord[];
  /** Why each non-derived capability produced no skill (canonical order). */
  readonly refusals: readonly SkillRefusal[];
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type SkillErrorCode =
  // extraction input gates (upstream errors carried verbatim)
  | "malformed-trajectory" // W037 re-validation failed (errors carried)
  | "registry-invalid" // W040 re-validation failed (errors carried)
  | "trajectory-scope-mismatch" // a trajectory's scope ≠ the registry's
  | "duplicate-trajectory" // the same trajectory id twice in the batch
  // record validation (re-proved from the recorded data)
  | "blank-scope-member" // the skill scope is not explicit
  | "skill-id-mismatch" // the id is not the canonical derivation of its content
  | "blank-capability-reference" // the carried capability id/name is blank
  | "unknown-capability-kind" // outside the W040 closed vocabulary
  | "unknown-capability-domain" // outside the W040 closed vocabulary
  | "unknown-bearer-kind" // outside the W040 closed bearer set
  | "blank-bearer-id"
  | "unmeasured-capability" // R052 — THE law of this package
  | "blank-citation-member" // a trajectory/experiment/provenance citation is blank
  | "duplicate-evidence-citation" // the same trajectory cited twice
  | "non-canonical-order" // evidence/summary order is not the canonical order
  | "summary-evidence-mismatch" // the summary disagrees with the evidence
  | "invalid-lineage" // a lineage shape law was violated
  | "blank-provenance" // the extraction provenance is blank
  // set validation
  | "duplicate-skill" // the same skill id twice in a collection
  | "lineage-break" // parent missing, or versions not continuous
  | "scope-mismatch"; // the collection's scopes disagree

/** One typed skill error (fail-closed; carries the upstream errors). */
export interface SkillError {
  readonly code: SkillErrorCode;
  readonly message: string;
  readonly skillId?: string;
  readonly trajectoryId?: string;
  readonly capabilityId?: string;
  /** Present on `malformed-trajectory`: W037's own errors, verbatim. */
  readonly trajectoryErrors?: readonly TrajectoryError[];
  /** Present on `registry-invalid`: W040's own errors, verbatim. */
  readonly registryErrors?: readonly CapabilityError[];
}

export type ExtractionOutcome =
  | { readonly ok: true; readonly run: ExtractionRun }
  | { readonly ok: false; readonly errors: readonly SkillError[] };

export type SkillValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly SkillError[] };

export type SkillSetValidationOutcome =
  | { readonly ok: true; readonly checked: readonly string[] }
  | { readonly ok: false; readonly errors: readonly SkillError[] };
