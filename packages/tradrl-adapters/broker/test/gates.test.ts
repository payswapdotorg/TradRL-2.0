/**
 * The broker record-law suites (W065): the observation gate's laws + the
 * order gate's laws, every refusal pinned over REAL imports.
 * License: Apache-2.0 (the repository LICENSE).
 */

import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { sealSecretReference } from "security";
import { declareShadowOrder } from "../broker-order.js";
import { sealMarketObservation } from "../broker-observation.js";
import { marketObservationIdOf } from "../broker-observation.js";
import { liveTransmissionViolations } from "../broker-identity.js";
import { anObservation, anOrder, OTHER_TENANT_SCOPE, SCOPE, venueCredential } from "./fixtures.js";

describe("sealMarketObservation (the observation gate)", () => {
  it("seals a lawful observation with a content-addressed id", () => {
    const observation = anObservation();
    strictEqual(observation.observationId.startsWith("obs-"), true);
    strictEqual(observation.provenance.deriver, "seal-market-observation");
    strictEqual(
      observation.observationId,
      marketObservationIdOf({
        scope: SCOPE,
        observationKind: "top-of-book-quote",
        instrumentId: "instrument-btcusd",
        price: "5200.05",
        size: "1.5",
        side: "bid",
        observedAt: 1_000,
        availableAt: 1_000,
      }),
    );
  });

  it("refuses an unknown observation kind (closed vocabulary)", () => {
    const outcome = sealMarketObservation({
      scope: SCOPE,
      observationKind: "chain-tip" as never,
      instrumentId: "instrument-btcusd",
      price: "5200.05",
      observedAt: 1_000,
      availableAt: 1_000,
    });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      deepStrictEqual(outcome.errors.map((error) => error.code), ["unknown-observation-kind"]);
    }
  });

  it("refuses a non-positive price and an unlawful decimal (A6 — carried data)", () => {
    for (const price of ["0", "-5", "abc", "5.2.1"]) {
      const outcome = sealMarketObservation({
        scope: SCOPE,
        observationKind: "trade-print",
        instrumentId: "instrument-btcusd",
        price,
        observedAt: 1_000,
        availableAt: 1_000,
      });
      strictEqual(outcome.ok, false, `price '${price}' must be refused`);
      if (!outcome.ok) {
        strictEqual(outcome.errors.some((error) => error.code === "invalid-price"), true);
      }
    }
  });

  it("refuses an observation knowable before it printed (the availability law)", () => {
    const outcome = sealMarketObservation({
      scope: SCOPE,
      observationKind: "trade-print",
      instrumentId: "instrument-btcusd",
      price: "1",
      observedAt: 2_000,
      availableAt: 1_000,
    });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      deepStrictEqual(outcome.errors.map((error) => error.code), ["availability-before-observation"]);
    }
  });

  it("refuses a blank scope member (§14 explicit)", () => {
    const outcome = sealMarketObservation({
      scope: { tenantId: "", projectId: PROJECT_X, worldId: WORLD_X },
      observationKind: "trade-print",
      instrumentId: "instrument-btcusd",
      price: "1",
      observedAt: 1,
      availableAt: 1,
    });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      strictEqual(outcome.errors.some((error) => error.code === "invalid-scope"), true);
    }
  });

  it("refuses a secret-shaped value in the input (THE REDACTION LAW rides through W060's own scanner)", () => {
    const outcome = sealMarketObservation({
      scope: SCOPE,
      observationKind: "trade-print",
      instrumentId: "instrument-btcusd",
      price: "1",
      observedAt: 1,
      availableAt: 1,
      size: "1",
    });
    // (control: the same shape WITHOUT the secret rides fine)
    strictEqual(outcome.ok, true);
    const secretOutcome = sealMarketObservation({
      scope: SCOPE,
      observationKind: "trade-print",
      instrumentId: "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
      price: "1",
      observedAt: 1,
      availableAt: 1,
    });
    strictEqual(secretOutcome.ok, false);
    if (!secretOutcome.ok) {
      strictEqual(
        secretOutcome.errors.some((error) => error.code === "secret-value-refused" && error.message.includes("REDACTION LAW")),
        true,
      );
    }
  });

  it("refuses a live-transmission-shaped declaration LOUDLY naming R063 (THE SHADOW LAW)", () => {
    const declared = {
      scope: SCOPE,
      observationKind: "trade-print",
      instrumentId: "instrument-btcusd",
      price: "1",
      observedAt: 1,
      availableAt: 1,
      endpoint: "https://venue.example.com/feed",
    } as Parameters<typeof sealMarketObservation>[0];
    const outcome = sealMarketObservation(declared);
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      const shadow = outcome.errors.filter((error) => error.code === "live-transmission-refused");
      strictEqual(shadow.length >= 2, true); // the member AND the URL-shaped value
      strictEqual(shadow.every((error) => error.message.includes("R063")), true);
    }
    // the scanner alone finds both shapes
    const violations = liveTransmissionViolations(declared, "x");
    strictEqual(violations.length >= 2, true);
  });
});

