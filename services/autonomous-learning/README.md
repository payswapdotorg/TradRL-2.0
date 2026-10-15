# autonomous-learning (W055) — the IMPROVEMENT CYCLE CONTRACT

The continuous autonomous improvement loop AS TYPED DATA: the
`ImprovementCycle` record — each cycle composing the six steps of the loop
(observe → post-mortem → brain-update → curriculum-adjustment →
re-selection → re-commissioning), EVERY step citing its evidence records
(A6), every cited record re-proven through its own source package's
validators at the composition gate.

## Owns

- **The step vocabulary** (`steps.ts`): the closed set of step kinds in
  canonical loop order, the typed citations (knowledge records, the
  post-mortem, the brain generation, the curriculum, the pairing plans,
  the skill records, the forged plans), the typed PROPOSAL declarations
  (`advance-stage` / `re-run-selection` / `commission-plans`), and the
  per-step evidence laws — a step without its required citations is
  refused loudly, naming A6.
- **The composition gate** (`cycle.ts`): `composeImprovementCycle(inputs)`
  — THE GATE: the step laws (A6); every cited record re-proven through
  its SOURCE PACKAGE's own validators (W053 `validatePostMortem`, W054
  `validateFirmBrain`, W046 `validateCurriculum` +
  `validateSelfPlayPairing`/`validateAdversarialPairing`, W041
  `validateSkillRecord` — their errors carried VERBATIM); the cited brain
  generation's TENANT scope proven against the cycle's scope (R056 named
  loudly on violation; §14 `scope-mismatch` for same-tenant/other-world);
  every step citation proven COHERENT with the record it cites (the
  observed records actually in the cited brain; the declared adjustment
  coherent with the cited curriculum's own stages); then the seal — the
  steps in canonical loop order (A9: input order never leaks), the
  content-addressed `impcycle-<digest>` id, the immutable lineage, the
  deterministic provenance.
- **Whole-cycle re-validation** (`validate.ts`):
  `validateImprovementCycle(cycle)` re-proves a sealed cycle from its own
  recorded data alone — id re-derivation (A9), kind, scope (§14), the
  step laws (A6, carried verbatim), canonical loop order, lineage,
  provenance re-derivation. The deep source re-proofs run at composition
  (where the records are given) — the sealed-record division of labor
  every package in this repository carries.

## Does NOT own (A13/A14 — binding)

- **No execution.** The cycle is a composed RECORD of what to do next,
  consumed by the runtime. Nothing here runs, applies, or effects
  anything.
- **No training.** No RL, no self-play, no adversarial, no evolutionary,
  no imitation, no preference, no bandit, no statistical method is
  executed here (ARCHITECTURE §12's methods live in the learning-side
  packages this service CITES).
- **No authority movement (A13).** The cycle composes PROPOSALS. The
  re-commissioning step cites forged plans whose W034 possession grants
  carry the authority — the loop never grants, never binds, never
  commissions. Authority stays with possession grants, always.
- **No improvement of itself.** The cycle never re-scores, never
  re-evaluates, never re-ranks anything — carried counts are honest
  carries (A14).
- **No I/O, no clocks, no randomness, no env reads** (A9): same inputs ⇒
  the deep-equal cycle, same canonical id — whatever order the inputs
  came in.

## The cited contract surfaces (imported, never modified)

| Surface | Package | Re-proof at the gate |
| --- | --- | --- |
| Post-mortem | `outcome-learning` (W053) | `validatePostMortem` (errors verbatim) |
| Brain generation | `firm-brain` (W054) over `memory` | `validateFirmBrain` (errors verbatim) |
| Curriculum | `learning-curriculum` (W046) | `validateCurriculum` (errors verbatim) |
| Pairing plans | `learning-populations` (W046) | `validateSelfPlayPairing` / `validateAdversarialPairing` (errors verbatim) |
| Skill records | `skills` (W041) | `validateSkillRecord` (errors verbatim) |
| Forged plans | `body-forge` (W041) | cited by content-addressed `planId` + endowment count; body-forge ships no whole-plan validator — the deep plan re-proof is W043 `commissionBody`'s own gate, where the proposal is consumed (disclosed) |

## Laws

spec/REQUIREMENTS.md **R056** (Firm Brain tenant isolation — proven
against the cycle's scope at every citation); spec/ARCHITECTURE-LOCK.md
**§14** (explicit tenant/project/world identity), **A6** (evidence-linked
steps), **A9** (determinism — canonical orders, content-addressed id,
same inputs ⇒ deep-equal cycle), **A13** (proposals; authority never
moves into the loop), **A14** (never executes, never trains, never
re-scores). Every file ≤ 400 lines.

License: Apache-2.0 (the repository LICENSE).
