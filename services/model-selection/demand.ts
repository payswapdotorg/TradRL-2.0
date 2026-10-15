/**
 * The selection demand + the benchmark surface contracts (W042) — typed
 * DATA: what a position demands of its substrate, and the measured
 * surface a selection is justified against.
 *
 * Spec: spec/REQUIREMENTS.md R050 — "Agent Body distinct from model
 * substrate": choosing the substrate is a FIRST-CLASS, evidenced act —
 * the demand carries the W039 position vocabulary (body/substrate
 * requirements + capability demands) and the benchmark policy; R052 —
 * every selection cites MEASURED evidence (no demand without evidence:
 * a capability-demand-free selection is refused, below in ./select.ts).
 *
 * The benchmark surface types are the STRUCTURAL MIRROR of the
 * dependency-free catalogue at benchmarks/model-capability (the
 * contracts/ui precedent — the catalogue imports nothing; the service
 * consumes it through structural typing and validates it at load in
 * ./validate.ts). The W037 atom family is mirrored unbranded so the
 * catalogue's plain declarative literals typecheck against these types
 * with no casts — atoms are compared AS DATA, never parsed.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { ExperimentEvaluation } from "evaluation";
import type {
  OrganizationBodyRequirement,
  OrganizationCapability,
  OrganizationCapabilityDemand,
  OrganizationSubstrateRequirement,
} from "organization";
import type { RegisteredSubstrate } from "organization-compiler";
import type { SkillError } from "skills";
import type { CapabilityError } from "capability-registry";
import type { SelectionId, SelectionScope } from "./identity.js";

// ---------------------------------------------------------------------------
// The benchmark surface (the structural mirror of the catalogue)
// ---------------------------------------------------------------------------

/** The closed atom-kind family — the W037 holdout atom vocabulary. */
export const BENCHMARK_ATOM_KINDS = ["period", "regime", "asset", "venue"] as const;
export type BenchmarkAtomKind = (typeof BENCHMARK_ATOM_KINDS)[number];

/**
 * One split atom, as the selection compares it: the W037 atom family
 * (period/regime/asset/venue) with UNBRANDED fields — the dependency-free
 * catalogue's plain literals are structurally this shape, and the W038
 * evaluations' branded atoms narrow into it (data comparison, no parsing).
 */
export type BenchmarkSplitAtom =
  | { readonly kind: "period"; readonly from: number; readonly to: number }
  | { readonly kind: "regime"; readonly regimeId: string }
  | { readonly kind: "asset"; readonly instrumentId: string }
  | { readonly kind: "venue"; readonly venueId: string };

/** The closed required-evidence shape vocabulary (the W037/W038 chain). */
export const BENCHMARK_EVIDENCE_SHAPE = ["experiment", "evaluation", "findings"] as const;
export type BenchmarkEvidenceShapeMember = (typeof BENCHMARK_EVIDENCE_SHAPE)[number];

/** One required holdout axis of a benchmark (the atoms AS DATA). */
export interface BenchmarkAxisDescriptor {
  readonly axisId: string;
  readonly kind: BenchmarkAtomKind;
  readonly atoms: readonly BenchmarkSplitAtom[];
}

/** The versioned immutable lineage of a benchmark (genesis: parent null, version 1). */
export interface BenchmarkLineage {
  readonly parentBenchmarkId: string | null;
  readonly version: number;
}

/**
 * One declared benchmark — the structural mirror of the catalogue's
 * `ModelCapabilityBenchmarkDescriptor`: the capability kind/domain
 * (validated against W040's closed vocabularies at load), the required
 * holdout axes, the required evidence shape, the explicit scope, the
 * immutable lineage.
 */
export interface BenchmarkDescriptor {
  readonly benchmarkId: string;
  readonly name: string;
  readonly description?: string;
  readonly capabilityKind: string;
  readonly capabilityDomain: string;
  readonly requiredAxes: readonly BenchmarkAxisDescriptor[];
  readonly requiredEvidence: readonly BenchmarkEvidenceShapeMember[];
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
  readonly lineage: BenchmarkLineage;
}

/**
 * The benchmark surface a selection is justified against: the validated
 * catalogue (the declarative benchmarks) PLUS the W038 experiment
 * evaluations the cited evidence was measured through — the evaluations
 * are the ONLY source of holdout-split atoms for the coverage proof
 * (carried verbatim, never re-scored; the W038 carry precedent).
 */
export interface BenchmarkSurface {
  readonly catalogue: readonly BenchmarkDescriptor[];
  readonly evaluations: readonly ExperimentEvaluation[];
}

