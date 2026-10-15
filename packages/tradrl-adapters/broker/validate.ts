/**
 * Whole-record re-validation (W065) — every broker record proven AGAIN from
 * its own carried bytes alone: the content-addressed ids RE-DERIVED (A9 — a
 * rewrite is caught loudly), the closed vocabularies re-enforced, THE
 * REDACTION LAW re-scanned through packages/security's own scanner (errors
 * carried verbatim), THE SHADOW LAW (R063) re-scanned, the deterministic
 * provenance re-derived, and every CITED record re-proven through THIS
 * module's own validators (the fill re-proves its order + its observation;
 * the execution report re-proves its order + every fill). Fail-closed:
 * every violation collected, none silently repaired. Pure — no I/O, no
 * clocks, no env reads (A14).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { secretValueViolations, validateSecretReference } from "security";
import type { SecurityError } from "security";
import {
  BROKER_EXECUTION_REPORT_KINDS,
  BROKER_OBSERVATION_KINDS,
  BROKER_ORDER_KINDS,
  BROKER_PROVENANCE_LAWS,
  BROKER_TIME_IN_FORCE,
  BROKER_VENUE_KINDS,
  isPositiveDecimal,
  liveTransmissionViolations,
} from "./broker-identity.js";
import type { BrokerExecutionReportKind, ShadowFillId } from "./broker-identity.js";
import type { BrokerError, MarketObservation } from "./broker-observation.js";
import {
  marketObservationIdOf,
  observationInputDigestOf,
} from "./broker-observation.js";
import type { OrderError, ShadowOrder } from "./broker-order.js";
import { orderInputDigestOf, shadowOrderIdOf } from "./broker-order.js";
import type { FillError, ShadowFill } from "./broker-fill.js";
import { fillInputDigestOf, shadowFillIdOf } from "./broker-fill.js";
import type { ExecutionError, ShadowExecutionReport } from "./broker-execution.js";
import {
  deriveExecutionReportKind,
  executionReportIdOf,
  reportInputDigestOf,
  totalFilledQuantityOf,
} from "./broker-execution.js";

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export type RecordValidation<E extends string> =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly SecurityError<E>[] };

/** One typed provenance re-proof violation (shared by every broker record). */
export interface BrokerProvenanceError {
  readonly code: "provenance-mismatch";
  readonly message: string;
}

