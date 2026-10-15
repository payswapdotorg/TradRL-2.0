# rl-protocol (W047)

The RL protocol contract: the typed interface an RL **trainer** consumes
and implements. One flat, source-exported package in the W035–W044
pattern (`exports` point at TypeScript sources; no build artifact).

The chain it rides on: **W037** captures trajectories (the empirical record
of agent-world sessions) · **W036** ships the constraint-aware evaluation
contract (`PolicyEvaluation` — components + constraints, P&L never sole) ·
**W038** walks experiments into evaluations · **W044** binds agents to
worlds. This package types what a trainer sees of that record.

## What this package OWNS

- **`episode.ts` — the Episode contract (typed DATA).** An opaque,
  content-addressed episode id over the provenance triple (trajectory
  canonical id + binding id + experiment-evaluation id); the explicit
  scope; the observation→action→outcome steps CARRIED VERBATIM from the
  W037 trajectory's own §10 evidence capsules; the reward signal TYPED
  through W036's `PolicyEvaluation` (components + constraints carried
  verbatim); immutable lineage (the trajectory's own, carried). The
  construction gate enforces the §13 sole-P&L law structurally: a carried
  evaluation whose reward components are all financial-outcome (an empty
  list included) is the loud typed refusal `pnl-sole-reward`, naming the
  law — defensive depth over recorded data, which is re-proven, never
  trusted.
- **`trainer.ts` — the TrainerPort + the batch descriptor.** The minimal
  PURE interface a trainer implements (`descriptor` + `consumeBatch` —
  types only; W048/W049 adapters satisfy it), plus the deterministic
  `EpisodeBatchDescriptor`: episode ids in canonical order (input order
  never leaks), a content-addressed batch id, an optional declared
  selection policy as DATA.
- **`validate.ts` — the whole-record re-validation.** The identity
  re-derivation, the scope/provenance/steps/reward/lineage laws, and the
  batch laws (content address, canonical order, count, policy
  declarations) re-proven from the record's bytes alone (A9).

## What this package does NOT own

- **No trainer execution, no gradients, no optimizers, no JAX** — the port
  types the handshake; the training adapter is **W049**.
- **No distributed episode generation** — **W048** owns producing episodes
  at scale.
- **No world stepping, no simulation, no trades** (A14) — the world
  runtime owns all execution authority.
- **No episode assembly from records** — the pure bridge service
  (`services/learning/rl`) owns proving provenance through W037/W044/W038's
  own gates and sealing episodes; this package only types and re-proves
  them.
- **No method prescription** (R054: RL is ONE learning method among many) —
  the protocol is method-neutral by construction.

## The laws, in one breath

Opaque ids, canonical encoders, scope explicit (DOMAIN-MODEL identity
laws) · same inputs ⇒ deep-equal episodes/batches, same canonical ids, no
clocks, no randomness, no env reads (A9) · carried data re-proven, never
trusted, never re-scored (A13, the W038 carry precedent) · a bare-P&L
reward is a loud typed refusal (§13) · fail-closed at every seam.

## Tests

`node:test` + `assert/strict` over REAL imports: the fixtures build REAL
W037 trajectory records through `trajectoryRecordOf` over the trajectory
package's own test fixtures (the W041 fixture lineage — zero drift), and
the laws are exercised against them, including the A9 twin (same inputs →
deep-equal episodes and batches, same ids; input order never leaks).

License: Apache-2.0 (the repository LICENSE).
