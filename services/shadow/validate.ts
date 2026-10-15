/**
 * Whole-record re-validation (W065) — the mirror session and the mirror
 * projection proven AGAIN from their own carried bytes alone: the
 * content-addressed ids RE-DERIVED (A9 — a rewrite is caught loudly), the
 * sealed W050 view re-proven through W050's OWN validator, every carried
 * observation/order re-proven through the broker adapter's OWN validators
 * (errors carried verbatim), the point-in-time laws re-proven (R016), the
 * projection's fills re-proven through the adapter's fill validator, and
 * the positions re-derived decimal-exact (a tampered position is caught by
 * the derivation itself). Fail-closed: every violation collected, none
 * silently repaired. Pure — no I/O, no clocks, no env reads (A14).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { SecurityError } from "security";
import { secretValueViolations } from "security";
import type { PointInTimeView } from "tradrl-time-machine";
import { validatePointInTimeView } from "tradrl-time-machine";
import type { MarketObservation, ShadowFill, ShadowOrder } from "tradrl-adapters-broker";
import { validateMarketObservation, validateShadowFill, validateShadowOrder } from "tradrl-adapters-broker";
import { byString } from "tradrl-adapters-broker";
import type { MirrorPosition, MirrorProjection } from "./projection.js";
import { derivePositions, mirrorProjectionIdOf, projectionInputDigestOf } from "./projection.js";
import type { LiveMirrorSession, SessionError } from "./session.js";
import { MIRROR_PROVENANCE_LAWS, mirrorSessionIdOf, sessionInputDigestOf } from "./session.js";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The unified whole-record re-validation error vocabulary. */
export type MirrorValidationErrorCode =
  | SessionError["code"]
  | "non-canonical-order"
  | "position-derivation-mismatch"
  | "projection-id-mismatch"
  | "secret-value-refused";

export type MirrorValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SecurityError<MirrorValidationErrorCode>[] };

function provenanceErrors(
  provenance: unknown,
  deriver: string,
  expectedDigest: string,
): SecurityError<MirrorValidationErrorCode>[] {
  if (!isRecordLike(provenance)) {
    return [{ code: "provenance-mismatch", message: "the record carries no provenance — mirror records are deterministic data (A9)" }];
  }
  const errors: SecurityError<MirrorValidationErrorCode>[] = [];
  if (provenance.deriver !== deriver) {
    errors.push({ code: "provenance-mismatch", message: `the provenance's deriver '${String(provenance.deriver)}' is not '${deriver}'` });
  }
  if (String(provenance.inputDigest) !== expectedDigest) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's input digest does not re-derive from the record's own carried bytes (A9)" });
  }
  const laws = provenance.laws;
  if (!Array.isArray(laws) || laws.length !== MIRROR_PROVENANCE_LAWS.length || laws.some((law, index) => String(law) !== String(MIRROR_PROVENANCE_LAWS[index]))) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's law list does not carry the mirror layer's canonical laws" });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The session re-proof
// ---------------------------------------------------------------------------

