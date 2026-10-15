/**
 * research/benchmarks — the benchmark/evidence PUBLICATION catalogue
 * (W063). DATA ONLY: this module declares the publication record
 * vocabulary and the genesis publication-family catalogue; the gate that
 * seals publications over already-verified records is `validate.ts`.
 *
 * Publication is COMPOSITION + CITATION (spec/ARCHITECTURE-LOCK.md A14):
 * a publication never measures, never re-scores, never executes anything.
 * Every number on a publication record is CARRIED by a cited record —
 * the W052 split family, the W038 evaluation + verification findings, the
 * W051 search history, the W061 audit trail, and the W022 replay-fidelity
 * verdicts (spec/ARCHITECTURE-LOCK.md A6 — evidence-linked truth: an
 * uncited claim is a loud typed refusal, enforced by the gate).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the publication id is
 * the canonical content digest over the canonical record bytes (same cited
 * records ⇒ deep-equal publication, same `bp-<digest>` id); no clocks, no
 * randomness, no env reads.
 *
 * This directory is a PLAIN directory (the benchmarks/model-capability +
 * contracts/ui precedent): no package manifest, no workspace membership.
 * Imports are relative source imports; the vocabulary structurally
 * mirrors the consumed packages' own vocabularies and the gate re-proves
 * every mirror against the real thing.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "../../packages/trajectory/index.js";
import { SEARCH_HISTORY_INTEGRITY_LAW } from "../../packages/search-integrity/index.js";
import type { SplitFamilyKind } from "../../packages/evaluation-splits/index.js";
import type {
  FidelityClaimDescriptor,
  FidelityVerdict,
} from "../../packages/tradrl-evaluation/replay/index.js";

// ---------------------------------------------------------------------------
// The laws, named (carried on every publication's provenance)
// ---------------------------------------------------------------------------

/** The A6 evidence-linked-truth law, named. */
export const EVIDENCE_LINKED_TRUTH_LAW = "spec/ARCHITECTURE-LOCK.md A6" as const;

/** The A9 deterministic-replay law, named. */
export const PUBLICATION_DETERMINISM_LAW = "spec/ARCHITECTURE-LOCK.md A9" as const;

/** The A14 composition law, named. */
export const PUBLICATION_COMPOSITION_LAW = "spec/ARCHITECTURE-LOCK.md A14" as const;

/** The canonical publication law list carried on the provenance. */
export const PUBLICATION_PROVENANCE_LAWS: readonly string[] = [
  EVIDENCE_LINKED_TRUTH_LAW,
  SEARCH_HISTORY_INTEGRITY_LAW,
  PUBLICATION_DETERMINISM_LAW,
  PUBLICATION_COMPOSITION_LAW,
];

// ---------------------------------------------------------------------------
// The citation vocabulary (opaque ids + CARRIED counts — data, never
// re-derivations; the gate re-proves every member through the cited
// record's own validators)
// ---------------------------------------------------------------------------

/**
 * The split-family citation (the W052 linkage): W052's own citation seam
 * members (opaque `fam-<digest>` id + kind + the §13 search-history
 * integrity law) plus the record's own CARRIED shape counts.
 */
export interface FamilyCitation {
  readonly familyId: string;
  readonly kind: string;
  readonly splitCount: number;
  readonly foldCount: number;
  readonly law: string;
}

/**
 * The evaluation citation (the W038 outcome linkage): the opaque
 * content-addressed evaluation id, the experiment + policy it answers, the
 * verification findings digest, and the outcome-side CARRIED counts —
 * every number carried by the cited records, never recomputed here.
 */
export interface EvaluationCitation {
  readonly evaluationId: string;
  readonly experimentId: string;
  readonly policyId: string;
  readonly findingsDigest: string;
  readonly trajectoryCount: number;
  readonly passCount: number;
  readonly failCount: number;
  readonly partialCount: number;
  readonly undeclaredCount: number;
}