// ---------------------------------------------------------------------------
// The selection demand
// ---------------------------------------------------------------------------

/**
 * The typed selection demand: the position's requirements in the W039
 * vocabulary (title + body requirement + substrate requirement +
 * capability demands), the organization's declared capability catalogue
 * (so each demand is answerable through W040's matchCapabilityDemand
 * seam), the benchmark policy (which benchmark ids the selection MUST be
 * justified against), and the registered candidate substrates (the W039
 * compiler registry's `RegisteredSubstrate` entries — the W033
 * descriptors eligibility is proven against). Declaration only — the
 * walk lives in ./select.ts.
 */
export interface SelectionDemand {
  readonly scope: SelectionScope;
  readonly position: {
    readonly title: string;
    readonly bodyRequirement: OrganizationBodyRequirement;
    readonly substrateRequirement: OrganizationSubstrateRequirement;
    readonly capabilityDemands: readonly OrganizationCapabilityDemand[];
  };
  /** The demanding organization's declared capabilities (the W039 catalogue). */
  readonly capabilities: readonly OrganizationCapability[];
  /** The benchmark ids the selection must be justified against (non-duplicate). */
  readonly benchmarkPolicy: readonly string[];
  /** The registered candidate substrates (the compiler registry entries). */
  readonly candidates: readonly RegisteredSubstrate[];
}

// ---------------------------------------------------------------------------
// The typed error families (closed sets — every law named)
// ---------------------------------------------------------------------------

/** One violated catalogue law (carried on `catalogue-invalid`). */
export interface CatalogueError {
  readonly code: CatalogueErrorCode;
  readonly message: string;
  readonly benchmarkId?: string;
}

export type CatalogueErrorCode =
  | "blank-benchmark-member" // blank id/name/scope member
  | "duplicate-benchmark" // one id, one benchmark
  | "unknown-capability-kind" // outside W040's closed vocabulary
  | "unknown-capability-domain" // outside W040's closed vocabulary
  | "unknown-evidence-shape" // outside the closed required-evidence set
  | "empty-evidence-shape" // a benchmark demands at least one component
  | "unknown-axis-kind" // outside the W037 atom family
  | "blank-axis-member" // blank axisId / atom id member
  | "invalid-period-atom" // from >= to (an empty or reversed period)
  | "empty-axis" // an axis demands at least one atom
  | "duplicate-axis" // one axisId per benchmark
  | "duplicate-atom" // one atom once per axis
  | "catalogue-scope-mismatch" // the catalogue is single-scope
  | "invalid-lineage" // genesis shape or version law violated
  | "lineage-break"; // parent missing, or version not parent+1

/** Why one candidate was NOT selected — loud, typed, never a silent drop. */
export type CandidateRejectionCode =
  | "requirement-incompatibility" // the W039 substrate requirement, field named
  | "unprovided-demand" // this candidate offers no live capability for a demand
  | "capability-deprecated" // the W040 lifecycle, carried verbatim
  | "capability-revoked" // terminal, carried verbatim
  | "benchmark-coverage-failure" // a demanded benchmark's axis atom uncovered
  | "bearer-without-descriptor"; // a skill bearer with no registered descriptor

export interface CandidateRejection {
  readonly code: CandidateRejectionCode;
  readonly message: string;
  readonly substrateId: string;
  /** The W040 lifecycle transitions, carried VERBATIM on deprecation/revocation. */
  readonly lifecycle?: readonly { readonly to: string; readonly reason: string }[];
}

export type SelectionErrorCode =
  | "blank-demand-member" // blank title/scope member/capability member
  | "duplicate-candidate" // the same substrate registered twice in the demand
  | "duplicate-benchmark-policy" // one benchmark demanded once
  | "unknown-declared-capability" // a demand names no declared organization capability
  | "registry-invalid" // W040 re-validation failed (errors carried verbatim)
  | "skills-invalid" // W041 re-validation failed (errors carried verbatim)
  | "scope-mismatch" // demand/registry/skills/catalogue scope disagreement
  | "catalogue-invalid" // the catalogue laws (errors carried verbatim)
  | "unknown-benchmark" // the policy cites a benchmark the catalogue lacks
  | "unprovided-demand" // no registered capability provides a demanded capability
  | "lifecycle-refused" // every provider deprecated/revoked (W040 carried verbatim)
  | "unmeasured-selection" // R052 — no capability demand, no evidence, NO selection
  | "unknown-evaluation" // a cited evaluation is missing from the surface
  | "no-eligible-candidate"; // every candidate rejected (rejections carried)

