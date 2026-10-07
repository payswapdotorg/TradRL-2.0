/**
 * THE DETERMINISM GOLDEN TEST — the W013/W014/W015 package's flagship (A9).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — "A determinism claim requires fixed
 * world definition, engine version, seed and command stream."
 * Spec: spec/WORLD-PROTOCOL.md "Determinism" (the manifest) and "Event
 * envelope" (sequence monotonic per world).
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md I (headless parity: the same command
 * stream produces the same deterministic result hash) and F (one golden
 * command sequence, matching assertions).
 * Spec: spec/SIMULATION.md "Matching" + "Headless report" — the W014
 * extension: the golden stream is now an ORDER FLOW (resting makers,
 * aggressive sweeps, stop arms that trigger and fill, IOC/FOK/post-only
 * outcomes, cancels, replacements) so the matching engine's whole batch
 * journaling — trade prints, causal fills, book deltas — is under the A9
 * claim too.
 * Spec: spec/DOMAIN-MODEL.md "Ownership"/"Financial precision" — the W015
 * extension: the golden world carries TWO funded accounts (a trader with
 * declared risk limits and a counterparty whose resting liquidity the flow
 * trades against) and the stream includes close-position, so the golden
 * claim now covers order flow → fills → ACCOUNT/PORTFOLIO/RISK: the
 * identical-inputs runs must agree on the journal digest, the determinism
 * manifest, the authoritative state (financial slice included) AND the
 * headless financial report (balances, positions, P&L, risk), and a fresh
 * instance replaying the journal must reproduce every event-derived
 * financial figure bit-for-bit.
 *
 * Design: a fixed world definition (seed, versions, entities) and a SEEDED
 * command stream (mulberry32 PRNG choosing commands, rejections, duplicates
 * and clock operations) are run through independent engine instances. The
 * A9 claim under proof:
 *   identical (world definition, engine version, seed, command stream)
 *     ⇒ identical journal digest, identical determinism manifest,
 *       identical authoritative state — and a fresh instance replaying the
 *       same journal reproduces all three, while wall time (varied between
 *       runs) never leaks into any of them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Account,
  AddAnnotationCommand,
  CancelOrderCommand,
  OrderSide,
  Participant,
  ReplaceOrderCommand,
  SetScenarioCommand,
  SubmitOrderCommand,
} from "tradrl-world-contracts";
import type { DeterministicStreamVerification } from "tradrl-world-contracts/time";
import { asWallTime } from "tradrl-world-contracts/time";
import { validateEventStream } from "tradrl-world-contracts/time";
import { createEventJournalFromRecords } from "../../journal/index.js";
import {
  formatSignedMoney,
  isCanonicalSignedMoney,
  parseSignedMoney,
  signedMulDivHalfUp,
} from "../../index.js";
import { createHeadlessWorldEngine } from "../index.js";
import type { HeadlessRunReport } from "../index.js";
import type { WorldDefinition } from "../index.js";
import {
  INSTRUMENT,
  START,
  TRADER,
  TRADER_ACCOUNT,
  WALL_START,
  addAnnotationCommand,
  closePositionCommand,
  mulberry32,
  setScenarioCommand,
  testAccount,
  testDefinition,
  testParticipant,
  testVenue,
} from "./helpers.js";

const GOLDEN_PRNG_SEED = 0x5eed_013;
const ITERATIONS = 96;
const REGIMES = ["trend", "mean-reversion", "high-volatility", "low-liquidity", "shock", "halt-reopen"] as const;
const COUNTER = "participant-counter" as Participant["participantId"];
const COUNTER_ACCOUNT = "account-counter" as Account["accountId"];

/**
 * The golden world (W015 extension): a TRADER account with declared risk
 * limits and a funded COUNTER account with a second participant, so the
 * golden flow OPENS real positions on both sides of the book (the W013/W014
 * golden was single-account: every trade netted to zero and only fees moved
 * cash). The counterparty rests in the warm-up; the seeded mix trades against
 * its liquidity, so fills, fees, marks, P&L and risk all land under the A9
 * claim (order flow → fills → account/portfolio/risk).
 */
