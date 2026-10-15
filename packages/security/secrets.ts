/**
 * The SECRET-REFERENCE contract (W060) — typed handles for the firm's
 * secrets, as typed DATA. THE REDACTION LAW lives here, STRUCTURALLY.
 *
 * A `SecretReference` is a secret's IDENTITY + its CUSTODY POLICY, never
 * the secret itself: which KIND of secret it is (the closed vocabulary),
 * which §14 scope it belongs to, a human display name, and the custody
 * policy as declared data — the required ROTATION cadence (on-schedule
 * with a declared max age, on-every-use, or never), the allowed ACCESS
 * scopes (W059's closed §14 route-scope hierarchy, imported), and the
 * required REDACTION level (the closed strictness vocabulary). The id is
 * the opaque content-addressed `sec-<digest>` weighing the TENANT FIRST
 * (R056 structural — the same handle under two tenants is two secrets).
 *
 * THE REDACTION LAW, enforced at construction: no secret VALUE ever
 * appears in any record, type, or test — typed handles only.
 * `sealSecretReference` scans its ENTIRE input (every member, recursively)
 * and REFUSES LOUDLY (`secret-value-refused`, the law named in the
 * message) when a forbidden VALUE member appears (value/secret/password/
 * token/apiKey/credential/privateKey/plaintext/key) or when any string in
 * the input is SECRET-SHAPED (known token grammar, PEM private-key blocks,
 * bearer-header material, AWS-style secret keys, JWTs, high-entropy long
 * tokens) — the push-protection lesson made structural. The same scan re-runs on
 * every re-validation: a record that carries a secret-shaped string is
 * INVALID, loudly.
 *
 * Laws: THE REDACTION LAW (above); R056 + §14 (the tenant is part of the
 * handle's canonical identity; the scope is explicit); A9 (same input ⇒
 * deep-equal handle, same id); A14 (typed contracts — this module never
 * stores, never transmits, never decrypts, never authenticates).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import { API_ROUTE_SCOPE_KINDS, SCOPE_MEMBERS_OF } from "api";
import type { ApiRouteScopeKind } from "api";
import type { SecurityError, SecurityProvenance, SecurityScope } from "./isolation.js";
import { REDACTION_LAW, SECURITY_PROVENANCE_LAWS, blankSecurityScopeMembers } from "./isolation.js";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The closed secret-kind vocabulary (what KIND of secret the handle names). */
export const SECRET_KINDS = [
  "api-key",
  "credential",
  "token",
  "signing-key",
  "encryption-key",
] as const;
export type SecretKind = (typeof SECRET_KINDS)[number];

/** The closed access-scope vocabulary for secret custody — W059's own §14
 * route-scope hierarchy, IMPORTED (the security layer cites the API's scope
 * kinds; it never re-declares a parallel set). */
export type SecretAccessScope = ApiRouteScopeKind;
export const SECRET_ACCESS_SCOPES: readonly SecretAccessScope[] = API_ROUTE_SCOPE_KINDS;
export const ACCESS_SCOPE_MEMBERS_OF = SCOPE_MEMBERS_OF;

/** The closed rotation-cadence vocabulary (declared data — A9 has no clocks). */
export const CUSTODY_ROTATION_KINDS = [
  "on-schedule",
  "on-every-use",
  "never",
] as const;
export type CustodyRotationKind = (typeof CUSTODY_ROTATION_KINDS)[number];
/** Rotation on a declared schedule: at most `maxAgeTicks` between rotations. */
export interface ScheduledRotation {
  readonly kind: "on-schedule";
  readonly maxAgeTicks: number;
}
/** Rotation on every use (the strictest cadence). */
export interface EveryUseRotation {
  readonly kind: "on-every-use";
}
/** No rotation required (the laxest cadence — a policy rarely allows it). */
export interface NoRotation {
  readonly kind: "never";
}
export type CustodyRotation = ScheduledRotation | EveryUseRotation | NoRotation;

