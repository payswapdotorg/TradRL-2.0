/**
 * THE W017 DETERMINISM GOLDEN — the generator's flagship (A9).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — "A determinism claim requires fixed
 * world definition, engine version, seed and command stream."
 * Spec: spec/SIMULATION.md "Synthetic regimes" (seeded regimes; regime
 * schedules are part of world metadata) + "Participants" + "Determinism".
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md B (a deterministic market generator
 * creating multiple regimes) and I (headless parity).
 *
 * THE CLAIM UNDER PROOF: two engines given the SAME definition (including
 * the regime schedule), the SAME seed, the SAME clock operations and the
 * SAME commands produce IDENTICAL journals — including every GENERATED
 * event (regime announcements, halt/reopen transitions, quote projections,
 * and the whole matching journal of the synthetic participants' orders) —
 * while a different seed, everything else equal, DIVERGES. The generator's
 * decisions are pure functions of (seed, schedule, simulation time) — no
 * hidden cursor — so the claim covers stepping and seeking alike.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AddAnnotationCommand,
  CancelOrderCommand,
  OrderSide,
  RegimeScheduleEntry,
  SetScenarioCommand,
  SubmitOrderCommand,
} from "tradrl-world-contracts";
import type { DeterministicStreamVerification } from "tradrl-world-contracts/time";
import { asWallTime } from "tradrl-world-contracts/time";
import { validateEventStream } from "tradrl-world-contracts/time";
import { MARKET_GENERATOR_PRODUCER } from "../events.js";
import { createGeneratedWorldEngine } from "../engine.js";
import {
  INSTRUMENT,
  START,
  TRADER,
  TRADER_ACCOUNT,
  WALL_START,
  at,
  generatedDefinition,
} from "./helpers.js";

const GOLDEN_PRNG_SEED = 0x5eed_017;
const ITERATIONS = 44;

/**
 * The golden regime schedule: all six SIMULATION.md regimes in one authored
 * sequence, one-second action grid, anchored around 4800.
 */
function goldenSchedule(): readonly RegimeScheduleEntry[] {
  return [
    { regime: "trend", from: at(START), to: at(START + 9_000), parameters: { anchorPrice: 4800, direction: 1 } },
    { regime: "high-volatility", from: at(START + 9_000), to: at(START + 15_000), parameters: { anchorPrice: 4800 } },
    { regime: "low-liquidity", from: at(START + 15_000), to: at(START + 21_000), parameters: { anchorPrice: 4800 } },
    { regime: "shock", from: at(START + 21_000), to: at(START + 28_000), parameters: { anchorPrice: 4800, gapLots: 20 } },
    { regime: "halt-reopen", from: at(START + 28_000), to: at(START + 40_000), parameters: { anchorPrice: 4800, reopenAfterMs: 4_000 } },
    { regime: "mean-reversion", from: at(START + 40_000), to: at(START + 60_000), parameters: { anchorPrice: 4802 } },
  ];
}

/** mulberry32 — the seeded command-stream PRNG (same family as the W014 golden). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function liveHumanOrderIds(engine: ReturnType<typeof createGeneratedWorldEngine>): string[] {
  return engine
    .worldState()
    .matching.orders.filter(
      (order) =>
        order.accountId === TRADER_ACCOUNT &&
        (order.status === "accepted" || order.status === "partially-filled"),
    )
    .map((order) => String(order.orderId));
}

/**
 * The one golden runner: a seeded interleaving of clock operations (steps,
 * bounded forward seeks, a swallowed backward seek, speed/status changes)
 * with human commands (market and limit orders into the GENERATED book,
 * cancels, annotations, a structural rejection, an unknown-entity
 * rejection, duplicate re-issues, and one mid-run setScenario that
 * re-anchors the closing mean-reversion window). The generator turns fire
 * on the schedule's action grid as the clock advances — the journal under
 * proof carries BOTH the human stream's events and every generated one.
 */