function goldenDefinition(): WorldDefinition {
  return testDefinition({
    venues: [testVenue()],
    accounts: [
      testAccount(),
      testAccount({
        accountId: COUNTER_ACCOUNT,
        balances: { USD: { amount: "50000.00" as never, currency: "USD" as never } } as never,
        buyingPower: { amount: "50000.00" as never, currency: "USD" as never },
        marginUsed: { amount: "0.00" as never, currency: "USD" as never },
        marginAvailable: { amount: "50000.00" as never, currency: "USD" as never },
        leverage: 2,
      }),
    ],
    participants: [testParticipant(), testParticipant({ participantId: COUNTER, accountId: COUNTER_ACCOUNT })],
    riskLimits: {
      [TRADER_ACCOUNT]: {
        maxOrderQuantity: "9" as never,
        maxGrossExposure: { amount: "60000" as never, currency: "USD" as never },
      },
    },
  });
}

/** A tick-aligned canonical price `4800 + 0.25 × ticksFromMid`. */
function priceAt(ticksFromMid: number): string {
  return String(4800 + 0.25 * ticksFromMid);
}

/** Only non-terminal orders can be canceled/replaced. */
function liveOrderIds(engine: ReturnType<typeof createHeadlessWorldEngine>): string[] {
  return engine
    .worldState()
    .matching.orders.filter((order) => order.status === "accepted" || order.status === "partially-filled")
    .map((order) => String(order.orderId));
}

/**
 * The one golden scenario runner (the single source of truth — every test
 * derives from it): a deterministic WARM-UP order flow (a resting maker, an
 * armed stop that a printed trade then triggers and fills — so every golden
 * journal carries trades, causal fills, partial fills and a stop cascade by
 * construction), then a seeded interleaving of clock operations and a
 * command mix (order submissions of every kind × TIF × policy, cancels,
 * replacements, annotations, scenario sets, structural rejections, unknown
 * participants, duplicate re-issues). `wallBase` varies the host-axis
 * readings between runs; it must never affect the outcome.
 */
