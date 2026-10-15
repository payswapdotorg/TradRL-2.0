/**
 * The shadow fill (W065) — ONE simulated fill as typed DATA, composed from
 * an order + a market observation BOTH carried verbatim, and its
 * fail-closed composition gate.
 *
 * THE A6 LAW (no invented numbers) is STRUCTURAL here: the fill's price IS
 * its observation's carried price — the record does not even carry a
 * separate price member to drift. The fill's quantity is declared and
 * bounded by the order's carried quantity. The fill's timestamps are the
 * observation's own. Everything else is lineage: the whole order record
 * and the whole observation record ride inside the fill, verbatim, so the
 * fill is re-validatable from its recorded data alone.
 *
 * THE REGISTRATION/COMPOSITION GATE collects ALL violations and re-proves
 * every cited record through its own source validator
 * (`validateShadowOrder`, `validateMarketObservation` — errors carried
 * VERBATIM, never bypassed). R056 is enforced at the gate: a
 * cross-tenant order-vs-observation pair is the LOUD typed
 * `cross-tenant-observation` refusal (tenant isolation is structural, and
 * so is the fill id — the TENANT is weighed first).
 *
 * A9: the id is the canonical content digest over the order id + the
 * observation id + the fill quantity (the carried bytes the fill is made
 * of); A14: the fill is COMPOSED — nothing is transmitted, nothing
 * executed (R063: the shadow path is the only path).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { SecurityError } from "security";
import { TENANT_ISOLATION_LAW } from "security";
import { canonicalDigestHex } from "trajectory";
import {
  BROKER_PROVENANCE_LAWS,
  SHADOW_FILL_ID_PREFIX,
  byString,
  compareDecimals,
  isPositiveDecimal,
  scopeTuple,
} from "./broker-identity.js";
import type { ShadowFillId } from "./broker-identity.js";
import type { BrokerProvenance, MarketObservation } from "./broker-observation.js";
import type { ShadowOrder } from "./broker-order.js";
import { validateMarketObservation, validateShadowOrder } from "./validate.js";

// ---------------------------------------------------------------------------
// The record (typed DATA)
// ---------------------------------------------------------------------------

/**
 * ONE shadow fill: the order VERBATIM, the observation VERBATIM, the fill's
 * own quantity — and NO separate price member (the fill's price IS the
 * observation's carried price: A6 structural — use `fillPriceOf`).
 */
export interface ShadowFill {
  readonly fillId: ShadowFillId;
  readonly order: ShadowOrder;
  readonly observation: MarketObservation;
  /** The filled quantity (positive decimal, ≤ the order's quantity). */
  readonly fillQuantity: string;
  readonly provenance: BrokerProvenance;
}