/**
 * The search-history citation (the W051 integrity linkage): the opaque
 * content-addressed history id plus the record's own CARRIED counts —
 * trials tried, selection decisions, distinct trials chosen (the
 * multiple-comparisons surface, carried as counts, never re-derived).
 */
export interface HistoryCitation {
  readonly historyId: string;
  readonly trialCount: number;
  readonly selectionCount: number;
  readonly selectedTrialCount: number;
  readonly law: string;
}

/**
 * The audit-trail citation (the W061 operations linkage): the opaque
 * content-addressed trail id, the hash-chain head, and the record's own
 * CARRIED record count — the tamper-evidenced custody trail of the
 * published evidence.
 */
export interface AuditTrailCitation {
  readonly trailId: string;
  readonly head: string;
  readonly recordCount: number;
  readonly law: string;
}

// ---------------------------------------------------------------------------
// The reproducibility manifest (the W022 claim shape, verdicts CARRIED)
// ---------------------------------------------------------------------------

/**
 * ONE reproducibility claim, in W022's own claim-descriptor shape
 * (claimId / title / family / module — carried from W022's registry) plus
 * the verdict CARRIED from the cited fidelity finding and that finding's
 * own content digest (W022's `findingDigestOf` rendering). The gate
 * refuses a claim whose verdict is not backed by a cited finding.
 */
export interface ReproducibilityClaim {
  readonly claimId: string;
  readonly title: string;
  readonly family: FidelityClaimDescriptor["family"];
  readonly module: string;
  readonly verdict: FidelityVerdict;
  readonly findingDigest: string;
}

/** The manifest schema stamp (a rendering convention, never parsed). */
export const REPRODUCIBILITY_MANIFEST_SCHEMA = "tradrl-benchmark-reproducibility@1" as const;

/**
 * The reproducibility manifest: the W022-style replay claims this
 * publication's evidence reproducibility rests on (canonical registry
 * order) plus the verdict tallies CARRIED from the cited findings through
 * W022's own tally machinery — never asserted, never invented.
 */
export interface ReproducibilityManifest {
  readonly schema: typeof REPRODUCIBILITY_MANIFEST_SCHEMA;
  readonly claims: readonly ReproducibilityClaim[];
  readonly passCount: number;
  readonly failCount: number;
  readonly partialCount: number;
}

// ---------------------------------------------------------------------------
// The scope, the declaration catalogue, the record
// ---------------------------------------------------------------------------

/**
 * The explicit single scope every publication is sealed in: the
 * tenant/project/world members of the cited family's, history's and audit
 * trail's own scopes (the gate proves all three agree — one scope, never
 * assumed).
 */
export interface PublicationScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

/**
 * The closed §13 holdout-kind family this catalogue mirrors from W052's
 * own `SPLIT_FAMILY_KINDS` (a structural mirror so the vocabulary stays
 * declarative data; the gate cross-proves the mirror against the real
 * kind on every citation).
 */
export const PUBLICATION_FAMILY_KINDS = [
  "walk-forward",
  "regime",
  "asset",
  "venue",
] as const;
export type PublicationFamilyKind = (typeof PUBLICATION_FAMILY_KINDS)[number];

/** The closed citation-kind vocabulary a publication family can require. */
export const PUBLICATION_CITATION_KINDS = [
  "split-family",
  "evaluation",
  "findings",
  "search-history",
  "audit-trail",
  "reproducibility",
] as const;
export type PublicationCitationKind = (typeof PUBLICATION_CITATION_KINDS)[number];

/**
 * ONE declared publication family — the benchmark DECLARATION this
 * directory publishes under: what the family publishes over (the §13
 * holdout kind of the cited W052 family), which citation kinds every
 * sealed publication must carry, and which W022 replay-fidelity claims
 * its reproducibility manifest must be backed by. Typed DATA — declaring
 * WHAT is citable; it never runs, never scores, never records results.
 */