/** The closed redaction-level vocabulary, in strictness order. */
export const REDACTION_LEVELS = [
  "records-only",
  "records-and-logs",
  "everywhere",
] as const;
export type RedactionLevel = (typeof REDACTION_LEVELS)[number];
/** The strictness ordering (records-only < records-and-logs < everywhere). */
export const REDACTION_STRICTNESS: Record<RedactionLevel, number> = {
  "records-only": 0,
  "records-and-logs": 1,
  "everywhere": 2,
};
/** The canonical (strictness) order of the redaction levels. */
export const CANONICAL_REDACTION_LEVELS: readonly RedactionLevel[] = REDACTION_LEVELS;

/** The custody policy of one secret — rotation, access scopes, and
 * redaction requirements, ALL declared data. */
export interface SecretCustodyPolicy {
  readonly rotation: CustodyRotation;
  readonly accessScopes: readonly SecretAccessScope[];
  readonly redaction: RedactionLevel;
}

export type SecretErrorCode =
  | "malformed-input" // not lawful typed data
  | "invalid-scope" // a §14 scope member is blank
  | "unknown-secret-kind" // the closed vocabulary, loudly enforced
  | "blank-display-name" // a handle names its secret, never blankly
  | "invalid-custody" // the custody policy fails its own closed-set laws
  | "secret-value-refused"; // THE REDACTION LAW: a secret VALUE appeared

declare const secretIdBrand: unique symbol;
/** An OPAQUE secret id (a canonical digest rendering) — the TYPED HANDLE.
 * Produced only by the seal gate / {@link secretReferenceDigestOf}; never
 * parsed; the secret's VALUE is never recoverable from it. */
export type SecretId = string & { readonly [secretIdBrand]: true };
/** The id prefix (a rendering convention, never a parse target). */
export const SECRET_ID_PREFIX = "sec-";

/** ONE secret reference — the typed handle. Carries the secret's identity
 * and custody policy ONLY: the VALUE never appears (THE REDACTION LAW),
 * here or anywhere downstream. */
export interface SecretReference {
  readonly secretId: SecretId;
  readonly kind: SecretKind;
  readonly scope: SecurityScope;
  readonly displayName: string;
  readonly custody: SecretCustodyPolicy;
  readonly provenance: SecurityProvenance;
}
/** The sealing input (never a value member — the scan enforces it). */
export interface SecretReferenceInput {
  readonly scope: SecurityScope;
  readonly kind: SecretKind;
  readonly displayName: string;
  readonly custody: SecretCustodyPolicy;
}
export type SecretReferenceOutcome =
  | { readonly ok: true; readonly reference: SecretReference }
  | { readonly ok: false; readonly errors: readonly SecurityError<SecretErrorCode>[] };

// ---------------------------------------------------------------------------
// THE REDACTION LAW — the scanner (pure, closed signature list)
// ---------------------------------------------------------------------------
/** The forbidden VALUE-member names: a secret reference never carries the
 * thing itself, only its handle. */
export const FORBIDDEN_VALUE_MEMBERS: readonly string[] = [
  "value",
  "secret",
  "secretValue",
  "plaintext",
  "password",
  "token",
  "apiKey",
  "apikey",
  "credential",
  "privateKey",
  "key",
];
/** The detector's own grammar is ASSEMBLED AT RUNTIME from non-secret
 * fragments — THE REDACTION LAW holds over this source file too: the
 * law's own implementation contains no secret-shaped string either. */
const signature = (...parts: readonly string[]): string => parts.join("");
/** Anchored token-grammar prefixes (collision-prone embedded — e.g. the
 * *sk-* of "desk-ops" — so these match only a WHOLE-string prefix; the
 * deliberately conservative list's one disclosed blind spot is an
 * *sk-*-style token embedded mid-prose). */
const SECRET_SHAPE_PREFIXES: readonly string[] = [
  signature("sk", "-"),
  signature("sk", "-ant", "-"),
];
/** Distinctive secret signatures, detected ANYWHERE in the string (the
 * push-protection lesson: secrets leak embedded in text, not only as
 * standalone values). */
