# benchmarks/model-capability — the declarative model-capability benchmark catalogue (W042)

This directory is the canonical benchmark surface substrate/model
selections are justified against (spec/REQUIREMENTS.md R052 —
"Capability discovery is EMPIRICAL": every selection cites MEASURED
evidence; R050 — the substrate is SELECTED, never assumed).

It is type-only declarative data (the contracts/ui precedent): **no
package manifest, no workspace membership, no dependencies, no imports**.
The selection service (`services/model-selection`) consumes it through
structural typing and VALIDATES it at load.

## Files

- `model-capability-benchmarks.ts` — the catalogue AS DATA:

  - `ModelCapabilitySplitAtom` / `MODEL_CAPABILITY_ATOM_KINDS` — the
    W037 holdout atom family (period / regime / asset / venue),
    structurally mirrored so this directory stays dependency-free.
  - `MODEL_CAPABILITY_EVIDENCE_SHAPE` — the closed required-evidence
    shape vocabulary: experiment + evaluation + findings (the W037/W038
    chain one W040 `EvidenceCitation` already carries).
  - `ModelCapabilityBenchmarkDescriptor` — one declared benchmark: the
    capability kind/domain from W040's closed vocabularies, the required
    holdout axes (atoms AS DATA — the measurement must have SPLIT over
    these atoms for a citation to cover the axis), the required evidence
    shape, the explicit single scope, and the versioned immutable
    lineage.
  - `MODEL_CAPABILITY_BENCHMARKS` — the catalogue itself (genesis
    entries; successors arrive only through re-declaration).

## Laws encoded here

1. DECLARATION ONLY: the catalogue declares WHAT must be measured. It
   never runs, never scores, never records results.
2. Dependency-free: the types are the structural mirror of the W037/W040
   vocabularies; drift is caught by the selection service's load
   validation + its tests (which import THIS file — no shims).
3. Single scope, field equality (the registry law); unique opaque ids;
   closed vocabularies; legal axis atoms; immutable lineage.

## This directory does NOT own

- Any benchmark RUN harness — running benchmarks, recording results, or
  fabricating measurements is FUTURE WORK (W063's research/benchmarks/).
- The selection walk itself — `services/model-selection` owns it.
- Any experiment/evaluation/findings artifacts — those live in the W037
  `trajectory`/`experiments` and W038 `evaluation`/`verification`
  packages; the catalogue only names the axes the evidence must cover.
- Any package manifest or workspace membership — deliberately not a
  workspace member (the frozen-surface law of W042).

License: Apache-2.0 (the repository LICENSE).
