/**
 * The operational event vocabulary (W061 `observability`) — closed kind sets,
 * typed payloads, the EXPLICIT identity scope (§14) and DECLARED timestamps.
 *
 * §14: every operational record carries its scope explicitly; the scope
 * vocabulary is W059's own closed hierarchy (`api` route scopes) — imported,
 * never re-declared. A blank/missing/extra member is a LOUD typed violation.
 * A9: event ids are content-addressed (same declaration ⇒ same id, always);
 * `declaredAt` is DECLARED DATA — never a clock read, never random, never an
 * environment probe. A14: contracts only — composes typed records; never
 * scrapes metrics, never serves, never alerts.
 *
 * Also owns the operational HEALTH and TRAFFIC descriptors — statuses and
 * counts AS DATA (no probing, no thresholding, no notification here).
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import type { ApiRouteScopeKind, ApiScopeMember } from "api";
import {
  API_ROUTE_SCOPE_KINDS,
  SCOPE_MEMBERS_OF,
} from "api";

// --- The explicit scope (§14 — shared by every operational record) ---
/**
 * The explicit identity scope. `kind` names the closed W059 hierarchy; the
 * members the kind requires MUST be present and non-blank — extra members
 * below the kind's prefix are refused (scope-member-not-permitted).
 */
export interface OpsScope {
  readonly kind: ApiRouteScopeKind;
  readonly tenantId: string;
  readonly projectId?: string;
  readonly worldId?: string;
}

/** One scope law violation (fail-closed, never silent). */
export interface OpsScopeViolation {
  readonly kind:
    | "blank-scope-member"
    | "missing-scope-member"
    | "scope-member-not-permitted"
    | "unknown-scope-kind";
  readonly member?: ApiScopeMember;
  readonly detail: string;
}

/** Validate one scope value against the §14 laws. Pure; never throws. */
export function validateOpsScope(scope: unknown): readonly OpsScopeViolation[] {
  const violations: OpsScopeViolation[] = [];
  if (typeof scope !== "object" || scope === null) {
    return [
      { kind: "unknown-scope-kind", detail: "scope is not an object" },
    ];
  }
  const candidate = scope as Record<string, unknown>;
  const kind = candidate.kind;
  if (
    typeof kind !== "string" ||
    !(API_ROUTE_SCOPE_KINDS as readonly string[]).includes(kind)
  ) {
    violations.push({
      kind: "unknown-scope-kind",
      detail: `scope kind ${JSON.stringify(kind)} is outside the closed W059 hierarchy`,
    });
    return violations;
  }
  const required = SCOPE_MEMBERS_OF[kind as ApiRouteScopeKind];
  for (const member of ["tenantId", "projectId", "worldId"] as const) {
    const value = candidate[member];
    const isRequired = (required as readonly string[]).includes(member);
    if (isRequired) {
      if (typeof value !== "string" || value.length === 0) {
        violations.push({
          kind: typeof value === "string" ? "blank-scope-member" : "missing-scope-member",
          member,
          detail: `scope member ${member} is required by scope kind ${kind} but ${typeof value === "string" ? "blank" : "absent"}`,
        });
      }
    } else if (value !== undefined) {
      violations.push({
        kind: "scope-member-not-permitted",
        member,
        detail: `scope member ${member} is present but not permitted by scope kind ${kind}`,
      });
    }
  }
  return violations;
}

/** The canonical scope content (the single id-addressed form — A9). */
export function canonicalScopeContent(scope: OpsScope): Record<string, unknown> {
  return {
    kind: scope.kind,
    tenantId: scope.tenantId,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    ...(scope.worldId === undefined ? {} : { worldId: scope.worldId }),
  };
}

// --- The actor vocabulary (who performed the audited act — declared data) ---
/** The closed actor-kind vocabulary. */
export type OpsActorKind =
  | "platform"
  | "service"
  | "tenant-operator"
  | "worker";
/** The closed actor-kind vocabulary, canonical order. */
export const OPS_ACTOR_KINDS: readonly OpsActorKind[] = [
  "platform",
  "service",
  "tenant-operator",
  "worker",
];

/** One actor: a closed kind + an opaque actor id (never parsed). */
export interface OpsActor {
  readonly kind: OpsActorKind;
  readonly actorId: string;
}
// --- The closed event-kind set + the typed payloads ---
/** The closed operational event-kind vocabulary. */
export type OpsEventKind =
  | "artifact-published"
  | "audit-appended"
  | "dataset-imported"
  | "evaluation-completed"
  | "report-composed"
  | "session-recorded"
  | "world-created"
  | "world-started"
  | "world-stopped";
