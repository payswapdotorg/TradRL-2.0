# outcome-learning (W053)

The OUTCOME / POST-MORTEM layer over completed evaluations — typed DATA,
flat source-exported (the W035–W052 package pattern).

The chain this package closes: **W038** evaluates experiments (the
`ExperimentEvaluation` + its verification `FindingsReport` — the outcome
side); **W051** proves search integrity (the complete declared history of
everything tried); **W052** generates the evaluation split families (the
family that judges an outcome); **W053** (this package) derives the
POST-MORTEM — what was predicted vs what happened, CARRIED from the
evaluation's own data — and the typed LESSONS.

## Modules

- `postmortem.ts` — **THE GATE** `derivePostMortem(evaluation, family,
  history)`: the completed evaluation is re-proven through W038's own laws
  (its content-addressed id re-derived from its own carried bytes — the
  same canonical content the walker digests; its findings digest
  re-derived through verification's own `findingsDigestOf`; its canonical
  orders re-proven), the split family through W052's own
  `validateSplitFamily`, the search history through W051's own
  `validateSearchHistory` (their own errors carried VERBATIM), scope
  agreement proven across all three (family ≡ history on
  tenant/project/world; `history.experimentId ≡ evaluation.experimentId`),
  and the family proven to have actually JUDGED this evaluation (every
  family split carried verbatim by the evaluation's own aggregations).
  Only then is the PostMortem sealed: the content-addressed `pm-<digest>`
  id, the predicted-vs-happened comparison CARRIED from the evaluation's
  own holdout aggregations (train side = predicted, held-out side =
  happened, unassigned surfaced — never re-scored), the family citation
  (through W052's own `splitFamilyCitationOf` seam), the history citation
  (the integrity linkage), the explicit scope, the immutable lineage, the
  deterministic provenance.
- `lessons.ts` — `deriveLessons(postMortem)`: the typed LESSON derivation.
  The closed failure-mode taxonomy (`constraint-violation`,
  `heldout-degradation`, `selection-pressure`, `unassigned-membership`,
  `verification-failure`), the per-axis capability deltas, and the
  held-out-vs-train divergence signals — ALL carried statistics of the
  evaluation's own data, canonical-id ordered (content-addressed
  `lesson-<digest>` ids). **A6**: every lesson cites its carried evidence;
  a lesson set over a post-mortem that fails whole-record re-validation is
  refused loudly naming A6/R052.
- `validate.ts` — `validatePostMortem` / `validateLessonSet`: whole-record
  re-validation from recorded data (the W047/W050/W051/W052 pattern). The
  id must re-derive from the carried bytes (A9), the citations must obey
  their own vocabularies, the carried comparison must keep the
  evaluation's own canonical orders, the carried reduction must be
  coherent, the lineage coherent, the provenance re-derivable; the lesson
  set must re-derive EXACTLY from the carried post-mortem (the A9 twin)
  with every lesson citing carried evidence.
- `index.ts` — the public surface (the exports map is the authority).

## What this package OWNS

- The PostMortem record + its gate (the predicted-vs-happened comparison,
  carried, never re-scored — R052/A6).
- The typed lesson derivation (failure-mode taxonomy, capability deltas,
  divergence signals — carried statistics, canonical-id ordered).
- Whole-record re-validation of its own records.

## What this package does NOT own (deliberately)

- **No training, no improvement, no application of lessons** — that is
  W055 (autonomous improvement). This package composes typed records
  (A14); it never trains a model, never updates a policy, never improves
  anything.
- **No firm brain** — no accumulation/organization of lessons into a
  long-lived knowledge base; that is W054 (Firm Brain). Lesson sets are
  derived per post-mortem, deterministically, and never persisted here.
- **No evaluation, no scoring** — the outcome side is W038's; the
  post-mortem CARRIES the evaluation's own summaries verbatim and never
  recomputes one (carry never re-score).
- **No split generation** — W052's; the family is cited through W052's
  own citation seam.
- **No search-history judgment** — W051's; the history is re-validated
  through W051's own validator (errors carried verbatim) and cited.

## Laws carried on every record

`spec/ARCHITECTURE-LOCK.md A6` (evidence-linked truth),
`spec/REQUIREMENTS.md R052` (outcome/post-mortem learning),
W051's search-integrity law, `spec/ARCHITECTURE-LOCK.md A9`
(determinism), `spec/ARCHITECTURE-LOCK.md A14` (composition: typed
records, never training).

## License

Apache-2.0 (the repository LICENSE).
