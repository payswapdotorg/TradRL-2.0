/**
 * The shadow execution report (W065) — ONE order's shadow-lifecycle state as
 * typed DATA, DERIVED from the carried order + its carried fills, and its
 * fail-closed composition gate.
 *
 * The report kind is NEVER declared and NEVER invented: it is derived,
 * decimal-exact, from the carried fills — no fills ⇒ `new-acknowledged`
 * (the order rests in the shadow book); the fills' decimal sum equals the
 * order's quantity ⇒ `order-filled`; strictly between ⇒
 * `order-partially-filled`. DISCLOSED: rejection/cancellation semantics are
 * declared outcomes that would need an explicit typed cancellation
 * vocabulary — deliberately not invented in this lane (A6: the derivable
 * lifecycle states only; the closed set lives in ./broker-identity.ts).
 *
 * THE COMPOSITION GATE re-proves every cited record through its own source
 * validator (the order through `validateShadowOrder`, every fill through
 * `validateShadowFill` — errors carried VERBATIM), enforces the fill-set
 * laws (every fill cites THIS order — a foreign fill is refused loudly;
 * duplicate fill ids refused; the fills are carried in CANONICAL fill-id
 * order so the declarer's input order never leaks — A9), and R056 rides
 * structurally: the report id weighs the TENANT FIRST.
 *
 * A14: the report is COMPOSED typed data — nothing is transmitted
 * (R063: the shadow path is the only path). License: Apache-2.0.
 */

import type { SecurityError } from "security";
import { canonicalDigestHex } from "trajectory";
import {
  BROKER_PROVENANCE_LAWS,
  EXECUTION_REPORT_ID_PREFIX,
  byString,
  compareDecimals,
  scopeTuple,
  sumDecimals,
} from "./broker-identity.js";
import type { BrokerExecutionReportKind, ExecutionReportId } from "./broker-identity.js";
import type { BrokerProvenance } from "./broker-observation.js";
import type { ShadowOrder } from "./broker-order.js";
import type { ShadowFill } from "./broker-fill.js";
import { validateShadowFill } from "./validate.js";
import { validateShadowOrder } from "./validate.js";

// ---------------------------------------------------------------------------
// The record (typed DATA)
// ---------------------------------------------------------------------------