/** The closed event-kind vocabulary, canonical order. */
export const OPS_EVENT_KINDS: readonly OpsEventKind[] = [
  "artifact-published",
  "audit-appended",
  "dataset-imported",
  "evaluation-completed",
  "report-composed",
  "session-recorded",
  "world-created",
  "world-started",
  "world-stopped",
];

/** The typed payload of each event kind (one member per kind — closed). */
export type OpsEventPayload =
  | {
      readonly kind: "world-created";
      readonly worldId: string;
      readonly definitionDigest: string;
      readonly seed: number;
    }
  | {
      readonly kind: "world-started";
      readonly worldId: string;
      readonly startMode: "cold" | "resumed";
    }
  | {
      readonly kind: "world-stopped";
      readonly worldId: string;
      readonly reason: string;
    }
  | {
      readonly kind: "dataset-imported";
      readonly datasetId: string;
      readonly recordCount: number;
    }
  | {
      readonly kind: "artifact-published";
      readonly artifactId: string;
      readonly datasetId: string;
      readonly recordDigest: string;
    }
  | {
      readonly kind: "session-recorded";
      readonly sessionId: string;
      readonly outcome: "aborted" | "completed" | "failed";
      readonly stepCount: number;
    }
  | {
      readonly kind: "evaluation-completed";
      readonly evaluationId: string;
      readonly score: number;
      readonly passed: boolean;
    }
  | {
      readonly kind: "report-composed";
      readonly reportId: string;
      readonly reportKind: string;
    }
  | {
      readonly kind: "audit-appended";
      readonly auditRecordId: string;
      readonly auditAction: string;
    };

// --- The operational event (immutable, content-addressed — A9) ---
declare const opsEventIdBrand: unique symbol;

/**
 * An OPAQUE content-addressed event id: `oev-<digest>` over the event's own
 * canonical content. Produced only by {@link eventIdOf}; never parsed — the
 * kind/scope/payload travel explicitly on the record.
 */