async function runGoldenEngine(options: {
  prngSeed: number;
  wallBase: number;
  definition?: WorldDefinition;
}) {
  const definition = options.definition ?? goldenDefinition();
  let wallTick = 0;
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: () => asWallTime(options.wallBase + (wallTick += 7)),
  });
  const rng = mulberry32(options.prngSeed);
  const rngInt = (max: number) => Math.floor(rng() * max);

  const annotate = (command: AddAnnotationCommand) => engine.command.addAnnotation(command);
  const scenario = (command: SetScenarioCommand) => engine.command.setScenario(command);
  /** Submit one order command (explicit submission — no default leakage). */
  const order = (submission: SubmitOrderCommand["submission"], commandId: string) =>
    engine.command.submitOrder({
      kind: "submit-order",
      commandId: commandId as never,
      worldId: definition.scope.worldId,
      issuedBy: TRADER,
      issuedAt: START as never,
      accountId: TRADER_ACCOUNT,
      instrumentId: INSTRUMENT,
      submission,
    });
  /** Submit one order as the counterparty (the other side of the book). */
  const counterOrder = (submission: SubmitOrderCommand["submission"], commandId: string) =>
    engine.command.submitOrder({
      kind: "submit-order",
      commandId: commandId as never,
      worldId: definition.scope.worldId,
      issuedBy: COUNTER,
      issuedAt: START as never,
      accountId: COUNTER_ACCOUNT,
      instrumentId: INSTRUMENT,
      submission,
    });

  // --- the W014/W015 warm-up flow (deterministic, seed-independent) ---------
  // 1. the counterparty rests a maker ask at 4800.25 (the trader will trade
  //    against it, so BOTH accounts open real positions from the same tape)
  await counterOrder({ kind: "limit", side: "sell", quantity: "10" as never, limitPrice: "4800.25" as never, constraints: { timeInForce: "GTC" } }, "cmd-flow-warm-1");
  // 2. an armed stop buy at 4800
  await order({ kind: "stop", side: "buy", quantity: "3" as never, stopPrice: "4800" as never, constraints: { timeInForce: "GTC" } }, "cmd-flow-warm-2");
  // 3. a market buy that trades at 4800.25, triggering and filling the stop
  await order({ kind: "market", side: "buy", quantity: "2" as never, constraints: { timeInForce: "IOC" } }, "cmd-flow-warm-3");
  // 4. the counterparty rests a bid one tick below (does not cross its own
  //    ask); a pure reduction for its short — accepted margin-free
  await counterOrder({ kind: "limit", side: "buy", quantity: "5" as never, limitPrice: "4799.75" as never, constraints: { timeInForce: "GTC" } }, "cmd-flow-warm-4");
  // 5. the trader CLOSES through the venue (W015): the reducing IOC market
  //    sell crosses the bid — realized P&L lands on both accounts and the
  //    mark moves off the entry price
  await engine.command.closePosition(
    closePositionCommand({ commandId: "cmd-flow-warm-5" as never }),
  );

  // --- the seeded command mix ------------------------------------------------
  for (let i = 0; i < ITERATIONS; i += 1) {
    const roll = rng();
    if (roll < 0.25) {
      await engine.clock.step(1_000 + rngInt(9_000));
    } else if (roll < 0.32) {
      // bounded forward seek (backward seeks reject — exercised next)
      const target = engine.clockState().simulationTime + 1_000 + rngInt(5_000);
      await engine.clock.seek(target as never);
    } else if (roll < 0.36) {
      // A8 rejection path: a deliberate backward seek, rejection swallowed
      // by the runner (the clock tests assert the typed rejection itself)
      await engine.clock.seek(engine.clockState().simulationTime as never).catch(() => undefined);
    } else if (roll < 0.42) {
      await engine.clock.setSpeed(0.5 + rngInt(8));
    } else if (roll < 0.46) {
      await engine.clock.pause();
      await engine.clock.play();
    } else if (roll < 0.62) {
      await annotate(
        addAnnotationCommand({
          commandId: `cmd-ann-${String(i)}` as never,
          issuedAt: (START + i) as never,
          at: (START + rngInt(100_000)) as never,
          text: `note-${String(i)}-${String(rngInt(1000))}`,
          ...(rng() < 0.3 ? { instrumentId: definition.instruments[0]!.instrumentId } : {}),
        }),
      );
    } else if (roll < 0.72) {
      await scenario(
        setScenarioCommand({
          commandId: `cmd-scn-${String(i)}` as never,
          issuedAt: (START + i) as never,
          scenario: {
            ...(rng() < 0.5 ? { label: `scenario-${String(rngInt(50))}` } : {}),
            entries: [
              {
                regime: REGIMES[rngInt(REGIMES.length)]!,
                from: (START + rngInt(10_000)) as never,
              },
            ],
          },
        }),
      );
    } else if (roll < 0.78) {
      // structural rejection (validate): blank text
      await annotate(
        addAnnotationCommand({ commandId: `cmd-bad-${String(i)}` as never, text: " " }),
      );
    } else if (roll < 0.84) {
      // unknown-entity rejection (validate)
      await annotate(
        addAnnotationCommand({
          commandId: `cmd-ghost-${String(i)}` as never,
          issuedBy: "participant-nope" as never,
        }),
      );
    } else if (roll < 0.94) {
      // THE W014 SEEDED ORDER FLOW: kinds × TIF × policies, cancels, replaces
      const pick = rng();
      const commandId = `cmd-flow-${String(i)}`;
      const side: OrderSide = rng() < 0.5 ? "buy" : "sell";
      const quantity = String(1 + rngInt(9));
      const live = liveOrderIds(engine);
      if (pick < 0.24) {
        // resting maker limit, 1–4 ticks away from mid
        const drift = 1 + rngInt(4);
        await order(
          {
            kind: "limit",
            side,
            quantity: quantity as never,
            limitPrice: priceAt(side === "buy" ? -drift : drift) as never,
            constraints: { timeInForce: "GTC" },
          },
          commandId,
        );
      } else if (pick < 0.44) {
        // aggressive market order — sweeps what is there, remainder cancels
        await order(
          { kind: "market", side, quantity: quantity as never, constraints: { timeInForce: "IOC" } },
          commandId,
        );
      } else if (pick < 0.56) {
        // stop arm 2–5 ticks through mid (triggers when the flow trades there)
        const far = 2 + rngInt(4);
        await order(
          {
            kind: "stop",
            side,
            quantity: quantity as never,
            stopPrice: priceAt(side === "buy" ? far : -far) as never,
            constraints: { timeInForce: "GTC" },
          },
          commandId,
        );
      } else if (pick < 0.66) {
        // FOK market — all-or-nothing at submission (mostly fok-unfillable)
        await order(
          { kind: "market", side, quantity: quantity as never, constraints: { timeInForce: "FOK" } },
          commandId,
        );
      } else if (pick < 0.76) {
        // post-only limit at/through mid — rejects whenever it would take
        await order(
          {
            kind: "limit",
            side,
            quantity: quantity as never,
            limitPrice: priceAt(side === "buy" ? rngInt(3) : -rngInt(3)) as never,
            constraints: { timeInForce: "GTC", postOnly: true },
          },
          commandId,
        );
      } else if (pick < 0.82) {
        // W015: close the trader's position through the venue (a reducing
        // IOC market order — acked, or the typed no-open-position rejection
        // when flat; both are deterministic outcomes of the same stream)
        await engine.command.closePosition(
          closePositionCommand({ commandId: commandId as never, issuedAt: (START + i) as never }),
        );
      } else if (pick < 0.9 && live.length > 0) {
        // cancel a live order (deterministic pick from current state)
        const cancel: CancelOrderCommand = {
          kind: "cancel-order",
          commandId: commandId as never,
          worldId: definition.scope.worldId,
          issuedBy: TRADER,
          issuedAt: (START + i) as never,
          orderId: live[rngInt(live.length)]! as never,
        };
        await engine.command.cancelOrder(cancel);
      } else {
        // replace a live order's quantity (cancel-and-replace through the seam)
        if (live.length > 0) {
          const replace: ReplaceOrderCommand = {
            kind: "replace-order",
            commandId: commandId as never,
            worldId: definition.scope.worldId,
            issuedBy: TRADER,
            issuedAt: (START + i) as never,
            orderId: live[rngInt(live.length)]! as never,
            quantity: quantity as never,
          };
          await engine.command.replaceOrder(replace);
        } else {
          await order(
            { kind: "market", side, quantity: quantity as never, constraints: { timeInForce: "IOC" } },
            commandId,
          );
        }
      }
    } else {
      // duplicate re-issue: an earlier acked command id, verbatim
      await annotate(
        addAnnotationCommand({ commandId: `cmd-ann-${String(Math.max(0, i - 1))}` as never }),
      );
    }
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
    report: engine.headlessReport(),
    verification: { manifest, digest } as DeterministicStreamVerification,
    journalSize: engine.journal.size(),
  };
}

