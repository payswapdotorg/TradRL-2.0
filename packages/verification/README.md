# verification (W038) — owns / does-NOT-own

The falsifiable evaluation-verification harness over **W037 experiments and
W038 experiment evaluations** — the W022 pattern (`packages/tradrl-evaluation/
replay/`), followed, never imported: every check is an adversarial fixture
in, a typed verdict out — `{ claim, verdict: PASS | FAIL | PARTIAL,
evidence }`. A **FAIL** is a valid outcome (the harness working, not
failing); a **PARTIAL** means the claim held within its declared scope and
the limitation is disclosed in the evidence.

## OWNS

- `claims.ts` — the claim registry: claims are DECLARED before they are
  checked. One claim per integrity requirement the policy declares (carried
  on the W037 manifest: evidence-chain, deterministic-replay, search-history
  when present), one holdout-coverage claim per DECLARED policy holdout
  axis, plus the two §13-named claims that are always declared:
  search-history (a policy that omits it gets the claim with the limitation
  disclosed — the check runs PARTIAL) and the constraint-dimension (raw P&L
  is never the sole objective — not optional). Every descriptor carries its
  declaration source and its EVIDENCE NEEDLES (the strings its findings'
  evidence must name — `needlesMissing` is the registry's own honesty check).
- `findings.ts` — the typed verdict record: `Finding` (claim, verdict,
  evidence — deterministic, ordered, evidence-linked lines), undeclared
  failures as their OWN finding kind, and the content-addressed
  `FindingsReport` (declared findings in registry order, undeclared after,
  counts, the canonical digest over subject + ordered findings).
- `checks.ts` — the trial, re-proving every law FROM DATA (constructor gates
  are never trusted):
  - **evidence-chain** (§10): every record's stream validates capsule-by-
    capsule (`validateEvidenceStream`, W036) and every citation resolves
    (stream/view digests present);
  - **deterministic-replay** (A9): determinism metadata present + the TWIN
    re-evaluation (the policy re-run over the record's own stream)
    deep-equal to the recorded outcome summary, compared by canonical bytes;
  - **search-history** (§13): declared by the policy AND carried on the
    manifest; undeclared ⇒ PARTIAL (disclosed);
  - **holdout-coverage** (§13): every DECLARED axis carries a split; a
    declared axis without a split ⇒ PARTIAL (its evaluation surface is
    absent);
  - **constraint-dimension** (§13): the evaluation carries the compliance
    dimension in data (closed-set compliance, integral/finite folds, every
    summary compliance-carrying) and no record's reward components are all
    financial-outcome (the sole-P&L law, re-proved from data);
  - **undeclared axes**: manifest splits naming axes the policy never
    declared surface as `undeclared-failure` findings — never swallowed.
- `harness.ts` — `verifyExperimentEvaluation()`: declare the claims, run
  every check, assemble the content-addressed findings report. Pure and
  deterministic (A9).

## DOES NOT OWN (scope honesty)

- NO verdicts about policies, models, or constraint programs W036 did not
  construct — the harness verifies DATA (assembled manifests, records, and
  evaluations), exactly as W022 verifies assembled replays.
- NO re-scoring authority: the twin re-evaluation is a CHECK (an equality
  verdict), never a replacement evaluation — the W038 walker
  (`packages/evaluation`) owns the walk.
- NO search-history DATA: §13's search-history integrity requirement is
  declared-and-carried data on the policy/manifest (W036/W037); the harness
  verifies the declaration and the carry — the honest limitation (a policy
  that does not declare it yields PARTIAL, disclosed) is owned here.
- NO enforcement (A13): findings measure; the world runtime's gates stay the
  sole authority. NO I/O, no store, no persistence.

## Tests

`cd packages/verification && ../../../node_modules/.bin/tsx --test
test/*.test.ts` — the registry completeness, each check's verdicts (PASS,
FAIL, PARTIAL all pinned), the falsifiability laws (a mangled fixture MUST
flip its verdict; the needles law), and the report determinism (the A9 twin).

License: Apache-2.0 (the repository LICENSE).