const SECRET_SHAPE_EMBEDDED_SIGNATURES: readonly string[] = [
  signature("gh", "p_"),
  signature("gh", "o_"),
  signature("gh", "u_"),
  signature("gh", "s_"),
  signature("gh", "r_"),
  signature("git", "hub", "_pat", "_"),
  signature("xox", "b-"),
  signature("xox", "p-"),
  signature("xox", "a-"),
  signature("AI", "za"),
  signature("AK", "IA"),
  signature("AS", "IA"),
];
/** The bearer-header signature, assembled (same law). */
const BEARER_SIGNATURE = signature("Bear", "er ");
const PEM_PRIVATE_KEY_PATTERN = /-----BEGIN[A-Z ]*PRIVATE KEY-----/;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const AWS_SECRET_PATTERN = /^[A-Za-z0-9/+=]{40}$/;
const ENTROPIC_TOKEN_PATTERN = /^[A-Za-z0-9+/=_-]{32,}$/;

function distinctCharacters(value: string): number {
  return new Set(value.split("")).size;
}
/** Is this string SECRET-SHAPED? A closed signature list: known token
 * grammar (distinctive signatures detected EMBEDDED anywhere in the
 * string — the push-protection lesson; collision-prone prefixes anchored
 * to the whole string), PEM private-key blocks, bearer-header material,
 * AWS-style secret keys, JWTs, and long high-entropy tokens
 * (whole-string). Pure + deterministic; deliberately conservative — this
 * repo's ids, digests, and scope members never trip it. */
export function isSecretShaped(value: string): boolean {
  if (typeof value !== "string") {
    return false;
  }
  if (PEM_PRIVATE_KEY_PATTERN.test(value)) {
    return true;
  }
  if (value.includes(BEARER_SIGNATURE)) {
    return true;
  }
  for (const prefix of SECRET_SHAPE_PREFIXES) {
    if (value.startsWith(prefix)) {
      return true;
    }
  }
  for (const signature of SECRET_SHAPE_EMBEDDED_SIGNATURES) {
    if (value.includes(signature)) {
      return true;
    }
  }
  if (JWT_PATTERN.test(value) || AWS_SECRET_PATTERN.test(value)) {
    return true;
  }
  return ENTROPIC_TOKEN_PATTERN.test(value) && distinctCharacters(value) >= 12;
}
/** THE REDACTION LAW scan: walk an entire value (objects, arrays, nested)
 * and collect a LOUD typed `secret-value-refused` error for every forbidden
 * VALUE member and every secret-shaped string found. Pure; the same input
 * always yields the same errors (A9). */
export function secretValueViolations(
  value: unknown,
  path: string,
): readonly SecurityError<"secret-value-refused">[] {
  const errors: SecurityError<"secret-value-refused">[] = [];
  const refuse = (where: string): void => {
    errors.push({
      code: "secret-value-refused",
      message: `${where} — THE REDACTION LAW refuses it: no secret VALUE ever appears in any record, type, or test; typed handles only (${REDACTION_LAW})`,
    });
  };
  const walk = (node: unknown, memberPath: string): void => {
    if (typeof node === "string") {
      if (isSecretShaped(node)) {
        refuse(`the string ${memberPath} is secret-shaped`);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const [index, entry] of node.entries()) {
        walk(entry, `${memberPath}[${String(index)}]`);
      }
      return;
    }
    if (isRecordLike(node)) {
      for (const member of Object.keys(node)) {
        if (FORBIDDEN_VALUE_MEMBERS.includes(member)) {
          refuse(`the member '${memberPath}.${member}' is a forbidden VALUE member`);
        }
        walk(node[member], `${memberPath}.${member}`);
      }
    }
  };
  walk(value, path);
  return errors;
}

// ---------------------------------------------------------------------------
// The custody-policy laws (closed sets, fail-closed)
// ---------------------------------------------------------------------------
function canonicalAccessScopes(scopes: readonly unknown[]): readonly string[] {
  return [...new Set(scopes.map((scope) => String(scope)))].sort();
}
/** The custody-policy law errors (fail-closed, all collected): the closed
 * rotation/redaction/access vocabularies, the rotation cadence's own laws,
 * non-blank canonical-order access scopes. */
