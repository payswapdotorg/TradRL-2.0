/**
 * Order contract tests: kinds, time-in-force/execution constraints and the
 * lifecycle transition law.
 *
 * Spec: spec/ARCHITECTURE.md §6 (market/limit/stop/stop-limit, IOC, FOK,
 * post-only, reduce-only, cancel/replace),
 * spec/SIMULATION.md "Matching" (deterministic, partial fills mandatory),
 * spec/ACCEPTANCE-WORLD-ALPHA.md C Execution (cancellation, replacement).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_INITIAL_STATUS,
  ORDER_LIFECYCLE_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  isTerminalOrderStatus,
} from "../src/orders.js";
import type {
  Order,
  OrderExecutionConstraints,
  OrderKind,
  OrderStatus,
  TimeInForce,
} from "../src/orders.js";
import type { OrderId, InstrumentId, AccountId, ParticipantId, WorldId } from "../src/ids.js";
import { asId, asPrice, asQuantity, asTimestamp } from "./helpers.js";
import type { Equal, Expect, OptionalKeys, RequiredKeys } from "./helpers.js";

const ALL_STATUSES = [
  "pending",
  "accepted",
  "partially-filled",
  "filled",
  "canceled",
  "rejected",
  "expired",
  "replaced",
] as const;

const ALL_KINDS = ["market", "limit", "stop", "stop-limit"] as const;
const ALL_TIF = ["GTC", "IOC", "FOK"] as const;

// --- type-level assertions ---------------------------------------------------

type _statusExact = Expect<Equal<OrderStatus, (typeof ALL_STATUSES)[number]>>;
type _kindExact = Expect<Equal<OrderKind, (typeof ALL_KINDS)[number]>>;
type _tifExact = Expect<Equal<TimeInForce, (typeof ALL_TIF)[number]>>;

// Post-only and reduce-only are optional execution constraints on every order.
type _constraintsShape = Expect<
  Equal<RequiredKeys<OrderExecutionConstraints>, "timeInForce">
>;
type _constraintFlags = Expect<
  Equal<"postOnly" | "reduceOnly" extends OptionalKeys<Order> ? true : false, true>
>;

// --- fixtures ----------------------------------------------------------------

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: asId<OrderId>("order-1"),
    worldId: asId<WorldId>("world-1"),
    instrumentId: asId<InstrumentId>("instr-1"),
    accountId: asId<AccountId>("account-1"),
    submittedBy: asId<ParticipantId>("participant-human"),
    kind: "limit",
    side: "buy",
    quantity: asQuantity("10"),
    filledQuantity: asQuantity("0"),
    limitPrice: asPrice("100.25"),
    constraints: { timeInForce: "GTC", postOnly: true, reduceOnly: false },
    status: "pending",
    submittedAt: asTimestamp(1_000),
    ...overrides,
  };
}

// --- lifecycle transition law -------------------------------------------------

test("transition table covers every order status", () => {
  assert.deepEqual(
    Object.keys(ORDER_LIFECYCLE_TRANSITIONS).sort(),
    [...ALL_STATUSES].sort(),
  );
});

test("every transition target is a valid status", () => {
  for (const [from, targets] of Object.entries(ORDER_LIFECYCLE_TRANSITIONS)) {
    for (const target of targets) {
      assert.ok(
        (ALL_STATUSES as readonly string[]).includes(target),
        `invalid transition ${from} -> ${target}`,
      );
    }
  }
});

test("terminal states have no outgoing transitions", () => {
  assert.deepEqual(TERMINAL_ORDER_STATUSES, [
    "filled",
    "canceled",
    "rejected",
    "expired",
    "replaced",
  ]);
  for (const status of TERMINAL_ORDER_STATUSES) {
    assert.deepEqual(ORDER_LIFECYCLE_TRANSITIONS[status], [], `${status} must be terminal`);
    assert.equal(isTerminalOrderStatus(status), true);
  }
  for (const status of ALL_STATUSES) {
    if (!TERMINAL_ORDER_STATUSES.includes(status)) {
      assert.equal(isTerminalOrderStatus(status), false);
    }
  }
});

test("every non-terminal state can reach a terminal state (no zombie orders)", () => {
  const terminals = new Set<string>(TERMINAL_ORDER_STATUSES);
  for (const start of ALL_STATUSES) {
    if (terminals.has(start)) continue;
    const seen = new Set<string>([start]);
    const queue = [start];
    let reachable = false;
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (terminals.has(current)) {
        reachable = true;
        break;
      }
      for (const next of ORDER_LIFECYCLE_TRANSITIONS[current as OrderStatus]) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    assert.ok(reachable, `${start} cannot reach any terminal state`);
  }
});

test("pending can be accepted, rejected or directly filled", () => {
  const fromPending = ORDER_LIFECYCLE_TRANSITIONS.pending;
  for (const expected of ["accepted", "rejected", "filled", "partially-filled"]) {
    assert.ok(fromPending.includes(expected as OrderStatus));
  }
});

test("partial fills keep the order working and can repeat", () => {
  const fromPartial = ORDER_LIFECYCLE_TRANSITIONS["partially-filled"];
  assert.ok(fromPartial.includes("partially-filled"));
  assert.ok(fromPartial.includes("filled"));
  assert.ok(fromPartial.includes("canceled"));
  assert.ok(fromPartial.includes("replaced"));
});

test("cancel/replace only applies to working states", () => {
  for (const status of ALL_STATUSES) {
    const canReplace = ORDER_LIFECYCLE_TRANSITIONS[status].includes("replaced");
    const working = status === "accepted" || status === "partially-filled";
    assert.equal(canReplace, working, `${status} replaceability`);
  }
});

// --- order shape invariants ---------------------------------------------------

test("initial order state is pending", () => {
  assert.equal(ORDER_INITIAL_STATUS, "pending");
});

test("an order carries cumulative fill quantity that never exceeds its quantity", () => {
  const partial = makeOrder({
    status: "partially-filled",
    filledQuantity: asQuantity("4"),
  });
  assert.ok(
    Number(partial.filledQuantity as string) <= Number(partial.quantity as string),
  );
  assert.equal(partial.filledQuantity as string, "4");
});

test("replaced orders point at their successor", () => {
  const replaced = makeOrder({
    status: "replaced",
    replacedByOrderId: asId<OrderId>("order-2"),
  });
  assert.equal(replaced.replacedByOrderId, "order-2" as OrderId);
  assert.equal(isTerminalOrderStatus(replaced.status), true);
});

test("rejections carry an explicit typed reason", () => {
  const rejected = makeOrder({ status: "rejected", rejectionReason: "fok-unfillable" });
  assert.equal(rejected.rejectionReason, "fok-unfillable");
});