test("A9 golden: identical inputs ⇒ identical digest, manifest, state and financial report across runs", async () => {
  const runA = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const runB = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));

  assert.ok(runA.journalSize >= 10, "the golden stream journals a meaningful number of events");
  assert.deepEqual(runA.digest, runB.digest, "journal digest identical");
  assert.deepEqual(runA.manifest, runB.manifest, "determinism manifest identical");
  assert.deepEqual(runA.state, runB.state, "authoritative state identical");
  assert.deepEqual(runA.report, runB.report, "headless financial report identical (W015)");
  assert.deepEqual(runA.verification, runB.verification, "DeterministicStreamVerification identical");
  assert.equal(runA.digest.lastSequence, runA.journalSize);
});

test("A9 golden: wall time never leaks into the journal (varied wall clock, same digest)", async () => {
  const hostRun = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const otherHost = outcomeOf(
    await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START + 86_400_000 }),
  );
  assert.deepEqual(otherHost.digest, hostRun.digest, "digest is wall-time independent");
  assert.deepEqual(otherHost.state, hostRun.state, "state is wall-time independent");
  assert.deepEqual(otherHost.report, hostRun.report, "financial report is wall-time independent (W015)");
  assert.equal(otherHost.manifest.commandStreamHash, hostRun.manifest.commandStreamHash);
});

