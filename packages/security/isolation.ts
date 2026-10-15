/**
 * The tenant-isolation proof vocabulary (W060) — THE R056 GENERALIZATION,
 * as typed DATA.
 *
 * The chain: W054 enforced R056 on ONE knowledge record at a time (the
 * record's declared scope vs its payload's own scope — the law's first
 * instance, `packages/memory`); W058 enforced it on grants (the tenant is
 * part of the entitlement's canonical identity); W059 made the §14 scope
 * explicit on every route. THIS module is the generalization: the
 * vocabulary of CROSS-RECORD isolation proofs — a typed proof record that
 * a set of §14-scoped records is isolated (every record carries an
 * explicit tenant/project/world scope, every scope agrees with the proof's
 * canonical reference scope), every mismatch a TYPED finding, never a
 * silent pass.
 *
 * The PROOF LAWS (the vocabulary this module owns):
 * - scope explicit — a record whose §14 scope is missing or blank yields
 *   an `implicit-scope` finding (§14 never defaults);
 * - mismatch findings typed — a tenant disagreement is the LOUD
 *   `cross-tenant` finding naming R056; project/world disagreements are
 *   `scope-mismatch` findings;
 * - canonical order — findings are carried in canonical (recordId, code,
 *   message) order and the proof id is content-addressed over the
 *   canonically ordered content, so the same set of records always yields
 *   the SAME proof (A9: input order never leaks);
 * - fail-closed — the proof is data; MINTING it (every record checked) is
 *   `proveIsolation` in services/security, and whole-record re-validation
 *   is `validateIsolationProof` in ./validate.ts.
 *
 * Laws: spec/REQUIREMENTS.md R056 ("Firm Brain is tenant isolated",
 * generalized to every §14-scoped record); spec/ARCHITECTURE-LOCK.md §14
 * (tenant/project/world identity explicit in persistence and transport);
 * A9 (same inputs ⇒ deep-equal proof, same canonical id; no clocks, no
 * randomness, no env reads); A14 (typed contracts — this package never
 * authenticates, never decrypts, never executes).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import type { KnowledgeScope } from "memory";

/** R056 — THE tenant-isolation law (generalized beyond the firm brain). */
export const TENANT_ISOLATION_LAW = "spec/REQUIREMENTS.md R056" as const;
/** §14 — explicit tenant/project/world identity in persistence + transport. */
export const EXPLICIT_SCOPE_LAW = "spec/ARCHITECTURE-LOCK.md §14" as const;
/** THE REDACTION LAW — no secret VALUE in any record, type, or test. */
export const REDACTION_LAW =
  "THE REDACTION LAW — no secret VALUE in any record, type, or test; typed handles only (the push-protection lesson made structural)" as const;
/** A9 — determinism: same inputs ⇒ deep-equal records, same canonical ids. */
export const DETERMINISM_LAW = "spec/ARCHITECTURE-LOCK.md A9" as const;
/** A14 — composes typed contracts; never authenticates, never decrypts, never executes. */
export const COMPOSITION_LAW = "spec/ARCHITECTURE-LOCK.md A14" as const;
/** The canonical law list carried on every security record's provenance. */
export const SECURITY_PROVENANCE_LAWS: readonly string[] = [
  TENANT_ISOLATION_LAW,
  EXPLICIT_SCOPE_LAW,
  REDACTION_LAW,
  DETERMINISM_LAW,
  COMPOSITION_LAW,
];

/**
 * The explicit §14 identity scope every security record carries — the W054
 * `KnowledgeScope` generalized beyond knowledge records (R056's domain is
 * every record the firm persists or transports, not only knowledge).
 */
