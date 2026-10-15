/**
 * Public surface of the W060 `security-service` package — the pure
 * SECURITY MACHINERY over the security contract (`packages/security`).
 *
 * Modules (the package.json exports map is the authority):
 * - `./isolation.js` — `proveIsolation(records)`: THE CROSS-RECORD PROOF
 *   (every record's §14 scope checked against the canonical reference
 *   scope; mismatches as typed findings; the `iso-<digest>` seal) + the
 *   W054 record adapters (knowledge records, brain generations);
 * - `./secrets.js` — `enforceSecretPolicy(policy, references)`: THE PURE
 *   CUSTODY CHECK (rotation compliance, access-scope agreement, redaction
 *   sufficiency, scope agreement, THE REDACTION LAW re-scanned — every
 *   violation typed; the `enf-<digest>` enforcement record);
 * - `./validate.js` — the enforcement record's whole-record re-validation
 *   + the contract validators re-exported.
 *
 * A14: composes typed proofs + policies — NEVER authenticates, NEVER
 * decrypts, NEVER executes, NEVER deploys (W062). The authorization model
 * is W058's entitlement grants, cited as data.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./isolation.js";
export * from "./secrets.js";
export * from "./validate.js";
