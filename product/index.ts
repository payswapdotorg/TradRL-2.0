/**
 * Public surface of the W066 `product` directory — the typed PRODUCT
 * IDENTITY CONTRACT (a plain directory, deliberately NOT a workspace
 * package — the deploy/ W062 + docs/benchmarks + research/benchmarks W063
 * precedent: no package.json, no lockfile change, no dependencies of its
 * own; the gate re-proves every citation against REAL repository surfaces
 * via relative source imports).
 *
 * Modules:
 * - `./identity.js` — the `ProductIdentity` record vocabulary: the product
 *   name, the branding law of record, the closed identity-scope vocabulary,
 *   THE MIGRATION LAWS as data, the per-surface declarations (incl. the
 *   shipped `TRADRL_IDENTITY_SURFACES`), the immutable lineage, the
 *   deterministic provenance, the content-addressed `identity-<digest>` id,
 *   the canonicalization laws (A9);
 * - `./citations.js` — the REAL-surface citation proofs (the fail-closed
 *   unknown-surface refusal, the migration-law byte-proofs, the W062
 *   deployment-component citation, the branding-law proof) + the closed
 *   violation vocabulary + the surface probe;
 * - `./compose.js` — `composeProductIdentity`, THE GATE;
 * - `./validate.js` — `validateProductIdentity`, whole-record
 *   re-validation from recorded data alone (ids re-derived — a rewrite is
 *   caught loudly).
 *
 * The migration is IDENTITY, not erasure: this contract never rewrites a
 * surface itself (the README migrations are this work item's own surgical
 * edits); it DECLARES and PROVES the identity laws the surfaces must keep.
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./identity.js";
export * from "./citations.js";
export * from "./compose.js";
export * from "./validate.js";
