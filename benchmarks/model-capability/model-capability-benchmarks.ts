/**
 * benchmarks/model-capability — the declarative model-capability benchmark
 * catalogue (W042). DATA ONLY: this file declares WHAT must be measured;
 * it never runs, never scores, never records results.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL":
 * a substrate/model selection must cite MEASURED evidence against a
 * DECLARED benchmark surface. This catalogue is that surface: the
 * benchmark descriptors (the capability kind/domain from W040's closed
 * vocabularies, the required holdout axes as W037 split atoms — the
 * period/regime/asset/venue family, carried AS DATA, never computed
 * statistics), the required evidence shape (experiment + evaluation +
 * findings digests — the W037/W038 chain), the explicit scope, and the
 * versioned immutable lineage.
 *
 * Deliberately dependency-free (the contracts/ui precedent): no package
 * manifest, no workspace membership, no imports. The types are the
 * structural mirror of the W037/W040 vocabularies; the selection service
 * (services/model-selection) validates this catalogue at load — unique
 * ids, closed vocabularies, scope agreement, axis-atom legality — and
 * proves benchmark coverage by comparing the cited W038 evaluations'
 * declared holdout atoms against these required axes AS DATA.
 *
 * A benchmark RUN harness is FUTURE WORK (W063's research/benchmarks/):
 * the catalogue declares what must be measured; the evidence it is
 * justified against is already measured through the W037 experiment /
 * W038 evaluation + findings chain.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

// ---------------------------------------------------------------------------
// The structural mirror of the W037 split-atom vocabulary (as DATA)
// ---------------------------------------------------------------------------

/**
 * One split atom — the W037 holdout atom family, structurally mirrored so
 * this catalogue stays dependency-free: periods for time-based holdouts,
 * regime/asset/venue ids for the id-based kinds. Compared AS DATA by the
 * selection service (kind + field equality), never parsed, never scored.
 */
export type ModelCapabilitySplitAtom =
  | { readonly kind: "period"; readonly from: number; readonly to: number }
  | { readonly kind: "regime"; readonly regimeId: string }
  | { readonly kind: "asset"; readonly instrumentId: string }
  | { readonly kind: "venue"; readonly venueId: string };

/** The closed atom-kind family (the W037 vocabulary, mirrored as data). */
export const MODEL_CAPABILITY_ATOM_KINDS = [
  "period",
  "regime",
  "asset",
  "venue",
] as const;
export type ModelCapabilityAtomKind = (typeof MODEL_CAPABILITY_ATOM_KINDS)[number];

// ---------------------------------------------------------------------------
// The evidence-shape vocabulary (the W037/W038 chain, closed)
// ---------------------------------------------------------------------------

/**
 * What a measured citation must carry to satisfy a benchmark: the W037
 * experiment, the W038 experiment evaluation, and the W038 findings
 * digest — the three components of one W040 EvidenceCitation, declared as
 * the benchmark's required evidence shape (closed set).
 */
export const MODEL_CAPABILITY_EVIDENCE_SHAPE = [
  "experiment",
  "evaluation",
  "findings",
] as const;
export type ModelCapabilityEvidenceShapeMember =
  (typeof MODEL_CAPABILITY_EVIDENCE_SHAPE)[number];

// ---------------------------------------------------------------------------
// The scope + lineage (the identity laws, as declarative data)
// ---------------------------------------------------------------------------

/**
 * The explicit scope every benchmark is declared in (single-scope
 * catalogue — the W039/W040 registry law, field equality, never parsed).
 */
export interface ModelCapabilityBenchmarkScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly worldId: string;
}

/**
 * The versioned immutable lineage of a benchmark: genesis benchmarks have
 * no parent and version 1; a re-declared successor cites its parent and
 * is exactly parent.version + 1. Immutable means a successor is a NEW
 * catalogue entry — a lineage is never edited in place.
 */
export interface ModelCapabilityBenchmarkLineage {
  readonly parentBenchmarkId: string | null;
  readonly version: number;
}

// ---------------------------------------------------------------------------
// The benchmark descriptor
// ---------------------------------------------------------------------------

/**
 * One declared benchmark: WHAT must be measured (the capability kind and
 * domain, drawn from W040's closed vocabularies), the required holdout
 * axes (the W037 atom family as data — the measurement must have SPLIT
 * over these atoms for the citation to cover the axis), the required
 * evidence shape, the explicit scope, and the immutable lineage. An
 * opaque declared id (the W039 organization-capability id precedent —
 * declared literals, uniqueness validated at load).
 */
export interface ModelCapabilityBenchmarkDescriptor {
  readonly benchmarkId: string;
  /** Non-blank human-facing name (data, never a prompt). */
  readonly name: string;
  readonly description?: string;
  /** From W040's closed CAPABILITY_KINDS vocabulary (validated at load). */
  readonly capabilityKind: string;
  /** From W040's closed CAPABILITY_DOMAINS vocabulary (validated at load). */
  readonly capabilityDomain: string;
  /** The required holdout axes — every axis's atoms must be covered by cited evidence. */
  readonly requiredAxes: readonly {
    readonly axisId: string;
    readonly kind: ModelCapabilityAtomKind;
    readonly atoms: readonly ModelCapabilitySplitAtom[];
  }[];
  /** The closed required-evidence shape (non-empty). */
  readonly requiredEvidence: readonly ModelCapabilityEvidenceShapeMember[];
  readonly scope: ModelCapabilityBenchmarkScope;
  readonly lineage: ModelCapabilityBenchmarkLineage;
}

