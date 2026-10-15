/**
 * Public surface of the W060 `security` package — the SECURITY CONTRACT.
 *
 * Modules (the package.json exports map is the authority):
 * - `./isolation.js` — the TENANT-ISOLATION PROOF vocabulary: the R056
 *   generalization (cross-record isolation proofs over §14-scoped records
 *   as typed data), the typed finding vocabulary, the canonical findings
 *   order, the content-addressed `iso-<digest>` proof id, the evidence
 *   envelope + record-shape laws;
 * - `./secrets.js` — the SECRET-REFERENCE contract: typed handles (opaque
 *   `sec-<digest>` ids + the custody policy — rotation, access scope,
 *   redaction, ALL declared data), THE REDACTION LAW scanner
 *   (`secretValueViolations` / `isSecretShaped` — a secret-shaped VALUE
 *   anywhere is a loud typed refusal), the seal gate, the secret-policy
 *   violation vocabulary;
 * - `./policy.js` — the security-policy vocabulary: the `SecurityPolicy`
 *   record (§14 scope, the W058 declaring principal, W059's required scope
 *   kind, the secret-custody requirement, the closed authorization model),
 *   the declaration gate, the `pol-<digest>` id;
 * - `./validate.js` — whole-record re-validation of all three contracts
 *   (ids re-derived, closed sets re-enforced, THE REDACTION LAW re-scanned).
 *
 * A14: CONTRACTS ONLY — the pure machinery (`proveIsolation`,
 * `enforceSecretPolicy`) lives in services/security. This package never
 * authenticates, never decrypts, never stores, never transmits.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

export * from "./isolation.js";
export * from "./secrets.js";
export * from "./policy.js";
export * from "./validate.js";
