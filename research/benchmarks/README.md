# research/benchmarks — the benchmark/evidence publication catalogue (W063)

This directory is the PUBLICATION surface of the TradRL evidence chain:
the reproducible benchmark/evidence publication records (spec
ARCHITECTURE §13 — evaluation is constraint-aware with holdouts,
search-history integrity, replay fidelity). The chain it composes over:
W022 proved replay fidelity; W038 evaluated/verified; W051 proved search
integrity; W052 generated the split families; W061 provided the
observability/audit/operations trail. THIS directory ships the
publication records — publication is COMPOSITION + CITATION
(spec/ARCHITECTURE-LOCK.md A14): **NO execution, NO new measurements**.

It is a PLAIN directory (the `benchmarks/model-capability` +
`contracts/ui` precedent): **no package manifest, no workspace
membership, no dependencies of its own** — imports are relative source
imports, and the tsconfig extends the repo base with `noEmit`.

## Files

- `benchmark-publications.ts` — the publication records AS DATA:

  - The citation vocabulary: `FamilyCitation` (W052's own citation seam
    members + the record's carried split/fold counts), `EvaluationCitation`
    (the W038 evaluation id + experiment/policy + the verification
    findings digest + the carried outcome counts), `HistoryCitation`
    (the W051 history id + the carried trial/selection counts under the
    search-history integrity law), `AuditTrailCitation` (the W061 trail
    id + hash-chain head + carried record count), and the
    `ReproducibilityManifest` in the W022 claim shape — one
    `ReproducibilityClaim` per required registry claim, its verdict and
    finding digest CARRIED from the cited fidelity findings.
  - `BENCHMARK_PUBLICATION_FAMILIES` — the genesis declaration catalogue
    (the declared publication families; successors arrive only through
    re-declaration).
  - The `BenchmarkPublication` record: the opaque content-addressed
    `bp-<digest>` id, the declared family, the explicit single scope,
    the four citations + the manifest, the immutable lineage, the
    deterministic provenance — and `benchmarkPublicationIdOf` (A9).

- `validate.ts` — THE PUBLICATION GATE:

  - `composeBenchmarkPublication` — seals one publication over
    ALREADY-VERIFIED records: every citation re-proven through its
    source package's own validators (W052 `validateSplitFamily`, W038
    id/digest/order re-proofs + verification's `findingsDigestOf`, W051
    `validateSearchHistory`, W061 operations' end-to-end `verifyTrail` —
    their own errors carried VERBATIM), scope agreement across every
    citation, the family proven to have JUDGED the evaluation, and every
    reproducibility claim proven BACKED by a carried W022 fidelity
    verdict.
  - `validateBenchmarkPublication` — whole-record re-validation from
    carried data (id re-derivation, the consumed vocabularies' own
    prefixes + closed kinds, the manifest re-proven against W022's
    registry, tally coherence, lineage, provenance).
  - `reproveBenchmarkPublication` — re-proves the citations against the
    LIVE records; a published number that differs from the cited
    record's own is the A6 invented-number refusal.

- `publication.test.ts` — node:test + assert/strict over REAL imports
  (the W041/W053 fixture lineage): the happy path, every refusal law
  (uncited claim, scope mismatch, unbacked reproducibility claim,
  uncitable record — with the source validators' errors pinned as
  carried VERBATIM), and the A9 twin. Run from the repo root:
  `npx tsx --test research/benchmarks/*.test.ts`.

## Laws encoded here

1. A6 evidence-linked truth: every published number/claim cites its
   record — an uncited or invented number is a loud typed refusal.
2. A9 determinism: same cited records ⇒ deep-equal publication, same
   canonical `bp-<digest>` id; input order never leaks.
3. A14: publication COMPOSES citations — never measures, never re-scores;
   carry never re-score.
4. Fail-closed at every seam: uncitable record (its own validator's
   errors carried verbatim), scope mismatch across citations,
   reproducibility claims not backed by the cited fidelity verdicts.

## This directory does NOT own

- Any measurement, execution, scoring or re-scoring — the cited records
  already carry their own numbers; this directory only cites them.
- The evaluation walk (W038 `evaluation`/`verification`), the split
  families (W052 `evaluation-splits`), the search histories (W051
  `search-integrity`), the audit trails (W061 `observability` +
  `services/operations`), or the replay-fidelity harness (W022
  `tradrl-evaluation/replay`) — imported, never modified.
- Any package manifest or workspace membership — deliberately not a
  workspace member (the frozen-surface law of W063).
- Deployment/operations tooling — W062; the reference journey — W064.
- The publication DOCS — `docs/benchmarks/` owns the human-readable
  publication records.

License: Apache-2.0 (the repository LICENSE).
