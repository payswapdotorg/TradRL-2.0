/**
 * The cross-record isolation proof (W060) — `proveIsolation`, THE PURE
 * MACHINERY over the tenant-isolation proof vocabulary
 * (`packages/security`): may THIS set of §14-scoped records be called
 * isolated?
 *
 * Every record's explicit tenant/project/world scope is checked against
 * the proof's CANONICAL REFERENCE SCOPE (the canonically-first
 * well-scoped record's scope — deterministic, never the input's order):
 * a TENANT disagreement is the LOUD typed `cross-tenant` finding naming
 * R056 (the W054 law, generalized); a project/world disagreement is a
 * `scope-mismatch` finding naming §14; an implicit or absent scope is an
 * `implicit-scope` finding (§14 never defaults); a non-record entry or a
 * blank record id is a `malformed-record` finding; a repeated record id
 * is a `duplicate-record` finding. ALL findings are collected (none
 * silently dropped), carried in canonical order, and the proof is sealed
 * as the content-addressed `iso-<digest>` id over the canonical content —
 * A9: the same set of records always yields the SAME proof, whatever the
 * input's order.
 *
 * Fail-closed: a non-array input is refused loudly (`malformed-input`);
 * an EMPTY record set is refused loudly (`empty-record-set`) — nothing is
 * proven vacuously here.
 *
 * Adapters: `knowledgeRecordEvidence` (a W054 memory KnowledgeRecord —
 * the isolation law's FIRST instance) and `brainEvidence` (a W054 brain
 * generation) wrap real §14-scoped records into the evidence envelope.
 *
 * A14: composes typed proofs — never authenticates, never decrypts, never
 * executes. Pure: no I/O, no clocks, no randomness, no env reads.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { KnowledgeRecord } from "memory";
import type { FirmBrain } from "firm-brain";
import type {
  IsolationEvidenceRecord,
  IsolationFinding,
  IsolationProof,
  SecurityScope,
} from "security";
import {
  SECURITY_PROVENANCE_LAWS,
  SECURITY_SCOPE_MEMBERS,
  TENANT_ISOLATION_LAW,
  canonicalIsolationFindings,
  isolationInputDigestOf,
  isolationProofDigestOf,
  isolationRecordShapeErrors,
} from "security";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The typed gate errors of the proof mint (fail-closed; law named). */
export type IsolationMintErrorCode = "malformed-input" | "empty-record-set";
export interface IsolationMintError {
  readonly code: IsolationMintErrorCode;
  readonly message: string;
}
export type IsolationProofOutcome =
  | { readonly ok: true; readonly proof: IsolationProof }
  | { readonly ok: false; readonly errors: readonly IsolationMintError[] };

/** Wrap a W054 memory KnowledgeRecord — the isolation law's FIRST
 * instance — into the evidence envelope (the record's own id + §14 scope,
 * carried verbatim; the payload never participates). */
export function knowledgeRecordEvidence(record: KnowledgeRecord): IsolationEvidenceRecord {
  return {
    recordId: String(record.recordId),
    scope: record.scope,
    kind: "knowledge-record",
  };
}
/** Wrap a W054 brain generation into the evidence envelope. */
export function brainEvidence(brain: FirmBrain): IsolationEvidenceRecord {
  return {
    recordId: String(brain.brainId),
    scope: brain.scope,
    kind: "firm-brain",
  };
}

interface CandidateRecord {
  readonly recordId: string;
  readonly scope: SecurityScope;
  readonly kind?: string;
}

/** THE CROSS-RECORD PROOF. Deterministic (A9) and fail-closed: the
 * canonical reference scope is the canonically-first well-scoped record's
 * scope; every other well-scoped record is proven against it; every
 * ill-scoped entry yields its own typed finding. The proof carries the
 * findings as DATA — `isolated` is true only when there are none. */
export function proveIsolation(records: unknown): IsolationProofOutcome {
  if (!Array.isArray(records)) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed-input",
          message: "the isolation input is not a record set — an array of §14-scoped records is required (fail-closed)",
        },
      ],
    };
  }
  if (records.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "empty-record-set",
          message: "the isolation input is empty — nothing is proven vacuously here (fail-closed); an isolation proof checks at least one record",
        },
      ],
    };
  }

  const findings: IsolationFinding[] = [];
  const candidates: CandidateRecord[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of records.entries()) {
    if (isRecordLike(entry) && typeof entry.recordId === "string" && entry.recordId.trim().length > 0) {
      const recordId = entry.recordId;
      if (seen.has(recordId)) {
        findings.push({
          code: "duplicate-record",
          recordId,
          message: `the record '${recordId}' appears more than once — identity is exact, a proof never double-counts a record`,
        });
      }
      seen.add(recordId);
    }
    const shapeErrors = isolationRecordShapeErrors(entry);
    if (shapeErrors.length > 0) {
      for (const shapeError of shapeErrors) {
        findings.push({
          code: shapeError.code,
          recordId:
            isRecordLike(entry) && typeof entry.recordId === "string" && entry.recordId.trim().length > 0
              ? entry.recordId
              : `#${String(index)}`,
          message: shapeError.message,
        });
      }
      continue;
    }
    const record = entry as unknown as IsolationEvidenceRecord;
    candidates.push({
      recordId: record.recordId,
      scope: record.scope,
      kind: record.kind,
    });
  }

  // The CANONICAL reference scope: the canonically-first well-scoped
  // record's own scope (A9 — never the input's order).
  let reference: CandidateRecord | undefined;
  for (const candidate of candidates) {
    if (reference === undefined || candidate.recordId < reference.recordId) {
      reference = candidate;
    }
  }

  for (const candidate of candidates) {
    if (candidate === reference) {
      continue;
    }
    const label = candidate.kind === undefined ? "" : ` ${candidate.kind} `;
    if (String(candidate.scope.tenantId) !== String(reference?.scope.tenantId)) {
      findings.push({
        code: "cross-tenant",
        recordId: candidate.recordId,
        message: `the${label}record '${candidate.recordId}' carries tenant '${String(candidate.scope.tenantId)}' but the proof's reference scope carries tenant '${String(reference?.scope.tenantId)}' — tenant isolation is the law (${TENANT_ISOLATION_LAW}); a cross-tenant record is a loud typed finding, never a silent pass`,
      });
      continue;
    }
    for (const member of SECURITY_SCOPE_MEMBERS) {
      if (member === "tenantId") {
        continue;
      }
      if (String(candidate.scope[member]) !== String(reference?.scope[member])) {
        findings.push({
          code: "scope-mismatch",
          recordId: candidate.recordId,
          message: `the${label}record '${candidate.recordId}' carries '${member}' '${String(candidate.scope[member])}' but the proof's reference scope carries '${String(reference?.scope[member])}' — tenant/project/world identity is explicit and must agree (spec/ARCHITECTURE-LOCK.md §14)`,
        });
      }
    }
  }

  const ordered = canonicalIsolationFindings(findings);
  const scope = reference === undefined ? undefined : reference.scope;
  const proof: IsolationProof = {
    proofId: isolationProofDigestOf({ scope, checked: records.length, findings: ordered }),
    scope,
    checked: records.length,
    findings: ordered,
    isolated: ordered.length === 0,
    provenance: {
      deriver: "prove-isolation",
      inputDigest: isolationInputDigestOf(scope, records.length),
      laws: SECURITY_PROVENANCE_LAWS,
    },
  };
  return { ok: true, proof: Object.freeze(proof) };
}