async function runGoldenEngine(options: {
  prngSeed: number;
  wallBase: number;
  worldSeed?: string;
}): Promise<ReturnType<typeof createGeneratedWorldEngine>> {
  const definition = generatedDefinition({
    regimeSchedule: goldenSchedule(),
    ...(options.worldSeed === undefined ? {} : { seed: options.worldSeed }),
  });
  let wallTick = 0;
  const engine = createGeneratedWorldEngine({
    definition,
    wallTimeSource: () => asWallTime(options.wallBase + (wallTick += 7)),
  });
  const rng = mulberry32(options.prngSeed);
  const rngInt = (max: number) => Math.floor(rng() * max);

  const annotate = (command: AddAnnotationCommand) => engine.command.addAnnotation(command);
  const order = (submission: SubmitOrderCommand["submission"], commandId: string) =>
    engine.command.submitOrder({
      kind: "submit-order",
      commandId: commandId as never,
      worldId: definition.scope.worldId,
      issuedBy: TRADER,
      issuedAt: engine.clockState().simulationTime as never,
      accountId: TRADER_ACCOUNT,
      instrumentId: INSTRUMENT,
      submission,
    });

  let scenarioFired = false;
  for (let i = 0; i < ITERATIONS; i += 1) {
    const roll = rng();
    if (roll < 0.3) {
      await engine.clock.step(1_000 + rngInt(2_000));
    } else if (roll < 0.46) {
      const target = engine.clockState().simulationTime + 1_000 + rngInt(4_000);
      await engine.clock.seek(target as never);
    } else if (roll < 0.5) {
      // A8: a deliberate backward seek — the typed rejection is swallowed
      // (the clock tests assert the rejection itself)
      await engine.clock.seek(engine.clockState().simulationTime as never).catch(() => undefined);
    } else if (roll < 0.56) {
      await engine.clock.setSpeed(0.5 + rngInt(8));
    } else if (roll < 0.6) {
      await engine.clock.pause();
      await engine.clock.play();
    } else if (roll < 0.76) {
      // THE HUMAN FLOW into the generated market: market sweeps that lift
      // generated maker liquidity and resting limits near the touch
      const commandId = `cmd-human-${String(i)}`;
      const side: OrderSide = rng() < 0.5 ? "buy" : "sell";
      const quantity = String(1 + rngInt(4));
      if (rng() < 0.6) {
        await order(
          { kind: "market", side, quantity: quantity as never, constraints: { timeInForce: "IOC" } },
          commandId,
        );
      } else {
        const ticks = rngInt(4);
        await order(
          {
            kind: "limit",
            side,
            quantity: quantity as never,
            limitPrice: String(4800 + 0.25 * (side === "buy" ? -ticks : ticks)) as never,
            constraints: { timeInForce: "GTC" },
          },
          commandId,
        );
      }
    } else if (roll < 0.84) {
      const live = liveHumanOrderIds(engine);
      if (live.length > 0) {
        const cancel: CancelOrderCommand = {
          kind: "cancel-order",
          commandId: `cmd-cancel-${String(i)}` as never,
          worldId: definition.scope.worldId,
          issuedBy: TRADER,
          issuedAt: engine.clockState().simulationTime as never,
          orderId: live[rngInt(live.length)]! as never,
        };
        await engine.command.cancelOrder(cancel);
      }
    } else if (roll < 0.9) {
      await annotate({
        kind: "add-annotation",
        commandId: `cmd-ann-${String(i)}` as never,
        worldId: definition.scope.worldId,
        issuedBy: TRADER,
        issuedAt: engine.clockState().simulationTime as never,
        at: (START + rngInt(50_000)) as never,
        text: `golden-${String(i)}`,
      });
    } else if (roll < 0.93) {
      // structural rejection (blank text)
      await annotate({
        kind: "add-annotation",
        commandId: `cmd-bad-${String(i)}` as never,
        worldId: definition.scope.worldId,
        issuedBy: TRADER,
        issuedAt: engine.clockState().simulationTime as never,
        at: engine.clockState().simulationTime as never,
        text: " ",
      });
    } else if (roll < 0.96) {
      // unknown-entity rejection
      await annotate({
        kind: "add-annotation",
        commandId: `cmd-ghost-${String(i)}` as never,
        worldId: definition.scope.worldId,
        issuedBy: "participant-nope" as never,
        issuedAt: engine.clockState().simulationTime as never,
        at: engine.clockState().simulationTime as never,
        text: "ghost",
      });
    } else if (!scenarioFired && i >= ITERATIONS - 8) {
      // one mid-run setScenario: re-anchor the closing mean-reversion window
      // (the generator redirects from its next pass — same regimes, new pin)
      scenarioFired = true;
      const scenario: SetScenarioCommand = {
        kind: "set-scenario",
        commandId: `cmd-scenario-${String(i)}` as never,
        worldId: definition.scope.worldId,
        issuedBy: TRADER,
        issuedAt: engine.clockState().simulationTime as never,
        scenario: {
          label: "golden-redirect",
          entries: [
            ...goldenSchedule().slice(0, 5),
            { regime: "mean-reversion", from: at(START + 40_000), to: at(START + 60_000), parameters: { anchorPrice: 4798 } },
          ],
        },
      };
      await engine.command.setScenario(scenario);
    } else {
      // duplicate re-issue of an earlier annotation command id, verbatim
      await annotate({
        kind: "add-annotation",
        commandId: `cmd-ann-${String(Math.max(0, i - 1))}` as never,
        worldId: definition.scope.worldId,
        issuedBy: TRADER,
        issuedAt: engine.clockState().simulationTime as never,
        at: engine.clockState().simulationTime as never,
        text: "dup",
      });
    }
  }
  // land the clock deterministically past every regime boundary (the final
  // seek covers the closing window whichever way the seeded steps landed)
  const finalTarget = START + 46_000;
  if (engine.clockState().simulationTime < finalTarget) {
    await engine.clock.seek(finalTarget as never);
  }
  return engine;
}

