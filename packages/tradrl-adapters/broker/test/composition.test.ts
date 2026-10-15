/**
 * The broker composition suites (W065): the fill composition gate, the
 * execution-report composition gate, and the SHADOW port — every law
 * pinned over REAL imports. License: Apache-2.0 (the repository LICENSE).
 */

import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { composeShadowExecutionReport } from "../broker-execution.js";
import { composeShadowFill, fillPriceOf } from "../broker-fill.js";
import { shadowBrokerGateway } from "../broker-port.js";
import type { MarketObservation, ShadowFill } from "../index.js";
import { anObservation, anOrder, OTHER_TENANT_SCOPE, SCOPE, venueCredential } from "./fixtures.js";
import { declareShadowOrder } from "../broker-order.js";
import { sealMarketObservation } from "../broker-observation.js";

describe("composeShadowFill (THE COMPOSITION GATE)", () => {
  it("composes a fill whose price IS the observation's carried price (A6 structural)", () => {
    const order = anOrder();
    const observation = anObservation({ observedAt: 2_000, availableAt: 2_000, price: "5250.50" });
    const outcome = composeShadowFill(order, observation, "0.25");
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      strictEqual(fillPriceOf(outcome.fill), "5250.50");
      strictEqual(outcome.fill.fillQuantity, "0.25");
      strictEqual(outcome.fill.order.orderId, order.orderId);
      strictEqual(outcome.fill.observation.observationId, observation.observationId);
      strictEqual(outcome.fill.fillId.startsWith("sfil-"), true);
    }
  });

  it("refuses a cross-tenant order-vs-observation pair LOUDLY naming R056", () => {
    const order = anOrder();
    const observation = anObservation({ scope: OTHER_TENANT_SCOPE, observedAt: 2_000, availableAt: 2_000 });
    const outcome = composeShadowFill(order, observation, "0.25");
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      const cross = outcome.errors.find((error) => error.code === "cross-tenant-observation");
      strictEqual(cross !== undefined, true);
      strictEqual(cross?.message.includes("R056"), true);
    }
  });

  it("refuses an instrument mismatch and an observation that predates the order", () => {
    const order = anOrder();
    const otherInstrument = anObservation({ instrumentId: "instrument-ethusd", observedAt: 2_000, availableAt: 2_000 });
    const instrumentOutcome = composeShadowFill(order, otherInstrument, "0.25");
    strictEqual(instrumentOutcome.ok, false);
    if (!instrumentOutcome.ok) {
      strictEqual(instrumentOutcome.errors.some((error) => error.code === "instrument-mismatch"), true);
    }
    const stale = anObservation({ observedAt: 1_500, availableAt: 1_500 });
    const staleOutcome = composeShadowFill(order, stale, "0.25");
    strictEqual(staleOutcome.ok, false);
    if (!staleOutcome.ok) {
      strictEqual(staleOutcome.errors.some((error) => error.code === "observation-before-order"), true);
    }
  });

  it("refuses an over-order fill quantity (decimal-exact, never clamped)", () => {
    const order = anOrder(); // quantity 0.5
    const observation = anObservation({ observedAt: 2_000, availableAt: 2_000 });
    const outcome = composeShadowFill(order, observation, "0.500000001");
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      strictEqual(outcome.errors.some((error) => error.code === "fill-quantity-exceeds-order"), true);
    }
  });

  it("re-proves a tampered cited order through its own validator (errors carried verbatim)", () => {
    const order = anOrder();
    const observation = anObservation({ observedAt: 2_000, availableAt: 2_000 });
    const tamperedOrder = { ...order, quantity: "9" };
    const outcome = composeShadowFill(tamperedOrder, observation, "0.25");
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      strictEqual(outcome.errors.some((error) => error.code === "order-invalid"), true);
    }
  });
});