// ---------------------------------------------------------------------------
// The catalogue (declarative data — four genesis benchmarks)
// ---------------------------------------------------------------------------

/** The single scope this catalogue is declared in. */
export const MODEL_CAPABILITY_BENCHMARK_SCOPE: ModelCapabilityBenchmarkScope = {
  tenantId: "tenant-model-selection",
  projectId: "project-selection",
  worldId: "world-selection-fixture",
};

/**
 * The held-out period the execution-quality evidence must have split
 * over (the evaluation side of the fixture experiments' unseen-period
 * axis) and the primary venue of the venue axis.
 */
const HELDOUT_PERIOD_ATOM = {
  kind: "period",
  from: 1_700_500_000_001,
  to: 1_701_000_000_000,
} as const;
const HELDOUT_VENUE_ATOM = { kind: "venue", venueId: "venue-forge-main" } as const;

/**
 * THE catalogue: the declarative benchmark surface selections are
 * justified against. All entries are genesis (parent null, version 1) —
 * successors arrive only through re-declaration (immutable lineage).
 */
export const MODEL_CAPABILITY_BENCHMARKS: readonly ModelCapabilityBenchmarkDescriptor[] = [
  {
    benchmarkId: "bmk-execution-quality-futures-holdout",
    name: "execution quality on held-out futures periods and venues",
    description:
      "the substrate's execution quality measured on futures, split over an unseen period and a held-out venue (the W037 atom vocabulary as data)",
    capabilityKind: "execution-quality",
    capabilityDomain: "futures",
    requiredAxes: [
      {
        axisId: "axis-heldout-period-2024h1",
        kind: "period",
        atoms: [HELDOUT_PERIOD_ATOM],
      },
      {
        axisId: "axis-heldout-venue-primary",
        kind: "venue",
        atoms: [HELDOUT_VENUE_ATOM],
      },
    ],
    requiredEvidence: ["experiment", "evaluation", "findings"],
    scope: MODEL_CAPABILITY_BENCHMARK_SCOPE,
    lineage: { parentBenchmarkId: null, version: 1 },
  },
  {
    benchmarkId: "bmk-alpha-generation-equities-regime",
    name: "alpha generation across held-out equities regimes",
    description:
      "alpha generation on equities, split over declared regime atoms — the measurement must have split over both the trend-up and trend-down regimes",
    capabilityKind: "alpha-generation",
    capabilityDomain: "equities",
    requiredAxes: [
      {
        axisId: "axis-heldout-regime-trend",
        kind: "regime",
        atoms: [
          { kind: "regime", regimeId: "regime-trend-up" },
          { kind: "regime", regimeId: "regime-trend-down" },
        ],
      },
    ],
    requiredEvidence: ["experiment", "evaluation", "findings"],
    scope: MODEL_CAPABILITY_BENCHMARK_SCOPE,
    lineage: { parentBenchmarkId: null, version: 1 },
  },
  {
    benchmarkId: "bmk-market-making-crypto-spot-asset",
    name: "market making on held-out crypto-spot assets and venues",
    description:
      "market making on crypto spot, split over a held-out asset instrument and a held-out venue",
    capabilityKind: "market-making",
    capabilityDomain: "crypto-spot",
    requiredAxes: [
      {
        axisId: "axis-heldout-asset-btc",
        kind: "asset",
        atoms: [{ kind: "asset", instrumentId: "ins-BTCUSDT" }],
      },
      {
        axisId: "axis-heldout-venue-crypto",
        kind: "venue",
        atoms: [{ kind: "venue", venueId: "venue-crypto-primary" }],
      },
    ],
    requiredEvidence: ["experiment", "evaluation", "findings"],
    scope: MODEL_CAPABILITY_BENCHMARK_SCOPE,
    lineage: { parentBenchmarkId: null, version: 1 },
  },
  {
    benchmarkId: "bmk-risk-control-fx-period",
    name: "risk control on held-out fx periods",
    description:
      "risk control on fx, split over an unseen period LATER than the fixture measurements cover — no current fixture evidence covers it (the honest uncovered-benchmark fixture)",
    capabilityKind: "risk-control",
    capabilityDomain: "fx",
    requiredAxes: [
      {
        axisId: "axis-heldout-period-2024h2",
        kind: "period",
        atoms: [{ kind: "period", from: 1_800_000_000_000, to: 1_801_000_000_000 }],
      },
    ],
    requiredEvidence: ["experiment", "evaluation", "findings"],
    scope: MODEL_CAPABILITY_BENCHMARK_SCOPE,
    lineage: { parentBenchmarkId: null, version: 1 },
  },
];
