/**
 * The mirror audit (W065) — every auditable step of a mirror session emits
 * W061 audit vocabulary events, TYPED, through packages/observability's OWN
 * contracts, and the session trail is assembled + verified through
 * services/operations' OWN trail laws.
 *
 * The steps audited (all DECLARED DATA — `declaredAt` is the session's own
 * carried cutoff, never a clock read; sequences are the trail's 1..n axis):
 * 1. `world-accessed` — the session read the sealed W050 view (the real
 *    observations IN; subject = the view's opaque id);
 * 2. `record-written` — the session record itself (subject = the session
 *    id), carrying the order/observation counts as data;
 * 3. `report-composed` — the projection (subject = the projection id),
 *    carrying the fill/position counts as data.
 * Each record is minted through `mintAuditRecord` (the W061 fail-closed
 * gate — §14 scope, the closed action set, the W028 provenance citation
 * law), the operational event through `mintOperationalEvent` (the W061
 * event vocabulary — `session-recorded`), the trail through operations'
 * `assembleTrail` (canonical sequence order, ONE scope, contiguous
 * lineage), and finally verified through operations' `verifyTrail` — a
 * trail that fails end-to-end verification is a LOUD typed refusal, never
 * returned.
 *
 * DISCLOSED: the audit records' W028 provenance is the HONEST
 * `no-declared-source` marker — the mirror session's own source chain is
 * the sealed W050 view + the broker adapter's records, not a W027
 * information dataset import (the closed W028 union carries no member for
 * that; the honest none marker is the lawful citation, named in the
 * record).
 *
 * A9: deterministic — the same session + projection always mint the same
 * records, the same event, the same trail. A14: composes typed records.
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { AuditRecord, AuditRecordViolation, AuditTrail, OperationalEvent } from "observability";
import { mintAuditRecord, mintOperationalEvent } from "observability";
import type { TrailAssemblyViolation } from "operations";
import { assembleTrail, verifyTrail } from "operations";
import type { LiveMirrorSession } from "./session.js";
import type { MirrorProjection } from "./projection.js";

// ---------------------------------------------------------------------------
// The typed outcome (fail-closed — W061/W061-service errors carried)
// ---------------------------------------------------------------------------

export type MirrorAuditErrorCode =
  | "malformed-input"
  | "record-unmintable" // the W061 mint gate's violations, verbatim
  | "event-unmintable" // the W061 event gate's violations, verbatim
  | "trail-unassemblable" // operations' assembly violations, verbatim
  | "trail-unverifiable"; // operations' end-to-end verification failed

export interface MirrorAuditError {
  readonly code: MirrorAuditErrorCode;
  readonly message: string;
}

export type MirrorAuditOutcome =
  | { readonly ok: true; readonly event: OperationalEvent; readonly trail: AuditTrail }
  | { readonly ok: false; readonly errors: readonly MirrorAuditError[] };

// ---------------------------------------------------------------------------
// The audit-step minting (through W061's OWN gates)
// ---------------------------------------------------------------------------

const HONEST_NONE_PROVENANCE = { kind: "none", reason: "no-declared-source" } as const;

function auditDeclaration(
  sequence: number,
  action: "record-written" | "report-composed" | "world-accessed",
  scope: LiveMirrorSession["scope"],
  subject: string,
  detail: Record<string, unknown>,
  declaredAt: number,
): Omit<AuditRecord, "recordId"> {
  return {
    sequence,
    action,
    scope: {
      kind: "tenant-project-world",
      tenantId: scope.tenantId,
      projectId: scope.projectId,
      worldId: scope.worldId,
    },
    actor: { kind: "service", actorId: "shadow-mirror" },
    subject,
    detail,
    provenance: HONEST_NONE_PROVENANCE,
    declaredAt,
  };
}

/**
 * Mint the mirror session's audit trail — every auditable step as a TYPED
 * W061 audit record (world-accessed / record-written / report-composed),
 * one W061 operational event (`session-recorded`), the trail assembled
 * through operations' `assembleTrail` and VERIFIED end-to-end through
 * operations' `verifyTrail`. Every intermediate gate's violations are
 * carried VERBATIM; a trail that fails verification is refused loudly.
 * Pure (A9): the same session + projection always mint the same trail.
 */