describe("composeShadowExecutionReport (the report gate)", () => {
  it("derives new-acknowledged over zero fills (all derived data)", () => {
    const order = anOrder();
    const outcome = composeShadowExecutionReport(order, []);
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      strictEqual(outcome.report.reportKind, "new-acknowledged");
      strictEqual(outcome.report.totalFilledQuantity, "0");
      strictEqual(outcome.report.reportId.startsWith("xrep-"), true);
    }
  });

  it("derives order-filled / order-partially-filled decimal-exact from the carried fills", () => {
    const order = anOrder(); // quantity 0.5
    const observation = anObservation({ observedAt: 2_000, availableAt: 2_000 });
    const full = composeShadowFill(order, observation, "0.5");
    strictEqual(full.ok, true);
    if (full.ok) {
      const fullReport = composeShadowExecutionReport(order, [full.fill]);
      strictEqual(fullReport.ok, true);
      if (fullReport.ok) {
        strictEqual(fullReport.report.reportKind, "order-filled");
        strictEqual(fullReport.report.totalFilledQuantity, "0.5");
      }
    }
    const partial = composeShadowFill(order, observation, "0.2");
    strictEqual(partial.ok, true);
    if (partial.ok) {
      const partialReport = composeShadowExecutionReport(order, [partial.fill]);
      strictEqual(partialReport.ok, true);
      if (partialReport.ok) {
        strictEqual(partialReport.report.reportKind, "order-partially-filled");
      }
    }
  });

  it("refuses an overfill (the fills' decimal sum exceeds the order quantity)", () => {
    const order = anOrder();
    const observation = anObservation({ observedAt: 2_000, availableAt: 2_000 });
    const first = composeShadowFill(order, observation, "0.4");
    const second = composeShadowFill(order, anObservation({ observedAt: 3_000, availableAt: 3_000, price: "5250.00" }), "0.4");
    strictEqual(first.ok && second.ok, true);
    if (first.ok && second.ok) {
      const outcome = composeShadowExecutionReport(order, [first.fill, second.fill]);
      strictEqual(outcome.ok, false);
      if (!outcome.ok) {
        strictEqual(outcome.errors.some((error) => error.code === "overfill"), true);
      }
    }
  });

  it("refuses a foreign fill and a duplicate fill; carries fills in canonical fill-id order", () => {
    const order = anOrder();
    const observation = anObservation({ observedAt: 2_000, availableAt: 2_000 });
    const ownFill = composeShadowFill(order, observation, "0.1");
    const otherOrder = anOrder({ declaredAt: 2_500 });
    const foreignFill = composeShadowFill(otherOrder, anObservation({ observedAt: 3_000, availableAt: 3_000 }), "0.1");
    strictEqual(ownFill.ok && foreignFill.ok, true);
    if (ownFill.ok && foreignFill.ok) {
      const foreign = composeShadowExecutionReport(order, [foreignFill.fill]);
      strictEqual(foreign.ok, false);
      if (!foreign.ok) {
        strictEqual(foreign.errors.some((error) => error.code === "foreign-fill"), true);
      }
      const duplicate = composeShadowExecutionReport(order, [ownFill.fill, ownFill.fill]);
      strictEqual(duplicate.ok, false);
      if (!duplicate.ok) {
        strictEqual(duplicate.errors.some((error) => error.code === "duplicate-fill"), true);
      }
      // a same-order fill via a different observation is lawful and canonically ordered
      const secondFill = composeShadowFill(order, anObservation({ observedAt: 4_000, availableAt: 4_000, price: "5300.00" }), "0.1");
      strictEqual(secondFill.ok, true);
      if (secondFill.ok) {
        const outcome = composeShadowExecutionReport(order, [secondFill.fill, ownFill.fill]);
        strictEqual(outcome.ok, true);
        if (outcome.ok) {
          deepStrictEqual(
            outcome.report.fills.map((fill) => String(fill.fillId)),
            [ownFill.fill, secondFill.fill].map((fill) => String(fill.fillId)).sort(),
          );
        }
      }
    }
  });
});

