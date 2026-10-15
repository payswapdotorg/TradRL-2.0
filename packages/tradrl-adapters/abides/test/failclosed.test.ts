/**
 * Fail-closed validation laws (W024): every structural/configuration failure
 * throws the TYPED `AbidesAdapterError` with its closed `kind` — unknown
 * agent kind, malformed latency spec, unregistered venue, out-of-order
 * messages (the work order's required four), plus the adapter's own
 * structural taxonomy. Never a silent default.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { AbidesAdapterError } from "../errors.js";
import { assertLatencySpec, latencySpecViolations, resolveLatencyMs } from "../latency.js";
import { abidesWorldDigest, validateAbidesWorldDefinition } from "../definition.js";
import { createMessageScheduler } from "../messaging.js";
import { createAbidesKernel } from "../kernel.js";
import {
  MM_ACCOUNT,
  MM_PARTICIPANT,
  NOISE_PARTICIPANT,
  abidesInstrument,
  abidesWorld,
  marketMakerDeclaration,
  noiseTraderDeclaration,
} from "./fixtures.js";

/** Capture a typed violation by hand (assert.throws returns undefined). */
function expectAbidesError(block: () => unknown, kind: string, detailPart?: string): AbidesAdapterError {
  let caught: unknown;
  try {
    block();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AbidesAdapterError, `expected AbidesAdapterError, got ${String(caught)}`);
  assert.equal(caught.name, "AbidesAdapterError");
  assert.equal(caught.kind, kind, `expected kind ${kind}, message: ${caught.message}`);
  assert.ok(caught.message.startsWith(`[abides:${kind}]`), `message carries the kind prefix: ${caught.message}`);
  if (detailPart !== undefined) {
    assert.ok(caught.message.includes(detailPart), `message mentions '${detailPart}': ${caught.message}`);
  }
  return caught;
}

/** The async face of the same law (kernel clock methods return promises). */
async function expectAsyncAbidesError(promise: Promise<unknown>, kind: string): Promise<AbidesAdapterError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AbidesAdapterError, `expected AbidesAdapterError, got ${String(caught)}`);
  assert.equal(caught.kind, kind, `expected kind ${kind}, message: ${caught.message}`);
  return caught;
}

test("unknown agent kind fails closed at kernel construction", () => {
  expectAbidesError(
    () =>
      createAbidesKernel({
        definition: abidesWorld(),
        agents: [marketMakerDeclaration({ kind: "arbitrageur" })],
      }),
    "unknown-agent-kind",
    "not registered",
  );
});

test("malformed latency specs fail loudly — every violation collected", () => {
  assert.deepEqual(latencySpecViolations({ toVenueMs: -1, fromVenueMs: 5 }, "spec"), [
    "spec.toVenueMs must be non-negative (got -1)",
  ]);
  assert.deepEqual(latencySpecViolations({ toVenueMs: 0.5, fromVenueMs: 2.5 }, "spec"), [
    "spec.toVenueMs must be integer milliseconds (got 0.5)",
    "spec.fromVenueMs must be integer milliseconds (got 2.5)",
  ]);
  assert.deepEqual(latencySpecViolations({ toVenueMs: { minMs: 9, maxMs: 2 }, fromVenueMs: 0 }, "spec"), [
    "spec.toVenueMs range is inverted (min 9 > max 2)",
  ]);
  assert.deepEqual(latencySpecViolations(42, "spec"), ["spec must be an AgentLatencySpec object (got 42)"]);
  assert.deepEqual(latencySpecViolations({ toVenueMs: 7, fromVenueMs: { minMs: -3, maxMs: 5 } }, "spec"), [
    "spec.fromVenueMs range bounds must be non-negative (got -3..5)",
  ]);
  expectAbidesError(() => assertLatencySpec({ toVenueMs: "fast", fromVenueMs: 0 }, "lat"), "malformed-latency-spec", "toVenueMs");
  expectAbidesError(
    () =>
      validateAbidesWorldDefinition(
        abidesWorld({
          participantLatency: {
            [String(NOISE_PARTICIPANT)]: { toVenueMs: -5, fromVenueMs: 0 },
          },
        }),
      ),
    "malformed-latency-spec",
  );
});