test("A9 golden: a fresh instance replaying the same journal reproduces everything", async () => {
  const definition = goldenDefinition();
  const source = await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START });
  const original = outcomeOf(source);

  // rebuild a live journal from the original records, then a fresh engine
  const restored = createHeadlessWorldEngine({
    definition,
    wallTimeSource: () => asWallTime(WALL_START),
    restore: {
      journal: createEventJournalFromRecords({
        worldId: definition.scope.worldId,
        records: source.journal.records(),
      }),
    },
  });

  assert.deepEqual(restored.journal.digest(), original.digest, "restored digest identical");
  assert.deepEqual(restored.worldState(), original.state, "replayed state bit-identical");
  // the W015 financial surface survives the replay bit-for-bit: every
  // event-derived figure (balances, open positions, P&L, breach history) is
  // reproduced from the journal alone. asOf-bearing projections re-derive
  // from the replayed clock (the finalSimulationTime assertion below pins
  // the one honest difference: the live run's clock advanced past the last
  // event; the replayed clock starts at it).
  const restoredReport: HeadlessRunReport = restored.headlessReport();
  assert.deepEqual(restoredReport.balances, original.report.balances, "replayed balances identical");
  assert.deepEqual(restoredReport.positions, original.report.positions, "replayed positions identical");
  assert.deepEqual(restoredReport.pnl, original.report.pnl, "replayed P&L identical");
  assert.deepEqual(
    restoredReport.risk.map((entry) => ({ ...entry, asOf: undefined })),
    original.report.risk.map((entry) => ({ ...entry, asOf: undefined })),
    "replayed risk (limits + breaches) identical",
  );
  const records = restored.journal.records();
  assert.equal(
    restored.clockState().simulationTime,
    records[records.length - 1]?.envelope.occurredAt ?? START,
    "clock defaults to the last replayed event time",
  );

  // the duplicate-command law survives the replay: re-issuing an acked
  // command id rejects exactly as it did live
  const ackedId = original.state.ackedCommandIds.values().next().value as string;
  const duplicate = await restored.command.addAnnotation(
    addAnnotationCommand({ commandId: ackedId as never }),
  );
  assert.equal(
    duplicate.status === "rejected" && duplicate.rejection.code,
    "duplicate-command",
  );
  // and the W014/W015 seams survive the replay: the restored engine keeps
  // accepting orders through the same lifecycle, with the replayed order
  // registry continuing from where the journal left off. The probe is a
  // small far-away resting SELL — it passes the trader's golden risk limits
  // in every reachable end state (a reduction when long, gross 4804 when
  // flat) and cannot cross (the book's bids rest well below mid).
  const ordersBefore = restored.worldState().matching.orders.length;
  const fresh = await restored.command.submitOrder({
    kind: "submit-order",
    commandId: "cmd-post-restore" as never,
    worldId: definition.scope.worldId,
    issuedBy: TRADER,
    issuedAt: START as never,
    accountId: TRADER_ACCOUNT,
    instrumentId: INSTRUMENT,
    submission: {
      kind: "limit",
      side: "sell",
      quantity: "1" as never,
      limitPrice: "4804" as never,
      constraints: { timeInForce: "GTC" },
    },
  });
  assert.equal(fresh.status, "acked");
  assert.equal(
    restored.worldState().matching.orders.length,
    ordersBefore + 1,
    "the restored engine accepted a new order through the seam",
  );
});

