/**
 * Possession runtime — W034 (the agent-body / cognitive-substrate
 * naming/structure pattern: a flat, source-exported package).
 *
 * What this package owns (spec/WORK-ITEMS.md W034):
 * - the possession contracts (`contracts.ts`): the PossessionDescriptor
 *   (substrate descriptor × body descriptor + the grant + the declared
 *   scope), the lifecycle table, and every outcome/error union — owned
 *   IN-PACKAGE (this Work Order's frozen surface is packages/possession/
 *   only, unlike the W032/W033 canonical-files precedent);
 * - the loud validators (`validate.ts`): the grant, the scope (⊆ the
 *   body's embodiment, closed observation kinds, a well-formed rate
 *   grant), with the W032/W033 descriptor validators delegated and their
 *   errors carried verbatim;
 * - the compatibility checker (`compatibility.ts`): can THIS substrate
 *   possess THIS body — the declaration level (proposed command kinds vs
 *   the embodiment, the rate envelope vs the grant, the W032 attach
 *   constraints) and the decision level (W033's validateDecisionStream +
 *   the possession-scope layer — the ultimate proof), every
 *   incompatibility naming the exact `{limit, substrateValue, bodyValue}`
 *   mismatch;
 * - the lifecycle (`lifecycle.ts`): unpossessed → possessed → released
 *   (+ the discard path) as fail-closed pure transforms;
 * - the lineage (`lineage.ts`): the body's possession history as an
 *   ordered, content-addressed digest chain (each record digested, each
 *   link citing its predecessor; verification catches any mutation of
 *   history loudly, at the exact index);
 * - the effective agent projection (`projection.ts`): the composed agent
 *   AS DATA — body + substrate + the tighter-of effective envelope + the
 *   maximalBodyView ∩ scope view grant; a pure projection, never a
 *   mutation.
 */

export * from "./contracts.js";
export * from "./validate.js";
export * from "./compatibility.js";
export * from "./lifecycle.js";
export * from "./lineage.js";
export * from "./projection.js";