/** Re-validate one live-mirror session from its carried bytes alone. */
export function validateLiveMirrorSession(session: unknown): MirrorValidation {
  if (!isRecordLike(session)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the session is not typed data — a live-mirror session record is required" }] };
  }
  const record = session as unknown as LiveMirrorSession;
  const errors: SecurityError<MirrorValidationErrorCode>[] = [];
  const observations = Array.isArray(record.observations) ? record.observations : [];
  const orders = Array.isArray(record.orders) ? record.orders : [];
  const canonical = {
    scope: record.scope ?? { tenantId: "", projectId: "", worldId: "" },
    cutoff: typeof record.cutoff === "number" ? record.cutoff : -1,
    viewId: String((record.view as PointInTimeView | undefined)?.viewId ?? ""),
    observationIds: observations.map((observation) => String((observation as MarketObservation).observationId ?? "")),
    orderIds: orders.map((order) => String((order as ShadowOrder).orderId ?? "")),
  };
  const id = mirrorSessionIdOf(canonical);
  if (String(record.sessionId) !== String(id)) {
    errors.push({ code: "session-id-mismatch", message: `the session id '${String(record.sessionId)}' does not re-derive from its carried bytes (expected '${String(id)}') — a rewrite is caught here (A9)` });
  }
  const viewValidation = validatePointInTimeView(record.view);
  if (!viewValidation.ok) {
    errors.push({
      code: "view-invalid",
      message: `the carried W050 view failed whole-record re-validation (${String(viewValidation.errors.length)} error(s), first: ${String(viewValidation.errors[0]?.code ?? "none")}) — errors carried verbatim`,
    });
  } else {
    const viewScope = record.view.query.scope;
    if (viewScope.tenantId !== record.scope?.tenantId) {
      errors.push({ code: "cross-tenant-view", message: "the view's tenant is not the session's tenant — R056 tenant isolation is structural" });
    }
    if (record.view.query.cutoff !== record.cutoff) {
      errors.push({ code: "cutoff-view-mismatch", message: "the session's cutoff is not the sealed view's cutoff — a mirror session never widens the firewall (R016)" });
    }
  }
  const observationIds = observations.map((observation) => String((observation as MarketObservation).observationId));
  if (observationIds.some((observationId, index) => observationIds.indexOf(observationId) !== index)) {
    errors.push({ code: "duplicate-observation", message: "the session carries a duplicate observation id" });
  }
  observations.forEach((observation, index) => {
    const validation = validateMarketObservation(observation);
    if (!validation.ok) {
      errors.push({ code: "observation-invalid", message: `observation #${String(index + 1)} failed the adapter's whole-record re-validation (${String(validation.errors.length)} error(s), first: ${String(validation.errors[0]?.code ?? "none")}) — errors carried verbatim` });
      return;
    }
    const typed = observation as MarketObservation;
    if (typed.availableAt > record.cutoff) {
      errors.push({ code: "post-cutoff-observation", message: `observation #${String(index + 1)} is available after the session cutoff — R016 (an observation is invisible before its availableAt)` });
    }
    if (typed.source === undefined) {
      errors.push({ code: "observation-source-missing", message: `observation #${String(index + 1)} carries no source citation — a mirror observation projects its view's record` });
    } else if (viewValidation.ok) {
      if (String(typed.source.viewId) !== String(record.view.viewId)) {
        errors.push({ code: "observation-source-view-mismatch", message: `observation #${String(index + 1)} cites another view — a mirror observation projects ITS session's view` });
      }
      const cited = record.view.records.find((viewRecord) => String(viewRecord.recordId) === String(typed.source?.recordId));
      if (cited === undefined) {
        errors.push({ code: "observation-source-record-unknown", message: `observation #${String(index + 1)} cites a record the view does not carry` });
      }
    }
    if (typed.scope?.tenantId !== record.scope?.tenantId) {
      errors.push({ code: "cross-tenant-observation", message: `observation #${String(index + 1)} belongs to another tenant — R056 tenant isolation is structural` });
    } else if (String(typed.scope?.projectId) !== String(record.scope?.projectId) || String(typed.scope?.worldId) !== String(record.scope?.worldId)) {
      errors.push({ code: "observation-scope-mismatch", message: `observation #${String(index + 1)} is outside the session's §14 scope` });
    }
  });
  const orderIds = orders.map((order) => String((order as ShadowOrder).orderId));
  if (orderIds.some((orderId, index) => orderIds.indexOf(orderId) !== index)) {
    errors.push({ code: "duplicate-order", message: "the session carries a duplicate order id" });
  }
  orders.forEach((order, index) => {
    const validation = validateShadowOrder(order);
    if (!validation.ok) {
      errors.push({ code: "order-invalid", message: `order #${String(index + 1)} failed the adapter's whole-record re-validation (${String(validation.errors.length)} error(s), first: ${String(validation.errors[0]?.code ?? "none")}) — errors carried verbatim` });
      return;
    }
    const typed = order as ShadowOrder;
    if (typed.declaredAt > record.cutoff) {
      errors.push({ code: "post-cutoff-order", message: `order #${String(index + 1)} is declared after the session cutoff — R016 (an order may not rest on knowledge the session cannot see)` });
    }
    if (typed.scope?.tenantId !== record.scope?.tenantId) {
      errors.push({ code: "cross-tenant-order", message: `order #${String(index + 1)} belongs to another tenant — R056 tenant isolation is structural` });
    } else if (String(typed.scope?.projectId) !== String(record.scope?.projectId) || String(typed.scope?.worldId) !== String(record.scope?.worldId)) {
      errors.push({ code: "order-scope-mismatch", message: `order #${String(index + 1)} is outside the session's §14 scope` });
    }
  });
  if (canonical.observationIds.some((observationId, index) => index > 0 && byString(observationId, canonical.observationIds[index - 1] ?? "") < 0)) {
    errors.push({ code: "non-canonical-order", message: "the observations are not in canonical observation-id order (A9 — the declarer's input order never leaks into the record)" });
  }
  if (canonical.orderIds.some((orderId, index) => index > 0 && byString(orderId, canonical.orderIds[index - 1] ?? "") < 0)) {
    errors.push({ code: "non-canonical-order", message: "the orders are not in canonical order-id order (A9)" });
  }
  errors.push(...secretValueViolations(record, "the session record"));
  errors.push(...provenanceErrors(record.provenance, "open-live-mirror-session", sessionInputDigestOf(canonical)));
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The projection re-proof
// ---------------------------------------------------------------------------

/** Re-validate one mirror projection from its carried bytes alone. */
export function validateMirrorProjection(projection: unknown): MirrorValidation {
  if (!isRecordLike(projection)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the projection is not typed data — a mirror projection record is required" }] };
  }
  const record = projection as unknown as MirrorProjection;
  const errors: SecurityError<MirrorValidationErrorCode>[] = [];
  const fills = Array.isArray(record.fills) ? record.fills : [];
  fills.forEach((fill: ShadowFill, index) => {
    const validation = validateShadowFill(fill);
    if (!validation.ok) {
      errors.push({ code: "order-invalid", message: `fill #${String(index + 1)} failed the adapter's whole-record re-validation (${String(validation.errors.length)} error(s), first: ${String(validation.errors[0]?.code ?? "none")}) — errors carried verbatim` });
    }
  });
  const derivedPositions: readonly MirrorPosition[] = derivePositions(fills);
  const carriedPositions = Array.isArray(record.positions) ? record.positions : [];
  if (JSON.stringify(derivedPositions) !== JSON.stringify(carriedPositions)) {
    errors.push({
      code: "position-derivation-mismatch",
      message: "the carried positions do not match the positions DERIVED decimal-exact from the carried fills — a tampered position is caught by the derivation itself (A6)",
    });
  }
  const canonical = {
    scope: record.scope ?? { tenantId: "", projectId: "", worldId: "" },
    sessionId: String(record.sessionId ?? ""),
    fillIds: fills.map((fill) => String(fill.fillId ?? "")),
    positions: carriedPositions,
    unfilledOrderIds: Array.isArray(record.unfilledOrderIds) ? record.unfilledOrderIds.map(String) : [],
  };
  const id = mirrorProjectionIdOf(canonical);
  if (String(record.projectionId) !== String(id)) {
    errors.push({ code: "projection-id-mismatch", message: `the projection id '${String(record.projectionId)}' does not re-derive from its carried bytes (expected '${String(id)}') — a rewrite is caught here (A9)` });
  }
  errors.push(...secretValueViolations(record, "the projection record"));
  errors.push(...provenanceErrors(record.provenance, "compose-mirror-projection", projectionInputDigestOf(canonical)));
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
