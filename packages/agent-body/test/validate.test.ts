/**
 * The Body descriptor + view structural validation laws (W032): loud typed
 * errors for every structural violation — never a silent pass.
 *
 * Run: ../../node_modules/.bin/tsx --test test/validate.test.ts
 * (from packages/agent-body).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  BODY_OBSERVATION_KINDS,
  maximalBodyView,
  validateBodyDescriptor,
  validateBodyView,
} from "../index.js";
import {
  INSTRUMENT_ES,
  INSTRUMENT_NQ,
  money,
  traderBody,
  traderEmbodiment,
  traderEnvelope,
  traderView,
} from "./fixtures.js";

function codes(outcome: ReturnType<typeof validateBodyDescriptor>): string[] {
  return outcome.ok ? [] : outcome.errors.map((error) => error.code);
}

test("the default trader Body is structurally valid", () => {
  assert.deepEqual(validateBodyDescriptor(traderBody()), { ok: true });
});

test("blank identities are loud errors", () => {
  const blank = traderBody({
    bodyId: "" as never,
    participantId: "  " as never,
    accountId: "" as never,
    scope: { tenantId: "" as never, projectId: "" as never, worldId: "" as never },
  });
  const outcome = validateBodyDescriptor(blank);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  const blankCodes = outcome.errors.filter((error) => error.code === "blank-identity");
  assert.equal(blankCodes.length, 4);
});

test("duplicate embodiment entries are loud errors", () => {
  const outcome = validateBodyDescriptor(
    traderBody({
      embodiment: traderEmbodiment({
        instruments: [INSTRUMENT_ES, INSTRUMENT_ES],
        venues: ["venue-all" as never, "venue-all" as never],
        orderKinds: ["market", "market"],
        timeInForce: ["GTC", "GTC"],
        commandKinds: ["submit-order", "submit-order"],
      }),
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(
    outcome.errors.filter((error) => error.code === "duplicate-embodiment-entry").length,
    5,
  );
});

test("unknown kinds are loud errors (commands, order kinds, TIFs)", () => {
  const outcome = validateBodyDescriptor(
    traderBody({
      embodiment: traderEmbodiment({
        orderKinds: ["market", "iceberg" as never],
        timeInForce: ["GTC", "GTD" as never],
        commandKinds: ["submit-order", "teleport-order" as never],
      }),
    }),
  );
  assert.deepEqual(codes(outcome), [
    "unknown-command-kind",
    "unknown-order-kind",
    "unknown-time-in-force",
  ]);
});

test("embodiment consistency: submission authority and reach are one declaration", () => {
  // submit-order without instruments
  assert.deepEqual(
    codes(
      validateBodyDescriptor(
        traderBody({ embodiment: traderEmbodiment({ instruments: [], venues: [] }) }),
      ),
    ),
    ["embodiment-consistency"],
  );
  // instruments without the venues they trade on
  assert.deepEqual(
    codes(
      validateBodyDescriptor(traderBody({ embodiment: traderEmbodiment({ venues: [] }) })),
    ),
    ["embodiment-consistency"],
  );
  // submit-order without order kinds
  assert.deepEqual(
    codes(
      validateBodyDescriptor(traderBody({ embodiment: traderEmbodiment({ orderKinds: [] }) })),
    ),
    ["embodiment-consistency"],
  );
  // submit-order without time-in-force (orders REQUIRE constraints.timeInForce)
  assert.deepEqual(
    codes(
      validateBodyDescriptor(traderBody({ embodiment: traderEmbodiment({ timeInForce: [] }) })),
    ),
    ["embodiment-consistency"],
  );
  // order kinds and TIFs are dead without the submit-order command
  const observer = traderBody({
    embodiment: traderEmbodiment({ commandKinds: ["add-annotation"] }),
  });
  assert.deepEqual(codes(validateBodyDescriptor(observer)), [
    "embodiment-consistency",
    "embodiment-consistency",
  ]);
  // ...and a consistent non-trading Body (observation-only commands) is valid
  const consistentObserver = traderBody({
    embodiment: traderEmbodiment({
      commandKinds: ["add-annotation"],
      orderKinds: [],
      timeInForce: [],
    }),
  });
  assert.deepEqual(validateBodyDescriptor(consistentObserver), { ok: true });
});

test("envelope shape: the W015 risk-limits law is reused, plus canonical decimals", () => {
  // zero quantity limit (the W015 law: positive decimal string)
  assert.deepEqual(
    codes(validateBodyDescriptor(traderBody({ riskEnvelope: traderEnvelope({ maxOrderQuantity: "0" as never }) }))),
    ["invalid-limit-shape"],
  );
  // negative money (the W015 law: Money amounts are non-negative)
  assert.deepEqual(
    codes(
      validateBodyDescriptor(
        traderBody({
          riskEnvelope: traderEnvelope({ maxDrawdown: money("-1") }),
        }),
      ),
    ),
    ["invalid-limit-shape"],
  );
  // non-canonical decimals pass the loose W015 shape but fail the
  // contract boundary (canonical decimal text, never exponent form)
  assert.deepEqual(
    codes(validateBodyDescriptor(traderBody({ riskEnvelope: traderEnvelope({ maxPositionQuantity: "1e2" as never }) }))),
    ["invalid-limit-shape"],
  );
  assert.deepEqual(
    codes(
      validateBodyDescriptor(
        traderBody({
          riskEnvelope: traderEnvelope({ maxGrossExposure: money("5e5") }),
        }),
      ),
    ),
    ["invalid-limit-shape"],
  );
  // Infinity leverage passes the W015 `> 0` check but is not declarable
  assert.deepEqual(
    codes(validateBodyDescriptor(traderBody({ riskEnvelope: traderEnvelope({ maxLeverage: Number.POSITIVE_INFINITY }) }))),
    ["invalid-limit-shape"],
  );
});

test("an empty envelope is valid (the W003 law: unset limits are not enforced)", () => {
  assert.deepEqual(
    validateBodyDescriptor(traderBody({ riskEnvelope: {} })),
    { ok: true },
  );
});

test("view validation: identity must match, kinds must be closed, instruments within embodiment", () => {
  const descriptor = traderBody();
  const mismatched = traderView({
    bodyId: "body-other" as never,
    worldId: "world-other" as never,
    accountId: "account-other" as never,
  });
  const mismatchOutcome = validateBodyView(mismatched, descriptor);
  assert.equal(mismatchOutcome.ok, false);
  if (mismatchOutcome.ok) return;
  assert.equal(mismatchOutcome.errors.filter((e) => e.code === "scope-mismatch").length, 3);

  const unknownKind = traderView({ observations: ["market-depth" as never] });
  assert.deepEqual(codes(validateBodyView(unknownKind, descriptor)), [
    "unknown-observation-kind",
  ]);

  const beyond = traderView({ instruments: [INSTRUMENT_NQ] });
  assert.deepEqual(codes(validateBodyView(beyond, descriptor)), [
    "view-beyond-embodiment",
  ]);
});

test("view validation: tighter views and the maximal view are valid", () => {
  const descriptor = traderBody();
  assert.deepEqual(
    validateBodyView(traderView({ observations: ["market-quote"] }), descriptor),
    { ok: true },
  );
  assert.deepEqual(validateBodyView(maximalBodyView(descriptor), descriptor), { ok: true });
  // the maximal view's observation set is the full closed set
  assert.deepEqual(maximalBodyView(descriptor).observations, BODY_OBSERVATION_KINDS);
  // instruments in a valid view are a subset of the embodiment
  const view = traderView({ instruments: [] });
  assert.deepEqual(validateBodyView(view, descriptor), { ok: true });
});
