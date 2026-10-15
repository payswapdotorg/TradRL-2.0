/**
 * The mirror-session gate suites (W065): the point-in-time law, the
 * real-source laws, the isolation law — every refusal pinned over REAL
 * imports (the W050 view composed through W050's OWN gates).
 * License: Apache-2.0 (the repository LICENSE).
 */

import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { sealMarketObservation } from "tradrl-adapters-broker";
import { openLiveMirrorSession } from "../session.js";
import {
  CUTOFF_MS,
  OTHER_SCOPE,
  SCOPE,
  aMarketEvent,
  aView,
  anObservation,
  anOrder,
  cutoffOf,
  happyInputs,
} from "./fixtures.js";

describe("openLiveMirrorSession (THE MIRROR COMPOSITION GATE)", () => {
  it("opens the happy mirror session — real observations in, canonical orders (A9)", () => {
    const { view, observations, orders } = happyInputs();
    const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders });
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      const session = outcome.session;
      strictEqual(session.sessionId.startsWith("mirror-"), true);
      strictEqual(session.cutoff, CUTOFF_MS);
      deepStrictEqual(
        session.observations.map((observation) => String(observation.observationId)),
        [...session.observations].map((observation) => String(observation.observationId)).sort(),
      );
      deepStrictEqual(
        session.orders.map((order) => String(order.orderId)),
        [...session.orders].map((order) => String(order.orderId)).sort(),
      );
      // the view rides VERBATIM
      deepStrictEqual(session.view, view);
    }
  });

  it("the session cutoff IS the sealed view's cutoff — a wider session is refused (R016)", () => {
    const { view, observations, orders } = happyInputs();
    const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(CUTOFF_MS + 1), view, observations, orders });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      strictEqual(outcome.errors.some((error) => error.code === "cutoff-view-mismatch" && error.message.includes("R016")), true);
    }
  });

  it("refuses a post-cutoff observation LOUDLY naming R016 (invisible before availableAt)", () => {
    const events = [aMarketEvent(5_000, "5200.05"), aMarketEvent(20_000, "5400.00")];
    const view = aView([events[0]!]); // the view is sealed at cutoff 10_000 — only the first event
    const lawful = anObservation(view, events[0]!);
    // an observation whose OWN availability is after the cutoff (not projected from the view)
    const late = sealMarketObservation({
      scope: SCOPE,
      observationKind: "top-of-book-quote",
      instrumentId: "instrument-btcusd",
      price: "5400.00",
      observedAt: 11_000,
      availableAt: 11_000,
      source: { viewId: String(view.viewId), recordId: String(events[0]!.eventId) },
    });
    strictEqual(late.ok, true);
    if (late.ok) {
      const outcome = openLiveMirrorSession({
        scope: SCOPE,
        cutoff: cutoffOf(),
        view,
        observations: [lawful, late.observation],
        orders: [],
      });
      strictEqual(outcome.ok, false);
      if (!outcome.ok) {
        const refusal = outcome.errors.find((error) => error.code === "post-cutoff-observation");
        strictEqual(refusal !== undefined, true);
        strictEqual(refusal?.message.includes("R016"), true);
      }
    }
  });

  it("refuses an observation that cites another view / an unknown record / no source at all", () => {
    const { view, observations, orders } = happyInputs();
    const otherView = aView([aMarketEvent(5_000, "5200.05")]);
    const foreignCitation = sealMarketObservation({
      scope: SCOPE,
      observationKind: "top-of-book-quote",
      instrumentId: "instrument-btcusd",
      price: "5200.05",
      observedAt: 5_000,
      availableAt: 5_000,
      source: { viewId: String(otherView.viewId), recordId: String(observations[0]!.source?.recordId) },
    });
    strictEqual(foreignCitation.ok, true);
    if (foreignCitation.ok) {
      const foreign = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations: [foreignCitation.observation], orders });
      strictEqual(foreign.ok, false);
      if (!foreign.ok) {
        strictEqual(foreign.errors.some((error) => error.code === "observation-source-view-mismatch"), true);
      }
    }
    const unknownRecord = sealMarketObservation({
      scope: SCOPE,
      observationKind: "top-of-book-quote",
      instrumentId: "instrument-btcusd",
      price: "5200.05",
      observedAt: 5_000,
      availableAt: 5_000,
      source: { viewId: String(view.viewId), recordId: "evt-not-in-view" },
    });
    strictEqual(unknownRecord.ok, true);
    if (unknownRecord.ok) {
      const unknown = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations: [unknownRecord.observation], orders });
      strictEqual(unknown.ok, false);
      if (!unknown.ok) {
        strictEqual(unknown.errors.some((error) => error.code === "observation-source-record-unknown"), true);
      }
    }
    const sourceless = sealMarketObservation({
      scope: SCOPE,
      observationKind: "top-of-book-quote",
      instrumentId: "instrument-btcusd",
      price: "5200.05",
      observedAt: 5_000,
      availableAt: 5_000,
    });
    strictEqual(sourceless.ok, true);
    if (sourceless.ok) {
      const noSource = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations: [sourceless.observation], orders });
      strictEqual(noSource.ok, false);
      if (!noSource.ok) {
        strictEqual(noSource.errors.some((error) => error.code === "observation-source-missing"), true);
      }
    }
  });

  it("refuses an observation whose timestamps are NOT its cited event's own (the projection law)", () => {
    const events = [aMarketEvent(5_000, "5200.05")];
    const view = aView(events);
    const drifted = sealMarketObservation({
      scope: SCOPE,
      observationKind: "top-of-book-quote",
      instrumentId: "instrument-btcusd",
      price: "5200.05",
      observedAt: 5_001,
      availableAt: 5_001,
      source: { viewId: String(view.viewId), recordId: String(events[0]!.eventId) },
    });
    strictEqual(drifted.ok, true);
    if (drifted.ok) {
      const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations: [drifted.observation], orders: [] });
      strictEqual(outcome.ok, false);
      if (!outcome.ok) {
        strictEqual(outcome.errors.some((error) => error.code === "observation-time-projection-mismatch"), true);
      }
    }
  });

  it("refuses cross-tenant views and orders LOUDLY naming R056 (the isolation law)", () => {
    const { view, observations } = happyInputs();
    const foreignView = aView([aMarketEvent(5_000, "5200.05")], CUTOFF_MS, OTHER_SCOPE);
    const foreignOrder = anOrder({}, OTHER_SCOPE);
    const crossView = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view: foreignView, observations, orders: [] });
    strictEqual(crossView.ok, false);
    if (!crossView.ok) {
      const refusal = crossView.errors.find((error) => error.code === "cross-tenant-view");
      strictEqual(refusal !== undefined, true);
      strictEqual(refusal?.message.includes("R056"), true);
    }
    const crossOrder = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders: [foreignOrder] });
    strictEqual(crossOrder.ok, false);
    if (!crossOrder.ok) {
      strictEqual(crossOrder.errors.some((error) => error.code === "cross-tenant-order"), true);
    }
  });

  it("refuses a post-cutoff order (an order may not rest on future knowledge — R016) and duplicates", () => {
    const { view, observations, orders } = happyInputs();
    const futureOrder = anOrder({ declaredAt: 11_000 });
    const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders: [futureOrder] });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      const refusal = outcome.errors.find((error) => error.code === "post-cutoff-order");
      strictEqual(refusal !== undefined, true);
      strictEqual(refusal?.message.includes("R016"), true);
    }
    const duplicated = openLiveMirrorSession({
      scope: SCOPE,
      cutoff: cutoffOf(),
      view,
      observations,
      orders: [orders[0]!, orders[0]!],
    });
    strictEqual(duplicated.ok, false);
    if (!duplicated.ok) {
      strictEqual(duplicated.errors.some((error) => error.code === "duplicate-order"), true);
    }
  });

  it("refuses an unlawful view through W050's own validator (errors carried verbatim)", () => {
    const { view, observations, orders } = happyInputs();
    const tamperedView = { ...view, viewId: "pitv-deadbeef" as typeof view.viewId };
    const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view: tamperedView, observations, orders });
    strictEqual(outcome.ok, false);
    if (!outcome.ok) {
      const refusal = outcome.errors.find((error) => error.code === "view-invalid");
      strictEqual(refusal !== undefined, true);
      strictEqual(refusal?.message.includes("verbatim"), true);
    }
  });

  it("session ids weigh the TENANT FIRST — the same declaration under two tenants is two sessions (R056)", () => {
    const first = happyInputs();
    const foreignEvents = [aMarketEvent(5_000, "5200.05")];
    const foreignView = aView(foreignEvents, CUTOFF_MS, OTHER_SCOPE);
    const foreignObservation = (() => {
      const outcome = sealMarketObservation({
        scope: OTHER_SCOPE,
        observationKind: "top-of-book-quote",
        instrumentId: "instrument-btcusd",
        price: "5200.05",
        observedAt: 5_000,
        availableAt: 5_000,
        source: { viewId: String(foreignView.viewId), recordId: String(foreignEvents[0]!.eventId) },
      });
      if (!outcome.ok) {
        throw new Error("unreachable");
      }
      return outcome.observation;
    })();
    const foreignOrder = anOrder({}, OTHER_SCOPE);
    const one = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view: first.view, observations: first.observations, orders: first.orders });
    const two = openLiveMirrorSession({ scope: OTHER_SCOPE, cutoff: cutoffOf(), view: foreignView, observations: [foreignObservation], orders: [foreignOrder] });
    strictEqual(one.ok && two.ok, true);
    if (one.ok && two.ok) {
      strictEqual(one.session.sessionId === two.session.sessionId, false);
    }
  });
});
