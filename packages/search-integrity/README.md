# search-integrity (W051) — the search-history CONTRACT

The search-integrity package (`spec/ARCHITECTURE.md` §13 — "Evaluation …
includes … search-history integrity"; `spec/REQUIREMENTS.md` R016;
`spec/ARCHITECTURE-LOCK.md` A9/A14).

W038 declared the search-history claim kinds and the findings vocabulary.
W047 shipped the episode/batch provenance vocabulary. W050 shipped the Time
Machine — the `PointInTimeQuery`/`PointInTimeView` + the R016 knowledge
firewall. THIS package ships the SEARCH-HISTORY CONTRACT ITSELF:

- **`./history`** — the `SearchHistory` record as typed DATA: the explicit
  scope (W050's tenant/project/world + the experiment), every trial (the
  candidate descriptor as data over the closed `hyperparameter | config`
  vocabulary + the SEALED W050 view it consulted + the outcome citation
  carried through W047's episode/batch provenance vocabulary — never
  re-scored), the selection decisions (which candidate chosen, citing
  WHICH sealed evidence, as of WHEN), the immutable lineage, and the
  content-addressed `search-<digest>` id.
- **`./build`** — THE CONSTRUCTION GATE (`buildSearchHistory`): fail-closed
  at every seam — the sealed views re-proven through W050's own
  `validatePointInTimeView` (firewall errors carried verbatim), the outcome
  citations re-derived through W047's own episode id law, the R016 carry
  (a selection consulting anything beyond its declared as-of point is
  refused loudly naming R016), and canonicalization (trials, decisions,
  parameters, evidence) so declaration order never leaks into the id (A9).
- **`./integrity`** — THE GATES (`checkSearchIntegrity(history, claim)`):
  a backtest claim must cite its COMPLETE search history — an undeclared
  trial is a loud typed violation naming §13 (and surfaces as its OWN
  `undeclared-failure` finding, the W038 registry law); the claim's cited
  evidence must be traceable to declared trials; a selection consulting
  anything the R016 firewall would withhold is refused naming R016
  (defensive depth over the construction/validation seams, the W050 engine
  precedent); the verdict is a PASS/FAIL/PARTIAL finding in the W038 shape,
  assembled through verification's own `assembleFindingsReport`.
- **`./overfit`** — the carried-statistics surface: trial counts, the
  selection funnel (trials → evidence-cited → selected), redundancy
  measures (duplicate candidates/views/outcome citations) — deterministic
  projections of the record, never invented, never re-scored. Fail-closed:
  statistics over a record that fails re-validation are refused.
- **`./validate`** — whole-record re-validation: the record is REBUILT from
  its own carried data and must reproduce it exactly (same content-addressed
  id, same canonical orders, coherent lineage, same canonical bytes).

## Owns

- The SearchHistory record + its construction gate + its whole-record
  re-validation.
- The search-history integrity gates (the §13 declaration audit) and the
  W038-shaped findings they emit.
- The overfit-risk carried statistics (deterministic projections of the
  record).

## Does NOT own

- Holdout splits / holdout coverage / walk-forward evaluation — W052.
- Outcome learning, outcome content, scoring — W053 (A14: this package
  CARRIES outcome citations through W047's vocabulary; it never opens,
  re-runs, or re-scores an outcome).
- Backtest EXECUTION — never: this package composes typed records +
  verdicts; it does not run worlds, does not evaluate candidates, does not
  score.
- The sealed-view firewall itself — W050's `tradrl-time-machine` owns R016;
  this package cites sealed views and re-proves them through W050's own
  validator.
- The claim registry / verification harness — W038's `verification` owns
  it; this package feeds it (findings in its shape, assembled through its
  own machinery).
- The episode/batch provenance vocabulary — W047's `rl-protocol` owns it;
  this package carries it verbatim.

## Dependencies (trimmed to what is genuinely imported)

- `evaluation` — the W038 `ExperimentEvaluationId` (the claimed result's
  identity).
- `verification` — the W038 findings vocabulary (`Finding`, `Verdict`,
  `VerificationClaimDescriptor`, `FindingsReport`) + the runtime
  `assembleFindingsReport` (this package's findings feed ITS claims).
- `tradrl-time-machine` — the W050 sealed-view contract
  (`PointInTimeView`, `PointInTimeCutoff`, `TimeMachineScope`,
  `isLegalCutoff`) + the runtime firewall re-proof
  (`validatePointInTimeView`, with its errors carried verbatim).
- `rl-protocol` — the W047 provenance vocabulary (`EpisodeProvenance`,
  `EpisodeId`, `EpisodeBatchId`) + the runtime `episodeIdOf` /
  `blankEpisodeProvenanceMembers` (the W047 laws re-proven at every seam).
- `trajectory` — the canonical digest family (`canonicalDigestHex`,
  `canonicalString` — the W037/W047/W050 house lineage).

## Structural note (disclosed deviation)

The construction gate lives in `./build`, one module beyond the order's
file list (`history` / `integrity` / `overfit` / `validate`): the record +
gate in one file exceeds the repo's ≤ 400-line law (oxlint `max-lines`)
and the loud named-message style is not compressible without losing the
law-naming the §13/R016 audits require. The exports map carries one entry
per module file, per the package conventions.

License: Apache-2.0 (the repository LICENSE).