const PROJECT_X = "project-broker";
const WORLD_X = "world-broker-tests";

describe("declareShadowOrder (the order gate)", () => {
  it("declares a lawful shadow order with a content-addressed id", () => {
    const order = anOrder();
    strictEqual(order.orderId.startsWith("sord-"), true);
    strictEqual(order.provenance.deriver, "declare-shadow-order");
    strictEqual(order.limitPrice, "5210.00");
  });

  it("refuses a limit order without a limit price (fail-closed, never silently repaired)", () => {
    const outcome = declareShadowOrder({
      scope: SCOPE,
      venueKind: "central-limit-order-book",
      orderKind: "limit",
      timeInForce: "day",
      side: "buy",
      instrumentId: "instrument-btcusd",
      quantity: "1",
      declaredAt: 1,
      credentialReference: venueCredential(),
    });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      deepStrictEqual(outcome.errors.map((error) => error.code), ["limit-price-missing"]);
    }
  });

  it("refuses a market order carrying a limit price (never silently dropped)", () => {
    const outcome = declareShadowOrder({
      scope: SCOPE,
      venueKind: "central-limit-order-book",
      orderKind: "market",
      timeInForce: "day",
      side: "buy",
      instrumentId: "instrument-btcusd",
      quantity: "1",
      limitPrice: "5210.00",
      declaredAt: 1,
      credentialReference: venueCredential(),
    });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      strictEqual(outcome.errors.some((error) => error.code === "limit-price-refused"), true);
    }
  });

  it("refuses unknown venue/order/TIF kinds (closed vocabularies) — all collected", () => {
    const outcome = declareShadowOrder({
      scope: SCOPE,
      venueKind: "dark-pool" as never,
      orderKind: "stop" as never,
      timeInForce: "at-open" as never,
      side: "buy",
      instrumentId: "instrument-btcusd",
      quantity: "1",
      declaredAt: 1,
      credentialReference: venueCredential(),
    });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      deepStrictEqual(outcome.errors.map((error) => error.code).sort(), [
        "unknown-order-kind",
        "unknown-time-in-force",
        "unknown-venue-kind",
      ]);
    }
  });

  it("re-proves the credential through W060's own validator (errors carried) and enforces R056", () => {
    const outcome = sealSecretReference({
      scope: OTHER_TENANT_SCOPE,
      kind: "api-key",
      displayName: "foreign-credential-handle",
      custody: {
        rotation: { kind: "on-every-use" },
        accessScopes: ["tenant-project-world"],
        redaction: "everywhere",
      },
    });
    strictEqual(outcome.ok, true);
    if (!outcome.ok) {
      throw new Error("unreachable");
    }
    // Build the declaration directly (the fixture helper would throw):
    const direct = declareShadowOrder({
      scope: SCOPE,
      venueKind: "central-limit-order-book",
      orderKind: "limit",
      timeInForce: "day",
      side: "buy",
      instrumentId: "instrument-btcusd",
      quantity: "1",
      limitPrice: "1",
      declaredAt: 1,
      credentialReference: outcome.reference,
    });
    strictEqual(direct.ok, false);
    if (!direct.ok) {
      const codes = direct.errors.map((error) => error.code);
      strictEqual(codes.includes("cross-tenant-credential"), true);
      strictEqual(direct.errors.some((error) => error.code === "cross-tenant-credential" && error.message.includes("R056")), true);
    }
    // a tampered credential (rewritten handle) fails W060's re-proof, verbatim
    const tampered = { ...outcome.reference, secretId: "sec-deadbeef" as never };
    const tamperedOutcome = declareShadowOrder({
      scope: OTHER_TENANT_SCOPE,
      venueKind: "central-limit-order-book",
      orderKind: "limit",
      timeInForce: "day",
      side: "buy",
      instrumentId: "instrument-btcusd",
      quantity: "1",
      limitPrice: "1",
      declaredAt: 1,
      credentialReference: tampered,
    });
    strictEqual(tamperedOutcome.ok, false);
    if (!tamperedOutcome.ok) {
      strictEqual(tamperedOutcome.errors.some((error) => error.code === "credential-invalid"), true);
    }
  });

  it("refuses a live-transmission-shaped order declaration LOUDLY naming R063", () => {
    const direct = declareShadowOrder({
      scope: SCOPE,
      venueKind: "central-limit-order-book",
      orderKind: "market",
      timeInForce: "day",
      side: "buy",
      instrumentId: "instrument-btcusd",
      quantity: "1",
      declaredAt: 1,
      credentialReference: venueCredential(),
      socket: "wss://venue.example.com/exec",
    } as never);
    strictEqual(direct.ok, false);
    if (!direct.ok) {
      const shadow = direct.errors.filter((error) => error.code === "live-transmission-refused");
      strictEqual(shadow.length >= 2, true);
      strictEqual(shadow.every((error) => error.message.includes("R063")), true);
    }
  });
});
