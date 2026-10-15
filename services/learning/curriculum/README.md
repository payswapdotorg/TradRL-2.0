# learning-curriculum (W046)

The staged curriculum: the LEARNING-side population orchestration as typed
DATA. One flat, source-exported package in the W035–W045 pattern (`exports`
point at TypeScript sources; no build artifact), living under
`services/learning/`.

The surfaces it composes: **W045** populations (the proven multi-agent
records, re-proven through their own whole-record validator) · **W038**
evaluation + verification (the experiment evaluation summaries and the
findings vocabulary — the curriculum's evidence thresholds CARRY these,
never re-score them).

## What this service OWNS

- **`curriculum.ts` — `foundCurriculum(population, stages)` + the
  Curriculum record.** The population re-proven through W045's own
  `validatePopulation` (errors carried verbatim); the staged schedule
  proven against the generation laws (stage 0 runs against the founding
  population's OWN generation; every stage advance is EXACTLY one new
  population generation); the difficulty atoms proven as DATA derived from
  measured evidence — every atom cites the W038 evaluation it was measured
  from (R052: evidence-less atoms refused loudly, never hand-tuned
  numbers); the evidence threshold carried from W038 evaluations +
  findings. Sealed content-addressed `curr-<digest>`, canonicalized (A9:
  input order never leaks), frozen, with the immutable lineage (genesis
  here) and deterministic provenance (the founding time is the
  population's own sealedAt — no clocks).
- **`progression.ts` — `advanceStage(curriculum, evidence)`: THE GATE.**
  The active stage's threshold proven against the CARRIED evaluation
  summaries (+ findings reports) — every requirement over the closed gate
  vocabulary (compliance §13 · hard-violation ceiling · trajectory-count
  floor · combined-score floor · carried integrity · carried finding
  verdicts), carry never re-score. Then the NEXT stage unsealed as a NEW
  curriculum generation: the lineage extended (parent cited, generation
  +1, origin naming fromStage→toStage), the schedule carried VERBATIM, the
  digest over the gate-passing evidence sealed into the provenance.
  Fail-closed: unprovable curriculum · duplicate evidence · missing
  citation · missing findings report · undeclared claim · unmet
  requirement · a completed curriculum — all loud typed refusals.
- **`validate.ts` — the shared law surface + `validateCurriculum`.** The
  stage/threshold/difficulty laws founding composes and the whole-record
  re-validation re-proves (identity re-derivation, canonical orders,
  schedule laws, lineage cross-laws tying the advance origin to the active
  stage, provenance laws, the §13 bare-P&L probe, the R052 citations).

## What this service does NOT own

- **No execution, no training, no world stepping** (A14) — a curriculum is
  a typed PLAN; whoever runs it owns execution.
- **No method prescription** (R054) — method-neutral by construction: no
  RL specifics, no trainer surface (**W047/W048** own the methods).
- **No episode generation, no distributed generation** — **W048**.
- **No population transitions** — producing the next population
  generation is W045's own transition gates; the curriculum only DECLARES
  which generation each stage runs against.
- **No re-scoring, no re-evaluation** — every evaluation number and
  finding verdict is CARRIED from W038's own records (carry never
  re-score); a carry mismatch is impossible by construction because the
  gate reads the carried records directly.

## The laws, in one breath

§13 constraint-aware progression: a stage threshold that gates on raw P&L
alone (a combined-score requirement with no compliance requirement) is the
loud typed refusal `bare-pnl-gate` naming the sole-P&L law · R052: an
evidence-less threshold or difficulty atom (no W038 citation) is refused
loudly · A9: same population + same stages + same evidence ⇒ deep-equal
curricula with identical canonical ids, input order never leaks · A14:
typed plans only · fail-closed at every seam (invalid population → W045
errors carried verbatim; scope explicit; lineage immutable — extended,
never rewritten).

## Tests

`node:test` + `assert/strict` over REAL imports: REAL W045 populations
through the populations package's own test fixtures (`foundPopulation`
over `populationMembers`/`populationWorldDefinition` — the W045 fixture
lineage), a REAL W038 experiment evaluation through the learning-rl
bridge fixture (`createExperiment` → `experimentManifestOf` →
`evaluateExperiment`, imported relative — the W043/W044/W045 cross-package
fixture precedent), and REAL W038 findings reports through the
verification package's own `assembleFindingsReport`. The A9 twin closes
the set: permuted stages + permuted evidence ⇒ deep-equal curricula,
identical ids.

License: Apache-2.0 (the repository LICENSE).