test("a participant WITHOUT a latency declaration fails closed", () => {
  expectAbidesError(
    () => validateAbidesWorldDefinition(abidesWorld({ participantLatency: {} })),
    "malformed-world-definition",
    "NO latency declaration",
  );
});

test("an instrument on an unregistered venue fails closed", () => {
  expectAbidesError(
    () =>
      validateAbidesWorldDefinition(
        abidesWorld({ instruments: [abidesInstrument({ venueId: "GHOST" as never })] }),
      ),
    "unregistered-venue",
    "GHOST",
  );
});

test("out-of-order messages fail closed: sent from the future, arriving in the past", () => {
  let clock = 1_000;
  let counter = 0;
  const scheduler = createMessageScheduler({ now: () => clock as never, nextMessageId: () => `m${(counter += 1)}` });
  expectAbidesError(
    () =>
      scheduler.enqueue({
        messageClass: "order-command",
        from: "a",
        to: "venue",
        sentAt: 1_001 as never,
        arriveAt: 1_100 as never,
        payload: {},
      }),
    "out-of-order-message",
    "sent from the future",
  );
  expectAbidesError(
    () =>
      scheduler.enqueue({
        messageClass: "order-command",
        from: "a",
        to: "venue",
        sentAt: 1_000 as never,
        arriveAt: 999 as never,
        payload: {},
      }),
    "out-of-order-message",
    "delivered past",
  );
  // Scheduled wakes are exempt from the future-send check (they arm timers)…
  const wake = scheduler.enqueue({
    messageClass: "agent-wake",
    from: "a",
    to: "a",
    sentAt: 1_001 as never,
    arriveAt: 1_200 as never,
    payload: {},
  });
  assert.equal(wake.messageClass, "agent-wake");
  // …but never from arriving in the delivered past.
  clock = 1_300;
  expectAbidesError(
    () =>
      scheduler.enqueue({
        messageClass: "agent-wake",
        from: "a",
        to: "a",
        sentAt: 1_000 as never,
        arriveAt: 1_250 as never,
        payload: {},
      }),
    "out-of-order-message",
  );
});

test("duplicate agent ids and unknown participants fail closed", () => {
  expectAbidesError(
    () => createAbidesKernel({ definition: abidesWorld(), agents: [marketMakerDeclaration(), marketMakerDeclaration()] }),
    "duplicate-agent",
    "declared twice",
  );
  expectAbidesError(
    () =>
      createAbidesKernel({
        definition: abidesWorld(),
        agents: [marketMakerDeclaration({ participantId: "p-ghost" as never })],
      }),
    "unknown-agent",
    "p-ghost",
  );
});

test("view-config mismatches fail closed (instrument not in the world, not in the view)", () => {
  expectAbidesError(
    () =>
      createAbidesKernel({
        definition: abidesWorld(),
        agents: [marketMakerDeclaration({ viewInstruments: ["EQ-9" as never] })],
      }),
    "view-config-mismatch",
    "the world does not list",
  );
  expectAbidesError(
    () =>
      createAbidesKernel({
        definition: abidesWorld(),
        agents: [
          marketMakerDeclaration({
            viewInstruments: ["EQ-1" as never],
            config: {
              agentId: "mm-1",
              participantId: MM_PARTICIPANT,
              accountId: MM_ACCOUNT,
              instrumentId: "EQ-2" as never,
              anchorPrice: "100.00" as never,
              halfSpreadTicks: 5,
              quoteLots: 10,
              maxPositionLots: 100,
              requoteTicks: 3,
            },
          }),
        ],
      }),
    "view-config-mismatch",
    "never observe its own market",
  );
});

test("malformed wake schedules fail closed", () => {
  expectAbidesError(
    () =>
      createAbidesKernel({
        definition: abidesWorld(),
        agents: [noiseTraderDeclaration({ wakeSchedule: { everyMs: 0 } })],
      }),
    "malformed-wake-schedule",
    "positive integer everyMs",
  );
  expectAbidesError(
    () =>
      createAbidesKernel({
        definition: abidesWorld(),
        agents: [noiseTraderDeclaration({ wakeSchedule: { everyMs: 250, firstWakeMs: 0 as never } })],
      }),
    "malformed-wake-schedule",
    "precedes the clock origin",
  );
});