test("A9 golden: the golden journal satisfies the W004 ordered-stream laws", async () => {
  const engine = await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START });
  const records = engine.journal.records();
  const validation = validateEventStream(records.map((record) => record.envelope));
  assert.deepEqual(validation, { ok: true });
  // sequences are dense and strictly monotonic from 1
  assert.deepEqual(
    records.map((record) => record.envelope.sequence),
    records.map((_, index) => index + 1),
  );
});

test("A9 golden sensitivity: a different command stream produces a different digest", async () => {
  const baseline = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const differentStream = outcomeOf(
    await runGoldenEngine({ prngSeed: 0x0dd_5eed, wallBase: WALL_START }),
  );
  assert.ok(differentStream.journalSize >= 10);
  assert.notDeepEqual(differentStream.digest, baseline.digest);
  assert.notEqual(
    differentStream.manifest.commandStreamHash,
    baseline.manifest.commandStreamHash,
  );
});

test("A9 golden: a different world definition changes the manifest input hash", async () => {
  const baseline = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const otherDefinitionRun = outcomeOf(
    await runGoldenEngine({
      prngSeed: GOLDEN_PRNG_SEED,
      wallBase: WALL_START,
      definition: testDefinition({
        seed: "w013-other-seed",
        worldDefinitionVersion: "w013-test-def@2",
      }),
    }),
  );
  assert.notEqual(
    otherDefinitionRun.manifest.inputHashes["worldDefinition"],
    baseline.manifest.inputHashes["worldDefinition"],
  );
  assert.notEqual(otherDefinitionRun.manifest.seed, baseline.manifest.seed);
  // The skeleton's events do not consume the seed (the market generator
  // that will — W017 — is not built yet), so digests MAY match; the
  // manifest is what distinguishes the runs today. Documented honestly.
});

test("A9 golden order flow: trades, fills and stop cascades happen; every fill cites its trade", async () => {
  const engine = await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START });
  const state = engine.worldState();
  // the warm-up guarantees: ≥3 orders, ≥2 trades (the sweep + the triggered
  // stop), ≥4 fills, a stop that armed→triggered→filled, a partially filled maker
  assert.ok(state.matching.orders.length >= 3, "the flow built an order registry");
  assert.ok(state.matching.trades.length >= 2, "the flow printed trades");
  assert.ok(state.matching.fills.length >= 4, "the flow produced fills");
  assert.ok(
    state.matching.orders.some(
      (order) => order.kind === "stop" && order.status === "filled",
    ),
    "a stop armed, triggered and filled",
  );
  // partial fills are evidenced on the fill tape (the maker's first fill
  // left most of its quantity working) — robust to later cancels/replaces
  const partialFillEvents = engine.journal
    .read({ types: ["matching.order.filled"] })
    .filter((envelope) => (envelope.payload as { status?: string }).status === "partially-filled");
  assert.ok(partialFillEvents.length > 0, "partial fills happened");
  // fill causality: every fill cites a journaled trade by id AND sequence
  const tradeBySequence = new Map(
    engine.journal.records().map((record) => [record.envelope.sequence, record.envelope]),
  );
  for (const fill of state.matching.fills) {
    const trade = tradeBySequence.get(fill.marketRef.sequence);
    if (trade === undefined) {
      assert.fail(`fill ${String(fill.fillId)} cites a journaled trade`);
    }
    assert.equal(trade.eventType, "market.trade.printed");
    assert.equal(
      (trade.payload as { tradeId: string }).tradeId,
      String(fill.marketRef.tradeId),
    );
    const own = engine.journal.getRecordByEventId(fill.eventId!);
    assert.ok(own !== undefined && own.envelope.sequence > trade.sequence);
  }
  // the deterministic event-type mix is part of the golden evidence: the
  // journal carries the full matching taxonomy the flow exercises
  const eventTypes = new Set(engine.journal.records().map((record) => record.envelope.eventType));
  for (const expected of [
    "matching.order.accepted",
    "matching.order.filled",
    "matching.order.triggered",
    "market.trade.printed",
    "market.book.delta",
  ]) {
    assert.ok(eventTypes.has(expected), `the golden journal carries ${expected}`);
  }
});

