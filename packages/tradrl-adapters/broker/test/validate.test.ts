/**
 * The whole-record re-validation + A9 twin suites (W065). License:
 * Apache-2.0 (the repository LICENSE).
 */

import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { composeShadowExecutionReport } from "../broker-execution.js";
import { composeShadowFill } from "../broker-fill.js";
import { declareShadowOrder } from "../broker-order.js";
import { sealMarketObservation } from "../broker-observation.js";
import { validateMarketObservation, validateShadowExecutionReport, validateShadowFill, validateShadowOrder } from "../validate.js";
import { anObservation, anOrder, SCOPE, venueCredential } from "./fixtures.js";

describe("validateMarketObservation (whole-record re-proof)", () => {
  it("re-validates a lawful observation", () => {
    strictEqual(validateMarketObservation(anObservation()).ok, true);
  });

  it("catches a rewritten observation through the id re-derivation (A9)", () => {
    const observation = anObservation();
    const tampered = { ...observation, price: "9999.99" };
    const outcome = validateMarketObservation(tampered);
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      strictEqual(outcome.errors.some((error) => error.code === "observation-id-mismatch"), true);
    }
  });
});

describe("validateShadowOrder (whole-record re-proof)", () => {
  it("re-validates a lawful order (credential re-proven through W060)", () => {
    strictEqual(validateShadowOrder(anOrder()).ok, true);
  });

  it("catches a rewritten order through the id re-derivation and the credential re-proof", () => {
    const order = anOrder();
    const tamperedQuantity = { ...order, quantity: "100" };
    const outcome = validateShadowOrder(tamperedQuantity);
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      strictEqual(outcome.errors.some((error) => error.code === "order-id-mismatch"), true);
    }
    const tamperedCredential = { ...order, credentialReference: { ...order.credentialReference, displayName: "" } };
    const credentialOutcome = validateShadowOrder(tamperedCredential);
    strictEqual(credentialOutcome.ok, false);
    if (!credentialOutcome.ok) {
      strictEqual(credentialOutcome.errors.some((error) => error.code === "credential-invalid"), true);
    }
  });
});

describe("validateShadowFill / validateShadowExecutionReport (whole-record re-proof)", () => {
  it("re-validates a lawful fill and a lawful report (cited records re-proven)", () => {
    const order = anOrder();
    const observation = anObservation({ observedAt: 2_000, availableAt: 2_000 });
    const fill = composeShadowFill(order, observation, "0.5");
    strictEqual(fill.ok, true);
    if (fill.ok) {
      strictEqual(validateShadowFill(fill.fill).ok, true);
      const report = composeShadowExecutionReport(order, [fill.fill]);
      strictEqual(report.ok, true);
      if (report.ok) {
        strictEqual(validateShadowExecutionReport(report.report).ok, true);
      }
    }
  });

  it("catches a rewritten fill through the fill-id re-derivation + the cited-record re-proofs", () => {
    const order = anOrder();
    const observation = anObservation({ observedAt: 2_000, availableAt: 2_000 });
    const fill = composeShadowFill(order, observation, "0.5");
    strictEqual(fill.ok, true);
    if (fill.ok) {
      const tampered = { ...fill.fill, fillQuantity: "0.1" };
      const outcome = validateShadowFill(tampered);
      strictEqual(outcome.ok, false);
      if (!outcome.ok) {
        strictEqual(outcome.errors.some((error) => error.code === "fill-id-mismatch"), true);
      }
      const tamperedObservation = { ...fill.fill, observation: { ...observation, price: "1" } };
      const observationOutcome = validateShadowFill(tamperedObservation);
      strictEqual(observationOutcome.ok, false);
      if (!observationOutcome.ok) {
        strictEqual(observationOutcome.errors.some((error) => error.code === "observation-invalid"), true);
      }
    }
  });

  it("catches a declared report kind that disagrees with the DERIVED kind (A6)", () => {
    const order = anOrder();
    const report = composeShadowExecutionReport(order, []);
    strictEqual(report.ok, true);
    if (report.ok) {
      const tampered = { ...report.report, reportKind: "order-filled" as never };
      const outcome = validateShadowExecutionReport(tampered);
      strictEqual(outcome.ok, false);
      if (!outcome.ok) {
        strictEqual(outcome.errors.some((error) => error.code === "report-kind-mismatch"), true);
      }
    }
  });
});

describe("A9 twins (determinism — the declarer's input order never leaks)", () => {
  it("same declaration ⇒ deep-equal observation, same id; any differing byte ⇒ another id", () => {
    const first = sealMarketObservation({
      scope: SCOPE,
      observationKind: "trade-print",
      instrumentId: "instrument-btcusd",
      price: "5200.05",
      observedAt: 1_000,
      availableAt: 1_000,
    });
    const second = sealMarketObservation({
      availableAt: 1_000,
      observedAt: 1_000,
      price: "5200.05",
      instrumentId: "instrument-btcusd",
      observationKind: "trade-print",
      scope: SCOPE,
    });
    strictEqual(first.ok && second.ok, true);
    if (first.ok && second.ok) {
      deepStrictEqual(first.observation, second.observation);
    }
    const differing = sealMarketObservation({
      scope: SCOPE,
      observationKind: "trade-print",
      instrumentId: "instrument-btcusd",
      price: "5200.06",
      observedAt: 1_000,
      availableAt: 1_000,
    });
    strictEqual(differing.ok, true);
    if (differing.ok && first.ok) {
      strictEqual(differing.observation.observationId === first.observation.observationId, false);
    }
  });

  it("the tenant weighs FIRST: the same declaration under two tenants is two orders (R056 structural)", () => {
    const first = anOrder();
    const second = declareShadowOrder({
      scope: { tenantId: "tenant-broker-other", projectId: "project-broker", worldId: "world-broker-tests" },
      venueKind: first.venueKind,
      orderKind: first.orderKind,
      timeInForce: first.timeInForce,
      side: first.side,
      instrumentId: first.instrumentId,
      quantity: first.quantity,
      limitPrice: first.limitPrice,
      declaredAt: first.declaredAt,
      credentialReference: venueCredential({ tenantId: "tenant-broker-other", projectId: "project-broker", worldId: "world-broker-tests" }),
    });
    strictEqual(second.ok, true);
    if (second.ok) {
      strictEqual(second.order.orderId === first.orderId, false);
    }
  });

  it("same order + observation ⇒ deep-equal fill; report input order never leaks", () => {
    const order = anOrder();
    const firstObservation = anObservation({ observedAt: 2_500, availableAt: 2_500, price: "5250.00" });
    const secondObservation = anObservation({ observedAt: 3_500, availableAt: 3_500, price: "5300.00" });
    const fillA = composeShadowFill(order, firstObservation, "0.1");
    const fillB = composeShadowFill(order, secondObservation, "0.1");
    strictEqual(fillA.ok && fillB.ok, true);
    if (fillA.ok && fillB.ok) {
      const first = composeShadowExecutionReport(order, [fillA.fill, fillB.fill]);
      const second = composeShadowExecutionReport(order, [fillB.fill, fillA.fill]);
      strictEqual(first.ok && second.ok, true);
      if (first.ok && second.ok) {
        deepStrictEqual(first.report, second.report);
      }
    }
  });
});
