/**
 * The shadow order (W065) — ONE trading intent routed to the SHADOW
 * execution path, as typed DATA, and its fail-closed declaration gate.
 *
 * THE SHADOW LAW (R063) is STRUCTURAL here: an order declaration carries
 * venue vocabulary, side, instrument, quantity, an optional limit price, a
 * declared timestamp — and a CREDENTIAL as a W060 SECRET REFERENCE (a typed
 * handle). The vocabulary has NO live-transmission field at all; the gate
 * scans the whole declaration for live-transmission-shaped members and
 * URL-shaped values and refuses them LOUDLY naming R063; the credential is
 * re-proven through packages/security's own `validateSecretReference` with
 * its errors carried VERBATIM (THE REDACTION LAW rides THERE — a
 * secret-shaped value anywhere is refused by W060's own scanner, never
 * re-implemented here), and the credential's §14 scope must EQUAL the
 * order's scope (R056 — a cross-tenant credential is the loud typed
 * `cross-tenant-credential` refusal).
 *
 * The limit-price law is fail-closed, never silently repaired: a limit
 * order DECLARES its limit price; a market order carries none (a stray
 * limit price on a market order is refused, not dropped — the arena top-k
 * precedent).
 *
 * A9: the id is the canonical content digest (TENANT FIRST — R056); A14:
 * typed data only — submitting this order anywhere is the shadow gateway's
 * pure composition, never a transmission.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { SecurityError, SecurityScope, SecretReference } from "security";
import {
  TENANT_ISOLATION_LAW,
  blankSecurityScopeMembers,
  secretValueViolations,
  validateSecretReference,
} from "security";
import { canonicalDigestHex } from "trajectory";
import {
  BROKER_ORDER_KINDS,
  BROKER_PROVENANCE_LAWS,
  BROKER_TIME_IN_FORCE,
  BROKER_VENUE_KINDS,
  SHADOW_ORDER_ID_PREFIX,
  isPositiveDecimal,
  liveTransmissionViolations,
  scopeTuple,
} from "./broker-identity.js";
import type { BrokerOrderKind, BrokerTimeInForce, BrokerVenueKind, ShadowOrderId } from "./broker-identity.js";
import type { BrokerProvenance } from "./broker-observation.js";

// ---------------------------------------------------------------------------
// The declaration + the record (typed DATA)
// ---------------------------------------------------------------------------

/** ONE shadow order declaration: the intent, before sealing. */
export interface ShadowOrderDeclaration {
  readonly scope: SecurityScope;
  readonly venueKind: BrokerVenueKind;
  readonly orderKind: BrokerOrderKind;
  readonly timeInForce: BrokerTimeInForce;
  readonly side: "buy" | "sell";
  readonly instrumentId: string;
  /** The order's quantity (positive decimal string — carried data). */
  readonly quantity: string;
  /** REQUIRED on limit orders; REFUSED on market orders (fail-closed). */
  readonly limitPrice?: string;
  /** When the intent was declared (simulation axis, declared ms — A9). */
  readonly declaredAt: number;
  /** The venue credential as a W060 typed handle — NEVER a value. */
  readonly credentialReference: SecretReference;
}