function outcomeOf(engine: Awaited<ReturnType<typeof runGoldenEngine>>) {
  const manifest = engine.determinismManifest();
  const digest = engine.journal.digest();
  return {
    digest,
    manifest,
    state: engine.worldState(),
    verification: { manifest, digest } as DeterministicStreamVerification,
    journalSize: engine.journal.size(),
  };
}

test("W017 golden: same definition+seed+clock+commands ⇒ identical journals INCLUDING generated events", async () => {
  const runA = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  // a second, independently constructed engine — and a DIFFERENT host clock
  const runB = outcomeOf(
    await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START + 86_400_000 }),
  );

  assert.ok(runA.journalSize >= 200, "the golden journal is a substantial generated history");
  assert.deepEqual(runA.digest, runB.digest, "journal digest identical (wall time never leaks)");
  assert.deepEqual(runA.manifest, runB.manifest, "determinism manifest identical");
  assert.deepEqual(runA.state, runB.state, "authoritative state identical");
  assert.deepEqual(runA.verification, runB.verification, "DeterministicStreamVerification identical");
  assert.equal(runA.digest.lastSequence, runA.journalSize);
  if (process.env.GOLDEN_ECHO === "1") {
    console.log(`GOLDEN journalSize=${String(runA.journalSize)} eventChecksum=${runA.digest.eventChecksum} commandStreamHash=${runA.manifest.commandStreamHash}`);
  }
});

test("W017 golden: a different seed diverges (same human stream, same clock) — the generator is seeded", async () => {
  const baseline = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const otherSeed = outcomeOf(
    await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START, worldSeed: "w017-golden-alt-seed" }),
  );
  // the runner's HUMAN commands and clock operations are the same seeded
  // stream (the prng seed is unchanged); what changed is the world seed —
  // the generator's draws. Note the generated participants' orders are
  // themselves commands through the real port, so the command-stream hash
  // legitimately moves with them; the claim under proof is the JOURNAL.
  assert.notEqual(otherSeed.manifest.seed, baseline.manifest.seed);
  assert.notEqual(
    otherSeed.manifest.inputHashes["worldDefinition"],
    baseline.manifest.inputHashes["worldDefinition"],
  );
  assert.notDeepEqual(otherSeed.digest, baseline.digest, "different seed ⇒ different journal");
  assert.ok(otherSeed.journalSize >= 200, "the divergent run is a substantial history too");
  if (process.env.GOLDEN_ECHO === "1") {
    console.log(`ALT_SEED journalSize=${String(otherSeed.journalSize)} eventChecksum=${otherSeed.digest.eventChecksum}`);
  }
});