export type SecurityScope = KnowledgeScope;
/** The scope members, in canonical order (validation + digest order). */
export const SECURITY_SCOPE_MEMBERS: readonly (keyof SecurityScope)[] = [
  "tenantId",
  "projectId",
  "worldId",
];
/** The blank scope members (the fail-closed identity gate's offender list). */
export function blankSecurityScopeMembers(
  scope: SecurityScope,
): readonly (keyof SecurityScope)[] {
  return SECURITY_SCOPE_MEMBERS.filter(
    (member) => String(scope[member]).trim().length === 0,
  );
}
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function blank(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

/** One typed security-contract error (fail-closed; the law named in the message). */
export interface SecurityError<C extends string = string> {
  readonly code: C;
  readonly message: string;
  /** The offending record/source id, when the error belongs to one entry. */
  readonly entryId?: string;
}

/** The closed deriver vocabulary of the security provenance records. */
export const SECURITY_DERIVERS = [
  "prove-isolation",
  "seal-secret-reference",
  "declare-security-policy",
] as const;
export type SecurityDeriver = (typeof SECURITY_DERIVERS)[number];
/** The deterministic provenance record (carried as data, re-derivable). */
export interface SecurityProvenance {
  readonly deriver: SecurityDeriver;
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/** One §14-scoped record as the isolation proof sees it — the envelope ANY
 * explicitly-scoped record satisfies structurally (a W054 KnowledgeRecord,
 * a W054 brain generation adapted by its caller, …). The record's identity
 * and scope are the proof's ONLY inputs — payloads are never re-scored
 * (A14). */
export interface IsolationEvidenceRecord {
  readonly recordId: string;
  readonly scope: SecurityScope;
  /** The record's family, when the caller declares it (finding messages cite it). */
  readonly kind?: string;
}

/** The typed findings of an isolation proof (closed set, canonical order). */
export type IsolationFindingCode =
  | "malformed-record" // not typed data / no record identity
  | "implicit-scope" // a §14 scope member is absent or blank (§14 never defaults)
  | "cross-tenant" // R056: the record's tenant ≠ the proof's reference tenant
  | "scope-mismatch" // §14: the record's project/world disagree
  | "duplicate-record"; // the same record id appears twice
/** One typed isolation finding (fail-closed; the law named in the message). */
export interface IsolationFinding {
  readonly code: IsolationFindingCode;
  readonly recordId: string;
  readonly message: string;
}

declare const isolationProofIdBrand: unique symbol;
/** An OPAQUE isolation-proof id (a canonical digest rendering). Produced
 * only by the proof mint / {@link isolationProofDigestOf}; never parsed. */
export type IsolationProofId = string & {
  readonly [isolationProofIdBrand]: true;
};
/** The id prefix (a rendering convention, never a parse target). */
export const ISOLATION_PROOF_ID_PREFIX = "iso-";

/** ONE isolation proof: the canonical reference scope every checked record
 * was proven against, the checked count, the typed findings in canonical
 * order, the isolation verdict. Typed DATA — the proof is re-validatable
 * from its own carried bytes alone (`validateIsolationProof`). */
export interface IsolationProof {
  readonly proofId: IsolationProofId;
  /** The canonical reference scope (the canonically-first well-scoped
   * record's scope); undefined when NO checked record carries one. */
  readonly scope: SecurityScope | undefined;
  readonly checked: number;
  readonly findings: readonly IsolationFinding[];
  readonly isolated: boolean;
  readonly provenance: SecurityProvenance;
}

/** The canonical findings order (recordId, then code, then message) —
 * A9: the proof's bytes never depend on the input's order. */
export function canonicalIsolationFindings(
  findings: readonly IsolationFinding[],
): readonly IsolationFinding[] {
  return [...findings].sort((left, right) => {
    if (left.recordId !== right.recordId) {
      return left.recordId < right.recordId ? -1 : 1;
    }
    if (left.code !== right.code) {
      return left.code < right.code ? -1 : 1;
    }
    return left.message < right.message ? -1 : left.message > right.message ? 1 : 0;
  });
}

/** The canonical content a proof id addresses: the reference scope as an
 * ORDERED TUPLE with the TENANT FIRST (R056 structural), the checked count,
 * and the findings in canonical order. */
export function isolationCanonicalContent(
  scope: SecurityScope | undefined,
  checked: number,
  findings: readonly IsolationFinding[],
): unknown {
  return {
    checked,
    findings: canonicalIsolationFindings(findings).map((finding) => [
      finding.code,
      finding.recordId,
      finding.message,
    ]),
    scope: scope === undefined ? null : [scope.tenantId, scope.projectId, scope.worldId],
  };
}
/** The isolation-proof id: `iso-<digest>` over the canonical content.
 * Pure and deterministic (A9). */
export function isolationProofDigestOf(
  proof: Pick<IsolationProof, "scope" | "checked" | "findings">,
): IsolationProofId {
  const digest = canonicalDigestHex(
    isolationCanonicalContent(proof.scope, proof.checked, proof.findings),
  );
  return `${ISOLATION_PROOF_ID_PREFIX}${digest}` as IsolationProofId;
}
/** The proof's input digest (the provenance member): the reference scope +
 * the checked count — the findings are the proof's own derivations. */
export function isolationInputDigestOf(
  scope: SecurityScope | undefined,
  checked: number,
): string {
  return canonicalDigestHex({
    checked,
    scope: scope === undefined ? null : [scope.tenantId, scope.projectId, scope.worldId],
  });
}

/** The scope-shape errors of one evidence record (shared by the proof mint
 * and the re-validator): a record that is not typed data, carries no
 * identity, or carries an implicit scope is NEVER silently skipped. */
export function isolationRecordShapeErrors(
  record: unknown,
): readonly SecurityError<"malformed-record" | "implicit-scope">[] {
  if (!isRecordLike(record)) {
    return [
      {
        code: "malformed-record",
        message: "the evidence entry is not typed data — a record id and an explicit §14 scope are required",
      },
    ];
  }
  if (blank(record.recordId)) {
    return [
      {
        code: "malformed-record",
        message: "the evidence entry carries a blank record id — the identity is explicit, never blank",
      },
    ];
  }
  const scope = record.scope;
  if (!isRecordLike(scope)) {
    return [
      {
        code: "implicit-scope",
        message: `the record '${String(record.recordId)}' carries no explicit §14 scope — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW}), never defaulted`,
        entryId: String(record.recordId),
      },
    ];
  }
  const blankMembers = SECURITY_SCOPE_MEMBERS.filter(
    (member) => blank((scope as Record<string, unknown>)[member]),
  );
  if (blankMembers.length > 0) {
    return [
      {
        code: "implicit-scope",
        message: `the record '${String(record.recordId)}' carries an implicit §14 scope (blank: ${blankMembers.join(", ")}) — tenant/project/world identity is explicit (${EXPLICIT_SCOPE_LAW}), never blank`,
        entryId: String(record.recordId),
      },
    ];
  }
  return [];
}