/** ONE shadow execution report: the order + its fills, state DERIVED. */
export interface ShadowExecutionReport {
  readonly reportId: ExecutionReportId;
  readonly order: ShadowOrder;
  /** The order's fills, in canonical fill-id order (A9). */
  readonly fills: readonly ShadowFill[];
  /** DERIVED from the carried fills — never declared, never invented. */
  readonly reportKind: BrokerExecutionReportKind;
  /** The decimal-exact total filled quantity (derived from carried data). */
  readonly totalFilledQuantity: string;
  readonly provenance: BrokerProvenance;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type ExecutionErrorCode =
  | "order-invalid" // the cited order failed re-proof (errors verbatim)
  | "fill-invalid" // a cited fill failed re-proof (errors verbatim)
  | "foreign-fill" // a fill that cites another order
  | "duplicate-fill"
  | "overfill" // the fills' sum exceeds the order's quantity
  | "secret-value-refused"
  | "live-transmission-refused"
  | "report-id-mismatch"
  | "report-kind-invalid"
  | "report-kind-mismatch" // the declared kind ≠ the DERIVED kind (A6)
  | "total-quantity-mismatch"
  | "provenance-mismatch";

export type ExecutionError = SecurityError<ExecutionErrorCode>;

export type ExecutionCompositionOutcome =
  | { readonly ok: true; readonly report: ShadowExecutionReport }
  | { readonly ok: false; readonly errors: readonly ExecutionError[] };

// ---------------------------------------------------------------------------
// The derived state (deterministic — never invented)
// ---------------------------------------------------------------------------

/**
 * The report kind DERIVED from the carried fills (decimal-exact): no fills
 * ⇒ acknowledged; the sum equals the order quantity ⇒ filled; strictly
 * between ⇒ partially filled; the sum exceeds the order ⇒ undefined (the
 * gate refuses — the overfill law). Pure.
 */
export function deriveExecutionReportKind(
  order: ShadowOrder,
  fills: readonly ShadowFill[],
): BrokerExecutionReportKind | undefined {
  if (fills.length === 0) {
    return "new-acknowledged";
  }
  const total = totalFilledQuantityOf(fills);
  if (total === undefined) {
    return undefined;
  }
  const comparison = compareDecimals(total, order.quantity);
  if (comparison === undefined) {
    return undefined;
  }
  if (comparison === 0) {
    return "order-filled";
  }
  return comparison < 0 ? "order-partially-filled" : undefined;
}

/** The decimal-exact total filled quantity ("0" when no fills). */
export function totalFilledQuantityOf(
  fills: readonly ShadowFill[],
): string | undefined {
  if (fills.length === 0) {
    return "0";
  }
  return sumDecimals(
    fills.map((fill) => fill.fillQuantity),
    fills.map(() => 1),
  );
}

// ---------------------------------------------------------------------------
// The canonical content + the id derivation (A9 — tenant first)
// ---------------------------------------------------------------------------

export interface ReportCanonicalInput {
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
  readonly orderId: string;
  readonly fillIds: readonly string[];
  readonly reportKind: BrokerExecutionReportKind;
  readonly totalFilledQuantity: string;
}

/** The report id: `xrep-<digest>` over the canonical content (TENANT FIRST). */
export function executionReportIdOf(input: ReportCanonicalInput): ExecutionReportId {
  const digest = canonicalDigestHex({
    fillIds: [...input.fillIds],
    orderId: input.orderId,
    reportKind: input.reportKind,
    scope: scopeTuple(input.scope),
    totalFilledQuantity: input.totalFilledQuantity,
  });
  return `${EXECUTION_REPORT_ID_PREFIX}${digest}` as ExecutionReportId;
}

/** The input digest (the provenance member). */
export function reportInputDigestOf(input: ReportCanonicalInput): string {
  return canonicalDigestHex({
    fillIds: [...input.fillIds],
    orderId: input.orderId,
    reportKind: input.reportKind,
    scope: scopeTuple(input.scope),
    totalFilledQuantity: input.totalFilledQuantity,
  });
}

// ---------------------------------------------------------------------------
// THE COMPOSITION GATE
// ---------------------------------------------------------------------------

/**
 * Compose ONE shadow execution report from an order + its fills —
 * fail-closed, ALL violations collected: the order re-proven through its
 * own validator (errors VERBATIM), every fill re-proven through its own
 * validator (errors VERBATIM — the fill's cited order/observation laws ride
 * there), every fill proven to cite THIS order, duplicate fill ids refused,
 * the fills canonically ordered by fill id (A9 — input order never leaks),
 * the overfill law (the decimal-exact fill sum never exceeds the order's
 * quantity), and the report kind + total DERIVED from the carried fills.
 * Pure (A9); A14: composes typed data — never transmits (R063).
 */
export function composeShadowExecutionReport(
  order: ShadowOrder,
  fills: readonly ShadowFill[],
): ExecutionCompositionOutcome {
  const errors: ExecutionError[] = [];
  const orderErrors = validateShadowOrder(order);
  if (!orderErrors.ok) {
    errors.push({
      code: "order-invalid",
      message: `the cited order failed whole-record re-validation (${String(orderErrors.errors.length)} error(s), first: ${String(orderErrors.errors[0]?.code ?? "none")}) — errors carried verbatim`,
    });
  }
  const seenFillIds = new Set<string>();
  const orderedFills = [...fills].sort((left, right) =>
    byString(String(left.fillId), String(right.fillId)),
  );
  orderedFills.forEach((fill, index) => {
    const fillErrors = validateShadowFill(fill);
    if (!fillErrors.ok) {
      errors.push({
        code: "fill-invalid",
        message: `fill #${String(index + 1)} failed whole-record re-validation (${String(fillErrors.errors.length)} error(s), first: ${String(fillErrors.errors[0]?.code ?? "none")}) — errors carried verbatim`,
      });
      return;
    }
    if (String(fill.order.orderId) !== String(order.orderId)) {
      errors.push({
        code: "foreign-fill",
        message: `fill '${String(fill.fillId)}' cites order '${String(fill.order.orderId)}', not this order '${String(order.orderId)}' — an execution report aggregates ITS order's fills only`,
      });
    }
    if (seenFillIds.has(String(fill.fillId))) {
      errors.push({
        code: "duplicate-fill",
        message: `fill '${String(fill.fillId)}' appears twice — never silently deduplicated`,
      });
    }
    seenFillIds.add(String(fill.fillId));
  });
  if (orderErrors.ok) {
    const reportKind = deriveExecutionReportKind(order, orderedFills);
    if (reportKind === undefined) {
      errors.push({
        code: "overfill",
        message: `the fills' decimal sum exceeds the order's quantity '${String(order.quantity)}' — an execution report never overfills (decimal-exact, never silently clamped)`,
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const totalFilledQuantity = totalFilledQuantityOf(orderedFills);
  const reportKind = deriveExecutionReportKind(order, orderedFills);
  if (totalFilledQuantity === undefined || reportKind === undefined) {
    // Unreachable: the order re-proof and the overfill law ran above; fail-closed regardless.
    return {
      ok: false,
      errors: [
        {
          code: "overfill",
          message: "the derived execution state failed to derive — fail-closed",
        },
      ],
    };
  }
  const canonical: ReportCanonicalInput = {
    scope: order.scope,
    orderId: String(order.orderId),
    fillIds: orderedFills.map((fill) => String(fill.fillId)),
    reportKind,
    totalFilledQuantity,
  };
  const report: ShadowExecutionReport = {
    reportId: executionReportIdOf(canonical),
    order,
    fills: orderedFills,
    reportKind,
    totalFilledQuantity,
    provenance: {
      deriver: "compose-shadow-execution-report",
      inputDigest: reportInputDigestOf(canonical),
      laws: BROKER_PROVENANCE_LAWS,
    },
  };
  return { ok: true, report: Object.freeze(report) };
}
