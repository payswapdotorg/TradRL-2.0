/**
 * Cognitive Substrate runtime — W033 (the `agent-body` naming/structure
 * pattern: a flat, source-exported package).
 *
 * What this package owns (spec/WORK-ITEMS.md W033):
 * - the observed-view firewall + digest (`observedView.ts`): the A7 grant
 *   made fail-closed (content beyond the view, future-dated content and
 *   unavailable artifacts are typed errors, never silently seen) and the
 *   content digest every decision cites (the W028 chain discipline, the
 *   W016 hashing family);
 * - the shared decide machinery (`decide.ts`): validate-then-think, the
 *   state-mode laws, deterministic decision ids, the view's asOf as
 *   command time (no clock reads);
 * - the loud validators (`validate.ts`): the descriptor structure and the
 *   decision stream against the BODY's embodiment (a substrate producing
 *   commands outside the embodiment is invalid; rate-envelope breaches are
 *   typed — never silently clipped);
 * - the reference substrates: a rule-following momentum mind
 *   (`momentum.ts`, declared-state — the seeded state machine) and a
 *   mean-reversion mind (`meanReversion.ts`, stateless-per-view) — pure,
 *   seeded, tested against REAL alpha-world body views through the W032
 *   maximal view.
 *
 * The canonical contracts (types, closed sets, error-code unions) live in
 * the shared contracts package at
 * `packages/tradrl-world-contracts/src/cognitiveSubstrate.ts` (the
 * `data.ts`/`agentBody.ts` precedent); this package bridges to them.
 */

export * from "./contracts.js";
export * from "./decide.js";
export * from "./observedView.js";
export * from "./validate.js";
export * from "./momentum.js";
export * from "./meanReversion.js";