describe("shadowBrokerGateway (THE SHADOW PORT — R063)", () => {
  it("serves observations in canonical id order and resolves by exact id, fail-closed", () => {
    const observations = [
      anObservation({ observedAt: 2_000, availableAt: 2_000, price: "5200.05" }),
      anObservation({ observedAt: 3_000, availableAt: 3_000, price: "5250.00" }),
    ];
    const gateway = shadowBrokerGateway(SCOPE, [observations[1]!, observations[0]!]);
    strictEqual(gateway.ok, true);
    if (gateway.ok) {
      const port = gateway.port;
      deepStrictEqual(
        port.listObservations().map((observation) => String(observation.observationId)),
        [...observations].map((observation) => String(observation.observationId)).sort(),
      );
      strictEqual(port.observation(observations[0]!.observationId).ok, true);
      const miss = port.observation("obs-00000000" as never);
      strictEqual(miss.ok, false);
    }
  });

  it("submits an order to the SHADOW path: a full fill at the first eligible observation's price", () => {
    const observations = [
      anObservation({ observedAt: 1_500, availableAt: 1_500, price: "5100.00" }), // before declaredAt 2_000 — ineligible
      anObservation({ observedAt: 2_500, availableAt: 2_500, price: "5250.00" }),
      anObservation({ observedAt: 3_500, availableAt: 3_500, price: "5300.00" }),
    ];
    const order = anOrder(); // declaredAt 2_000, quantity 0.5
    const gateway = shadowBrokerGateway(SCOPE, observations);
    strictEqual(gateway.ok, true);
    if (gateway.ok) {
      const outcome = gateway.port.submitShadowOrder(order);
      strictEqual(outcome.ok, true);
      if (outcome.ok) {
        strictEqual(outcome.report.reportKind, "order-filled");
        strictEqual(fillPriceOf(outcome.report.fills[0] as ShadowFill), "5250.00");
      }
    }
  });

  it("composes an acknowledged report over zero fills when no observation is eligible", () => {
    const order = anOrder(); // instrument-btcusd, declaredAt 2_000
    const wrongInstrument = anObservation({ instrumentId: "instrument-ethusd", observedAt: 5_000, availableAt: 5_000 });
    const gateway = shadowBrokerGateway(SCOPE, [wrongInstrument]);
    strictEqual(gateway.ok, true);
    if (gateway.ok) {
      const outcome = gateway.port.submitShadowOrder(order);
      strictEqual(outcome.ok, true);
      if (outcome.ok) {
        strictEqual(outcome.report.reportKind, "new-acknowledged");
        deepStrictEqual(outcome.report.fills, []);
      }
    }
  });

  it("refuses a cross-tenant order at the port (R056 loud) and re-proves a tampered order", () => {
    const observations: readonly MarketObservation[] = [anObservation({ observedAt: 3_000, availableAt: 3_000 })];
    const gateway = shadowBrokerGateway(SCOPE, observations);
    strictEqual(gateway.ok, true);
    if (gateway.ok) {
      const foreignOrder = declareShadowOrder({
        scope: OTHER_TENANT_SCOPE,
        venueKind: "central-limit-order-book",
        orderKind: "limit",
        timeInForce: "day",
        side: "buy",
        instrumentId: "instrument-btcusd",
        quantity: "1",
        limitPrice: "1",
        declaredAt: 1,
        credentialReference: venueCredential(OTHER_TENANT_SCOPE),
      });
      strictEqual(foreignOrder.ok, true);
      if (foreignOrder.ok) {
        const outcome = gateway.port.submitShadowOrder(foreignOrder.order);
        strictEqual(outcome.ok, false);
        if (!outcome.ok) {
          strictEqual(outcome.errors.some((error) => error.message.includes("R056")), true);
        }
      }
      const tampered = { ...anOrder(), quantity: "999" };
      const tamperedOutcome = gateway.port.submitShadowOrder(tampered);
      strictEqual(tamperedOutcome.ok, false);
    }
  });

  it("refuses a cross-tenant carried observation at construction (R056 loud)", () => {
    const foreign = sealMarketObservation({
      scope: OTHER_TENANT_SCOPE,
      observationKind: "trade-print",
      instrumentId: "instrument-btcusd",
      price: "1",
      observedAt: 1,
      availableAt: 1,
    });
    strictEqual(foreign.ok, true);
    if (foreign.ok) {
      const gateway = shadowBrokerGateway(SCOPE, [foreign.observation]);
      strictEqual(gateway.ok, false);
      if (!gateway.ok) {
        strictEqual(gateway.errors.some((error) => error.message.includes("R056")), true);
      }
    }
  });
});
