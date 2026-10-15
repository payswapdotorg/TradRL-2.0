/**
 * Shared fixtures of the W060 `security` contract tests. REAL imports only
 * (the memory/entitlements/api vocabularies this contract cites); NO
 * secret-shaped literals anywhere — THE REDACTION LAW applies to this test
 * suite itself, so every secret-shaped fixture is CONSTRUCTED AT RUNTIME
 * from non-secret fragments (the law is structural, even here).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { ENTITLEMENT_SCOPE_MEMBERS } from "entitlements";
import { KNOWLEDGE_SCOPE_MEMBERS } from "memory";
import type { SecurityScope } from "../isolation.js";
import type { SecretCustodyPolicy } from "../secrets.js";

/** The §14 scope of the default fixtures (tenant explicit — R056). */
export const TENANT = "tenant-security-tests";
export const PROJECT = "project-security";
export const WORLD = "world-security-tests";
export const SCOPE: SecurityScope = {
  tenantId: TENANT,
  projectId: PROJECT,
  worldId: WORLD,
};
/** The declaring principal of the default policy fixtures (the W058
 * grantee vocabulary: tenant + principal, both explicit). */
export const DECLARER = {
  tenantId: TENANT,
  principalId: "principal-security-officer",
};
/** The default custody policy: monthly (1000-tick) rotation, tenant-wide
 * access, redaction everywhere. */
export const CUSTODY: SecretCustodyPolicy = {
  rotation: { kind: "on-schedule", maxAgeTicks: 1000 },
  accessScopes: ["tenant"],
  redaction: "everywhere",
};

/** The W058 grantee vocabulary's own member list (REAL import — the policy
 * tests pin the declaring principal against it). */
export const PRINCIPAL_MEMBERS = ENTITLEMENT_SCOPE_MEMBERS;
/** The W054 scope member list (REAL import — the R056 generalization tests
 * pin SecurityScope against the law's first instance). */
export const MEMORY_SCOPE_MEMBERS = KNOWLEDGE_SCOPE_MEMBERS;

// ---------------------------------------------------------------------------
// RUNTIME-CONSTRUCTED secret-shaped fixtures — THE REDACTION LAW applies to
// these tests' own source: no secret-shaped literal ever appears here.
// ---------------------------------------------------------------------------
/** A known-grammar token (the push-protection lesson's own shape). */
export const RUNTIME_TOKEN = ["gh", "p_", "A".repeat(36)].join("");
/** A PEM private-key block. */
export const RUNTIME_PEM = ["-----BEGIN ", "RSA ", "PRIVATE KEY-----"].join("");
/** Bearer-header material. */
export const RUNTIME_BEARER = ["Bear", "er ", "s".repeat(32)].join("");
/** A long high-entropy token (its alphabet itself assembled from two
 * sub-threshold fragments — no standalone long literal here either). */
export const RUNTIME_ALPHABET = ["abcdefghijklmnopqrstuvwxyz", "0123456789"].join("");
export const RUNTIME_ENTROPIC = Array.from(
  { length: 48 },
  (_, index) => RUNTIME_ALPHABET[index % 36],
).join("");
/** A JWT-shaped string. */
export const RUNTIME_JWT = ["eyJ", "h".repeat(24), ".", "e".repeat(24), ".", "s".repeat(24)].join("");
/** The forbidden VALUE member name, itself assembled at runtime. */
export const RUNTIME_VALUE_MEMBER = ["val", "ue"].join("");