/** One typed selection error (fail-closed; upstream errors carried verbatim). */
export interface SelectionError {
  readonly code: SelectionErrorCode;
  readonly message: string;
  readonly substrateId?: string;
  readonly benchmarkId?: string;
  /** Present on `registry-invalid`: W040's own errors, verbatim. */
  readonly registryErrors?: readonly CapabilityError[];
  /** Present on `skills-invalid`: W041's own errors, verbatim. */
  readonly skillErrors?: readonly SkillError[];
  /** Present on `catalogue-invalid`: the catalogue law errors, verbatim. */
  readonly catalogueErrors?: readonly CatalogueError[];
  /** Present on `no-eligible-candidate`: every candidate's reasons, verbatim. */
  readonly rejections?: readonly CandidateRejection[];
}

export type SelectionOutcome =
  | { readonly ok: true; readonly plan: SelectionPlan }
  | { readonly ok: false; readonly errors: readonly SelectionError[] };

// ---------------------------------------------------------------------------
// The selection plan (composed DATA — never executed)
// ---------------------------------------------------------------------------

/** One covering capability, carried with its measured provenance. */
export interface SelectedCapability {
  readonly capabilityId: string;
  readonly name: string;
  readonly kind: string;
  readonly domain: string;
  readonly state: string;
  readonly satisfiesDemandId: string;
  /** The W040 measured provenance, carried verbatim. */
  readonly provenance: readonly {
    readonly experimentId: string;
    readonly evaluationId: string;
    readonly findingsDigest: string;
  }[];
  /** The W040 matchCapabilityDemand evidence reasons, carried VERBATIM. */
  readonly matchReasons: readonly string[];
}

/** One linked skill, carried with its evidence citations. */
export interface SelectedSkill {
  readonly skillId: string;
  readonly capabilityId: string;
  readonly trajectoryIds: readonly string[];
  readonly experimentIds: readonly string[];
}

/** One resolved evaluation the chain cites (the carried holdout atoms). */
export interface ChainEvaluation {
  readonly evaluationId: string;
  readonly experimentId: string;
  readonly splits: readonly {
    readonly axisId: string;
    readonly kind: string;
    readonly trainAtoms: readonly BenchmarkSplitAtom[];
    readonly evaluationAtoms: readonly BenchmarkSplitAtom[];
  }[];
}

/** One demanded benchmark's coverage proof (atoms → covering evaluations). */
export interface BenchmarkCoverageProof {
  readonly benchmarkId: string;
  readonly axes: readonly {
    readonly axisId: string;
    readonly kind: BenchmarkAtomKind;
    readonly requiredAtomCount: number;
    readonly coveredAtomCount: number;
    /** Which evaluation ids' splits covered which atoms (as data). */
    readonly coverage: readonly { readonly atomIndex: number; readonly evaluationId: string }[];
  }[];
}

/**
 * The model-substitution variant (W039's substitution axis, as data): the
 * next-ranked eligible candidate the plan's consumer may substitute, with
 * the carried evidence counts that separate them (counts of CARRIED
 * citations — never a re-scored statistic).
 */
export interface SelectionVariant {
  readonly kind: "model-substitution";
  readonly substituteSubstrateId: string;
  readonly substituteDisplayName: string;
  readonly carriedCitations: number;
  readonly selectedCarriedCitations: number;
}

/** The full evidence chain the selection is justified by (A6). */
export interface SelectionEvidenceChain {
  readonly selectedSubstrateId: string;
  readonly selectedDisplayName: string;
  readonly capabilities: readonly SelectedCapability[];
  readonly skills: readonly SelectedSkill[];
  readonly evaluations: readonly ChainEvaluation[];
  readonly benchmarkCoverage: readonly BenchmarkCoverageProof[];
  readonly totalCarriedCitations: number;
}

/** One ranked eligible candidate (deterministic order — A9). */
export interface RankedCandidate {
  readonly substrateId: string;
  readonly displayName: string;
  readonly carriedCitations: number;
  readonly coveredDemandCount: number;
  readonly linkedSkillCount: number;
}

/** The composed selection plan — DATA the consumer (W043/W044) reads, never executes. */
export interface SelectionPlan {
  readonly selectionId: SelectionId;
  readonly scope: SelectionScope;
  readonly demandedBenchmarks: readonly string[];
  readonly selected: SelectionEvidenceChain;
  /** Every eligible candidate in deterministic rank order (selected first). */
  readonly ranking: readonly RankedCandidate[];
  /** Every rejected candidate's typed reasons — loud, never a silent drop. */
  readonly rejections: readonly CandidateRejection[];
  /** The ablation/model-substitution variants (the runner-ups, as data). */
  readonly variants: readonly SelectionVariant[];
}
