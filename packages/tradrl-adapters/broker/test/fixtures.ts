/**
 * REAL record builders for the W065 broker adapter tests (the no-shim law,
 * the W057 arena fixture precedent): the W060 secret reference is built
 * through packages/security's OWN sealSecretReference gate (never
 * hand-forged — THE REDACTION LAW's fixture discipline), the market
 * observation through the adapter's own sealMarketObservation gate, the
 * shadow order through declareShadowOrder. Only opaque-id leaf values are
 * plain literals. License: Apache-2.0 (the repository LICENSE).
 */

import { sealSecretReference } from "security";
import type { SecretReference } from "security";
import { declareShadowOrder } from "../broker-order.js";
import { sealMarketObservation } from "../broker-observation.js";
import type { MarketObservation } from "../broker-observation.js";
import type { ShadowOrder } from "../broker-order.js";

export const TENANT = "tenant-broker-tests";
export const PROJECT = "project-broker";
export const WORLD = "world-broker-tests";
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };
export const OTHER_TENANT_SCOPE = {
  tenantId: "tenant-broker-other",
  projectId: PROJECT,
  worldId: WORLD,
};

/** A REAL W060 secret reference — sealed through security's own gate. */
export function venueCredential(scope = SCOPE): SecretReference {
  const outcome = sealSecretReference({
    scope,
    kind: "api-key",
    displayName: "venue-credential-handle",
    custody: {
      rotation: { kind: "on-every-use" },
      accessScopes: ["tenant-project-world"],
      redaction: "everywhere",
    },
  });
  if (!outcome.ok) {
    throw new Error(`fixture credential failed W060's gate: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.reference;
}

/** One REAL market observation through the adapter's own gate. */
export function anObservation(overrides: Partial<Parameters<typeof sealMarketObservation>[0]> = {}): MarketObservation {
  const outcome = sealMarketObservation({
    scope: SCOPE,
    observationKind: "top-of-book-quote",
    instrumentId: "instrument-btcusd",
    price: "5200.05",
    size: "1.5",
    side: "bid",
    observedAt: 1_000,
    availableAt: 1_000,
    ...overrides,
  });
  if (!outcome.ok) {
    throw new Error(`fixture observation failed the gate: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.observation;
}

/** One REAL shadow order through the adapter's own gate. */
export function anOrder(
  overrides: Partial<Omit<Parameters<typeof declareShadowOrder>[0], "credentialReference">> = {},
  credential = venueCredential(),
): ShadowOrder {
  const outcome = declareShadowOrder({
    scope: SCOPE,
    venueKind: "central-limit-order-book",
    orderKind: "limit",
    timeInForce: "day",
    side: "buy",
    instrumentId: "instrument-btcusd",
    quantity: "0.5",
    limitPrice: "5210.00",
    declaredAt: 2_000,
    credentialReference: credential,
    ...overrides,
  });
  if (!outcome.ok) {
    throw new Error(`fixture order failed the gate: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.order;
}
