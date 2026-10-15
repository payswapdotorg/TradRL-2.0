# learning-objectives

The reward/constraint evaluation **CONTRACT** (W036) — the typed vocabulary
W037 (trajectories/experiments) and W038 (evaluation/verification) build on.
A contract package in the W035 flat source-exported pattern: TypeScript
sources re-exported through the package.json `exports` map, `node:test`
suites over the real imported sources (no shims), every file ≤ 400 code
lines, Apache-2.0.

## What this package OWNS

- **The §10 evidence chain, completed** (`evidence.ts`): the W035
  `AgentPassRecord` (observation → decision metadata → admission → action,
  verbatim) plus the fourth link — the settled resulting state — bound into
  ordered `EvidenceCapsule`s and the `EvidenceStream` every evaluation here
  consumes. `validateEvidenceStream` is the fail-closed gate every seam runs
  first (identity, ordering, citation, and money-text laws).
- **Reward as a function over evidence** (`reward.ts`, `components.ts`): a
  reward model is DATA — typed components (kind + weight + scale) from a
  closed six-kind set, reduced in the closed CANONICAL kind order (never
  declaration order) into the ordered weighted sum. The §13 law
  **"Raw P&L is never the sole objective"** is enforced STRUCTURALLY: a
  model whose components are all financial-outcome family (a single
  `realized-pnl` component being the literal case) is refused at construction
  with the typed error `pnl-sole-objective` naming the law. Deterministic
  comparator with explicit tie rules included.
- **Constraints as data, never prompt text** (`constraints.ts`,
  `constraintCheckers.ts`, `constraintEvaluation.ts`) — A13: risk limits,
  venue policy, authorization gates (HARD — compliance gates) and shaped
  budgets (SOFT — priced penalties) are typed specs an evaluator walks.
  Violations are TYPED, ORDERED (the canonical capsule → kind → id → code
  total order), EVIDENCE-LINKED records — never strings. The package never
  ENFORCES anything: the world runtime's own gates stay the sole authority;
  it MEASURES evidence against declared boundaries.
- **The money-reading discipline** (`money.ts`, `decimal.ts`): one currency
  (mixed-currency streams fail closed — multi-currency accounting is W038's),
  canonical decimal text parsed exactly, finite readings, strictly positive
  equity, the deterministic peak/drawdown fold.
- **The §13 evaluation-policy descriptor** (`policy.ts`): the evaluation axes
  as closed, canonically-ordered kind sets — holdouts (unseen periods,
  walk-forward, regime/asset/venue), stress (execution, adversarial),
  ablations (organization, model substitution), integrity requirements
  (search-history, evidence-chain, deterministic-replay) — plus the
  deterministic REDUCTION semantics: components combine in canonical order,
  the policy's penalized SOFT constraints fold in canonical record order,
  hard violations gate compliance (never a price), and the combined score
  carries an EXPLICIT overflow rule (typed `non-finite-combined`, never a
  silent clamp) and an EXPLICIT tie ladder (total order).

## What this package deliberately does NOT own

- **No RL algorithm, no training loop, no gradients, no optimization** — it
  is the contract those things would be measured against, not one of them.
- **No model calls, no prompts** — nothing here reads a prompt, a model
  output, or a wall clock (A13/A9).
- **No enforcement** — declaring a constraint measures evidence; the world
  runtime's gates stay the sole authority (A13).
- **No trajectory capture/storage** — W037 owns the trajectory/experiment
  protocol; this package defines the stream shape it will produce
  (`evidenceStreamOfSession` is the contract-side pairing law).
- **No experiment orchestration** — W038 walks the descriptors defined here;
  it owns holdout splitting, stress generation, ablation execution.
- **No multi-currency evaluation accounting** — W038's surface; this package
  fails closed on mixed currency instead of converting silently.
- **No persistence, no I/O** — pure functions over typed data.

## Conventions

- Determinism (A9): fixed reward model + fixed evidence stream ⇒ identical
  results; canonical orders everywhere; fail-closed at every seam (unknown
  component kind, unregistered constraint, malformed evidence → typed
  errors, never silent defaults).
- Tests: `node:test` + `node:assert/strict` over the REAL imported sources
  (`pnpm --filter learning-objectives test`).
- Typecheck: `tsc -p .` (`pnpm --filter learning-objectives typecheck`);
  lint: `npx oxlint packages/learning-objectives`.