/** The fill's price: the observation's OWN carried price (A6 — never invented). */
export function fillPriceOf(fill: ShadowFill): string {
  return fill.observation.price;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type FillErrorCode =
  | "fill-invalid" // the fill record itself is not typed data
  | "order-invalid" // the cited order failed re-proof (errors verbatim)
  | "observation-invalid" // the cited observation failed re-proof (verbatim)
  | "cross-tenant-observation" // R056: the observation's tenant ≠ the order's
  | "observation-scope-mismatch"
  | "instrument-mismatch" // the observation is for another instrument
  | "invalid-fill-quantity"
  | "fill-quantity-exceeds-order"
  | "observation-before-order" // the observation predates the order's declaration
  | "secret-value-refused"
  | "live-transmission-refused"
  | "fill-id-mismatch"
  | "provenance-mismatch";

export type FillError = SecurityError<FillErrorCode>;

export type FillCompositionOutcome =
  | { readonly ok: true; readonly fill: ShadowFill }
  | { readonly ok: false; readonly errors: readonly FillError[] };

// ---------------------------------------------------------------------------
// The canonical content + the id derivation (A9 — tenant first)
// ---------------------------------------------------------------------------

/** What a fill id weighs: the scope tuple FIRST, then the cited ids + qty. */
export interface FillCanonicalInput {
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
  readonly orderId: string;
  readonly observationId: string;
  readonly fillQuantity: string;
}

/** The fill id: `sfil-<digest>` over the canonical content (TENANT FIRST). */
export function shadowFillIdOf(input: FillCanonicalInput): ShadowFillId {
  const digest = canonicalDigestHex({
    fillQuantity: input.fillQuantity,
    observationId: input.observationId,
    orderId: input.orderId,
    scope: scopeTuple(input.scope),
  });
  return `${SHADOW_FILL_ID_PREFIX}${digest}` as ShadowFillId;
}

/** The input digest (the provenance member). */
export function fillInputDigestOf(input: FillCanonicalInput): string {
  return canonicalDigestHex({
    fillQuantity: input.fillQuantity,
    observationId: input.observationId,
    orderId: input.orderId,
    scope: scopeTuple(input.scope),
  });
}

// ---------------------------------------------------------------------------
// THE COMPOSITION GATE
// ---------------------------------------------------------------------------

/**
 * Compose ONE shadow fill from an order + a market observation — fail-closed,
 * ALL violations collected: BOTH cited records re-proven through their own
 * validators (errors carried VERBATIM — the order's credential laws ride in
 * W060's re-proof, the observation's redaction/shadow laws ride in its own),
 * the R056 tenant-scope law (a cross-tenant order-vs-observation pair is the
 * LOUD `cross-tenant-observation` refusal), the instrument-match law, the
 * declared fill quantity (positive decimal, ≤ the order's quantity —
 * decimal-exact), and the observation-timing law (the observation must not
 * predate the order's declaration — a fill prices an order at market data
 * the order could see). Then the seal: `sfil-<digest>` over the scope tuple
 * (TENANT FIRST), the order id, the observation id and the fill quantity.
 * Pure (A9): same inputs ⇒ deep-equal fill, same id; A14: composes typed
 * data — never transmits (R063: the shadow path is the only path).
 */
export function composeShadowFill(
  order: ShadowOrder,
  observation: MarketObservation,
  fillQuantity: string,
): FillCompositionOutcome {
  const errors: FillError[] = [];
  const orderErrors = validateShadowOrder(order);
  if (!orderErrors.ok) {
    errors.push({
      code: "order-invalid",
      message: `the cited order failed whole-record re-validation (${String(orderErrors.errors.length)} error(s), first: ${String(orderErrors.errors[0]?.code ?? "none")}) — errors carried verbatim`,
    });
  }
  const observationErrors = validateMarketObservation(observation);
  if (!observationErrors.ok) {
    errors.push({
      code: "observation-invalid",
      message: `the cited observation failed whole-record re-validation (${String(observationErrors.errors.length)} error(s), first: ${String(observationErrors.errors[0]?.code ?? "none")}) — errors carried verbatim`,
    });
  }
  if (orderErrors.ok && observationErrors.ok) {
    if (observation.scope.tenantId !== order.scope.tenantId) {
      errors.push({
        code: "cross-tenant-observation",
        message: `the observation's tenant '${String(observation.scope.tenantId)}' is not the order's tenant '${String(order.scope.tenantId)}' — ${TENANT_ISOLATION_LAW} (a cross-tenant order-vs-observation pair is refused loudly, never silently composed)`,
      });
    } else if (
      observation.scope.projectId !== order.scope.projectId ||
      observation.scope.worldId !== order.scope.worldId
    ) {
      errors.push({
        code: "observation-scope-mismatch",
        message: "the observation's project/world disagree with the order's scope — §14 scope identity is explicit and must agree",
      });
    }
    if (byString(observation.instrumentId, order.instrumentId) !== 0) {
      errors.push({
        code: "instrument-mismatch",
        message: `the observation's instrument '${String(observation.instrumentId)}' is not the order's instrument '${String(order.instrumentId)}' — a fill prices an order on ITS instrument, never another`,
      });
    }
    if (observation.observedAt < order.declaredAt) {
      errors.push({
        code: "observation-before-order",
        message: `the observation's observedAt ${String(observation.observedAt)} precedes the order's declaredAt ${String(order.declaredAt)} — a fill prices an order at market data the order could see`,
      });
    }
  }
  if (!isPositiveDecimal(fillQuantity)) {
    errors.push({
      code: "invalid-fill-quantity",
      message: `the fill quantity '${String(fillQuantity)}' is not a lawful positive decimal string — quantities are carried data (A6), never floats`,
    });
  } else if (orderErrors.ok) {
    const comparison = compareDecimals(fillQuantity, order.quantity);
    if (comparison === undefined || comparison > 0) {
      errors.push({
        code: "fill-quantity-exceeds-order",
        message: `the fill quantity '${String(fillQuantity)}' exceeds the order's quantity '${String(order.quantity)}' — decimal-exact comparison, never silently clamped`,
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const canonical: FillCanonicalInput = {
    scope: order.scope,
    orderId: String(order.orderId),
    observationId: String(observation.observationId),
    fillQuantity,
  };
  const fill: ShadowFill = {
    fillId: shadowFillIdOf(canonical),
    order,
    observation,
    fillQuantity,
    provenance: {
      deriver: "compose-shadow-fill",
      inputDigest: fillInputDigestOf(canonical),
      laws: BROKER_PROVENANCE_LAWS,
    },
  };
  return { ok: true, fill: Object.freeze(fill) };
}
