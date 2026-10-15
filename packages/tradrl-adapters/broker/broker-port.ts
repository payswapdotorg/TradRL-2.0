/**
 * The BrokerGatewayPort (W065) — the provider-neutral typed port a concrete
 * venue adapter implements, plus the deterministic in-memory SHADOW
 * reference implementation (the W056 CapabilityProviderPort precedent).
 *
 * R070 — "Provider-neutral adapters": the port speaks ONLY the closed broker
 * vocabulary (./broker-identity.ts); venue-specific microstructure lives in
 * concrete venue adapters, which is exactly what the port is FOR.
 * R063 — "Shadow/live separation is mandatory": THE PORT'S SUBMISSION PATH
 * IS THE SHADOW PATH — `submitShadowOrder` is the ONLY order entry point
 * (there is no live entry point AT ALL), and it COMPOSES typed records
 * deterministically in memory: the order is re-proven, matched against the
 * gateway's carried observations (same scope — R056 cross-tenant refused
 * loudly; same instrument; observable at/after the order's declaration),
 * filled at the FIRST eligible observation's carried price through the REAL
 * `composeShadowFill` gate, and aggregated through the REAL
 * `composeShadowExecutionReport` gate. No network code exists here — the
 * reference implementation never transmits anything (A14).
 *
 * DISCLOSED (the reference implementation's deliberately simple matching
 * law): one FULL fill at the first eligible observation (canonical order:
 * observedAt, then observation id) — the order's own quantity is the fill's
 * quantity and the observation's own price is the fill's price (A6: both
 * carried numbers, nothing invented). Queueing, partial-venue-depth and
 * venue microstructure are venue-adapter concerns, not port concerns.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { SecurityScope } from "security";
import { TENANT_ISOLATION_LAW } from "security";
import type { BrokerError } from "./broker-observation.js";
import type { MarketObservation } from "./broker-observation.js";
import type { ShadowOrder } from "./broker-order.js";
import type { ShadowExecutionReport } from "./broker-execution.js";
import { composeShadowExecutionReport } from "./broker-execution.js";
import { composeShadowFill } from "./broker-fill.js";
import { validateMarketObservation } from "./validate.js";
import { validateShadowOrder } from "./validate.js";
import type { MarketObservationId } from "./broker-identity.js";
import { byString } from "./broker-identity.js";

// ---------------------------------------------------------------------------
// THE PORT (provider-neutral — the closed broker vocabulary only)
// ---------------------------------------------------------------------------

/** The typed fail-closed by-id lookup (never a silent undefined). */
export type ObservationLookup =
  | { readonly ok: true; readonly observation: MarketObservation }
  | { readonly ok: false; readonly errors: readonly BrokerError[] };

/** The typed outcome of a SHADOW submission (a composed report, or errors). */
export type ShadowSubmissionOutcome =
  | { readonly ok: true; readonly report: ShadowExecutionReport }
  | { readonly ok: false; readonly errors: readonly BrokerError[] };

/**
 * THE BROKER GATEWAY PORT — provider-neutral (R070), SHADOW-ONLY (R063):
 * observations are served in canonical observation-id order, resolved by
 * exact opaque-id equality (never parsed), and orders enter EXCLUSIVELY
 * through the shadow submission path. A concrete venue adapter implements
 * this port against its own venue vocabulary — never against live
 * transmission (the vocabulary has no such field; a live-transmission-shaped
 * implementation is refused by the adapter's own gates).
 */
export interface BrokerGatewayPort {
  readonly scope: SecurityScope;
  /** The gateway's carried observations, in canonical id order (A9). */
  listObservations(): readonly MarketObservation[];
  /** Resolve one observation by exact id — fail-closed. */
  observation(observationId: MarketObservationId): ObservationLookup;
  /**
   * THE SHADOW PATH (R063): compose the order's shadow execution report —
   * deterministic, in-memory, pure. The ONLY order entry point.
   */
  submitShadowOrder(order: ShadowOrder): ShadowSubmissionOutcome;
}

// ---------------------------------------------------------------------------
// The deterministic in-memory reference implementation
// ---------------------------------------------------------------------------

function unknownObservation(
  observationId: MarketObservationId,
): readonly BrokerError[] {
  return [
    {
      code: "malformed-input",
      message: `observation '${String(observationId)}' is not carried by this gateway — the port resolves exact ids only`,
    },
  ];
}