export function secretCustodyPolicyErrors(
  custody: unknown,
): readonly SecurityError<SecretErrorCode>[] {
  if (!isRecordLike(custody)) {
    return [
      {
        code: "invalid-custody",
        message: "the custody policy is not typed data — rotation, access scopes, and a redaction level are required",
      },
    ];
  }
  const errors: SecurityError<SecretErrorCode>[] = [];
  const rotation = custody.rotation;
  if (
    !isRecordLike(rotation) ||
    !CUSTODY_ROTATION_KINDS.includes(rotation.kind as CustodyRotationKind)
  ) {
    errors.push({
      code: "invalid-custody",
      message: `the rotation cadence '${String(isRecordLike(rotation) ? rotation.kind : rotation)}' is outside the closed vocabulary — secrets rotate ${CUSTODY_ROTATION_KINDS.join(" or ")} (declared data, never a clock read)`,
    });
  } else if (rotation.kind === "on-schedule") {
    const maxAgeTicks = rotation.maxAgeTicks;
    if (
      typeof maxAgeTicks !== "number" ||
      !Number.isSafeInteger(maxAgeTicks) ||
      maxAgeTicks <= 0
    ) {
      errors.push({
        code: "invalid-custody",
        message: `the scheduled rotation's maxAgeTicks '${String(maxAgeTicks)}' is not a safe positive integer tick — declared time is explicit data (A9 has no clocks)`,
      });
    }
  }
  const accessScopes = custody.accessScopes;
  if (!Array.isArray(accessScopes) || accessScopes.length === 0) {
    errors.push({
      code: "invalid-custody",
      message: "the custody policy declares no access scopes — a secret is reachable through at least one explicit §14 scope, never through none",
    });
  } else {
    const unknown = accessScopes.filter(
      (scope) => !SECRET_ACCESS_SCOPES.includes(scope as SecretAccessScope),
    );
    if (unknown.length > 0) {
      errors.push({
        code: "invalid-custody",
        message: `the access scopes (${unknown.map(String).join(", ")}) are outside the closed §14 route-scope hierarchy — secrets are accessible at ${SECRET_ACCESS_SCOPES.join(" / ")} only`,
      });
    }
    const canonicallyOrdered = canonicalAccessScopes(accessScopes);
    if (
      accessScopes.length !== new Set(accessScopes.map(String)).size ||
      accessScopes.map(String).join("|") !== canonicallyOrdered.join("|")
    ) {
      errors.push({
        code: "invalid-custody",
        message: "the access scopes are not in canonical order without duplicates — the custody policy is canonical data (A9)",
      });
    }
  }
  if (!REDACTION_LEVELS.includes(custody.redaction as RedactionLevel)) {
    errors.push({
      code: "invalid-custody",
      message: `the redaction level '${String(custody.redaction)}' is outside the closed vocabulary — secrets are redacted ${REDACTION_LEVELS.join(" or ")} (THE REDACTION LAW is data here too)`,
    });
  }
  return errors;
}

/** The canonical content a secret id addresses (the TENANT FIRST — R056
 * structural; the custody policy is carried data, so it is addressed too). */
export function secretCanonicalContent(
  scope: SecurityScope,
  kind: SecretKind,
  displayName: string,
  custody: SecretCustodyPolicy,
): unknown {
  const rotation: unknown[] =
    custody.rotation.kind === "on-schedule"
      ? [custody.rotation.kind, custody.rotation.maxAgeTicks]
      : [custody.rotation.kind];
  return {
    custody: [rotation, custody.accessScopes.map(String), custody.redaction],
    displayName,
    kind,
    scope: [scope.tenantId, scope.projectId, scope.worldId],
  };
}
/** The secret id: `sec-<digest>` over the canonical content. The VALUE
 * participates NOWHERE — the handle addresses identity + custody only. */
export function secretReferenceDigestOf(
  reference: Pick<SecretReference, "scope" | "kind" | "displayName" | "custody">,
): SecretId {
  const digest = canonicalDigestHex(
    secretCanonicalContent(
      reference.scope,
      reference.kind,
      reference.displayName,
      reference.custody,
    ),
  );
  return `${SECRET_ID_PREFIX}${digest}` as SecretId;
}
/** The handle's input digest (the provenance member). */
export function secretInputDigestOf(input: SecretReferenceInput): string {
  return canonicalDigestHex({
    displayName: input.displayName,
    kind: input.kind,
    scope: [input.scope.tenantId, input.scope.projectId, input.scope.worldId],
  });
}