test("W017 golden evidence: the six regimes ran, halts/reopens flowed, and humans traded on generated liquidity", async () => {
  const engine = await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START });
  const records = engine.journal.records();
  const state = engine.worldState();

  // every regime in the schedule was announced (origin rule + boundaries)
  const announcements = engine.journal.read({ types: ["market.regime.changed"] });
  const announced = announcements.map((envelope) => (envelope.payload as { to: string }).to);
  assert.deepEqual(announced, [
    "trend",
    "high-volatility",
    "low-liquidity",
    "shock",
    "halt-reopen",
    "mean-reversion",
  ]);
  assert.ok(announcements.every((envelope) => envelope.producer === MARKET_GENERATOR_PRODUCER));

  // the halt/reopen flowed through the W014 reduction paths
  const halts = engine.journal.read({ types: ["market.halted"] });
  const reopens = engine.journal.read({ types: ["market.reopened"] });
  assert.equal(halts.length, 1);
  assert.equal(halts[0]?.occurredAt, START + 28_000);
  assert.equal(reopens.length, 1);
  assert.equal(reopens[0]?.occurredAt, START + 32_000);
  assert.ok(
    (reopens[0]!.payload as { referencePrice?: string }).referencePrice !== undefined,
    "the reopen carries the last printed trade as reference",
  );

  // the generated participants quoted and traded through the REAL engine
  const generatedAccepts = records.filter(
    (record) =>
      record.envelope.eventType === "matching.order.accepted" &&
      String(record.envelope.causationId).startsWith("cmd-gen:"),
  );
  assert.ok(generatedAccepts.length >= 40, "the synthetic population submitted many real orders");
  assert.ok(state.matching.trades.length >= 10, "the generated market printed a tape");
  assert.ok(
    engine.journal.read({ types: ["market.quote.updated"] }).length >= 10,
    "quote projections moved with the market",
  );

  // the human flow filled on GENERATED liquidity: a human fill whose trade's
  // counterparty fill belongs to a synthetic participant
  const humanFills = state.matching.fills.filter((fill) => fill.accountId === TRADER_ACCOUNT);
  assert.ok(humanFills.length >= 1, "the human flow traded");
  const syntheticIds = new Set(
    generatedAccepts.map(
      (record) => (record.envelope.payload as { submittedBy: string }).submittedBy,
    ),
  );
  const counterparties = state.matching.fills
    .filter((fill) => syntheticIds.has(String(state.matching.orders.find((order) => order.orderId === fill.orderId)?.submittedBy)))
    .map((fill) => String(fill.orderId));
  assert.ok(counterparties.length >= 10, "generated participants hold the other side of the tape");

  // every fill cites a journaled trade (the W014 causality law, on generated
  // liquidity too), and the whole stream satisfies the W004 laws
  const tradesBySequence = new Map(records.map((record) => [record.envelope.sequence, record.envelope]));
  for (const fill of state.matching.fills) {
    const trade = tradesBySequence.get(fill.marketRef.sequence);
    assert.ok(trade !== undefined, `fill ${String(fill.fillId)} cites a journaled trade`);
    assert.equal(trade.eventType, "market.trade.printed");
  }
  assert.deepEqual(validateEventStream(records.map((record) => record.envelope)), { ok: true });

  // the producer boundary holds across the whole golden journal
  for (const record of records) {
    const { eventType, producer } = record.envelope;
    if (eventType.startsWith("matching.") || eventType === "market.trade.printed" || eventType === "market.book.delta") {
      assert.equal(producer, "matching-engine", `${eventType} belongs to the matching engine`);
    }
    if (eventType === "market.regime.changed" || eventType === "market.quote.updated" || eventType === "market.halted" || eventType === "market.reopened") {
      assert.equal(producer, MARKET_GENERATOR_PRODUCER, `${eventType} belongs to the generator`);
    }
  }

  // the headless report mirrors the journal (SIMULATION.md "Headless report")
  const report = engine.headlessReport();
  assert.equal(report.eventCount, engine.journal.size());
  assert.equal(report.eventHash, engine.journal.digest().eventChecksum);
  assert.equal(report.seed, "w017-test-seed");
});