test("malformed world definitions fail closed with every problem collected", () => {
  const error = expectAbidesError(
    () =>
      validateAbidesWorldDefinition(
        abidesWorld({ worldId: "  " as never, worldDefinitionVersion: "", defaultStepMs: -1 }),
      ),
    "malformed-world-definition",
  );
  assert.ok(error.message.includes("worldId is blank"));
  assert.ok(error.message.includes("worldDefinitionVersion is blank"));
  assert.ok(error.message.includes("defaultStepMs"));
});

test("an account declaring live execution fails closed (A14)", () => {
  const accounts = abidesWorld().accounts.map((account) =>
    String(account.accountId) === "acct-noise"
      ? { ...account, permissions: { canTrade: true, canShort: true, liveExecutionAllowed: true as never } }
      : account,
  );
  expectAbidesError(
    () => validateAbidesWorldDefinition(abidesWorld({ accounts })),
    "live-execution-not-permitted",
    "simulated-only",
  );
});

test("invalid clock commands fail closed (step/seek guards)", async () => {
  const kernel = createAbidesKernel({ definition: abidesWorld(), agents: [] });
  try {
    await expectAsyncAbidesError(kernel.step(0), "invalid-clock-command");
    await expectAsyncAbidesError(kernel.step(-5), "invalid-clock-command");
    await expectAsyncAbidesError(kernel.seek(999_999 as never), "invalid-clock-command");
    await kernel.step(100);
    await expectAsyncAbidesError(kernel.seek((Number(kernel.now()) - 1) as never), "invalid-clock-command");
    assert.equal(Number(kernel.now()), 1_000_100);
  } finally {
    kernel.dispose();
  }
});

test("a disposed kernel fails closed on further traffic (message-after-close)", async () => {
  const kernel = createAbidesKernel({ definition: abidesWorld(), agents: [marketMakerDeclaration()] });
  await kernel.step(50);
  kernel.dispose();
  await expectAsyncAbidesError(kernel.step(50), "message-after-close");
  await expectAsyncAbidesError(kernel.seek((Number(kernel.now()) + 100) as never), "message-after-close");
});

test("the event-storm guard fails closed (reactive-loop-overflow)", async () => {
  const kernel = createAbidesKernel({
    definition: abidesWorld(),
    agents: [marketMakerDeclaration(), noiseTraderDeclaration()],
    messageBudget: 2,
  });
  try {
    await expectAsyncAbidesError(kernel.step(1_000), "reactive-loop-overflow");
  } finally {
    kernel.dispose();
  }
});

test("telemetry of an unknown agent fails closed", () => {
  const kernel = createAbidesKernel({ definition: abidesWorld(), agents: [] });
  try {
    expectAbidesError(() => kernel.telemetry("nobody"), "unknown-agent", "no agent");
  } finally {
    kernel.dispose();
  }
});

test("latency resolution is a pure keyed draw (determinism, in-bounds)", () => {
  const input = {
    bound: { minMs: 20, maxMs: 80 } as const,
    seed: "w024-seed-a",
    direction: "to-venue" as const,
    actor: String(NOISE_PARTICIPANT),
  };
  assert.equal(resolveLatencyMs({ ...input, key: "k1" }), resolveLatencyMs({ ...input, key: "k1" }));
  assert.equal(resolveLatencyMs({ bound: 37, seed: "s", direction: "to-venue", actor: "a", key: 1 }), 37);
  const draws = new Set<number>();
  for (let index = 0; index < 50; index += 1) {
    const draw = resolveLatencyMs({ ...input, key: index });
    assert.ok(draw >= 20 && draw <= 80, `draw ${String(draw)} in [20, 80]`);
    draws.add(draw);
  }
  assert.ok(draws.size > 1, "keyed draws vary across keys");
});

test("the world digest is stable across rebuilds and seed-sensitive", () => {
  assert.equal(abidesWorldDigest(abidesWorld()), abidesWorldDigest(abidesWorld()));
  assert.notEqual(abidesWorldDigest(abidesWorld()), abidesWorldDigest(abidesWorld({ seed: "w024-seed-b" })));
});
