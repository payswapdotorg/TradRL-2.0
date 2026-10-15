# docs/benchmarks — the canonical benchmark/evidence publication docs (W063)

One markdown file per declared publication family in
`research/benchmarks` (`BENCHMARK_PUBLICATION_FAMILIES`). These are the
human-readable PUBLICATION records: they carry the same citations and
reproducibility statements as the typed records — **NO numbers the cited
records do not carry** (spec/ARCHITECTURE-LOCK.md A6 — evidence-linked
truth). These docs deliberately carry no measurements, scores or counts
at all: every number on a publication lives on the typed record, CARRIED
by its cited record, and is re-proven by the publication gate
(`research/benchmarks/validate.ts`).

## Convention

- Each doc names its publication record id — the declared publication
  family's opaque id in the `research/benchmarks` catalogue (e.g.
  `pub-walk-forward-evidence-v1`). Every SEALED publication cites that
  id as its `familyId` and is content-addressed `bp-<digest>` by the
  gate; the docs document the declared family, not any one sealed
  instance.
- Each doc names the citation chain (the packages that own each cited
  record kind) and the reproducibility statement (the W022
  replay-fidelity claims the family requires, verbatim from the W022
  claim registry).
- Law references (A6/A9/A14, §13, R016) are citations to the spec, not
  measurements.
- Sealing a publication over real records is done ONLY through the gate:
  `composeBenchmarkPublication` in `research/benchmarks/validate.ts`.

## Files

- `walk-forward-evidence.md` — `pub-walk-forward-evidence-v1`
- `regime-evidence.md` — `pub-regime-evidence-v1`
- `asset-evidence.md` — `pub-asset-evidence-v1`
- `venue-evidence.md` — `pub-venue-evidence-v1`

## This directory does NOT own

- Any typed record, validator, or gate — `research/benchmarks/` owns
  them; the docs cite.
- Any number not carried by a cited record — none is carried here at
  all.
- The consumed packages (W022/W038/W051/W052/W061) — imported by the
  catalogue, never modified.

License: Apache-2.0 (the repository LICENSE).
