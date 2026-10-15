# services/model-selection — the empirical substrate/model selection service (W042)

`selectSubstrate(demand, registry, skills, benchmarks)` is the PURE
selection walk: given a typed `SelectionDemand` (the W039 position
vocabulary — body/substrate requirements + capability demands — plus the
scope, the benchmark policy, and the registered candidate substrates),
the W040 capability registry, the W041 skill records, and the benchmark
surface (the `benchmarks/model-capability` catalogue + the W038
experiment evaluations the cited evidence was measured through), it
derives the deterministic, evidence-ranked **SelectionPlan** — never
executing, never training, never running a benchmark.

## The walk

1. **Input gates** — the registry re-proved through W040's own
   `validateCapabilityRegistry`, the skills through W041's
   `validateSkillSet`, the catalogue through `validateBenchmarkCatalogue`
   (unique ids, W040 closed kind/domain vocabularies, closed evidence
   shape, single scope, legal W037 axis atoms, immutable lineage) —
   every failure a loud typed error with the upstream errors carried
   verbatim.
2. **R052 enforced structurally** — a demand with no capability demand is
   refused: a selection citing no measured evidence is REJECTED, the law
   named. Scope agreement (demand/registry/skills/catalogue) by field
   equality; an unknown benchmark in the policy is a loud error.
3. **Registry-level demand proofs** through W040's own
   `matchCapabilityDemand` seam — its evidence reasons are carried
   VERBATIM into the plan; unprovided demands and all-dead providers
   refuse the selection with the W040 lifecycle carried verbatim.
4. **Per-candidate proofs** (canonical substrate-id order — the demand's
   registered substrates ∪ the skill bearers): eligibility against the
   W039 substrate requirement (compared as data), capability coverage by
   the candidate's OWN registered measured providers (the W039
   first-eligible law among them), and benchmark coverage — the cited
   evaluations' declared W037 holdout atoms must cover the demanded
   benchmark's required axes, compared AS DATA. Every failure is a typed
   rejection carried in the plan — never a silent drop.
5. **Deterministic rank** (A9): carried evidence counts (capability
   provenance citations + linked skill trajectories — counting CARRIED
   data, never a re-scored statistic), canonical substrate-id
   tiebreaks. The winner + the full evidence chain (capabilities, skills,
   evaluations, benchmark coverage) + the content-addressed
   `selection-<digest>` id + the model-substitution variants (the
   runner-ups, W039's substitution axis as data).

## Files

- `identity.ts` — the opaque `SelectionId`, the scope, canonical JSON +
  FNV-1a + the content-addressed selection id (in-package per the
  W037/W039/W040/W041 precedent).
- `demand.ts` — `SelectionDemand`, `BenchmarkSurface`, the structural
  mirror of the catalogue types, the closed error/rejection families,
  and the `SelectionPlan` contract.
- `validate.ts` — `validateBenchmarkCatalogue` (the load-time catalogue
  laws) + the canonical atom key.
- `select.ts` — the walk itself.
- `index.ts` — the public surface (the exports map is the authority).

## What this service does NOT own

- NO execution, NO training, NO benchmark runs — the selector COMPOSES
  typed plans (A14: authority lives outside prompts, in the composed
  plan W043's commissioning / W044's world-agent-runtime consume).
- NO benchmark RUN harness (W063's research/benchmarks/ reserves it);
  the catalogue declares WHAT must be measured, and this service
  consumes evidence already measured through the W037/W038 chain.
- NO body selection — the body requirement is carried as data for the
  consumer; pairing bodies is W039's compiler and W041's forge.
- NO re-scoring — carried summaries only (the W038 carry precedent).
- The catalogue itself — `benchmarks/model-capability` owns it; this
  service validates + consumes it structurally (no shims — the tests
  import the REAL catalogue file).

License: Apache-2.0 (the repository LICENSE).
