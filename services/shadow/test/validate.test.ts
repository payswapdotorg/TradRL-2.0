/**
 * The whole-record re-validation + A9 twin suites (W065). License:
 * Apache-2.0 (the repository LICENSE).
 */

import { deepStrictEqual, strictEqual } from "node:assert";
import { describe, it } from "node:test";
import { composeMirrorProjection } from "../projection.js";
import { openLiveMirrorSession } from "../session.js";
import { validateLiveMirrorSession, validateMirrorProjection } from "../validate.js";
import { SCOPE, cutoffOf, happyInputs } from "./fixtures.js";

describe("validateLiveMirrorSession (whole-record re-proof)", () => {
  it("re-validates a lawful session from its recorded data alone", () => {
    const { view, observations, orders } = happyInputs();
    const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders });
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      strictEqual(validateLiveMirrorSession(outcome.session).ok, true);
    }
  });

  it("catches a rewritten session through the id re-derivation (A9)", () => {
    const { view, observations, orders } = happyInputs();
    const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders });
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      const tampered = { ...outcome.session, cutoff: 9_000 };
      const validation = validateLiveMirrorSession(tampered);
      strictEqual(validation.ok, false);
      if (!validation.ok) {
        strictEqual(validation.errors.some((error) => error.code === "session-id-mismatch"), true);
        strictEqual(validation.errors.some((error) => error.code === "cutoff-view-mismatch"), true);
      }
    }
  });

  it("catches a rewritten carried observation through the adapter's own re-proof (verbatim)", () => {
    const { view, observations, orders } = happyInputs();
    const outcome = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders });
    strictEqual(outcome.ok, true);
    if (outcome.ok) {
      const tampered = {
        ...outcome.session,
        observations: outcome.session.observations.map((observation, index) =>
          index === 0 ? { ...observation, price: "9999.99" } : observation,
        ),
      };
      const validation = validateLiveMirrorSession(tampered);
      strictEqual(validation.ok, false);
      if (!validation.ok) {
        // the session id weighs RECORD IDS (unchanged) — the rewritten price is
        // caught by the carried observation's OWN id re-proof, carried verbatim
        strictEqual(validation.errors.some((error) => error.code === "observation-invalid"), true);
      }
    }
  });
});

describe("validateMirrorProjection (whole-record re-proof)", () => {
  it("re-validates a lawful projection; catches tampered positions by the derivation itself (A6)", () => {
    const { view, observations, orders } = happyInputs();
    const session = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders });
    strictEqual(session.ok, true);
    if (session.ok) {
      const projection = composeMirrorProjection(session.session);
      strictEqual(projection.ok, true);
      if (projection.ok) {
        strictEqual(validateMirrorProjection(projection.projection).ok, true);
        const tampered = {
          ...projection.projection,
          positions: projection.projection.positions.map((position) => ({ ...position, netQuantity: "100" })),
        };
        const validation = validateMirrorProjection(tampered);
        strictEqual(validation.ok, false);
        if (!validation.ok) {
          strictEqual(validation.errors.some((error) => error.code === "position-derivation-mismatch"), true);
          strictEqual(validation.errors.some((error) => error.code === "projection-id-mismatch"), true);
        }
      }
    }
  });
});

describe("A9 twins (the declarer's input order never leaks)", () => {
  it("the same declaration with shuffled observation/order arrays opens the SAME session (deep-equal)", () => {
    const { view, observations, orders } = happyInputs();
    const first = openLiveMirrorSession({
      scope: SCOPE,
      cutoff: cutoffOf(),
      view,
      observations,
      orders,
    });
    const second = openLiveMirrorSession({
      orders: [...orders].reverse(),
      observations: [...observations].reverse(),
      view,
      cutoff: cutoffOf(),
      scope: { ...SCOPE },
    });
    strictEqual(first.ok && second.ok, true);
    if (first.ok && second.ok) {
      deepStrictEqual(first.session, second.session);
    }
  });

  it("the same session always composes the deep-equal projection, whatever the caller's array order", () => {
    const { view, observations, orders } = happyInputs();
    const first = openLiveMirrorSession({ scope: SCOPE, cutoff: cutoffOf(), view, observations, orders });
    const second = openLiveMirrorSession({
      scope: SCOPE,
      cutoff: cutoffOf(),
      view,
      observations: [...observations].reverse(),
      orders: [...orders].reverse(),
    });
    strictEqual(first.ok && second.ok, true);
    if (first.ok && second.ok) {
      const projectionA = composeMirrorProjection(first.session);
      const projectionB = composeMirrorProjection(second.session);
      strictEqual(projectionA.ok && projectionB.ok, true);
      if (projectionA.ok && projectionB.ok) {
        deepStrictEqual(projectionA.projection, projectionB.projection);
      }
    }
  });
});
