/**
 * The message-fabric ordering laws (W024): the scheduler's TOTAL order is
 * (arrival time → message-class priority → enqueue sequence) — never wall
 * time — and the latency model resolves bounds as pure keyed draws.
 * Spec: spec/ARCHITECTURE-LOCK.md A7/A9; README.md "The message flow".
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MESSAGE_CLASS_PRIORITY,
  createMessageScheduler,
  type AbidesMessage,
} from "../messaging.js";
import { describeLatencyBound, describeLatencySpec, resolveLatencyMs } from "../latency.js";

type Draft = Omit<AbidesMessage, "messageId" | "sequence">;

function fabric(): { scheduler: ReturnType<typeof createMessageScheduler>; clockRef: { now: number } } {
  const clockRef = { now: 1_000 };
  let counter = 0;
  const scheduler = createMessageScheduler({
    now: () => clockRef.now as never,
    nextMessageId: () => `m${(counter += 1)}`,
  });
  return { scheduler, clockRef };
}

function draft(input: Partial<Draft> & Pick<Draft, "arriveAt">): Draft {
  return {
    messageClass: "order-command",
    from: "agent-a",
    to: "venue",
    sentAt: 1_000 as never,
    payload: {},
    ...input,
  };
}

test("the fabric drains in ARRIVAL time order first", () => {
  const { scheduler } = fabric();
  const first = scheduler.enqueue(draft({ arriveAt: 1_050 as never }));
  const second = scheduler.enqueue(draft({ arriveAt: 1_020 as never }));
  const third = scheduler.enqueue(draft({ arriveAt: 1_090 as never }));
  assert.deepEqual(
    [scheduler.pop(), scheduler.pop(), scheduler.pop()].map((m) => m?.messageId),
    [second.messageId, first.messageId, third.messageId],
  );
  assert.equal(scheduler.size, 0);
  assert.equal(scheduler.delivered, 3);
});

test("ties at one arrival drain in message-class priority order", () => {
  const { scheduler } = fabric();
  const wake = scheduler.enqueue(draft({ messageClass: "agent-wake", from: "a", to: "a", arriveAt: 1_100 as never }));
  const data = scheduler.enqueue(draft({ messageClass: "market-data", from: "venue", to: "a", arriveAt: 1_100 as never }));
  const delivery = scheduler.enqueue(draft({ messageClass: "order-delivery", from: "venue", to: "a", arriveAt: 1_100 as never }));
  const command = scheduler.enqueue(draft({ messageClass: "order-command", arriveAt: 1_100 as never }));
  assert.deepEqual(
    [scheduler.pop(), scheduler.pop(), scheduler.pop(), scheduler.pop()].map((m) => m?.messageId),
    [command.messageId, delivery.messageId, data.messageId, wake.messageId],
  );
  assert.ok(MESSAGE_CLASS_PRIORITY["order-command"] < MESSAGE_CLASS_PRIORITY["order-delivery"]);
  assert.ok(MESSAGE_CLASS_PRIORITY["order-delivery"] < MESSAGE_CLASS_PRIORITY["market-data"]);
  assert.ok(MESSAGE_CLASS_PRIORITY["market-data"] < MESSAGE_CLASS_PRIORITY["agent-wake"]);
});

test("exact ties drain in enqueue-sequence order (stable)", () => {
  const { scheduler } = fabric();
  const one = scheduler.enqueue(draft({ arriveAt: 1_100 as never }));
  const two = scheduler.enqueue(draft({ arriveAt: 1_100 as never }));
  const three = scheduler.enqueue(draft({ arriveAt: 1_100 as never }));
  const drained = [scheduler.pop(), scheduler.pop(), scheduler.pop()];
  assert.deepEqual(
    drained.map((m) => m?.messageId),
    [one.messageId, two.messageId, three.messageId],
  );
  assert.deepEqual(drained.map((m) => m?.sequence), [1, 2, 3]);
});

test("peek does not remove; pop advances the delivered counter", () => {
  const { scheduler } = fabric();
  scheduler.enqueue(draft({ arriveAt: 1_010 as never }));
  scheduler.enqueue(draft({ arriveAt: 1_020 as never }));
  assert.equal(scheduler.size, 2);
  assert.equal(scheduler.peek()?.arriveAt, 1_010);
  assert.equal(scheduler.size, 2);
  assert.equal(scheduler.pop()?.arriveAt, 1_010);
  assert.equal(scheduler.size, 1);
  assert.equal(scheduler.delivered, 1);
  assert.equal(scheduler.peek()?.arriveAt, 1_020);
  assert.equal(scheduler.pop()?.arriveAt, 1_020);
  assert.equal(scheduler.pop(), undefined);
});

test("sorted insert keeps the total order under interleaved enqueue/pop", () => {
  const { scheduler, clockRef } = fabric();
  const early = scheduler.enqueue(draft({ arriveAt: 1_005 as never }));
  clockRef.now = 1_005;
  assert.equal(scheduler.pop()?.messageId, early.messageId);
  // Late arrivals still enqueue (sent from the delivered present or past).
  const late = scheduler.enqueue(draft({ sentAt: 900 as never, arriveAt: 1_006 as never }));
  const later = scheduler.enqueue(draft({ sentAt: 1_005 as never, arriveAt: 1_007 as never }));
  assert.deepEqual([scheduler.pop()?.messageId, scheduler.pop()?.messageId], [late.messageId, later.messageId]);
});

test("message ids come from the allocator; sequences are global", () => {
  const { scheduler } = fabric();
  const one = scheduler.enqueue(draft({ arriveAt: 1_100 as never }));
  const two = scheduler.enqueue(draft({ messageClass: "agent-wake", from: "a", to: "a", sentAt: 1_100 as never, arriveAt: 1_200 as never }));
  assert.deepEqual([one.messageId, two.messageId], ["m1", "m2"]);
  assert.deepEqual([one.sequence, two.sequence], [1, 2]);
});

test("fixed latency bounds resolve to themselves; ranges draw seeded uniforms", () => {
  assert.equal(resolveLatencyMs({ bound: 0, seed: "s", direction: "from-venue", actor: "a", key: 1 }), 0);
  assert.equal(resolveLatencyMs({ bound: 123, seed: "s", direction: "to-venue", actor: "a", key: "k" }), 123);
  const range = { minMs: 5, maxMs: 15 } as const;
  const seen = new Set<number>();
  for (let index = 0; index < 100; index += 1) {
    const draw = resolveLatencyMs({ bound: range, seed: "w024", direction: "to-venue", actor: "p", key: index });
    assert.ok(Number.isInteger(draw));
    assert.ok(draw >= 5 && draw <= 15, `draw ${String(draw)} within [5, 15]`);
    seen.add(draw);
  }
  assert.ok(seen.size > 1, "a 10ms span produces more than one distinct draw");
  // Same inputs ⇒ same draw (pure function — A9, no cursor anywhere).
  for (let index = 0; index < 10; index += 1) {
    assert.equal(
      resolveLatencyMs({ bound: range, seed: "w024", direction: "to-venue", actor: "p", key: 7 }),
      resolveLatencyMs({ bound: range, seed: "w024", direction: "to-venue", actor: "p", key: 7 }),
    );
  }
  // The draw is KEYED: direction, actor and key each change the draw space.
  assert.notEqual(
    resolveLatencyMs({ bound: range, seed: "w024", direction: "to-venue", actor: "p", key: 7 }),
    resolveLatencyMs({ bound: range, seed: "w024", direction: "from-venue", actor: "p", key: 7 }),
  );
});

test("latency descriptions are deterministic display text", () => {
  assert.equal(describeLatencyBound(40), "40ms");
  assert.equal(describeLatencyBound({ minMs: 20, maxMs: 80 }), "20..80ms");
  assert.equal(
    describeLatencySpec({ toVenueMs: 40, fromVenueMs: { minMs: 30, maxMs: 90 } }),
    "to-venue 40ms, from-venue 30..90ms",
  );
});
