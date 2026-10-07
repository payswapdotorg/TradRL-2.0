/**
 * The envelope laws (W032, A13): the exact envelope-vs-world-limits
 * comparison — a Body declaring a LOOSER limit than its world is invalid
 * at attach, never silently clipped — and the effective-envelope
 * intersection.
 *
 * Run: ../../node_modules/.bin/tsx --test test/envelope.test.ts
 * (from packages/agent-body).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRiskEnvelopeToWorldLimits,
  effectiveRiskEnvelope,
} from "../index.js";
import type { RiskLimits } from "tradrl-world-contracts";
import {
  TRADER_WORLD_LIMITS,
  money,
  traderBody,
  traderEnvelope,
} from "./fixtures.js";

const ACCOUNT = "account-trader";

function breaches(
  envelope: RiskLimits,
  worldLimits: RiskLimits = TRADER_WORLD_LIMITS,
): (string | undefined)[] {
  return compareRiskEnvelopeToWorldLimits(envelope, worldLimits, ACCOUNT)
    .filter((error) => error.code === "envelope-exceeds-world-limits")
    .map((error) => error.envelope?.limit);
}

test("an envelope within the world's limits is valid (equal and tighter)", () => {
  // the default fixture envelope is strictly tighter on every field
  assert.deepEqual(breaches(traderEnvelope()), []);
  // equal declarations are valid (the Body IS the world limit)
  assert.deepEqual(breaches(TRADER_WORLD_LIMITS), []);
});

test("a looser max-limit is a breach — exact scaled comparison, all fields", () => {
  assert.deepEqual(
    breaches(traderEnvelope({ maxOrderQuantity: "50.5" as never })),
    ["maxOrderQuantity"],
  );
  assert.deepEqual(
    breaches(traderEnvelope({ maxPositionQuantity: "200.000000000001" as never })),
    ["maxPositionQuantity"],
  );
  assert.deepEqual(breaches(traderEnvelope({ maxLeverage: 4.5 })), ["maxLeverage"]);
  assert.deepEqual(
    breaches(traderEnvelope({ maxGrossExposure: money("500000.01") })),
    ["maxGrossExposure"],
  );
  assert.deepEqual(
    breaches(traderEnvelope({ maxDrawdown: money("10000.5") })),
    ["maxDrawdown"],
  );
});

test("the buying-power floor inverts: LOWER than the world's floor is the breach", () => {
  // the floor is a minimum the Body must leave intact — declaring it would
  // leave LESS buying power than the world demands is the loose side
  assert.deepEqual(
    breaches(traderEnvelope({ minBuyingPowerAfterOrder: money("999.99") })),
    ["minBuyingPowerAfterOrder"],
  );
  // a HIGHER floor is tighter, never a breach
  assert.deepEqual(
    breaches(traderEnvelope({ minBuyingPowerAfterOrder: money("100000") })),
    [],
  );
});

test("a breach carries the exact compared values (never silently clipped)", () => {
  const errors = compareRiskEnvelopeToWorldLimits(
    traderEnvelope({ maxOrderQuantity: "60" as never }),
    TRADER_WORLD_LIMITS,
    ACCOUNT,
  );
  assert.equal(errors.length, 1);
  const error = errors[0];
  if (error === undefined) return;
  assert.equal(error.code, "envelope-exceeds-world-limits");
  assert.deepEqual(error.envelope, {
    limit: "maxOrderQuantity",
    bodyValue: "60",
    worldValue: "50",
  });
  assert.match(error.message, /never silently clipped/);
  assert.equal(error.field, "riskEnvelope.maxOrderQuantity");
});

test("currency mismatches are incommensurable (loud, distinct code)", () => {
  const errors = compareRiskEnvelopeToWorldLimits(
    traderEnvelope({ maxGrossExposure: money("1", "EUR") }),
    TRADER_WORLD_LIMITS,
    ACCOUNT,
  );
  assert.equal(errors.length, 1);
  const error = errors[0];
  if (error === undefined) return;
  assert.equal(error.code, "envelope-currency-mismatch");
  assert.match(error.message, /EUR/);
  assert.match(error.message, /USD/);
});

test("unset world limits are not enforced (the W003 law)", () => {
  // the world declares nothing: any Body envelope is valid
  assert.deepEqual(breaches(traderEnvelope(), {}), []);
  // a world declaring only maxDrawdown never compares the Body's leverage
  // (the Body declares 100; the world's single limit is elsewhere)
  assert.deepEqual(
    breaches({ maxLeverage: 100 }, { maxDrawdown: money("1") }),
    [],
  );
  // a Body field the world does not declare is never compared: a huge
  // order-size envelope against a world that only declares leverage
  assert.deepEqual(
    breaches({ maxOrderQuantity: "999999" as never }, { maxLeverage: 1 }),
    [],
  );
});

test("effectiveRiskEnvelope keeps the tighter declaration per field", () => {
  const effective = effectiveRiskEnvelope(traderEnvelope(), TRADER_WORLD_LIMITS);
  assert.deepEqual(effective, traderEnvelope());
  // one-sided declarations flow through
  const oneSided = effectiveRiskEnvelope({ maxLeverage: 2 }, { maxOrderQuantity: "10" as never });
  assert.deepEqual(oneSided, { maxLeverage: 2, maxOrderQuantity: "10" });
  // the world's undeclared-by-body limits join the effective envelope
  const bodyOnlyOrder = effectiveRiskEnvelope(
    { maxOrderQuantity: "10" as never },
    TRADER_WORLD_LIMITS,
  );
  assert.deepEqual(bodyOnlyOrder, {
    maxOrderQuantity: "10",
    maxPositionQuantity: "200",
    maxLeverage: 4,
    maxGrossExposure: { amount: "500000", currency: "USD" },
    maxDrawdown: { amount: "10000", currency: "USD" },
    minBuyingPowerAfterOrder: money("1000"),
  });
});

test("effectiveRiskEnvelope keeps the HIGHER buying-power floor", () => {
  const effective = effectiveRiskEnvelope(
    { minBuyingPowerAfterOrder: money("3000") },
    { minBuyingPowerAfterOrder: money("1000") },
  );
  assert.deepEqual(effective, {
    minBuyingPowerAfterOrder: money("3000"),
  });
  const flipped = effectiveRiskEnvelope(
    { minBuyingPowerAfterOrder: money("500") },
    { minBuyingPowerAfterOrder: money("1000") },
  );
  assert.deepEqual(flipped, {
    minBuyingPowerAfterOrder: money("1000"),
  });
});

test("on a VALID attachment the effective envelope is exactly the Body's declaration", () => {
  // the composition law: validate (proves Body ⊆ world), then the
  // effective envelope carries every Body-declared value unchanged — the
  // intersection never loosens a declaration
  const envelope = traderEnvelope({ maxPositionQuantity: "25" as never });
  const effective = effectiveRiskEnvelope(envelope, TRADER_WORLD_LIMITS);
  assert.equal(effective.maxPositionQuantity, "25");
  assert.equal(effective.maxOrderQuantity, envelope.maxOrderQuantity);
  assert.equal(effective.minBuyingPowerAfterOrder, envelope.minBuyingPowerAfterOrder);
});

test("the default trader Body's envelope sits within the fixture world's limits", () => {
  assert.deepEqual(
    compareRiskEnvelopeToWorldLimits(
      traderBody().riskEnvelope,
      TRADER_WORLD_LIMITS,
      ACCOUNT,
    ),
    [],
  );
});
