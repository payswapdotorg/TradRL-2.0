/**
 * The contract surface laws (W033): the closed sets, the descriptor
 * structure validator, and the state-mode/decision-rate declarations the
 * reference substrates ship.
 *
 * Run: ../../node_modules/.bin/tsx --test test/contracts.test.ts
 * (from packages/cognitive-substrate).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBSTRATE_STATE_MODES,
  createMeanReversionSubstrate,
  createMomentumSubstrate,
  validateSubstrateDescriptor,
} from "../index.js";
import type { CognitiveSubstrateDescriptor } from "../index.js";
import { INSTRUMENT } from "./fixtures.js";

function descriptor(overrides: Partial<CognitiveSubstrateDescriptor> = {}): CognitiveSubstrateDescriptor {
  return {
    substrateId: "substrate-one" as never,
    stateMode: "stateless-per-view",
    seed: "seed-one",
    decisionRate: { maxDecisionsPerView: 1 },
    commandKinds: ["submit-order", "close-position"],
    ...overrides,
  };
}

test("the state-mode set is exactly the two contract modes", () => {
  assert.deepEqual(SUBSTRATE_STATE_MODES, ["stateless-per-view", "declared-state"]);
});

test("a well-formed descriptor validates ok", () => {
  assert.deepEqual(validateSubstrateDescriptor(descriptor()), { ok: true });
  assert.deepEqual(
    validateSubstrateDescriptor(descriptor({ stateMode: "declared-state" })),
    { ok: true },
  );
});

test("blank identity, empty seed and unknown state mode are typed errors", () => {
  const blank = validateSubstrateDescriptor(descriptor({ substrateId: "   " as never }));
  assert.deepEqual(
    !blank.ok ? blank.errors.map((one) => one.code) : [],
    ["blank-identity"],
  );

  const unseeded = validateSubstrateDescriptor(descriptor({ seed: "" }));
  assert.deepEqual(!unseeded.ok ? unseeded.errors.map((one) => one.code) : [], ["empty-seed"]);

  const unknownMode = validateSubstrateDescriptor(
    descriptor({ stateMode: "sometimes" as never }),
  );
  assert.deepEqual(!unknownMode.ok ? unknownMode.errors.map((one) => one.code) : [], ["unknown-state-mode"]);
});

test("an invalid rate envelope is a typed error", () => {
  const zero = validateSubstrateDescriptor(
    descriptor({ decisionRate: { maxDecisionsPerView: 0 } }),
  );
  assert.deepEqual(!zero.ok ? zero.errors.map((one) => one.code) : [], ["invalid-rate-envelope"]);

  const fractional = validateSubstrateDescriptor(
    descriptor({ decisionRate: { maxDecisionsPerView: 1.5 } }),
  );
  assert.deepEqual(!fractional.ok ? fractional.errors.map((one) => one.code) : [], ["invalid-rate-envelope"]);

  const negativeSpacing = validateSubstrateDescriptor(
    descriptor({ decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: -1 } }),
  );
  assert.deepEqual(!negativeSpacing.ok ? negativeSpacing.errors.map((one) => one.code) : [], ["invalid-rate-envelope"]);

  assert.deepEqual(
    validateSubstrateDescriptor(
      descriptor({ decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 1000 } }),
    ),
    { ok: true },
  );
});

test("unknown and duplicate command kinds are typed errors", () => {
  const unknown = validateSubstrateDescriptor(
    descriptor({ commandKinds: ["submit-order", "teleport"] as never }),
  );
  assert.deepEqual(!unknown.ok ? unknown.errors.map((one) => one.code) : [], ["unknown-command-kind"]);

  const duplicate = validateSubstrateDescriptor(
    descriptor({ commandKinds: ["submit-order", "submit-order"] }),
  );
  assert.deepEqual(!duplicate.ok ? duplicate.errors.map((one) => one.code) : [], ["duplicate-command-kind"]);

  const empty = validateSubstrateDescriptor(descriptor({ commandKinds: [] }));
  assert.deepEqual(!empty.ok ? empty.errors.map((one) => one.code) : [], ["unknown-command-kind"]);
});

test("the reference substrates ship well-formed descriptors with the declared state modes", () => {
  const momentum = createMomentumSubstrate({
    substrateId: "substrate-momentum" as never,
    seed: "seed-momentum",
    instrumentId: INSTRUMENT,
    lookback: 4,
    threshold: "1",
    quantity: "1",
  });
  assert.equal(momentum.descriptor.stateMode, "declared-state");
  assert.notEqual(momentum.initialState, undefined);
  assert.deepEqual(validateSubstrateDescriptor(momentum.descriptor), { ok: true });

  const meanReversion = createMeanReversionSubstrate({
    substrateId: "substrate-mr" as never,
    seed: "seed-mr",
    instrumentId: INSTRUMENT,
    threshold: "1",
    quantity: "1",
  });
  assert.equal(meanReversion.descriptor.stateMode, "stateless-per-view");
  assert.equal(meanReversion.initialState, undefined);
  assert.deepEqual(validateSubstrateDescriptor(meanReversion.descriptor), { ok: true });
});

test("the reference factories guard their configs loudly at construction time", () => {
  assert.throws(() =>
    createMomentumSubstrate({
      substrateId: "substrate-x" as never,
      seed: "s",
      instrumentId: INSTRUMENT,
      lookback: 1,
      threshold: "1",
      quantity: "1",
    }),
  );
  assert.throws(() =>
    createMomentumSubstrate({
      substrateId: "substrate-x" as never,
      seed: "s",
      instrumentId: INSTRUMENT,
      lookback: 4,
      threshold: "0",
      quantity: "1",
    }),
  );
  assert.throws(() =>
    createMeanReversionSubstrate({
      substrateId: "substrate-x" as never,
      seed: "s",
      instrumentId: INSTRUMENT,
      threshold: "0",
      quantity: "1",
    }),
  );
});
