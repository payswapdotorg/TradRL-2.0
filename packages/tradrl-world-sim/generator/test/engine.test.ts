/**
 * Generated-world engine tests (W017 `generator` module): the clock-driven
 * composition — clock advance drives generator turns whose orders flow
 * through the REAL matching engine (fills on generated liquidity), halts and
 * reopens flow through W014's reduction paths, stepping and seeking produce
 * identical journals, restore continues the generator exactly where the
 * journal left off, and setScenario redirects the schedule from its next
 * pass.
 *
 * Spec: spec/SIMULATION.md "Runtime topology" + "Synthetic regimes" +
 * "Participants"; spec/ARCHITECTURE-LOCK.md A6/A7/A9.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegimeScheduleEntry, Venue } from "tradrl-world-contracts";
import { createEventJournalFromRecords } from "../../journal/index.js";
import { createGeneratedWorldEngine } from "../engine.js";
import { MARKET_GENERATOR_PRODUCER, GENERATOR_EVENT_SCHEMA_VERSION } from "../events.js";
import {
  INSTRUMENT,
  MARKET_MAKER,
  START,
  TRADER,
  TRADER_ACCOUNT,
  VENUE_ID,
  at,
  fixedWallTimeSource,
  generatedDefinition,
  humanOrder,
  trendThenHaltSchedule,
} from "./helpers.js";

function generated(regimeSchedule?: readonly RegimeScheduleEntry[], venues?: readonly Venue[]) {
  return createGeneratedWorldEngine({
    definition: generatedDefinition({
      ...(regimeSchedule === undefined ? {} : { regimeSchedule }),
      ...(venues === undefined ? {} : { venues }),
    }),
    wallTimeSource: fixedWallTimeSource(),
  });
}

const TYPES = (records: readonly { readonly envelope: { readonly eventType: string } }[]) =>
  records.map((record) => record.envelope.eventType);

test("clock advance drives the generator: announcement, maker liquidity, printed trades, causal fills, honest quotes", async () => {
  const engine = generated(trendThenHaltSchedule());
  await engine.clock.step(1_000);
  await engine.clock.step(1_000);
  await engine.clock.step(1_000);
  await engine.clock.step(1_000);
  await engine.clock.step(1_000);

  const records = engine.journal.records();
  const state = engine.worldState();

  // the ORIGIN RULE: the regime in force at the world start is journaled
  const announcements = engine.journal.read({ types: ["market.regime.changed"] });
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0]?.occurredAt, START);
  assert.deepEqual((announcements[0]!.payload as { to: string }).to, "trend");
  assert.equal(announcements[0]?.producer, MARKET_GENERATOR_PRODUCER);

  // market makers rest real post-only liquidity through the real engine
  const makerOrders = state.matching.orders.filter((order) => order.submittedBy === MARKET_MAKER);
  assert.ok(makerOrders.length > 0, "the generated market maker has working orders");
  assert.ok(makerOrders.every((order) => order.kind === "limit" && order.constraints.postOnly === true));

  // the seeded aggressive flow printed trades and causal fills (REAL matching)
  assert.ok(state.matching.trades.length >= 1, "generated flow printed trades");
  assert.ok(state.matching.fills.length >= 1, "generated flow produced fills");
  const tradesBySequence = new Map(
    records.map((record) => [record.envelope.sequence, record.envelope]),
  );
  for (const fill of state.matching.fills) {
    const trade = tradesBySequence.get(fill.marketRef.sequence);
    assert.ok(trade !== undefined, `fill ${String(fill.fillId)} cites a journaled trade`);
    assert.equal(trade.eventType, "market.trade.printed");
    assert.equal(
      (trade.payload as { tradeId: string }).tradeId,
      String(fill.marketRef.tradeId),
    );
    const own = engine.journal.getRecordByEventId(fill.eventId!);
    assert.ok(own !== undefined && own.envelope.sequence > trade.sequence);
  }
  // the quote is an honest projection of the authoritative book
  const quotes = engine.journal.read({ types: ["market.quote.updated"] });
  assert.ok(quotes.length >= 1, "quote projections journaled");
  const book = state.matching.books[String(INSTRUMENT)]!;
  const lastQuote = quotes[quotes.length - 1]!.payload as {
    bid?: string;
    ask?: string;
    bidSize?: string;
    askSize?: string;
  };
  assert.ok(lastQuote.bid !== undefined && lastQuote.ask !== undefined, "a two-sided generated market");
  assert.equal(lastQuote.bid, book.bids[0]?.price);
  assert.equal(lastQuote.ask, book.asks[0]?.price);

  // the producer boundary holds: structural market facts are the
  // generator's; EVERY order/trade fact is the matching engine's — and the
  // generated orders cite their generated command ids as causation
  for (const record of records) {
    const envelope = record.envelope;
    if (envelope.eventType.startsWith("matching.") || envelope.eventType === "market.trade.printed" || envelope.eventType === "market.book.delta") {
      assert.equal(envelope.producer, "matching-engine");
    }
    if (envelope.eventType === "market.regime.changed" || envelope.eventType === "market.quote.updated") {
      assert.equal(envelope.producer, MARKET_GENERATOR_PRODUCER);
      assert.equal(envelope.schemaVersion, GENERATOR_EVENT_SCHEMA_VERSION);
      assert.ok(String(envelope.causationId).startsWith(`gen:`));
    }
    if (envelope.eventType === "matching.order.accepted" && String(envelope.causationId).startsWith("cmd-gen:")) {
      assert.equal(envelope.producer, "matching-engine", "generated orders journal as REAL matching events");
    }
  }
  assert.ok(
    records.some(
      (record) =>
        record.envelope.eventType === "matching.order.accepted" &&
        String(record.envelope.causationId).startsWith("cmd-gen:"),
    ),
    "the synthetic participants' orders flowed through the real command port",
  );
});

test("human traders fill on generated liquidity (the participant law, both directions)", async () => {
  const engine = generated(trendThenHaltSchedule());
  await engine.clock.step(1_000);
  const book = engine.worldState().matching.books[String(INSTRUMENT)]!;
  assert.ok(book.asks.length > 0, "the generated market maker is offering");

  const human = await engine.command.submitOrder(
    humanOrder({
      commandId: "cmd-human-buy" as never,
      submission: { kind: "market", side: "buy", quantity: "2" as never, constraints: { timeInForce: "IOC" } },
    }),
  );
  assert.equal(human.status, "acked");
  const state = engine.worldState();
  const humanOrderRecord = state.matching.orders.find((order) => order.accountId === TRADER_ACCOUNT);
  assert.ok(humanOrderRecord !== undefined);
  assert.equal(humanOrderRecord.status, "filled");
  // the fill is REAL: it cites a printed trade, and the counterparty fill
  // belongs to the generated maker whose liquidity was hit
  const humanFill = state.matching.fills.find((fill) => fill.orderId === humanOrderRecord.orderId);
  assert.ok(humanFill !== undefined);
  const trade = state.matching.trades.find((candidate) => candidate.tradeId === humanFill.marketRef.tradeId);
  assert.ok(trade !== undefined, "the human fill cites a journaled trade");
  assert.equal(trade.aggressorSide, "buy");
  const makerFills = state.matching.fills.filter(
    (fill) => fill.price === trade.price && fill.orderId !== humanFill.orderId,
  );
  assert.ok(makerFills.length > 0, "the counterparty is generated maker liquidity");
  assert.ok(makerFills.every((fill) => fill.liquidity === "maker"));
});

test("halt/reopen flows through the W014 paths: journal, book state, market-halted rejections, silence, reopen", async () => {
  const engine = generated(trendThenHaltSchedule());
  await engine.clock.seek((START + 19_000) as never);
  const tradesBeforeHalt = engine.worldState().matching.trades.length;
  assert.ok(tradesBeforeHalt >= 1, "the trend phase printed trades (the reopen reference)");

  // cross the halt boundary (halt-reopen halts at its window start)
  await engine.clock.seek((START + 21_000) as never);
  const haltedAt = engine.journal.read({ types: ["market.halted"] });
  assert.equal(haltedAt.length, 1);
  assert.equal(haltedAt[0]?.occurredAt, START + 20_000);
  assert.deepEqual(haltedAt[0]?.payload, {
    type: "market.halted",
    scope: { kind: "instrument", instrumentId: INSTRUMENT },
    reason: "regime",
  });
  assert.equal(engine.worldState().matching.books[String(INSTRUMENT)]?.tradingState, "halted");

  // a human order during the halt rejects through the real venue policy
  const rejected = await engine.command.submitOrder(
    humanOrder({ commandId: "cmd-human-halted" as never }),
  );
  assert.equal(rejected.status, "rejected");
  assert.equal(
    rejected.status === "rejected" && rejected.rejection.code,
    "market-halted",
  );

  // the generator is silent while halted: no order was accepted between the
  // halt and the reopen (grid turns at 21k/22k/23k produced no actions)
  const acceptedWhileHalted = engine.journal.records().filter(
    (record) =>
      record.envelope.eventType === "matching.order.accepted" &&
      record.envelope.occurredAt > (START + 20_000) &&
      record.envelope.occurredAt < (START + 24_000),
  );
  assert.deepEqual(acceptedWhileHalted, []);

  // cross the reopen: the book reopens with the last trade as reference,
  // and the makers quote again on the reopen turn (grid time 24k)
  await engine.clock.seek((START + 25_000) as never);
  const reopened = engine.journal.read({ types: ["market.reopened"] });
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0]?.occurredAt, START + 24_000);
  const reference = (reopened[0]!.payload as { referencePrice?: string }).referencePrice;
  const lastTrade = engine.worldState().matching.trades[tradesBeforeHalt - 1]?.price;
  assert.equal(reference, lastTrade, "the reopen cites the last printed trade as reference");
  assert.equal(engine.worldState().matching.books[String(INSTRUMENT)]?.tradingState, "open");
  const acceptedAfterReopen = engine.journal.records().filter(
    (record) =>
      record.envelope.eventType === "matching.order.accepted" &&
      record.envelope.occurredAt >= (START + 24_000),
  );
  assert.ok(acceptedAfterReopen.length > 0, "the makers re-quoted after the reopen");
  // and the regime transition itself was announced at the window boundary
  const announcements = engine.journal.read({ types: ["market.regime.changed"] });
  assert.deepEqual(
    announcements.map((envelope) => (envelope.payload as { to: string }).to),
    ["trend", "halt-reopen"],
  );
});

test("stepping and seeking produce identical journals (the A9 core, generator included)", async () => {
  const schedule = trendThenHaltSchedule();
  const stepper = generated(schedule);
  for (let i = 0; i < 8; i += 1) {
    await stepper.clock.step(1_000);
  }
  const seeker = generated(schedule);
  await seeker.clock.seek((START + 8_000) as never);
  assert.deepEqual(stepper.journal.records(), seeker.journal.records());
  assert.deepEqual(stepper.journal.digest(), seeker.journal.digest());
  assert.deepEqual(stepper.worldState(), seeker.worldState());
  // pause/play/setSpeed never touch the simulation axis: no journal effect
  const idler = generated(schedule);
  await idler.clock.play();
  await idler.clock.setSpeed(4);
  await idler.clock.pause();
  assert.deepEqual(idler.journal.records(), [], "status operations generate nothing");
  assert.equal(idler.clockState().simulationTime, START);
});

test("restore continues the generator exactly where the journal left off", async () => {
  const schedule = trendThenHaltSchedule();
  const definition = generatedDefinition({ regimeSchedule: schedule });
  const source = createGeneratedWorldEngine({ definition, wallTimeSource: fixedWallTimeSource() });
  await source.clock.seek((START + 5_000) as never);
  const midway = source.journal.records();

  const restored = createGeneratedWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
    restore: { journal: createEventJournalFromRecords({ worldId: definition.scope.worldId, records: midway }) },
  });
  assert.equal(restored.clockState().simulationTime, START + 5_000, "the clock resumes at the interval end");
  await restored.clock.seek((START + 10_000) as never);
  await source.clock.seek((START + 10_000) as never);

  // an unbroken run and a restored-then-continued run are BIT-IDENTICAL:
  // no re-announced regime, no duplicated or missing turns, no re-emitted quote
  assert.deepEqual(restored.journal.records(), source.journal.records());
  assert.deepEqual(restored.journal.digest(), source.journal.digest());
  assert.deepEqual(restored.worldState(), source.worldState());
  assert.equal(
    restored.journal.read({ types: ["market.regime.changed"] }).length,
    1,
    "the origin announcement fired exactly once across the restore",
  );
  // and the restored engine still accepts human orders through the seam
  const human = await restored.command.submitOrder(
    humanOrder({ commandId: "cmd-human-post-restore" as never }),
  );
  assert.equal(human.status, "acked");
});

test("setScenario redirects the generator from its next pass", async () => {
  const anchored = (anchor: number): readonly RegimeScheduleEntry[] => [
    {
      regime: "mean-reversion",
      from: at(START),
      parameters: { anchorPrice: anchor, tickMs: 1_000 },
    },
  ];
  const engine = generated(anchored(4800));
  await engine.clock.step(1_000);
  const before = engine.worldState().matching.books[String(INSTRUMENT)]!;
  assert.equal(before.asks[0]?.price, "4800.25", "quotes pinned at the 4800 anchor");

  await engine.command.setScenario({
    kind: "set-scenario",
    commandId: "cmd-scenario" as never,
    worldId: engine.worldId,
    issuedBy: TRADER,
    issuedAt: at(START + 1_000),
    scenario: { entries: anchored(4810) },
  });
  await engine.clock.step(1_000);
  const after = engine.worldState().matching.books[String(INSTRUMENT)]!;
  assert.equal(after.asks[0]?.price, "4810.25", "the new schedule's anchor moved the quotes");
  // the journal documents the redirection, and the generator announced the
  // scenario's regime at the next pass boundary it crossed — none here (the
  // replacement regime never changed at a boundary), so the quote evidence
  // is the scenario event plus the moved maker ladder
  assert.ok(
    engine.journal.records().some((record) => record.envelope.eventType === "world.scenario.set"),
  );
  assert.notDeepEqual(after.bids.map((level) => level.price), before.bids.map((level) => level.price));
});

test("generated quotes respect the venue latency policy (A7 availableAt)", async () => {
  const latencyVenue: Venue = {
    venueId: VENUE_ID,
    worldId: "world-w017-tests" as never,
    name: "latent-sim",
    matchingModel: "price-time-priority",
    allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
    feeSchedule: { makerRateBps: 0, takerRateBps: 0 },
    latency: { acknowledgementMs: 250, fillPropagationMs: 500 },
    calendar: { sessions: [{ opensAt: at(0), closesAt: at(Number.MAX_SAFE_INTEGER) }] },
    haltPolicy: { haltOnShock: false },
  };
  const engine = generated(trendThenHaltSchedule(), [latencyVenue]);
  await engine.clock.step(1_000);
  const quotes = engine.journal.read({ types: ["market.quote.updated"] });
  assert.ok(quotes.length > 0);
  for (const quote of quotes) {
    assert.equal(quote.occurredAt, START + 1_000);
    assert.equal(quote.availableAt, START + 1_000 + 750, "acknowledgement + fill propagation delay");
  }
  // order acknowledgement is delayed too (the venue contract, not a generator invention)
  const accepted = engine.journal.read({ types: ["matching.order.accepted"] });
  assert.ok(accepted.length > 0);
  for (const envelope of accepted) {
    assert.equal(envelope.availableAt, START + 1_000 + 250);
  }
});

test("getQuote projects the generated market; the wrapped clock serves through the protocol too", async () => {
  const engine = generated(trendThenHaltSchedule());
  const empty = await engine.query.getQuote(INSTRUMENT);
  assert.deepEqual(empty, { instrumentId: INSTRUMENT, asOf: START as never });
  await engine.protocol.clock.step(1_000);
  const quote = await engine.query.getQuote(INSTRUMENT);
  assert.ok(quote.bid !== undefined && quote.ask !== undefined, "the generated book projects a two-sided quote");
  assert.equal(quote.asOf, (START + 1_000) as never);
  const book = engine.worldState().matching.books[String(INSTRUMENT)]!;
  assert.equal(quote.bid, book.bids[0]?.price);
  assert.equal(quote.bidSize, "10", "both makers' depth aggregates at the best bid");
  assert.equal(TYPES(engine.journal.records()).includes("market.quote.updated"), true);
});