/** Seal ONE secret reference — THE HANDLE GATE. Fail-closed, all violations
 * collected: lawful typed input, explicit §14 scope, closed kind
 * vocabulary, non-blank display name, the custody policy validated through
 * its own closed-set laws, and THE REDACTION LAW SCAN over the ENTIRE input
 * (a secret-shaped VALUE anywhere is the LOUD `secret-value-refused`
 * violation — the push-protection lesson made structural), then the seal:
 * the `sec-<digest>` id minted over the canonical bytes (the TENANT weighed
 * first — R056 structural), the deterministic provenance recorded. */
export function sealSecretReference(input: SecretReferenceInput): SecretReferenceOutcome {
  if (!isRecordLike(input) || !isRecordLike(input.scope) || !isRecordLike(input.custody)) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed-input",
          message: "the sealing input is not typed data — a scope, a kind, a display name, and a custody policy are required",
        },
      ],
    };
  }
  const errors: SecurityError<SecretErrorCode>[] = [];
  for (const member of blankSecurityScopeMembers(input.scope)) {
    errors.push({
      code: "invalid-scope",
      message: `the secret reference's scope '${member}' is blank — tenant/project/world identity is explicit, never blank`,
    });
  }
  if (!SECRET_KINDS.includes(input.kind as SecretKind)) {
    errors.push({
      code: "unknown-secret-kind",
      message: `the secret kind '${String(input.kind)}' is outside the closed vocabulary — secrets are ${SECRET_KINDS.join(", ")} only`,
    });
  }
  if (typeof input.displayName !== "string" || input.displayName.trim().length === 0) {
    errors.push({
      code: "blank-display-name",
      message: "the secret reference's display name is blank — a handle names its secret, never blankly",
    });
  }
  errors.push(...secretCustodyPolicyErrors(input.custody));
  errors.push(...secretValueViolations(input, "the sealing input"));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const scopedInput = input;
  const reference: SecretReference = {
    secretId: secretReferenceDigestOf({
      scope: scopedInput.scope,
      kind: scopedInput.kind,
      displayName: scopedInput.displayName,
      custody: scopedInput.custody,
    }),
    kind: scopedInput.kind,
    scope: {
      tenantId: scopedInput.scope.tenantId,
      projectId: scopedInput.scope.projectId,
      worldId: scopedInput.scope.worldId,
    },
    displayName: scopedInput.displayName,
    custody: scopedInput.custody,
    provenance: {
      deriver: "seal-secret-reference",
      inputDigest: secretInputDigestOf(scopedInput),
      laws: SECURITY_PROVENANCE_LAWS,
    },
  };
  return { ok: true, reference: Object.freeze(reference) };
}

// ---------------------------------------------------------------------------
// The secret-policy violation vocabulary (the typed contract of
// services/security's `enforceSecretPolicy` — every violation typed)
// ---------------------------------------------------------------------------
export type SecretPolicyViolationCode =
  | "invalid-policy" // the policy record fails its own laws (fail-closed, loudly)
  | "invalid-reference" // the handle fails its own laws (id re-derivation etc.)
  | "cross-tenant" // R056: the handle's tenant ≠ the policy's tenant
  | "scope-mismatch" // §14: the handle's project/world disagree
  | "rotation-noncompliant" // the handle's cadence is laxer than the policy requires
  | "access-scope-violation" // the handle grants access outside the policy's allowed scopes
  | "redaction-insufficient" // the handle's redaction is below the policy's required level
  | "secret-value-detected" // THE REDACTION LAW: a secret-shaped string in the checked data
  | "duplicate-reference"; // the same handle appears twice

/** One typed secret-policy violation (fail-closed; the law named in the message). */
export interface SecretPolicyViolation {
  readonly code: SecretPolicyViolationCode;
  readonly message: string;
  /** The offending handle's id, when the violation belongs to one reference. */
  readonly secretId?: string;
}
/** The canonical violation order (secretId, then code, then message). */
export function canonicalSecretViolations(
  violations: readonly SecretPolicyViolation[],
): readonly SecretPolicyViolation[] {
  return [...violations].sort((left, right) => {
    const leftId = left.secretId ?? "";
    const rightId = right.secretId ?? "";
    if (leftId !== rightId) {
      return leftId < rightId ? -1 : 1;
    }
    if (left.code !== right.code) {
      return left.code < right.code ? -1 : 1;
    }
    return left.message < right.message ? -1 : left.message > right.message ? 1 : 0;
  });
}
