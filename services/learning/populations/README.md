# learning-populations (W046)

The self-play/adversarial composition ops: PURE typed pairing plans over
W045 populations. One flat, source-exported package in the W035–W045
pattern (`exports` point at TypeScript sources; no build artifact), living
under `services/learning/`.

The surfaces it composes: **W045** populations (the proven multi-agent
records, re-proven through their own whole-record validator, errors
carried verbatim) · **W039** organization (the ablation/model-substitution
vocabulary — the substitution citation is W039's own derived-origin
shape).

## What this service OWNS

- **`selfplay.ts` — `composeSelfPlay(population, cohortPolicy,
  structure?)`.** One re-proven population split into
  cooperating/competing cohorts AS DATA: the split declared by the cohort
  policy (the canonical-order `alternate` split, or an `explicit` member
  partition — every member a REAL member, every member in EXACTLY one
  cohort), the cooperation/competition structure declared over the closed
  cohesion vocabulary (the cooperating cohort's cohesion IS cooperation
  and the cohorts MEET in competition — contradictions are refused).
  Sealed content-addressed `selfplay-<digest>`, cohorts in canonical
  member order (A9: input order never leaks), frozen, deterministic
  provenance (the population's own sealedAt — no clocks).
- **`adversarial.ts` — `composeAdversarial(champion, challenger)`.**
  Champion-vs-challenger GENERATIONS as DATA: both sides re-proven
  through W045's own validator (errors carried verbatim, naming the
  side); scope/world agreement proven (one world, one scope —
  disagreement fail-closed); the challenger proven the champion's DIRECT
  next generation (the lineage cites the champion, exactly one
  generation on — an adversarial pairing is generational); and the W039
  ablation/model-substitution vocabulary CITED where applicable: an
  ablate-origin challenger carries the substitution citation (axis kind +
  operation + subject, W039's own derived-origin shape), anything else
  carries null. Sealed content-addressed `adversarial-<digest>`, frozen.
- **`validate.ts` — the whole-record re-validations.**
  `validateSelfPlayPairing` + `validateAdversarialPairing`: the identity
  re-derivation, the cohort partition/coverage laws (against the carried
  census), the canonical orders, the generational laws, the substitution
  shape laws (the W039 operation vocabulary), the provenance laws.

## What this service does NOT own

- **No execution, no training, no world stepping** (A14) — a pairing is a
  typed PLAN; whoever runs it owns execution.
- **No method prescription** (R054) — method-neutral by construction: no
  RL specifics (**W047/W048** own the methods).
- **No episode generation, no distributed generation** — **W048**.
- **No population transitions** — producing the challenger generation is
  W045's own transition gates; this package only COMPOSES the pairing
  over populations that already exist.
- **No re-scoring** — every population fact is carried from W045's own
  records; the pairing adds structure, never measurements.

## The laws, in one breath

Fail-closed at every seam (invalid population → W045 errors carried
verbatim, naming the side; scope/world disagreement; a challenger that is
not the champion's direct next generation; an empty cohort; a split that
misses a member or doubles one; a structure that contradicts the roles) ·
A9: same populations + same policy ⇒ deep-equal pairings with identical
canonical ids, input order never leaks · A14: COMPOSE typed plans — never
execute, never train, never step worlds · identity laws: opaque ids,
canonical encoders, scope explicit, lineage respected (the generational
law).

## Tests

`node:test` + `assert/strict` over REAL imports: REAL W045 populations
through the populations package's own test fixtures (founding through
`foundPopulation`, the challenger generation through W045's own REAL
`addMembers` transition gate — the W045 fixture lineage). The A9 twin
closes the set: permuted explicit cohort lists ⇒ deep-equal pairings,
identical ids.

License: Apache-2.0 (the repository LICENSE).