export type OpsEventId = string & { readonly [opsEventIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const OPS_EVENT_ID_PREFIX = "oev-";

/**
 * One operational event: DECLARED DATA. `sequence` is the stream's own
 * strictly-increasing integer order; `declaredAt` is a declared timestamp
 * (integer ms the caller carries — A9: never a clock read).
 */
export interface OperationalEvent {
  readonly eventId: OpsEventId;
  readonly sequence: number;
  readonly kind: OpsEventKind;
  readonly scope: OpsScope;
  readonly actor: OpsActor;
  readonly payload: OpsEventPayload;
  readonly declaredAt: number;
}

/** The canonical content an event id addresses (every law-bearing member). */
export function canonicalEventContent(
  event: Omit<OperationalEvent, "eventId">,
): Record<string, unknown> {
  return {
    actor: event.actor,
    declaredAt: event.declaredAt,
    kind: event.kind,
    payload: event.payload,
    scope: canonicalScopeContent(event.scope),
    sequence: event.sequence,
  };
}

/**
 * The content-addressed event id: `oev-<digest>` over the canonical content.
 * Pure and deterministic — the same declaration always mints the same id.
 */
export function eventIdOf(
  event: Omit<OperationalEvent, "eventId">,
): OpsEventId {
  const digest = canonicalDigestHex(canonicalEventContent(event));
  return `${OPS_EVENT_ID_PREFIX}${digest}` as OpsEventId;
}

// --- The construction gate (fail-closed) ---
/** Every law an event declaration can violate (closed set). */
export type OpsEventViolation =
  | OpsScopeViolation
  | {
      readonly kind:
        | "unknown-event-kind"
        | "unknown-actor-kind"
        | "blank-actor-id"
        | "payload-kind-mismatch"
        | "payload-field-invalid"
        | "non-integer-sequence"
        | "non-positive-sequence"
        | "non-integer-timestamp"
        | "negative-timestamp"
        | "id-mismatch";
      readonly detail: string;
    };

/** The outcome of the event construction gate. */
export type MintEventOutcome =
  | { readonly ok: true; readonly event: OperationalEvent }
  | { readonly ok: false; readonly violations: readonly OpsEventViolation[] };

const INTEGER_PAYW = new Set(["recordCount", "stepCount", "score", "seed"]);

/**
 * The fail-closed construction gate: validates every law, then mints the
 * content-addressed id. A declaration that violates ANY law is refused with
 * the COMPLETE violation list — never partially constructed.
 */
export function mintOperationalEvent(
  declaration: Omit<OperationalEvent, "eventId">,
): MintEventOutcome {
  const violations: OpsEventViolation[] = [];
  if (
    typeof declaration.kind !== "string" ||
    !(OPS_EVENT_KINDS as readonly string[]).includes(declaration.kind)
  ) {
    violations.push({
      kind: "unknown-event-kind",
      detail: `event kind ${JSON.stringify(declaration.kind)} is outside the closed vocabulary`,
    });
  }
  const scopeViolations = validateOpsScope(declaration.scope);
  violations.push(...scopeViolations);
  if (typeof declaration.actor?.kind !== "string" || !(OPS_ACTOR_KINDS as readonly string[]).includes(declaration.actor?.kind)) {
    violations.push({
      kind: "unknown-actor-kind",
      detail: `actor kind ${JSON.stringify(declaration.actor?.kind)} is outside the closed vocabulary`,
    });
  }
  if (typeof declaration.actor?.actorId !== "string" || declaration.actor.actorId.length === 0) {
    violations.push({ kind: "blank-actor-id", detail: "actor id is blank" });
  }
  if (typeof declaration.sequence !== "number" || !Number.isSafeInteger(declaration.sequence)) {
    violations.push({ kind: "non-integer-sequence", detail: "sequence is not a safe integer" });
  } else if (declaration.sequence < 1) {
    violations.push({ kind: "non-positive-sequence", detail: `sequence ${String(declaration.sequence)} is below 1` });
  }
  if (typeof declaration.declaredAt !== "number" || !Number.isSafeInteger(declaration.declaredAt)) {
    violations.push({ kind: "non-integer-timestamp", detail: "declaredAt is not a safe integer" });
  } else if (declaration.declaredAt < 0) {
    violations.push({ kind: "negative-timestamp", detail: `declaredAt ${String(declaration.declaredAt)} is negative` });
  }
  if (
    typeof declaration.payload !== "object" ||
    declaration.payload === null ||
    (declaration.payload as { kind?: unknown }).kind !== declaration.kind
  ) {
    violations.push({
      kind: "payload-kind-mismatch",
      detail: `payload does not carry the event's own kind ${JSON.stringify(declaration.kind)}`,
    });
  } else {
    const payload = declaration.payload as Record<string, unknown>;
    for (const [key, value] of Object.entries(payload)) {
      if (key === "kind") continue;
      const expectsInteger = INTEGER_PAYW.has(key);
      if (expectsInteger && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
        violations.push({
          kind: "payload-field-invalid",
          detail: `payload field ${key} must be a non-negative safe integer`,
        });
      } else if (!expectsInteger && typeof value !== "string") {
        violations.push({
          kind: "payload-field-invalid",
          detail: `payload field ${key} must be a non-empty string`,
        });
      } else if (!expectsInteger && (value as string).length === 0) {
        violations.push({
          kind: "payload-field-invalid",
          detail: `payload field ${key} must be a non-empty string`,
        });
      }
    }
  }
  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return { ok: true, event: { ...declaration, eventId: eventIdOf(declaration) } };
}

// --- Health + traffic descriptors (statuses and counts AS DATA) ---
/** The closed operational health-status vocabulary. */
export type OpsHealthStatus = "healthy" | "degraded" | "down";
/** The closed health-status vocabulary, canonical order. */
export const OPS_HEALTH_STATUSES: readonly OpsHealthStatus[] = [
  "degraded",
  "down",
  "healthy",
];

/**
 * One health descriptor: a DECLARED status for an explicit scope, checked at
 * a declared time. Data only — no probe ran here, no alert fires from here.
 */
export interface HealthDescriptor {
  readonly descriptorId: string;
  readonly scope: OpsScope;
  readonly status: OpsHealthStatus;
  readonly checkedAt: number;
  readonly notes: readonly string[];
}

/** One traffic descriptor: declared counts over a declared window (data). */
export interface TrafficDescriptor {
  readonly descriptorId: string;
  readonly scope: OpsScope;
  readonly windowFromMs: number;
  readonly windowToMs: number;
  readonly eventCount: number;
  readonly auditRecordCount: number;
}

/** The content-addressed descriptor id: `opsd-<digest>` (A9). */
export function descriptorIdOf(descriptor: {
  readonly scope: OpsScope;
  readonly kind: "health" | "traffic";
  readonly content: Record<string, unknown>;
}): string {
  const digest = canonicalDigestHex({
    content: descriptor.content,
    kind: descriptor.kind,
    scope: canonicalScopeContent(descriptor.scope),
  });
  return `opsd-${digest}`;
}
