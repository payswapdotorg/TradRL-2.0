# learning-rl (W047)

The pure RL bridge service: the seam between the recorded empirical chain
and the RL trainer surface. One flat, source-exported package in the
W035–W044 pattern (`exports` point at TypeScript sources; no build
artifact), living under `services/learning/`.

The chain it bridges: **W037** trajectories (the empirical record of
agent-world sessions) · **W036** the constraint-aware evaluation contract
(`PolicyEvaluation` — components + constraints, P&L never sole) · **W038**
experiment evaluations (the verified outcome summaries) · **W044**
world-agent bindings (the proven agent-identity routes) → **rl-protocol**
(W047, the typed trainer-facing contract).

## What this service OWNS

- **`assemble.ts` — `assembleEpisodes(trajectories, evaluations,
  bindings)`: THE GATE.** Every trajectory re-proven through W037's own
  validator (errors carried verbatim); every binding re-proven through
  W044's own (errors carried verbatim); scope/world/session agreement
  proven pairwise — an episode's agent identity routes through a PROVEN
  binding, and the session's mind must be one of that binding's substrate
  surfaces (agent substrate, or an organization seat's); the experiment
  evaluation proven a FAITHFUL CARRY of the record's own W036 evaluation
  (carry never re-scores — but a carry mismatch is fail-closed); the
  reward signal proven constraint-aware — a bare-P&L reward is the loud
  typed refusal `bare-pnl-reward` naming the §13 law. Then the episode is
  sealed through the protocol's own construction gate and emitted in
  canonical episode-id order.
- **`batch.ts` — `assembleBatch(episodes, policy?)`.** Deterministic batch
  construction: episodes re-proven through the protocol's whole-record
  validation, ids in canonical order (input order never leaks), the
  content-addressed batch id, an optional declared selection policy as
  DATA.
- **`validate.ts` — the bridge error family + the provenance laws.** The
  pairwise agreement laws, the faithful-carry proof, the §13 probe, and
  `validateEpisodeProvenance` — the sealed-episode re-validation against
  its cited sources (the W048-facing proof).

## What this service does NOT own

- **No trainer execution, no gradients, no optimizers, no JAX** — the
  training adapter is **W049**; this bridge hands trainers typed data and
  descriptors only.
- **No distributed episode generation** — **W048** owns producing episodes
  at scale.
- **No world stepping, no simulation, no trades** (A14) — the world
  runtime owns all execution authority; the bridge only reads records.
- **No re-scoring, no re-evaluation** — the reward rides VERBATIM through
  W036's `PolicyEvaluation` (components + constraints); re-deriving
  outcomes is the W038 evaluation consumer's job, never the bridge's
  (carry never re-score).
- **No method prescription** (R054) — method-neutral by construction.

## The laws, in one breath

Fail-closed at every seam (malformed trajectory → W037 errors carried;
scope/world/session disagreement; evaluation mismatch; duplicate episode
ids) · carried data re-proven through the upstream packages' OWN gates,
never trusted (A13) · identical inputs ⇒ deep-equal episodes/batches with
identical canonical ids, input order never leaks (A9) · a bare-P&L reward
is a loud typed refusal naming §13 (R054: RL is one learning method among
many — never a P&L chaser).

## Tests

`node:test` + `assert/strict` over REAL imports: REAL W037 trajectories
through the trajectory package's own test fixtures (the W041 fixture
lineage), a REAL W038 experiment evaluation through `createExperiment` →
`experimentManifestOf` → `evaluateExperiment`, and REAL W044 bindings
through the world-agent-runtime's own test fixtures (`bindAgent` over a
commissioned body forged through body-forge's REAL gates — zero fixture
drift). The A9 twin closes the set: permuted inputs → deep-equal episodes
and batches, identical ids.

License: Apache-2.0 (the repository LICENSE).
