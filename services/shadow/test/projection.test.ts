/**
 * The mirror projection + audit suites (W065): the simulated half composed
 * deterministically (A6), and the auditable steps through W061's own
 * contracts + operations' own trail laws. License: Apache-2.0 (the
 * repository LICENSE).
 */

import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { verifyTrail } from "operations";
import { fillPriceOf } from "tradrl-adapters-broker";
import { composeMirrorProjection } from "../projection.js";
import { mirrorSessionAudit } from "../audit.js";
import { openLiveMirrorSession } from "../session.js";
import { SCOPE, cutoffOf, happyInputs } from "./fixtures.js";

function happySession() {
  const { view, observations, orders } = happyInputs();
  const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders });
  if (!outcome.ok) {
    throw new Error(`fixture session failed to open: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.session;
}

describe("composeMirrorProjection (the simulated half — never live execution)", () => {
  it("composes fills through the REAL adapter gate; every fill price IS its observation's price (A6)", () => {
    const session = happySession();
    const outcome = composeMirrorProjection(session);
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      const projection = outcome.projection;
      strictEqual(projection.fills.length, 2);
      for (const fill of projection.fills) {
        strictEqual(fillPriceOf(fill), fill.observation.price);
        strictEqual(fill.order.orderId.startsWith("sord-"), true);
      }
      strictEqual(projection.projectionId.startsWith("proj-"), true);
    }
  });

  it("derives positions decimal-exact (buy + sell netting) and carries unfilled orders", () => {
    const session = happySession();
    const outcome = composeMirrorProjection(session);
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      const projection = outcome.projection;
      const position = projection.positions[0];
      strictEqual(position?.instrumentId, "instrument-btcusd");
      // buy 0.5 at 5250.50 (first eligible observation at/after declaredAt 5_500) then sell 0.2 at 5300.75
      strictEqual(position?.netQuantity, "0.3");
      // basis = 0.5×5250.50 + 0.2×5300.75 = 2625.25 + 1060.15 = 3685.4 (canonical decimal)
      strictEqual(position?.notionalBasis, "3685.4");
      strictEqual(position?.fillCount, 2);
      strictEqual(projection.unfilledOrderIds.length, 1); // the eth order rests unfilled
      strictEqual(projection.unfilledOrderIds[0]?.startsWith("sord-"), true);
    }
  });

  it("is deterministic — the same session always yields the deep-equal projection (A9)", () => {
    const session = happySession();
    const first = composeMirrorProjection(session);
    const second = composeMirrorProjection(session);
    strictEqual(first.ok && second.ok, true);
    if (first.ok && second.ok) {
      deepStrictEqual(first.projection, second.projection);
    }
  });

  it("never executes live: the projection is composed typed data only (structural — R063)", () => {
    const session = happySession();
    const outcome = composeMirrorProjection(session);
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      // the projection carries ONLY composed records: fills + derived positions + carried ids
      strictEqual(typeof outcome.projection.projectionId, "string");
      strictEqual(Array.isArray(outcome.projection.fills), true);
      strictEqual(Array.isArray(outcome.projection.positions), true);
      strictEqual(Array.isArray(outcome.projection.unfilledOrderIds), true);
    }
  });
});

describe("mirrorSessionAudit (W061 events + the operations trail)", () => {
  it("mints the typed audit records + the session-recorded event and a VERIFIED trail", () => {
    const session = happySession();
    const projection = composeMirrorProjection(session);
    strictEqual(projection.ok, true);
    if (projection.ok) {
      const outcome = mirrorSessionAudit(session, projection.projection);
      strictEqual(outcome.ok, true);
      if (outcome.ok) {
        strictEqual(outcome.trail.records.length, 3);
        deepStrictEqual(
          outcome.trail.records.map((record) => record.action),
          ["world-accessed", "record-written", "report-composed"],
        );
        strictEqual(outcome.event.kind, "session-recorded");
        strictEqual(outcome.event.payload.kind, "session-recorded");
        // the trail verifies END-TO-END through operations' own tamper gate
        const verification = verifyTrail(outcome.trail);
        strictEqual(verification.ok, true);
        if (verification.ok) {
          strictEqual(verification.recordCount, 3);
        }
      }
    }
  });

  it("is deterministic — the same session + projection mint the same trail + event (A9)", () => {
    const session = happySession();
    const projection = composeMirrorProjection(session);
    strictEqual(projection.ok, true);
    if (projection.ok) {
      const first = mirrorSessionAudit(session, projection.projection);
      const second = mirrorSessionAudit(session, projection.projection);
      strictEqual(first.ok && second.ok, true);
      if (first.ok && second.ok) {
        deepStrictEqual(first.trail, second.trail);
        deepStrictEqual(first.event, second.event);
      }
    }
  });
});
