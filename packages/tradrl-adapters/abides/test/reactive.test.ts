/**
 * The reactive loop through the REAL W023 participant seam (W024): the
 * kernel wakes declared agents on market events and on their own scheduled
 * wakes, every wake produces decisions through the participant protocol,
 * commands travel the declared transport, and outcomes land in ONE ordered
 * journal (A6) under the observation firewall (A7).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { createAbidesKernel } from "../kernel.js";
import { ABIDES_EVENT_TYPES } from "../events.js";
import {
  CLOCK_ORIGIN,
  abidesWorld,
  driveSteps,
  marketMakerDeclaration,
  noiseTraderDeclaration,
  settleMicrotasks,
} from "./fixtures.js";

const STEPS = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];

test("the reactive loop drives both agents through the W023 seam", async () => {
  const kernel = createAbidesKernel({
    definition: abidesWorld(),
    agents: [marketMakerDeclaration(), noiseTraderDeclaration()],
  });
  try {
    await driveSteps(kernel, STEPS);
    await settleMicrotasks(12);

    // The clock advanced exactly the streamed simulated milliseconds.
    assert.equal(Number(kernel.now()), Number(CLOCK_ORIGIN) + 1_200);

    // The journal is ONE monotonic sequence (A6) with the world's birth first.
    const events = kernel.events();
    assert.equal(events[0]?.eventType, ABIDES_EVENT_TYPES.worldCreated);
    const sequences = events.map((event) => Number(event.sequence));
    assert.equal(new Set(sequences).size, sequences.length, "sequences are unique");
    for (let index = 1; index < sequences.length; index += 1) {
      assert.ok(sequences[index]! > sequences[index - 1]!, "sequences strictly increase");
    }
    for (const event of events) {
      assert.ok(Number(event.occurredAt) >= Number(CLOCK_ORIGIN), "no event precedes the clock origin");
      if (event.availableAt !== undefined) {
        assert.ok(Number(event.availableAt) >= Number(event.occurredAt), "availability law (A7)");
      }
    }

    // Real traffic crossed the transport: commands, deliveries, data, wakes.
    assert.ok(kernel.deliveredMessages() > 10, `delivered messages (got ${String(kernel.deliveredMessages())})`);
    assert.ok(events.some((event) => event.eventType === ABIDES_EVENT_TYPES.tradePrinted), "at least one trade printed");

    // Both W023 runtimes really ran: settled views, decisions, typed outcomes.
    const mm = kernel.telemetry("mm-1");
    const noise = kernel.telemetry("noise-1");
    assert.ok(mm.status === "idle" || mm.status === "reacting", `mm status ${String(mm.status)}`);
    assert.ok(noise.status === "idle" || noise.status === "reacting", `noise status ${String(noise.status)}`);
    assert.ok(mm.passes.length >= 2, `mm passes (got ${String(mm.passes.length)})`);
    assert.ok(noise.passes.length >= 2, `noise passes (got ${String(noise.passes.length)})`);
    assert.ok(noise.outcomes.length >= 1, `noise issued commands (got ${String(noise.outcomes.length)})`);
    assert.ok(noise.acked >= 1, "at least one noise command was acked (typed outcome, never a throw)");
    for (const runtime of [mm, noise]) {
      for (const pass of runtime.passes) {
        assert.equal(String(pass.view.instruments[0]?.instrumentId), "EQ-1", "the declared view is served");
        assert.ok(Number(pass.observedAt) <= Number(kernel.now()), "the observation frontier never exceeds the clock (A7)");
      }
    }

    // Market data crossed the transport: some pass observed a non-empty book.
    const observedBook = [...mm.passes, ...noise.passes].some(
      (pass) => (pass.view.books[0]?.asks.length ?? 0) >= 1 || (pass.view.books[0]?.bids.length ?? 0) >= 1,
    );
    assert.ok(observedBook, "an agent observed the seeded/made book through the firewall");

    // The issuer's port promise resolved on the delivery (typed outcomes).
    assert.ok(mm.outcomes.length + noise.outcomes.length >= 2, "both agents produced typed command outcomes");
  } finally {
    kernel.dispose();
  }
});

test("scheduled wakes are periodic and self-re-arming", async () => {
  const kernel = createAbidesKernel({
    definition: abidesWorld(),
    agents: [marketMakerDeclaration({ wakeSchedule: { everyMs: 300 } })],
  });
  try {
    await driveSteps(kernel, [100, 100, 100]); // 300ms: exactly one wake interval
    await settleMicrotasks(8);
    const first = kernel.telemetry("mm-1").passes.length;
    assert.ok(first >= 1, "the first wake produced a pass");
    await driveSteps(kernel, [100, 100, 100]); // 600ms: a second wake
    await settleMicrotasks(8);
    const second = kernel.telemetry("mm-1").passes.length;
    assert.ok(second > first, `wakes keep firing (passes ${String(first)} → ${String(second)})`);
  } finally {
    kernel.dispose();
  }
});

test("the observation frontier moves only on delivery, monotonically", async () => {
  const kernel = createAbidesKernel({
    definition: abidesWorld(),
    agents: [noiseTraderDeclaration()],
  });
  try {
    await driveSteps(kernel, [100, 100, 100, 100]);
    await settleMicrotasks(8);
    const observedAt = kernel.telemetry("noise-1").passes.map((pass) => Number(pass.observedAt));
    assert.ok(observedAt.length >= 2, "the noise trader reacted at least twice");
    for (let index = 1; index < observedAt.length; index += 1) {
      assert.ok(observedAt[index]! >= observedAt[index - 1]!, "observation times never go backwards");
    }
    assert.ok(observedAt.every((at) => at >= Number(CLOCK_ORIGIN)), "observations never precede the origin");
  } finally {
    kernel.dispose();
  }
});

test("dispose stops the runtimes and closes the fabric", async () => {
  const kernel = createAbidesKernel({
    definition: abidesWorld(),
    agents: [marketMakerDeclaration()],
  });
  await driveSteps(kernel, [100]);
  await settleMicrotasks(8);
  kernel.dispose();
  assert.equal(kernel.telemetry("mm-1").status, "stopped");
  await assert.rejects(kernel.step(100), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as { kind?: string }).kind, "message-after-close");
    return true;
  });
});

test("a seed-only world replays its opening book with no agents", async () => {
  const kernel = createAbidesKernel({ definition: abidesWorld(), agents: [] });
  try {
    await driveSteps(kernel, [100]);
    const events = kernel.events();
    assert.equal(events[0]?.eventType, ABIDES_EVENT_TYPES.worldCreated);
    // The two seed orders were placed through the command path at the origin.
    const accepted = events.filter((event) => event.eventType === ABIDES_EVENT_TYPES.orderAccepted);
    assert.equal(accepted.length, 2);
    assert.equal(Number(kernel.now()), Number(CLOCK_ORIGIN) + 100);
    assert.equal(kernel.deliveredMessages(), 0, "no agents: no traffic to deliver");
  } finally {
    kernel.dispose();
  }
});
