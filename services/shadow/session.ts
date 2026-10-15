/**
 * The live-mirror session (W065) — the mirror composition contract as typed
 * DATA, and its fail-closed opening gate.
 *
 * THE LIVE-MIRROR LAW (spec/ARCHITECTURE.md "Live mirror"): real
 * observations with simulated positions/execution; never live execution.
 * A LiveMirrorSession is the REAL half sealed: a W050 point-in-time VIEW
 * (carried verbatim — the world's knowable market events at the session's
 * cutoff), the market observations projected from that view (carried
 * verbatim, each re-proven through the W065 broker adapter's own
 * observation validation, each citing the view + the record it projects),
 * and the simulated trading intents (shadow orders, re-proven through the
 * adapter's own order validation). The SIMULATED half — fills, positions —
 * is the projection (./projection.ts), composed deterministically from
 * this session's carried chain. NOTHING is transmitted: there is no
 * network code in this service at all (A13/A14).
 *
 * THE POINT-IN-TIME LAW: the session's cutoff IS the sealed view's cutoff
 * (a mirror session can never widen the knowledge firewall), and an
 * observation is invisible to the session before its `availableAt` — a
 * post-cutoff observation is the LOUD `post-cutoff-observation` refusal
 * naming R016 (the W050 firewall law). The observation's timestamps are
 * proven to BE its cited event's own observation-law timestamps
 * (occurredAt / availableAt ?? occurredAt) — the projection carries the
 * world's times verbatim, never its own.
 *
 * THE ISOLATION LAW (R056 structural): session ids weigh the TENANT FIRST,
 * and a cross-tenant view-vs-session or order-vs-session pair is the LOUD
 * typed refusal (never silently composed).
 *
 * A9: content-addressed `mirror-<digest>` id, canonical record orders;
 * A14: composes typed records, never executes. License: Apache-2.0.
 */

import type { SecurityError, SecurityScope } from "security";
import { TENANT_ISOLATION_LAW, blankSecurityScopeMembers } from "security";
import { canonicalDigestHex } from "trajectory";
import type { PointInTimeCutoff, PointInTimeView, ViewRecord } from "tradrl-time-machine";
import { isLegalCutoff, validatePointInTimeView } from "tradrl-time-machine";
import type { MarketObservation, ShadowOrder } from "tradrl-adapters-broker";
import { validateMarketObservation, validateShadowOrder } from "tradrl-adapters-broker";
import { byString, scopeTuple } from "tradrl-adapters-broker";

// ---------------------------------------------------------------------------
// The record (typed DATA)
// ---------------------------------------------------------------------------

declare const mirrorSessionIdBrand: unique symbol;
/** An OPAQUE mirror-session id (`mirror-<digest>`, TENANT FIRST — R056). */
export type MirrorSessionId = string & { readonly [mirrorSessionIdBrand]: true };
export const MIRROR_SESSION_ID_PREFIX = "mirror-";