export interface BenchmarkPublicationFamily {
  /** Opaque declared id (unique in the catalogue; never parsed). */
  readonly publicationId: string;
  readonly name: string;
  readonly description: string;
  readonly familyKind: PublicationFamilyKind;
  readonly requiredCitations: readonly PublicationCitationKind[];
  /** W022 registry claim ids, in registry order (the manifest backbone). */
  readonly requiredClaims: readonly string[];
  readonly lineage: {
    readonly parentPublicationId: string | null;
    readonly version: number;
  };
}

/**
 * The genesis publication-family catalogue. Successors arrive only
 * through re-declaration (immutable lineage); the gate refuses a
 * publication citing a family id this catalogue does not carry.
 */
export const BENCHMARK_PUBLICATION_FAMILIES: readonly BenchmarkPublicationFamily[] = [
  {
    publicationId: "pub-walk-forward-evidence-v1",
    name: "walk-forward benchmark evidence publication",
    description:
      "the reproducible publication of evaluated walk-forward holdout evidence: one W052 walk-forward split family, the W038 evaluation + verification findings it judged, the W051 search history it came from, the W061 audit trail that custodies it, and the W022 replay-fidelity verdicts its reproducibility rests on",
    familyKind: "walk-forward",
    requiredCitations: [...PUBLICATION_CITATION_KINDS],
    requiredClaims: [
      "ns-to-ms-exact-digit-truncation",
      "int64-carrier-fidelity",
      "a9-double-map-determinism",
    ],
    lineage: { parentPublicationId: null, version: 1 },
  },
  {
    publicationId: "pub-regime-evidence-v1",
    name: "regime benchmark evidence publication",
    description:
      "the reproducible publication of evaluated regime-holdout evidence: one W052 regime partition family, the W038 evaluation + verification findings it judged, the W051 search history, the W061 audit trail, and the W022 replay-fidelity verdicts",
    familyKind: "regime",
    requiredCitations: [...PUBLICATION_CITATION_KINDS],
    requiredClaims: [
      "bar-interval-convention",
      "bar-availability-at-close",
      "known-gap-declaration-honesty",
    ],
    lineage: { parentPublicationId: null, version: 1 },
  },
  {
    publicationId: "pub-asset-evidence-v1",
    name: "asset benchmark evidence publication",
    description:
      "the reproducible publication of evaluated asset-holdout evidence: one W052 asset partition family, the W038 evaluation + verification findings it judged, the W051 search history, the W061 audit trail, and the W022 replay-fidelity verdicts",
    familyKind: "asset",
    requiredCitations: [...PUBLICATION_CITATION_KINDS],
    requiredClaims: [
      "aggressor-side-mapping",
      "quote-no-last",
      "float64-canonical-decimal",
    ],
    lineage: { parentPublicationId: null, version: 1 },
  },
  {
    publicationId: "pub-venue-evidence-v1",
    name: "venue benchmark evidence publication",
    description:
      "the reproducible publication of evaluated venue-holdout evidence: one W052 venue partition family, the W038 evaluation + verification findings it judged, the W051 search history, the W061 audit trail, and the W022 replay-fidelity verdicts",
    familyKind: "venue",
    requiredCitations: [...PUBLICATION_CITATION_KINDS],
    requiredClaims: [
      "trade-id-forms",
      "tick-availability-boundary",
      "derived-range-never-claimed",
    ],
    lineage: { parentPublicationId: null, version: 1 },
  },
];

// ---------------------------------------------------------------------------
// The publication record: id, scope, lineage, provenance
// ---------------------------------------------------------------------------

declare const benchmarkPublicationIdBrand: unique symbol;

/**
 * An OPAQUE publication id (a canonical digest rendering). Produced only
 * by the gate / {@link benchmarkPublicationIdOf}; never parsed — the
 * citations, scope and manifest are carried on the record, never
 * recovered by splitting the id.
 */
export type BenchmarkPublicationId = string & {
  readonly [benchmarkPublicationIdBrand]: true;
};

/** The id prefix (a rendering convention, never a parse target). */
export const BENCHMARK_PUBLICATION_ID_PREFIX = "bp-";

