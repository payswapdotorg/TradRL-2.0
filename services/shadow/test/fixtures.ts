/**
 * REAL record builders for the W065 shadow service tests (the no-shim law):
 * the W004 market events are hand-fixed world-journal envelopes in the
 * QuoteUpdatePayload shape (the W050 services/time-machine fixture pattern,
 * adapted in-place — disclosed), the sealed W050 point-in-time view is
 * composed through W050's OWN buildPointInTimeQuery + sealView gates, the
 * observations are sealed through the W065 broker adapter's own gate with
 * REAL source citations, the orders through declareShadowOrder with a REAL
 * W060 secret reference (packages/security's own gate — never hand-forged).
 * License: Apache-2.0 (the repository LICENSE).
 */

import type {
  CausationId,
  CorrelationId,
  EventId,
  InstrumentId,
  Price,
  ProducerId,
  Quantity,
  SequenceNumber,
  TenantId,
  WorldEventEnvelope,
  WorldId,
} from "tradrl-world-contracts";
import type { ProjectId, TimestampMs } from "tradrl-world-contracts";
import { asPointInTimeCutoff, buildPointInTimeQuery, sealView } from "tradrl-time-machine";
import type { PointInTimeCutoff, PointInTimeView, ViewRecord } from "tradrl-time-machine";
import { declareShadowOrder } from "tradrl-adapters-broker";
import { sealMarketObservation } from "tradrl-adapters-broker";
import type { MarketObservation, ShadowOrder } from "tradrl-adapters-broker";
import { sealSecretReference } from "security";
import type { SecretReference } from "security";

export const TENANT = "tenant-shadow-tests" as TenantId;
export const PROJECT = "project-shadow" as ProjectId;
export const WORLD = "world-shadow-tests" as WorldId;
export const SCOPE = { tenantId: TENANT, projectId: PROJECT, worldId: WORLD };
export const OTHER_TENANT = "tenant-shadow-other" as TenantId;
export const OTHER_SCOPE = { tenantId: OTHER_TENANT, projectId: PROJECT, worldId: WORLD };

/** A REAL W060 secret reference — sealed through security's own gate. */
export function venueCredential(scope = SCOPE): SecretReference {
  const outcome = sealSecretReference({
    scope,
    kind: "api-key",
    displayName: "mirror-credential-handle",
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

let eventCounter = 0;

/** The W004 timestamp cast (declared simulation-axis ms → the branded type). */
function at(ms: number): TimestampMs {
  return ms as TimestampMs;
}

/** One W004 market event (quote update) — the W050 fixture pattern. */
export function aMarketEvent(
  occurredAt: number,
  price = "5200.05",
  availableAt?: number,
  instrument = "instrument-btcusd",
): WorldEventEnvelope {
  eventCounter += 1;
  return {
    worldId: WORLD,
    sequence: eventCounter as SequenceNumber,
    eventId: `evt-shadow-${String(eventCounter)}` as EventId,
    eventType: "market.quote.updated",
    occurredAt: at(occurredAt),
    ...(availableAt === undefined ? {} : { availableAt: at(availableAt) }),
    causationId: "cause-shadow" as CausationId,
    correlationId: "corr-shadow" as CorrelationId,
    producer: "producer-shadow" as ProducerId,
    schemaVersion: "shadow.fixture@1",
    payload: {
      type: "market.quote.updated",
      instrumentId: instrument as InstrumentId,
      bid: price as Price,
      ask: price as Price,
      bidSize: "1.5" as Quantity,
      askSize: "0.75" as Quantity,
    },
  };
}

/** The W050 view record projection of one market event. */
export function aViewRecord(event: WorldEventEnvelope): ViewRecord {
  return { family: "market-event", recordId: event.eventId, event };
}

export const CUTOFF_MS = 10_000;

/** A REAL sealed W050 view over the fixture events (W050's OWN gates). */
export function aView(
  events: readonly WorldEventEnvelope[],
  cutoffMs = CUTOFF_MS,
  scope = SCOPE,
): PointInTimeView {
  const query = buildPointInTimeQuery({
    scope,
    cutoff: asPointInTimeCutoff(cutoffMs),
    families: ["market-event"],
  });
  if (!query.ok) {
    throw new Error(`fixture query failed: ${query.errors[0]?.message ?? "unknown"}`);
  }
  const sealed = sealView(query.query, events.map(aViewRecord));
  if (!sealed.ok) {
    throw new Error(`fixture view failed to seal: ${sealed.refusal.message}`);
  }
  return sealed.view;
}

/** The fixture cutoff (declared simulation-axis data). */
export function cutoffOf(ms = CUTOFF_MS): PointInTimeCutoff {
  return asPointInTimeCutoff(ms);
}

/** One REAL observation projected from a sealed view's event (the adapter's own gate). */
export function anObservation(
  view: PointInTimeView,
  event: WorldEventEnvelope,
  overrides: { price?: string; instrumentId?: string } = {},
): MarketObservation {
  const availableAt = event.availableAt ?? event.occurredAt;
  const outcome = sealMarketObservation({
    scope: SCOPE,
    observationKind: "top-of-book-quote",
    instrumentId: overrides.instrumentId ?? "instrument-btcusd",
    price: overrides.price ?? "5200.05",
    side: "bid",
    observedAt: event.occurredAt,
    availableAt,
    source: { viewId: String(view.viewId), recordId: String(event.eventId) },
  });
  if (!outcome.ok) {
    throw new Error(`fixture observation failed the gate: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.observation;
}

/** One REAL shadow order through the adapter's own gate. */
export function anOrder(
  overrides: Partial<Omit<Parameters<typeof declareShadowOrder>[0], "credentialReference" | "scope">> = {},
  scope = SCOPE,
): ShadowOrder {
  const outcome = declareShadowOrder({
    scope,
    venueKind: "central-limit-order-book",
    orderKind: "market",
    timeInForce: "immediate-or-cancel",
    side: "buy",
    instrumentId: "instrument-btcusd",
    quantity: "0.5",
    declaredAt: 5_000,
    credentialReference: venueCredential(scope),
    ...overrides,
  });
  if (!outcome.ok) {
    throw new Error(`fixture order failed the gate: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.order;
}

/** The happy mirror-session declaration inputs. */
export function happyInputs(): {
  view: PointInTimeView;
  events: readonly WorldEventEnvelope[];
  observations: readonly MarketObservation[];
  orders: readonly ShadowOrder[];
} {
  const events = [
    aMarketEvent(5_000, "5200.05"),
    aMarketEvent(6_000, "5250.50"),
    aMarketEvent(7_000, "5300.75", 9_000),
  ];
  const view = aView(events);
  const observations = events.map((event) =>
    anObservation(view, event, { price: (event.payload as { bid: string }).bid }),
  );
  const orders = [
    anOrder({ declaredAt: 5_500, side: "buy", quantity: "0.5" }),
    anOrder({ declaredAt: 6_500, side: "sell", quantity: "0.2", instrumentId: "instrument-btcusd" }),
    anOrder({ declaredAt: 8_000, instrumentId: "instrument-ethusd" }), // no eth observation → unfilled
  ];
  return { view, events, observations, orders };
}