/** The mirror session's deterministic provenance record. */
export interface MirrorProvenance {
  readonly deriver: string;
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/** The canonical law list carried on every mirror record's provenance. */
export const MIRROR_PROVENANCE_LAWS: readonly string[] = [
  "spec/ARCHITECTURE.md 'Live mirror' — real observations with simulated positions/execution; never live execution",
  "spec/REQUIREMENTS.md R063 — shadow/live separation is mandatory",
  "spec/REQUIREMENTS.md R056 — tenant isolation is structural (tenant-first session ids)",
  "spec/REQUIREMENTS.md R016 — the runtime point-in-time information firewall",
  "spec/ARCHITECTURE-LOCK.md A9 — determinism",
  "spec/ARCHITECTURE-LOCK.md A14 — composes typed records, never executes",
];

/** The session declaration: what the gate takes. */
export interface LiveMirrorSessionDeclaration {
  readonly scope: SecurityScope;
  readonly cutoff: PointInTimeCutoff;
  readonly view: PointInTimeView;
  readonly observations: readonly MarketObservation[];
  readonly orders: readonly ShadowOrder[];
}

/** ONE sealed live-mirror session (immutable, content-addressed). */
export interface LiveMirrorSession {
  readonly sessionId: MirrorSessionId;
  readonly scope: SecurityScope;
  readonly cutoff: PointInTimeCutoff;
  readonly view: PointInTimeView;
  /** The observations in canonical observation-id order (A9). */
  readonly observations: readonly MarketObservation[];
  /** The orders in canonical order-id order (A9 — declaration order never leaks). */
  readonly orders: readonly ShadowOrder[];
  readonly provenance: MirrorProvenance;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type SessionErrorCode =
  | "malformed-input"
  | "invalid-scope"
  | "invalid-cutoff"
  | "view-invalid" // W050's validatePointInTimeView errors, verbatim
  | "cross-tenant-view" // R056: the view's tenant ≠ the session's
  | "view-scope-mismatch"
  | "cutoff-view-mismatch" // the session may not widen the firewall
  | "observation-invalid" // the adapter validator's errors, verbatim
  | "cross-tenant-observation" // R056
  | "observation-scope-mismatch"
  | "post-cutoff-observation" // R016: availableAt > cutoff
  | "observation-source-missing" // a mirror observation cites its view record
  | "observation-source-view-mismatch"
  | "observation-source-record-unknown"
  | "observation-source-not-market-event"
  | "observation-time-projection-mismatch" // the times are the event's own
  | "duplicate-observation"
  | "order-invalid" // the adapter validator's errors, verbatim
  | "cross-tenant-order" // R056
  | "order-scope-mismatch"
  | "post-cutoff-order" // R016: declaredAt > cutoff
  | "duplicate-order"
  | "session-id-mismatch"
  | "provenance-mismatch";

export type SessionError = SecurityError<SessionErrorCode>;

export type SessionOpenOutcome =
  | { readonly ok: true; readonly session: LiveMirrorSession }
  | { readonly ok: false; readonly errors: readonly SessionError[] };

// ---------------------------------------------------------------------------
// The canonical content + the id derivation (A9 — tenant FIRST)
// ---------------------------------------------------------------------------

/** What a session id weighs (the view id + the canonical record-id lists). */
export interface SessionCanonicalInput {
  readonly scope: SecurityScope;
  readonly cutoff: number;
  readonly viewId: string;
  readonly observationIds: readonly string[];
  readonly orderIds: readonly string[];
}

/** The session id: `mirror-<digest>` over the canonical content. */
export function mirrorSessionIdOf(input: SessionCanonicalInput): MirrorSessionId {
  const digest = canonicalDigestHex({
    cutoff: input.cutoff,
    observationIds: [...input.observationIds].sort(),
    orderIds: [...input.orderIds].sort(),
    scope: scopeTuple(input.scope),
    viewId: input.viewId,
  });
  return `${MIRROR_SESSION_ID_PREFIX}${digest}` as MirrorSessionId;
}

/** The input digest (the provenance member). */
export function sessionInputDigestOf(input: SessionCanonicalInput): string {
  return canonicalDigestHex({
    cutoff: input.cutoff,
    observationIds: [...input.observationIds].sort(),
    orderIds: [...input.orderIds].sort(),
    scope: scopeTuple(input.scope),
    viewId: input.viewId,
  });
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * THE MIRROR-SESSION GATE — fail-closed, ALL violations collected: the
 * sealed W050 view re-proven through W050's OWN `validatePointInTimeView`
 * (errors carried VERBATIM), the §14 scope laws (cross-tenant view/order/
 * observation pairs are the LOUD R056 refusals), the cutoff laws (a legal
 * simulation-axis cutoff that EQUALS the view's cutoff — the session never
 * widens the firewall), EVERY observation re-proven through the broker
 * adapter's own validator (errors verbatim) with the point-in-time law
 * (`availableAt <= cutoff`, naming R016) + the real-source laws (the
 * citation names THIS view + a REAL market-event record of it + the
 * observation's timestamps ARE that event's own observation-law
 * timestamps), and EVERY order re-proven (errors verbatim) with the
 * point-in-time law (`declaredAt <= cutoff`). Then the seal:
 * `mirror-<digest>` over the scope tuple (TENANT FIRST — R056), the
 * cutoff, the view id and the canonical record-id lists. Pure (A9);
 * A14: composes typed records — never executes, never transmits.
 */
export function openLiveMirrorSession(
  declaration: LiveMirrorSessionDeclaration,
): SessionOpenOutcome {
  if (!isRecordLike(declaration) || !isRecordLike(declaration.scope)) {
    return {
      ok: false,
      errors: [{ code: "malformed-input", message: "the session declaration is not typed data — a scope, a cutoff, a sealed view, observations and orders are required" }],
    };
  }
  const errors: SessionError[] = [];
  for (const member of blankSecurityScopeMembers(declaration.scope)) {
    errors.push({ code: "invalid-scope", message: `the session's scope '${String(member)}' is blank — tenant/project/world identity is explicit, never blank` });
  }
  if (!isLegalCutoff(declaration.cutoff)) {
    errors.push({ code: "invalid-cutoff", message: `the session's cutoff '${String(declaration.cutoff)}' is not a legal simulation-axis timestamp (declared data — A9 has no clocks)` });
  }
  const viewValidation = validatePointInTimeView(declaration.view);
  if (!viewValidation.ok) {
    errors.push({
      code: "view-invalid",
      message: `the carried W050 view failed whole-record re-validation (${String(viewValidation.errors.length)} error(s), first: ${String(viewValidation.errors[0]?.code ?? "none")}) — errors carried verbatim; the mirror session never opens over an unlawful view`,
    });
  } else {
    const viewScope = declaration.view.query.scope;
    if (viewScope.tenantId !== declaration.scope.tenantId) {
      errors.push({
        code: "cross-tenant-view",
        message: `the view's tenant '${String(viewScope.tenantId)}' is not the session's tenant '${String(declaration.scope.tenantId)}' — ${TENANT_ISOLATION_LAW} (a cross-tenant view is refused loudly, never mirrored)`,
      });
    } else if (viewScope.projectId !== declaration.scope.projectId || viewScope.worldId !== declaration.scope.worldId) {
      errors.push({ code: "view-scope-mismatch", message: "the view's project/world disagree with the session's scope — §14 scope identity is explicit and must agree" });
    }
    if (declaration.view.query.cutoff !== declaration.cutoff) {
      errors.push({
        code: "cutoff-view-mismatch",
        message: `the session's cutoff ${String(declaration.cutoff)} is not the sealed view's cutoff ${String(declaration.view.query.cutoff)} — a mirror session sees EXACTLY the view's sealed knowledge, never wider (R016)`,
      });
    }
  }
  const seenObservations = new Set<string>();
  const observations = [...(Array.isArray(declaration.observations) ? declaration.observations : [])].sort((left, right) => byString(String(left.observationId), String(right.observationId)));
  observations.forEach((observation, index) => {
    const label = { entryId: `obs#${String(index + 1)}` };
    const observationValidation = validateMarketObservation(observation);
    if (!observationValidation.ok) {
      errors.push({ code: "observation-invalid", message: `observation #${String(index + 1)} failed the broker adapter's whole-record re-validation (${String(observationValidation.errors.length)} error(s), first: ${String(observationValidation.errors[0]?.code ?? "none")}) — errors carried verbatim`, ...label });
      return;
    }
    if (seenObservations.has(String(observation.observationId))) {
      errors.push({ code: "duplicate-observation", message: `observation '${String(observation.observationId)}' appears twice — never silently deduplicated`, ...label });
    }
    seenObservations.add(String(observation.observationId));
    if (observation.scope.tenantId !== declaration.scope.tenantId) {
      errors.push({ code: "cross-tenant-observation", message: `observation '${String(observation.observationId)}' belongs to tenant '${String(observation.scope.tenantId)}', not the session's tenant '${String(declaration.scope.tenantId)}' — ${TENANT_ISOLATION_LAW}`, ...label });
      return;
    }
    if (observation.scope.projectId !== declaration.scope.projectId || observation.scope.worldId !== declaration.scope.worldId) {
      errors.push({ code: "observation-scope-mismatch", message: `observation '${String(observation.observationId)}' is outside the session's §14 scope`, ...label });
      return;
    }
    if (observation.availableAt > declaration.cutoff) {
      errors.push({
        code: "post-cutoff-observation",
        message: `observation '${String(observation.observationId)}' is available at ${String(observation.availableAt)}, after the session cutoff ${String(declaration.cutoff)} — an observation is INVISIBLE to a mirror session before its availableAt (R016, the runtime point-in-time information firewall)`,
        ...label,
      });
      return;
    }
    if (viewValidation.ok) {
      const source = observation.source;
      if (source === undefined) {
        errors.push({ code: "observation-source-missing", message: `observation '${String(observation.observationId)}' carries no source citation — a mirror session's observations are projected from ITS sealed view (the real-observations-IN law)`, ...label });
        return;
      }
      if (String(source.viewId) !== String(declaration.view.viewId)) {
        errors.push({ code: "observation-source-view-mismatch", message: `observation '${String(observation.observationId)}' cites view '${String(source.viewId)}', not the session's view '${String(declaration.view.viewId)}'`, ...label });
        return;
      }
      const cited = declaration.view.records.find((record) => String(record.recordId) === String(source.recordId));
      if (cited === undefined) {
        errors.push({ code: "observation-source-record-unknown", message: `observation '${String(observation.observationId)}' cites record '${String(source.recordId)}' which the session's view does not carry — a mirror observation projects a REAL sealed record`, ...label });
        return;
      }
      if (cited.family !== "market-event") {
        errors.push({ code: "observation-source-not-market-event", message: `observation '${String(observation.observationId)}' cites record '${String(source.recordId)}' of family '${String(cited.family)}' — market observations project the world journal's market events`, ...label });
        return;
      }
      const event = (cited as Extract<ViewRecord, { family: "market-event" }>).event;
      const eventAvailableAt = event.availableAt ?? event.occurredAt;
      if (observation.observedAt !== event.occurredAt || observation.availableAt !== eventAvailableAt) {
        errors.push({
          code: "observation-time-projection-mismatch",
          message: `observation '${String(observation.observationId)}' carries (${String(observation.observedAt)}, ${String(observation.availableAt)}) but its cited event's own observation-law timestamps are (${String(event.occurredAt)}, ${String(eventAvailableAt)}) — the projection carries the world's times verbatim, never its own`,
          ...label,
        });
      }
    }
  });
  const seenOrders = new Set<string>();
  const orders = [...(Array.isArray(declaration.orders) ? declaration.orders : [])].sort((left, right) => byString(String(left.orderId), String(right.orderId)));
  orders.forEach((order, index) => {
    const label = { entryId: `ord#${String(index + 1)}` };
    const orderValidation = validateShadowOrder(order);
    if (!orderValidation.ok) {
      errors.push({ code: "order-invalid", message: `order #${String(index + 1)} failed the broker adapter's whole-record re-validation (${String(orderValidation.errors.length)} error(s), first: ${String(orderValidation.errors[0]?.code ?? "none")}) — errors carried verbatim`, ...label });
      return;
    }
    if (seenOrders.has(String(order.orderId))) {
      errors.push({ code: "duplicate-order", message: `order '${String(order.orderId)}' appears twice — never silently deduplicated`, ...label });
    }
    seenOrders.add(String(order.orderId));
    if (order.scope.tenantId !== declaration.scope.tenantId) {
      errors.push({ code: "cross-tenant-order", message: `order '${String(order.orderId)}' belongs to tenant '${String(order.scope.tenantId)}', not the session's tenant '${String(declaration.scope.tenantId)}' — ${TENANT_ISOLATION_LAW}`, ...label });
      return;
    }
    if (order.scope.projectId !== declaration.scope.projectId || order.scope.worldId !== declaration.scope.worldId) {
      errors.push({ code: "order-scope-mismatch", message: `order '${String(order.orderId)}' is outside the session's §14 scope`, ...label });
      return;
    }
    if (order.declaredAt > declaration.cutoff) {
      errors.push({
        code: "post-cutoff-order",
        message: `order '${String(order.orderId)}' is declared at ${String(order.declaredAt)}, after the session cutoff ${String(declaration.cutoff)} — an order may not rest on knowledge the session cannot see (R016)`,
        ...label,
      });
    }
  });
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const canonical: SessionCanonicalInput = {
    scope: declaration.scope,
    cutoff: declaration.cutoff,
    viewId: String(declaration.view.viewId),
    observationIds: observations.map((observation) => String(observation.observationId)),
    orderIds: orders.map((order) => String(order.orderId)),
  };
  const session: LiveMirrorSession = {
    sessionId: mirrorSessionIdOf(canonical),
    scope: declaration.scope,
    cutoff: declaration.cutoff,
    view: declaration.view,
    observations,
    orders,
    provenance: {
      deriver: "open-live-mirror-session",
      inputDigest: sessionInputDigestOf(canonical),
      laws: MIRROR_PROVENANCE_LAWS,
    },
  };
  return { ok: true, session: Object.freeze(session) };
}