test("A9 golden: annotation ids are derived deterministically from the event-sourced state", async () => {
  const run = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const annotations = run.state.annotations;
  assert.ok(annotations.length > 0);
  assert.ok(annotations.every((annotation) => annotation.issuedBy === TRADER));
  assert.deepEqual(
    annotations.map((annotation) => String(annotation.annotationId)),
    annotations.map((_, index) => `ann:world-w013-tests:${String(index + 1)}`),
  );
});

test("A9 golden financial surface (W015): real positions, real fees, exact canonical figures", async () => {
  const run = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const report = run.report;
  // both accounts built position LEDGERS from journaled fills (records
  // persist after closing — the single-account netting of the W013/W014
  // golden, where every trade netted to zero, is gone)
  assert.ok(
    run.state.financial.portfolio.positions.length >= 2,
    "both golden accounts hold position ledgers",
  );
  assert.ok(report.positions.length >= 1, "the golden flow ends with open positions");
  for (const position of report.positions) {
    assert.ok(isCanonicalSignedMoney(position.quantity), "quantity is canonical decimal text");
    assert.ok(isCanonicalSignedMoney(position.averageEntryPrice), "average entry is canonical");
    assert.ok(isCanonicalSignedMoney(position.realizedPnl.amount), "realized P&L is canonical");
    assert.ok(isCanonicalSignedMoney(position.unrealizedPnl.amount), "unrealized P&L is canonical");
    // THE EXACT-MATH LAW, recomputed here from the projected canonical text:
    // unrealized = (mark − avgEntry) × signedQuantity, ONE half-up rounding
    const mark = position.markPrice ?? position.averageEntryPrice;
    const recomputed = formatSignedMoney(
      signedMulDivHalfUp(
        parseSignedMoney(mark) - parseSignedMoney(position.averageEntryPrice),
        parseSignedMoney(position.quantity),
        10n ** 12n,
      ),
    );
    assert.equal(
      position.unrealizedPnl.amount,
      recomputed,
      `unrealized P&L of ${String(position.accountId)} is (mark − avg) × qty`,
    );
  }
  // fees really charged: both accounts started at their declared cash and
  // the venue schedule (2/5 bps + 0.10 per order) collected on every fill
  const traderCash = Number(report.balances[0]?.amount ?? "0");
  assert.ok(traderCash < 100_000, `the trader paid fees (cash ${String(traderCash)})`);
  const counterCash = Number(report.balances[1]?.amount ?? "0");
  assert.ok(counterCash < 50_000, `the counterparty paid fees (cash ${String(counterCash)})`);
  // the P&L consistency law per account: total = realized + unrealized
  for (const entry of report.pnl) {
    assert.ok(isCanonicalSignedMoney(entry.realized.amount));
    assert.ok(isCanonicalSignedMoney(entry.unrealized.amount));
    assert.equal(
      entry.total.amount,
      formatSignedMoney(
        parseSignedMoney(entry.realized.amount) + parseSignedMoney(entry.unrealized.amount),
      ),
      `total P&L of ${String(entry.accountId)} = realized + unrealized`,
    );
  }
  // the declared limits ride into the risk projection verbatim (A13: the
  // runtime control's read side is the declaration, not derived state)
  const traderRisk = report.risk.find((entry) => String(entry.accountId) === String(TRADER_ACCOUNT));
  assert.deepEqual(traderRisk?.limits, {
    maxOrderQuantity: "9",
    maxGrossExposure: { amount: "60000", currency: "USD" },
  });
});