/**
 * The immutable lineage (the W037/W051/W052/W053 branch-lineage pattern):
 * a publication never branches on its own — a CONTINUATION declares its
 * parent, and the chain's root + ordinal are carried verbatim.
 */
export interface PublicationLineage {
  readonly parent: BenchmarkPublicationId | undefined;
  readonly root: BenchmarkPublicationId;
  readonly ordinal: number;
}

/** The declared lineage at composition (a root publication omits it). */
export interface PublicationLineageInput {
  readonly parent?: BenchmarkPublicationId;
  readonly root?: BenchmarkPublicationId;
  readonly ordinal?: number;
}

/** The deterministic provenance record (carried as data, re-derivable). */
export interface PublicationProvenance {
  readonly deriver: "compose-benchmark-publication";
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/**
 * ONE benchmark/evidence publication: the opaque content-addressed id, the
 * declared publication family it publishes under, the explicit single
 * scope, the family/evaluation/history/trail citations, the
 * reproducibility manifest (W022 claim shape, verdicts carried), the
 * immutable lineage, and the deterministic provenance. Typed DATA — never
 * executed, never re-scored (A14).
 */
export interface BenchmarkPublication {
  readonly publicationId: BenchmarkPublicationId;
  readonly familyId: string;
  readonly scope: PublicationScope;
  readonly family: FamilyCitation;
  readonly evaluation: EvaluationCitation;
  readonly history: HistoryCitation;
  readonly trail: AuditTrailCitation;
  readonly reproducibility: ReproducibilityManifest;
  readonly lineage: PublicationLineage;
  readonly provenance: PublicationProvenance;
}

// ---------------------------------------------------------------------------
// The canonical content + the id (A9: input order never leaks)
// ---------------------------------------------------------------------------

/** The canonical bytes the publication id addresses. */
function publicationCanonicalContent(record: BenchmarkPublication): unknown {
  return {
    evaluation: {
      counts: [
        record.evaluation.failCount,
        record.evaluation.partialCount,
        record.evaluation.passCount,
        record.evaluation.undeclaredCount,
        record.evaluation.trajectoryCount,
      ],
      evaluationId: record.evaluation.evaluationId,
      experimentId: record.evaluation.experimentId,
      findingsDigest: record.evaluation.findingsDigest,
      policyId: record.evaluation.policyId,
    },
    family: {
      familyId: record.family.familyId,
      foldCount: record.family.foldCount,
      kind: record.family.kind,
      splitCount: record.family.splitCount,
    },
    familyId: record.familyId,
    history: {
      counts: [
        record.history.selectionCount,
        record.history.selectedTrialCount,
        record.history.trialCount,
      ],
      historyId: record.history.historyId,
    },
    reproducibility: {
      claims: record.reproducibility.claims.map((claim) => [
        claim.claimId,
        claim.family,
        claim.findingDigest,
        claim.module,
        claim.title,
        claim.verdict,
      ]),
      counts: [
        record.reproducibility.failCount,
        record.reproducibility.partialCount,
        record.reproducibility.passCount,
      ],
      schema: record.reproducibility.schema,
    },
    scope: {
      projectId: record.scope.projectId,
      tenantId: record.scope.tenantId,
      worldId: record.scope.worldId,
    },
    trail: { head: record.trail.head, recordCount: record.trail.recordCount, trailId: record.trail.trailId },
  };
}

/**
 * The publication id: `bp-<digest>` over the canonical record bytes. Pure
 * and deterministic (A9); the lineage rides BESIDE the id, never inside
 * it.
 */
export function benchmarkPublicationIdOf(
  record: BenchmarkPublication,
): BenchmarkPublicationId {
  const digest = canonicalDigestHex(publicationCanonicalContent(record));
  return `${BENCHMARK_PUBLICATION_ID_PREFIX}${digest}` as BenchmarkPublicationId;
}

/** The §13 holdout-kind mirror cross-proved by the gate (W052's own set). */
export type CitedFamilyKind = SplitFamilyKind;
