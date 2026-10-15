# learning-compute (W048) — Distributed episode generation

The COMPUTE ORCHESTRATION CONTRACT for generating episodes at scale
(`spec/ARCHITECTURE.md` §12; `spec/ARCHITECTURE-LOCK.md` A9 + A14).

W047 shipped the RL bridge (episodes/batches assembled from recorded
trajectories — the `TrainerPort` contract). W045 shipped populations (many
agents bound into one world). THIS service composes typed generation
**PLANS**: which population × which world × which batch policy × which
declared sharding policy → which work units → which declared episode
batches. Distribution is DECLARED as data (shard assignments in canonical
member order, content-addressed plan/unit/declared-batch ids) — never
discovered from a fleet, a network, or a clock.

## The modules (the package.json exports map is the authority)

- **`./plan`** — `planGeneration(population, batchPolicy, sharding)`:
  THE GATE. The population is re-proven through W045's own
  `validatePopulation` (errors carried VERBATIM); the batch policy is
  proven against W047's declared selection-policy vocabulary (blank policy
  id / blank parameter name / duplicate parameter name — the closed-set
  mirror of `EpisodeBatchErrorCode`); the sharding policy is validated as
  closed-set declaration data (axis ∈ `SHARDING_AXES`, positive-integer
  shard count that never exceeds the membership — an empty population
  slice is meaningless work — and a positive-integer per-unit episode
  quota). Then the `GenerationPlan` is sealed: the content-addressed
  `genplan-<digest>` id, the work units in canonical shard order (each:
  its `ShardAssignment` + its population slice carried verbatim + its
  `DeclaredBatchDescriptor` + its declared world/scope), the immutable
  population lineage, and the deterministic provenance (the population's
  own declared seal time — never a clock read).
- **`./port`** — the `GenerationWorkerPort`: the minimal PURE interface a
  generation worker implements (claim one unit → emit one
  `GeneratedBatchReference` citing the W047 `EpisodeBatchId`). Types
  only; no execution.
- **`./validate`** — `validateGenerationPlan(plan)`: the whole-plan
  re-validation from recorded data alone — every identity re-derived, the
  population re-proven, the canonical shard partition re-derived, the
  vocabulary/lineage/provenance laws re-run; every violation named.

## What this package OWNS

- The typed generation-plan vocabulary (plan, units, shard assignments,
  declared batch descriptors, lineage, provenance).
- The deterministic sharding/partitioning of generation work as DATA.
- The plan construction + whole-plan validation gates (fail-closed, every
  law named in a closed error vocabulary).
- The worker-facing port TYPE.

## What this package does NOT own (deliberately)

- **No execution** — it never generates an episode, never steps a world,
  never runs a trainer (A14).
- **No process spawning, no network, no fleet discovery** — distribution
  is DECLARED data; a future distributed runtime (out of scope) executes
  these plans.
- **No clocks, no randomness, no env reads, no node ids** (A9) — plan,
  unit, and declared-batch ids are pure content digests.
- **No JAX** — W049 (the JAX-LOB training adapter) consumes these plans.
- **No Time Machine** — W050 owns it.

## Consumed surfaces (imported, never modified)

- `populations` (W045): the `Population` record + `validatePopulation` +
  `freezePopulation`.
- `rl-protocol` (W047): `BatchSelectionPolicy` + `EpisodeBatchId`.
- `learning-rl` (W047): the assembly surface (`assembleEpisodes` /
  `assembleBatch`) — proven in the tests as the realization of the
  declared batch descriptors.
- `trajectory` (W037): `canonicalDigestHex` / `canonicalString`.

## Conventions

`node:test` + `assert/strict` over REAL imports, the W045/W047 fixture
lineage (relative test-fixture imports), every file ≤ 400 lines,
source-exported (no build artifact), oxlint-clean.

License: Apache-2.0 (the repository LICENSE).