function provenanceErrors(
  provenance: unknown,
  deriver: string,
  expectedDigest: string,
): BrokerProvenanceError[] {
  if (!isRecordLike(provenance)) {
    return [
      { code: "provenance-mismatch", message: "the record carries no provenance — broker records are deterministic data (A9)" },
    ];
  }
  const errors: BrokerProvenanceError[] = [];
  if (provenance.deriver !== deriver) {
    errors.push({ code: "provenance-mismatch", message: `the provenance's deriver '${String(provenance.deriver)}' is not '${deriver}'` });
  }
  if (String(provenance.inputDigest) !== expectedDigest) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's input digest does not re-derive from the record's own carried bytes (A9)" });
  }
  const laws = provenance.laws;
  if (!Array.isArray(laws) || laws.length !== BROKER_PROVENANCE_LAWS.length || laws.some((law, index) => String(law) !== String(BROKER_PROVENANCE_LAWS[index]))) {
    errors.push({ code: "provenance-mismatch", message: "the provenance's law list does not carry the broker layer's canonical laws" });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// The market observation re-proof
// ---------------------------------------------------------------------------

/** Re-validate one market observation from its carried bytes alone. */
export function validateMarketObservation(
  observation: unknown,
): RecordValidation<BrokerError["code"]> {
  if (!isRecordLike(observation)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the observation is not typed data — a market observation record is required" }] };
  }
  const record = observation as unknown as MarketObservation;
  const errors: BrokerError[] = [];
  const id = marketObservationIdOf(record);
  if (String(record.observationId) !== String(id)) {
    errors.push({ code: "observation-id-mismatch", message: `the observation id '${String(record.observationId)}' does not re-derive from its carried bytes (expected '${String(id)}') — a rewrite is caught here (A9)` });
  }
  if (!BROKER_OBSERVATION_KINDS.includes(record.observationKind)) {
    errors.push({ code: "unknown-observation-kind", message: `observation kind '${String(record.observationKind)}' is outside the closed vocabulary` });
  }
  if (!isPositiveDecimal(record.price)) {
    errors.push({ code: "invalid-price", message: `the observation's price '${String(record.price)}' is not a lawful positive decimal string (A6 — carried data)` });
  }
  if (record.size !== undefined && !isPositiveDecimal(record.size)) {
    errors.push({ code: "invalid-size", message: `the observation's size '${String(record.size)}' is not a lawful positive decimal string` });
  }
  if (typeof record.observedAt !== "number" || !Number.isSafeInteger(record.observedAt) || record.observedAt < 0) {
    errors.push({ code: "invalid-observed-at", message: `the observation's observedAt '${String(record.observedAt)}' is not a non-negative safe integer (simulation axis)` });
  }
  if (typeof record.availableAt !== "number" || !Number.isSafeInteger(record.availableAt) || record.availableAt < 0) {
    errors.push({ code: "invalid-available-at", message: `the observation's availableAt '${String(record.availableAt)}' is not a non-negative safe integer (simulation axis)` });
  }
  if (typeof record.observedAt === "number" && typeof record.availableAt === "number" && record.availableAt < record.observedAt) {
    errors.push({ code: "availability-before-observation", message: `availableAt ${String(record.availableAt)} precedes observedAt ${String(record.observedAt)} — the W050 availability law` });
  }
  errors.push(...secretValueViolations(record, "the observation record"));
  for (const violation of liveTransmissionViolations(record, "the observation record")) {
    errors.push({ code: violation.code, message: violation.message });
  }
  errors.push(...provenanceErrors(record.provenance, "seal-market-observation", observationInputDigestOf(record)));
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The shadow order re-proof
// ---------------------------------------------------------------------------

/** Re-validate one shadow order from its carried bytes alone. */
export function validateShadowOrder(order: unknown): RecordValidation<OrderError["code"]> {
  if (!isRecordLike(order)) {
    return { ok: false, errors: [{ code: "malformed-input", message: "the order is not typed data — a shadow order record is required" }] };
  }
  const record = order as unknown as ShadowOrder;
  const errors: OrderError[] = [];
  const canonical = { ...record, credentialSecretId: String(record.credentialReference?.secretId ?? "") };
  const id = shadowOrderIdOf(canonical);
  if (String(record.orderId) !== String(id)) {
    errors.push({ code: "order-id-mismatch", message: `the order id '${String(record.orderId)}' does not re-derive from its carried bytes (expected '${String(id)}') — a rewrite is caught here (A9)` });
  }
  if (!BROKER_VENUE_KINDS.includes(record.venueKind)) {
    errors.push({ code: "unknown-venue-kind", message: `venue kind '${String(record.venueKind)}' is outside the closed vocabulary` });
  }
  if (!BROKER_ORDER_KINDS.includes(record.orderKind)) {
    errors.push({ code: "unknown-order-kind", message: `order kind '${String(record.orderKind)}' is outside the closed vocabulary` });
  }
  if (!BROKER_TIME_IN_FORCE.includes(record.timeInForce)) {
    errors.push({ code: "unknown-time-in-force", message: `time-in-force '${String(record.timeInForce)}' is outside the closed vocabulary` });
  }
  if (record.side !== "buy" && record.side !== "sell") {
    errors.push({ code: "invalid-side", message: `the order's side '${String(record.side)}' is outside the closed vocabulary` });
  }
  if (!isPositiveDecimal(record.quantity)) {
    errors.push({ code: "invalid-quantity", message: `the order's quantity '${String(record.quantity)}' is not a lawful positive decimal string` });
  }
  if (record.orderKind === "limit" && record.limitPrice === undefined) {
    errors.push({ code: "limit-price-missing", message: "a limit order declares its limit price" });
  }
  if (record.limitPrice !== undefined && !isPositiveDecimal(record.limitPrice)) {
    errors.push({ code: "invalid-limit-price", message: `the order's limit price '${String(record.limitPrice)}' is not a lawful positive decimal string` });
  }
  if (typeof record.declaredAt !== "number" || !Number.isSafeInteger(record.declaredAt) || record.declaredAt < 0) {
    errors.push({ code: "invalid-declared-at", message: `the order's declaredAt '${String(record.declaredAt)}' is not a non-negative safe integer (simulation axis)` });
  }
  const credentialValidation = validateSecretReference(record.credentialReference);
  if (!credentialValidation.ok) {
    errors.push({ code: "credential-invalid", message: "the order's credential failed W060's own secret-reference re-validation (errors carried verbatim)" });
  }
  if (isRecordLike(record.credentialReference) && isRecordLike(record.credentialReference.scope) && isRecordLike(record.scope)) {
    const credentialScope = record.credentialReference.scope as Record<string, unknown>;
    const orderScope = record.scope as Record<string, unknown>;
    if (String(credentialScope.tenantId) !== String(orderScope.tenantId)) {
      errors.push({ code: "cross-tenant-credential", message: "the credential's tenant is not the order's tenant — R056 tenant isolation is structural" });
    } else if (String(credentialScope.projectId) !== String(orderScope.projectId) || String(credentialScope.worldId) !== String(orderScope.worldId)) {
      errors.push({ code: "credential-scope-mismatch", message: "the credential's project/world disagree with the order's scope" });
    }
  }
  errors.push(...secretValueViolations(record, "the order record"));
  for (const violation of liveTransmissionViolations(record, "the order record")) {
    errors.push({ code: violation.code, message: violation.message });
  }
  errors.push(...provenanceErrors(record.provenance, "declare-shadow-order", orderInputDigestOf(canonical)));
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The shadow fill re-proof
// ---------------------------------------------------------------------------

/** Re-validate one shadow fill from its carried bytes alone. */
export function validateShadowFill(fill: unknown): RecordValidation<FillError["code"]> {
  if (!isRecordLike(fill)) {
    return { ok: false, errors: [{ code: "fill-invalid", message: "the fill is not typed data — a shadow fill record is required" }] };
  }
  const record = fill as unknown as ShadowFill;
  const errors: FillError[] = [];
  const orderValidation = validateShadowOrder(record.order);
  if (!orderValidation.ok) {
    errors.push({ code: "order-invalid", message: `the fill's cited order failed whole-record re-validation (${String(orderValidation.errors.length)} error(s), first: ${String(orderValidation.errors[0]?.code ?? "none")}) — errors carried verbatim` });
  }
  const observationValidation = validateMarketObservation(record.observation);
  if (!observationValidation.ok) {
    errors.push({ code: "observation-invalid", message: `the fill's cited observation failed whole-record re-validation (${String(observationValidation.errors.length)} error(s), first: ${String(observationValidation.errors[0]?.code ?? "none")}) — errors carried verbatim` });
  }
  if (orderValidation.ok && observationValidation.ok) {
    if (String(record.observation.scope.tenantId) !== String(record.order.scope.tenantId)) {
      errors.push({ code: "cross-tenant-observation", message: "the observation's tenant is not the order's tenant — R056 tenant isolation is structural" });
    }
    if (String(record.observation.instrumentId) !== String(record.order.instrumentId)) {
      errors.push({ code: "instrument-mismatch", message: "the observation's instrument is not the order's instrument" });
    }
    if (record.observation.observedAt < record.order.declaredAt) {
      errors.push({ code: "observation-before-order", message: "the observation predates the order's declaration" });
    }
  }
  if (!isPositiveDecimal(record.fillQuantity)) {
    errors.push({ code: "invalid-fill-quantity", message: `the fill quantity '${String(record.fillQuantity)}' is not a lawful positive decimal string` });
  }
  const canonical = {
    scope: record.order?.scope ?? { tenantId: "", projectId: "", worldId: "" },
    orderId: String(record.order?.orderId ?? ""),
    observationId: String(record.observation?.observationId ?? ""),
    fillQuantity: String(record.fillQuantity ?? ""),
  };
  const id: ShadowFillId = shadowFillIdOf(canonical);
  if (String(record.fillId) !== String(id)) {
    errors.push({ code: "fill-id-mismatch", message: `the fill id '${String(record.fillId)}' does not re-derive from its carried bytes (expected '${String(id)}') — a rewrite is caught here (A9)` });
  }
  errors.push(...provenanceErrors(record.provenance, "compose-shadow-fill", fillInputDigestOf(canonical)));
  errors.push(...secretValueViolations(record, "the fill record"));
  for (const violation of liveTransmissionViolations(record, "the fill record")) {
    errors.push({ code: violation.code, message: violation.message });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------------------------------------------------------------------------
// The shadow execution report re-proof
// ---------------------------------------------------------------------------

/** Re-validate one shadow execution report from its carried bytes alone. */
export function validateShadowExecutionReport(
  report: unknown,
): RecordValidation<ExecutionError["code"]> {
  if (!isRecordLike(report)) {
    return { ok: false, errors: [{ code: "order-invalid", message: "the report is not typed data — a shadow execution report record is required" }] };
  }
  const record = report as unknown as ShadowExecutionReport;
  const errors: ExecutionError[] = [];
  const orderValidation = validateShadowOrder(record.order);
  if (!orderValidation.ok) {
    errors.push({ code: "order-invalid", message: `the report's cited order failed whole-record re-validation (${String(orderValidation.errors.length)} error(s), first: ${String(orderValidation.errors[0]?.code ?? "none")}) — errors carried verbatim` });
  }
  const seen = new Set<string>();
  const fills = Array.isArray(record.fills) ? record.fills : [];
  fills.forEach((fill, index) => {
    const fillValidation = validateShadowFill(fill);
    if (!fillValidation.ok) {
      errors.push({ code: "fill-invalid", message: `fill #${String(index + 1)} failed whole-record re-validation (${String(fillValidation.errors.length)} error(s), first: ${String(fillValidation.errors[0]?.code ?? "none")}) — errors carried verbatim` });
      return;
    }
    if (String((fill as ShadowFill).order.orderId) !== String(record.order?.orderId ?? "")) {
      errors.push({ code: "foreign-fill", message: `fill #${String(index + 1)} cites another order — an execution report aggregates ITS order's fills only` });
    }
    if (seen.has(String((fill as ShadowFill).fillId))) {
      errors.push({ code: "duplicate-fill", message: `fill '${String((fill as ShadowFill).fillId)}' appears twice` });
    }
    seen.add(String((fill as ShadowFill).fillId));
  });
  if (!BROKER_EXECUTION_REPORT_KINDS.includes(record.reportKind)) {
    errors.push({ code: "report-kind-invalid", message: `report kind '${String(record.reportKind)}' is outside the closed vocabulary` });
  }
  if (orderValidation.ok) {
    const derivedKind: BrokerExecutionReportKind | undefined = deriveExecutionReportKind(record.order, fills);
    const derivedTotal = totalFilledQuantityOf(fills);
    if (derivedKind === undefined) {
      errors.push({ code: "overfill", message: "the carried fills' decimal sum exceeds the order's quantity — an execution report never overfills" });
    } else if (derivedKind !== record.reportKind) {
      errors.push({ code: "report-kind-mismatch", message: `the report kind '${String(record.reportKind)}' does not match the kind DERIVED from the carried fills ('${derivedKind}') — the state is derived, never declared (A6)` });
    }
    if (derivedTotal !== undefined && String(record.totalFilledQuantity) !== derivedTotal) {
      errors.push({ code: "total-quantity-mismatch", message: `the total filled quantity '${String(record.totalFilledQuantity)}' does not match the decimal-exact derivation '${derivedTotal}'` });
    }
  }
  const canonical = {
    scope: record.order?.scope ?? { tenantId: "", projectId: "", worldId: "" },
    orderId: String(record.order?.orderId ?? ""),
    fillIds: fills.map((fill) => String((fill as ShadowFill).fillId ?? "")),
    reportKind: record.reportKind,
    totalFilledQuantity: String(record.totalFilledQuantity ?? ""),
  };
  const id = executionReportIdOf(canonical);
  if (String(record.reportId) !== String(id)) {
    errors.push({ code: "report-id-mismatch", message: `the report id '${String(record.reportId)}' does not re-derive from its carried bytes (expected '${String(id)}') — a rewrite is caught here (A9)` });
  }
  errors.push(...provenanceErrors(record.provenance, "compose-shadow-execution-report", reportInputDigestOf(canonical)));
  errors.push(...secretValueViolations(record, "the execution report record"));
  for (const violation of liveTransmissionViolations(record, "the execution report record")) {
    errors.push({ code: violation.code, message: violation.message });
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