/**
 * The SHADOW broker gateway — the deterministic in-memory reference
 * implementation of {@link BrokerGatewayPort}: every carried observation is
 * re-proven at construction (fail-closed, all violations collected), and
 * `submitShadowOrder` composes the order's shadow execution report through
 * the REAL composition gates with their errors carried verbatim. Pure
 * (A9): the same observations + order always yield the deep-equal report.
 */
export function shadowBrokerGateway(
  scope: SecurityScope,
  observations: readonly MarketObservation[],
): { readonly ok: true; readonly port: BrokerGatewayPort } | { readonly ok: false; readonly errors: readonly BrokerError[] } {
  const errors: BrokerError[] = [];
  const seen = new Set<string>();
  for (const observation of observations) {
    const validation = validateMarketObservation(observation);
    if (!validation.ok) {
      errors.push(...validation.errors);
      continue;
    }
    if (String(observation.scope.tenantId) !== String(scope.tenantId)) {
      errors.push({
        code: "malformed-input",
        message: `observation '${String(observation.observationId)}' belongs to tenant '${String(observation.scope.tenantId)}', not the gateway's tenant '${String(scope.tenantId)}' — ${TENANT_ISOLATION_LAW} (cross-tenant observations are refused loudly)`,
      });
      continue;
    }
    if (String(observation.scope.projectId) !== String(scope.projectId) || String(observation.scope.worldId) !== String(scope.worldId)) {
      errors.push({
        code: "malformed-input",
        message: `observation '${String(observation.observationId)}' is outside the gateway's §14 scope — scope identity is explicit and must agree`,
      });
      continue;
    }
    if (seen.has(String(observation.observationId))) {
      errors.push({
        code: "malformed-input",
        message: `observation '${String(observation.observationId)}' is carried twice — never silently deduplicated`,
      });
      continue;
    }
    seen.add(String(observation.observationId));
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const ordered = [...observations].sort((left, right) =>
    byString(String(left.observationId), String(right.observationId)),
  );
  const byExactId = (observationId: MarketObservationId): MarketObservation | undefined =>
    ordered.find((candidate) => String(candidate.observationId) === String(observationId));
  const eligible = (order: ShadowOrder): MarketObservation | undefined =>
    ordered
      .filter(
        (observation) =>
          observation.instrumentId === order.instrumentId &&
          observation.observedAt >= order.declaredAt,
      )
      .sort((left, right) =>
        left.observedAt === right.observedAt
          ? byString(String(left.observationId), String(right.observationId))
          : left.observedAt - right.observedAt,
      )[0];
  const port: BrokerGatewayPort = {
    scope,
    listObservations: () => ordered,
    observation: (observationId: MarketObservationId): ObservationLookup => {
      const observation = byExactId(observationId);
      return observation === undefined
        ? { ok: false, errors: unknownObservation(observationId) }
        : { ok: true, observation };
    },
    submitShadowOrder: (order: ShadowOrder): ShadowSubmissionOutcome => {
      const orderErrors = validateShadowOrder(order);
      if (!orderErrors.ok) {
        return { ok: false, errors: orderErrors.errors as readonly BrokerError[] };
      }
      if (String(order.scope.tenantId) !== String(scope.tenantId)) {
        return {
          ok: false,
          errors: [
            {
              code: "malformed-input",
              message: `the order belongs to tenant '${String(order.scope.tenantId)}', not the gateway's tenant '${String(scope.tenantId)}' — ${TENANT_ISOLATION_LAW} (a cross-tenant order is refused loudly, never executed)`,
            },
          ],
        };
      }
      const match = eligible(order);
      if (match === undefined) {
        // No eligible observation: the order rests in the shadow book — the
        // acknowledged report is composed over ZERO fills (all derived data).
        const report = composeShadowExecutionReport(order, []);
        return report.ok ? report : { ok: false, errors: report.errors as readonly BrokerError[] };
      }
      const fill = composeShadowFill(order, match, order.quantity);
      if (!fill.ok) {
        return { ok: false, errors: fill.errors as readonly BrokerError[] };
      }
      const report = composeShadowExecutionReport(order, [fill.fill]);
      return report.ok ? report : { ok: false, errors: report.errors as readonly BrokerError[] };
    },
  };
  return { ok: true, port };
}
