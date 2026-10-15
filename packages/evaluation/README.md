/**
 * The evaluation ENGINE (W038) — owns/
 * does-NOT-own.
 *
 * OWNS:
 * - `evaluateExperiment()` — the experiment WALKER: an `ExperimentManifest`
 *   (W037) + its member `TrajectoryRecord`s (W037) + the experiment's
 *   `EvaluationPolicy` (W036) → the typed, deterministic
 *   `ExperimentEvaluation`. Per-trajectory results are CARRIED from the
 *   records' own outcome summaries (never re-scored — A13); per-holdout-split
 *   aggregations compare the manifest's declarative atoms (periods /
 *   instruments) against the records' own data as DATA — set membership,
 *   never computed statistics; the reduction folds the policy's own
 *   dimensions across trajectories in canonical order; the compliance
 *   dimension ALWAYS rides along (hard violations gate, soft penalties fold
 *   — never a bare P&L, §13).
 * - `summary.ts` — the carried outcome summary + the holdout membership
 *   derivation (period-instants / asset-instruments / not-derivable — the
 *   walker never fabricates a regime/venue membership the record surface
 *   cannot support).
 * - The canonical content-addressed evaluation id (`expeval-…`, A9): same
 *   manifest + same records + same policy ⇒ identical evaluation AND
 *   identical id; input order never matters (canonical walk order).
 *
 * DOES NOT OWN (scope honesty):
 * - NO execution, no model calls, no RL, no stress generation, no holdout
 *   SPLITTING (W037's manifest gate owns split construction; the walker
 *   re-proves the split laws from data and aggregates).
 * - NO re-scoring of records (the W037 capture gate produced the outcome
 *   summaries; re-deriving them is the VERIFICATION harness's twin check,
 *   W038 packages/verification).
 * - NO store, NO persistence, NO I/O (W037 types the store contract).
 * - NO enforcement (A13): the walker measures and aggregates; the world
 *   runtime's gates stay the sole authority.
 *
 * FAIL-CLOSED: unknown/duplicate/missing/malformed records, scope, world,
 * digest, or policy disagreements, broken integrity carry-forward, unknown
 * or re-kinded holdout splits, non-finite fold totals — loud typed errors
 * naming the law, never silent defaults, never partial silent skips.
 *
 * Tests: `cd packages/evaluation && ../../../node_modules/.bin/tsx --test
 * test/*.test.ts`
 *
 * License: Apache-2.0 (the repository LICENSE).
 */
