# tradrl-adapters-jax-lob (W049)

The JAX-LOB training adapter: the LOB-venue TRAINING ADAPTER over the
W047 TrainerPort/episode-batch contracts (`rl-protocol`) and the W048
GenerationPlan/GenerationWorkerPort contracts (`learning-compute`) —
the `packages/tradrl-adapters/*` flat source-exported layout (the W024
abides / W057 arena template). The venue-specific vocabulary (book-state
descriptors, order kinds, execution event kinds, episode-step shapes)
is declared HERE and ONLY HERE, as closed sets with fail-closed
validation.

## CLEAN-ROOM PROVENANCE (the license law — binding)

`spec/THIRD-PARTY-TECHNOLOGY-REGISTER.md` rules JAX-LOB **reference-only**,
verbatim:

> No license file = all-rights-reserved: copying, vendoring, or deriving
> from KangOxford/jax-lob or KangOxford/AlphaTrade code is prohibited;
> W049 must be clean-room (paper-based) or must first obtain and record
> written permission in this register; do not treat the successor repo
> (AlphaTrade) as licensed — it is equally unlicensed.

Accordingly this package is a **CLEAN-ROOM, paper-based re-expression** of
the publicly documented CONCEPTS of a limit-order-book training
environment family (two sides aggregated into best-first price levels,
order kinds, execution event kinds, observe/act/report/reward step
shapes): **zero third-party code, zero vendored files, zero upstream
API-shape copying.** No KangOxford/jax-lob or KangOxford/AlphaTrade
repository was fetched, read, or ported while writing this package; the
only inputs were the public paper-level concepts, this repository's own
W047/W048 contract surfaces, and the register's binding ruling (the
W024 ABIDES + W057 arena clean-room precedents). A test-pinned
vocabulary-law scan (`test/provenance.test.ts`) proves the public source
surface imports nothing but this repository's own packages and node
builtins, and carries no upstream-derived identifiers.

## What this package OWNS

- `lob-vocabulary.ts` — the clean-room LOB training vocabulary, declared
  here and only here as CLOSED sets, fail-closed at every seam:
  - the side vocabulary (`bid` / `ask`) and the aggregated level
    descriptor (price / size / orderCount — data);
  - the book-state descriptor + THE BOOK-STATE GATE (both sides
    non-empty, finite positive level data, best-first strictly ordered
    levels, the best bid strictly below the best ask — a crossed or
    locked book is the loud refusal `crossed-book`), with the opaque
    content-addressed `lobbook-<digest>` id;
  - the order-kind vocabulary (`limit` / `market` / `cancel` / `amend`)
    and the execution-event vocabulary (`submission` / `cancellation` /
    `execution` / `amendment`) + the event gate;
  - the episode-step shape vocabulary (`book-observation` /
    `order-action` / `execution-report` / `reward-signal` /
    `terminal-marker`) + THE SHAPE GATE (non-empty, closed set, one kind
    once, canonical protocol order, begins with the observation, carries
    the action AND the reward signal — §13 rides through the carried
    reward — and the terminal marker last).
- `lob-trainer.ts` — the venue's TrainerPort-facing contract: how a W047
  episode/batch maps to LOB-style training steps. The mapping is PURE
  typed DATA: one carried episode step (the W036 evidence capsule,
  carried VERBATIM — never re-structured, never re-scored) maps to the
  declared sequence of LOB step records of the venue's shape, cited by
  INDEX (the capsule content is never copied); the projection is
  canonical-order, content-addressed (`lobtrain-<digest>`), input-order
  blind (A9). Malformed episodes are refused with W047's OWN validation
  errors carried VERBATIM; malformed batch descriptors with W047's own
  batch errors carried verbatim; a handed realization that does not
  cover the batch exactly, or episodes that disagree on scope, are
  refused by name.
- `lob-generation.ts` — the venue's GenerationWorkerPort-facing
  contract: how a W048 generation plan/work unit projects to LOB-style
  environment declarations. ONE declaration per work unit (canonical
  shard order): the `lobenv-<digest>` id, the plan/unit opaque
  citations, the shard index, the population-slice size and declared
  episode quota CARRIED verbatim from the unit, and the venue's sealed
  step shape. A plan failing W048's own whole-plan re-validation is
  refused with ITS errors carried VERBATIM; a declared expected scope
  that disagrees with the plan's is refused by name.
- `validate.ts` — the whole-record re-validation of both projection
  kinds: identity re-derivations (mapping ids, environment ids), the
  vocabulary laws re-proven on the recorded shape (errors carried
  verbatim), the canonical training-step sequence re-derivation, the
  canonical episode order, the projection coverage laws, the canonical
  shard order. Re-proven, never re-scored (A13).

## What this package does NOT own

- **NO third-party code, ever** — the clean-room law above is binding;
  nothing here is derived from KangOxford/jax-lob or KangOxford/
  AlphaTrade code, and nothing upstream is vendored, imported, or
  forked.
- NO training execution: the adapter COMPOSES typed data (A14); it never
  trains, never computes gradients, never invokes a trainer through
  W047's TrainerPort (the port types the handshake; a venue trainer
  implementation is a future lane).
- NO simulation stepping: never steps a book environment, never matches
  an order, never executes a generation unit through W048's
  GenerationWorkerPort, never spawns, never networks.
- NO re-scoring, ever: carried steps/rewards/capsules are cited and
  carried, never re-derived; W047's and W048's own gates are run
  VERBATIM with their errors carried verbatim, never bypassed, never
  weakened, never re-implemented.
- NO contract changes: `packages/rl-protocol`, `services/learning/*`
  are frozen to this package — imported, never modified, never
  re-declared.
- NO clocks, no randomness, no env reads (A9): every id is a canonical
  content digest over recorded data; distribution and identity are
  declared data, never discovered.

## Layout (the W024 abides / W057 arena template)

`lob-vocabulary.ts` (the closed vocabularies + the gates + the
content-addressed ids), `lob-trainer.ts` (the W047-facing projection),
`lob-generation.ts` (the W048-facing projection), `validate.ts`
(whole-record re-validation), `index.ts`, `test/` (node:test +
node:assert/strict over REAL imports — REAL W047 episodes through the
bridge fixture lineage, REAL W048 plans through the compute fixture
lineage; no shims).