export function mirrorSessionAudit(
  session: LiveMirrorSession,
  projection: MirrorProjection,
): MirrorAuditOutcome {
  if (typeof session !== "object" || session === null || typeof projection !== "object" || projection === null) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the session and the projection are required typed records" }] };
  }
  const errors: MirrorAuditError[] = [];
  const declaredAt = session.cutoff;
  const declarations = [
    auditDeclaration(1, "world-accessed", session.scope, String(session.view.viewId), {
      cutoff: session.cutoff,
      observationCount: session.observations.length,
      sessionId: String(session.sessionId),
    }, declaredAt),
    auditDeclaration(2, "record-written", session.scope, String(session.sessionId), {
      observationCount: session.observations.length,
      orderCount: session.orders.length,
    }, declaredAt),
    auditDeclaration(3, "report-composed", session.scope, String(projection.projectionId), {
      fillCount: projection.fills.length,
      positionCount: projection.positions.length,
    }, declaredAt),
  ];
  const records: AuditRecord[] = [];
  declarations.forEach((declaration, index) => {
    const minted = mintAuditRecord(declaration);
    if (!minted.ok) {
      errors.push({
        code: "record-unmintable",
        message: `audit step #${String(index + 1)} was refused by W061's own mintAuditRecord gate (${String(minted.violations.length)} violation(s), first: ${String(minted.violations[0]?.kind ?? "none")}) — violations carried verbatim`,
      });
      return;
    }
    records.push(minted.record);
  });
  const eventDeclaration: Omit<OperationalEvent, "eventId"> = {
    sequence: 1,
    kind: "session-recorded",
    scope: {
      kind: "tenant-project-world",
      tenantId: session.scope.tenantId,
      projectId: session.scope.projectId,
      worldId: session.scope.worldId,
    },
    actor: { kind: "service", actorId: "shadow-mirror" },
    payload: {
      kind: "session-recorded",
      sessionId: String(session.sessionId),
      outcome: "completed",
      stepCount: session.orders.length,
    },
    declaredAt,
  };
  let operationalEvent: OperationalEvent | undefined;
  const eventOutcome = mintOperationalEvent(eventDeclaration);
  if (eventOutcome.ok) {
    operationalEvent = eventOutcome.event;
  } else {
    errors.push({
      code: "event-unmintable",
      message: `the session-recorded event was refused by W061's own mintOperationalEvent gate (${String(eventOutcome.violations.length)} violation(s), first: ${String(eventOutcome.violations[0]?.kind ?? "none")}) — violations carried verbatim`,
    });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (operationalEvent === undefined) {
    // Unreachable: the mint gate's failure returned above; fail-closed regardless.
    return { ok: false, errors: [{ code: "event-unmintable", message: "the session-recorded event was not minted — fail-closed" }] };
  }
  const assembled = assembleTrail(records);
  if (!assembled.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "trail-unassemblable",
          message: `the audit trail was refused by operations' own assembleTrail gate (${String(assembled.violations.length)} violation(s), first: ${String(assembled.violations[0]?.kind ?? "none")}) — violations carried verbatim`,
        },
      ],
    };
  }
  const verification = verifyTrail(assembled.trail);
  if (!verification.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "trail-unverifiable",
          message: `the assembled trail failed operations' end-to-end verification (${verification.kind}: ${verification.detail}) — a mirror trail that cannot be verified is refused loudly, never returned`,
        },
      ],
    };
  }
  return { ok: true, event: operationalEvent, trail: assembled.trail };
}

export type { AuditRecordViolation, TrailAssemblyViolation };