/** ONE sealed shadow order (immutable, content-addressed). */
export interface ShadowOrder {
  readonly orderId: ShadowOrderId;
  readonly scope: SecurityScope;
  readonly venueKind: BrokerVenueKind;
  readonly orderKind: BrokerOrderKind;
  readonly timeInForce: BrokerTimeInForce;
  readonly side: "buy" | "sell";
  readonly instrumentId: string;
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly declaredAt: number;
  readonly credentialReference: SecretReference;
  readonly provenance: BrokerProvenance;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type OrderErrorCode =
  | "malformed-input"
  | "invalid-scope"
  | "unknown-venue-kind"
  | "unknown-order-kind"
  | "unknown-time-in-force"
  | "invalid-side"
  | "blank-instrument"
  | "invalid-quantity"
  | "limit-price-missing"
  | "limit-price-refused"
  | "invalid-limit-price"
  | "invalid-declared-at"
  | "credential-invalid" // W060's validateSecretReference errors, verbatim
  | "cross-tenant-credential" // R056: the credential's tenant ≠ the order's
  | "credential-scope-mismatch"
  | "secret-value-refused"
  | "live-transmission-refused"
  | "order-id-mismatch"
  | "provenance-mismatch";

export type OrderError = SecurityError<OrderErrorCode>;

export type OrderDeclarationOutcome =
  | { readonly ok: true; readonly order: ShadowOrder }
  | { readonly ok: false; readonly errors: readonly OrderError[] };

// ---------------------------------------------------------------------------
// The canonical content + the id derivation (A9 — tenant first)
// ---------------------------------------------------------------------------

/** What an order id weighs (the credential by its OPAQUE HANDLE only). */
export interface OrderCanonicalInput {
  readonly scope: SecurityScope;
  readonly venueKind: BrokerVenueKind;
  readonly orderKind: BrokerOrderKind;
  readonly timeInForce: BrokerTimeInForce;
  readonly side: "buy" | "sell";
  readonly instrumentId: string;
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly declaredAt: number;
  readonly credentialSecretId: string;
}

/** The canonical content an order id addresses (TENANT FIRST — R056). */
export function orderCanonicalContent(input: OrderCanonicalInput): unknown {
  return {
    credentialSecretId: input.credentialSecretId,
    declaredAt: input.declaredAt,
    instrumentId: input.instrumentId,
    orderKind: input.orderKind,
    quantity: input.quantity,
    scope: scopeTuple(input.scope),
    side: input.side,
    ...(input.limitPrice === undefined ? {} : { limitPrice: input.limitPrice }),
    timeInForce: input.timeInForce,
    venueKind: input.venueKind,
  };
}

/** The order id: `sord-<digest>` over the canonical content. */
export function shadowOrderIdOf(input: OrderCanonicalInput): ShadowOrderId {
  const digest = canonicalDigestHex(orderCanonicalContent(input));
  return `${SHADOW_ORDER_ID_PREFIX}${digest}` as ShadowOrderId;
}

/** The input digest (the provenance member). */
export function orderInputDigestOf(input: OrderCanonicalInput): string {
  return canonicalDigestHex(orderCanonicalContent(input));
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Declare ONE shadow order — fail-closed, ALL violations collected: the
 * explicit §14 scope, the closed venue/order/TIF vocabularies, the closed
 * side vocabulary, a non-blank instrument, a lawful positive decimal
 * quantity, the limit-price law, a legal declared timestamp, the credential
 * re-proven through W060's own `validateSecretReference` (errors VERBATIM)
 * with the R056 credential-scope law, THE REDACTION LAW scan and THE SHADOW
 * LAW scan (R063). Then the seal: `sord-<digest>` minted over the canonical
 * bytes (the TENANT weighed first — R056 structural).
 */
export function declareShadowOrder(
  declaration: ShadowOrderDeclaration,
): OrderDeclarationOutcome {
  if (!isRecordLike(declaration) || !isRecordLike(declaration.scope)) {
    return {
      ok: false,
      errors: [
        {
          code: "malformed-input",
          message:
            "the order declaration is not typed data — a scope, venue/order/TIF vocabularies, side, instrument, quantity and a credential handle are required",
        },
      ],
    };
  }
  const errors: OrderError[] = [];
  for (const member of blankSecurityScopeMembers(declaration.scope)) {
    errors.push({
      code: "invalid-scope",
      message: `the order's scope '${String(member)}' is blank — tenant/project/world identity is explicit, never blank`,
    });
  }
  if (!BROKER_VENUE_KINDS.includes(declaration.venueKind)) {
    errors.push({
      code: "unknown-venue-kind",
      message: `venue kind '${String(declaration.venueKind)}' is outside the closed vocabulary — orders answer in ${BROKER_VENUE_KINDS.join(", ")} only`,
    });
  }
  if (!BROKER_ORDER_KINDS.includes(declaration.orderKind)) {
    errors.push({
      code: "unknown-order-kind",
      message: `order kind '${String(declaration.orderKind)}' is outside the closed vocabulary — orders answer in ${BROKER_ORDER_KINDS.join(", ")} only`,
    });
  }
  if (!BROKER_TIME_IN_FORCE.includes(declaration.timeInForce)) {
    errors.push({
      code: "unknown-time-in-force",
      message: `time-in-force '${String(declaration.timeInForce)}' is outside the closed vocabulary — orders answer in ${BROKER_TIME_IN_FORCE.join(", ")} only`,
    });
  }
  if (declaration.side !== "buy" && declaration.side !== "sell") {
    errors.push({
      code: "invalid-side",
      message: `the order's side '${String(declaration.side)}' is outside the closed vocabulary — orders answer in buy or sell only`,
    });
  }
  if (typeof declaration.instrumentId !== "string" || declaration.instrumentId.trim().length === 0) {
    errors.push({
      code: "blank-instrument",
      message: "the order's instrument id is blank — an order names its instrument, never blankly",
    });
  }
  if (!isPositiveDecimal(declaration.quantity)) {
    errors.push({
      code: "invalid-quantity",
      message: `the order's quantity '${String(declaration.quantity)}' is not a lawful positive decimal string — quantities are carried data (A6), never floats`,
    });
  }
  if (declaration.orderKind === "limit" && declaration.limitPrice === undefined) {
    errors.push({
      code: "limit-price-missing",
      message: "a limit order declares its limit price — the price bound is explicit, never implicit",
    });
  }
  if (declaration.orderKind === "market" && declaration.limitPrice !== undefined) {
    errors.push({
      code: "limit-price-refused",
      message: `the market order carries a limit price ('${String(declaration.limitPrice)}') — only a limit order carries one (fail-closed, never silently ignored)`,
    });
  }
  if (declaration.limitPrice !== undefined && !isPositiveDecimal(declaration.limitPrice)) {
    errors.push({
      code: "invalid-limit-price",
      message: `the order's limit price '${String(declaration.limitPrice)}' is not a lawful positive decimal string — carried data, never a float`,
    });
  }
  if (typeof declaration.declaredAt !== "number" || !Number.isSafeInteger(declaration.declaredAt) || declaration.declaredAt < 0) {
    errors.push({
      code: "invalid-declared-at",
      message: `the order's declaredAt '${String(declaration.declaredAt)}' is not a non-negative safe integer on the simulation axis (declared data — A9 has no clocks)`,
    });
  }
  const credentialValidation = validateSecretReference(declaration.credentialReference);
  if (!credentialValidation.ok) {
    errors.push({
      code: "credential-invalid",
      message: "the order's credential failed W060's own secret-reference re-validation — THE REDACTION LAW and the custody laws are enforced THERE (errors carried verbatim)",
    });
  }
  if (isRecordLike(declaration.credentialReference) && isRecordLike(declaration.credentialReference.scope)) {
    const credentialScope = declaration.credentialReference.scope as unknown as SecurityScope;
    const orderScope = declaration.scope;
    if (credentialScope.tenantId !== orderScope.tenantId) {
      errors.push({
        code: "cross-tenant-credential",
        message: `the credential's tenant '${String(credentialScope.tenantId)}' is not the order's tenant '${String(orderScope.tenantId)}' — ${TENANT_ISOLATION_LAW} (tenant isolation is structural; a cross-tenant credential is refused loudly)`,
      });
    } else if (
      credentialScope.projectId !== orderScope.projectId ||
      credentialScope.worldId !== orderScope.worldId
    ) {
      errors.push({
        code: "credential-scope-mismatch",
        message: "the credential's project/world disagree with the order's scope — §14 scope identity is explicit and must agree",
      });
    }
  }
  errors.push(...secretValueViolations(declaration, "the order declaration"));
  for (const violation of liveTransmissionViolations(declaration, "the order declaration")) {
    errors.push({ code: violation.code, message: violation.message });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const canonical: OrderCanonicalInput = { ...declaration, credentialSecretId: String(declaration.credentialReference.secretId) };
  const order: ShadowOrder = {
    orderId: shadowOrderIdOf(canonical),
    scope: declaration.scope,
    venueKind: declaration.venueKind,
    orderKind: declaration.orderKind,
    timeInForce: declaration.timeInForce,
    side: declaration.side,
    instrumentId: declaration.instrumentId,
    quantity: declaration.quantity,
    ...(declaration.limitPrice === undefined ? {} : { limitPrice: declaration.limitPrice }),
    declaredAt: declaration.declaredAt,
    credentialReference: declaration.credentialReference,
    provenance: {
      deriver: "declare-shadow-order",
      inputDigest: orderInputDigestOf(canonical),
      laws: BROKER_PROVENANCE_LAWS,
    },
  };
  return { ok: true, order: Object.freeze(order) };
}
