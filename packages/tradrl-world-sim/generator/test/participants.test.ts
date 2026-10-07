/**
 * Synthetic participant tests (W017 `generator` module): the planners emit
 * REAL order commands — market makers reconcile post-only quotes around the
 * reference price, liquidity takers / noise / momentum draw from the seeded
 * per-turn RNG, and the shock gap fires once — all as pure functions of
 * (definition, matching state, regime, time), never touching the book or
 * journal directly (SIMULATION.md "Participants": no bypassing the venue
 * contracts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { RegimeScheduleEntry } from "tradrl-world-contracts";
import { createHeadlessWorldEngine } from "../../world/index.js";
import { initialMatchingState } from "../../matching/index.js";
import {
  createCommandIdSource,
  planGeneratorTurn,
  type GeneratedCommand,
} from "../participants.js";
import { derivedRandom, drawChance, drawInt } from "../rng.js";
import { regimeProfileOf } from "../regime.js";
import {
  INSTRUMENT,
  TAKER,
  WORLD,
  generatedDefinition,
  testInstrument,
  at,
} from "./helpers.js";

function entryOf(
  regime: RegimeScheduleEntry["regime"],
  parameters?: Record<string, number>,
): RegimeScheduleEntry {
  return { regime, from: at(0), ...(parameters === undefined ? {} : { parameters }) };
}

/** The planning context for one instrument over one definition's state. */
function context(matching: ReturnType<typeof initialMatchingState>) {
  const definition = generatedDefinition();
  const instrument = testInstrument();
  const book = matching.books[String(INSTRUMENT)]!;
  return { definition, instrument, book, matching };
}

test("cold book: market makers seed post-only two-sided quotes around the anchor", () => {
  const { definition, instrument, book, matching } = context(initialMatchingState(generatedDefinition()));
  const entry = entryOf("mean-reversion", { anchorPrice: 4800 });
  const commands = planGeneratorTurn({
    definition,
    matching,
    instrument,
    book,
    entry,
    profile: regimeProfileOf(entry),
    entries: [entry],
    at: at(1_000),
    seed: definition.seed,
  });
  // both makers × (3 bid levels + 3 ask levels) around 4800, post-only GTC
  const makers = new Set(definition.participants.filter((p) => p.kind === "passive-market-maker").map((p) => String(p.participantId)));
  const submits = commands.filter((command) => command.kind === "submit-order");
  assert.equal(submits.length, 12);
  for (const command of submits) {
    assert.equal(command.kind, "submit-order");
    assert.ok(makers.has(String(command.issuedBy)), "only makers quote on a cold book");
    assert.equal(command.submission.kind, "limit");
    assert.equal(command.submission.constraints.postOnly, true);
    assert.equal(command.submission.constraints.timeInForce, "GTC");
    assert.equal(command.submission.quantity, "8", "mmDepthLots × lotSize");
  }
  const prices = new Set(submits.map((command) => String(command.submission.limitPrice)));
  // inner spread 1 tick, 3 levels per side, tick 0.25, around 4800
  assert.deepEqual(
    [...prices].sort(),
    ["4799.25", "4799.5", "4799.75", "4800.25", "4800.5", "4800.75"],
  );
  // the takers drew nothing to hit (mean-reversion takerRate 0.25 with this
  // seed at t=1000): the cold book is makers-only this turn
  assert.ok(commands.every((command) => command.kind === "submit-order"));
});

test("reconciliation: moved reference cancels undesired levels, keeps covered ones, quotes the rest", async () => {
  const definition = generatedDefinition();
  const engine = createHeadlessWorldEngine({ definition });
  const instrument = testInstrument();
  const anchorEntry = entryOf("mean-reversion", { anchorPrice: 4800 });
  const first = planGeneratorTurn({
    definition,
    matching: engine.worldState().matching,
    instrument,
    book: engine.worldState().matching.books[String(INSTRUMENT)]!,
    entry: anchorEntry,
    profile: regimeProfileOf(anchorEntry),
    entries: [anchorEntry],
    at: at(1_000),
    seed: definition.seed,
  });
  for (const command of first) {
    const result = await engine.command.submitOrder(command as never);
    assert.equal(result.status, "acked");
  }
  // the book now carries both makers' six-level quotes
  const restingBefore = engine.worldState().matching.orders.filter((order) => order.status === "accepted");
  assert.equal(restingBefore.length, 12);

  // the anchor MOVES (a new scenario authored around 4801): the plan must
  // cancel the now-undesired levels and quote the new ones, keeping any
  // price that is still desired
  const movedEntry = entryOf("mean-reversion", { anchorPrice: 4801 });
  const plan = planGeneratorTurn({
    definition,
    matching: engine.worldState().matching,
    instrument,
    book: engine.worldState().matching.books[String(INSTRUMENT)]!,
    entry: movedEntry,
    profile: regimeProfileOf(movedEntry),
    entries: [movedEntry],
    at: at(2_000),
    seed: definition.seed,
  });
  const cancels = plan.filter((command) => command.kind === "cancel-order");
  const submits = plan.filter((command) => command.kind === "submit-order");
  // every old level is undesired (the whole ladder moved one tick)
  assert.equal(cancels.length, 12);
  assert.equal(submits.length, 12);
  const newPrices = new Set(submits.map((command) => String(command.submission.limitPrice)));
  assert.deepEqual(
    [...newPrices].sort(),
    ["4800.25", "4800.5", "4800.75", "4801.25", "4801.5", "4801.75"],
  );
  // a level that is STILL desired is kept, not canceled and re-quoted:
  // move the anchor so the new ladder overlaps the old one at 4800.25
  const overlapEntry = entryOf("mean-reversion", { anchorPrice: 4800.5 });
  const overlapPlan = planGeneratorTurn({
    definition,
    matching: engine.worldState().matching,
    instrument,
    book: engine.worldState().matching.books[String(INSTRUMENT)]!,
    entry: overlapEntry,
    profile: regimeProfileOf(overlapEntry),
    entries: [overlapEntry],
    at: at(3_000),
    seed: definition.seed,
  });
  // re-quote through the engine, then plan again around the same anchor:
  // nothing changes, so the plan carries no cancels and no submits
  for (const command of overlapPlan) {
    if (command.kind === "cancel-order") {
      await engine.command.cancelOrder(command as never);
    } else {
      await engine.command.submitOrder(command as never);
    }
  }
  const steadyPlan = planGeneratorTurn({
    definition,
    matching: engine.worldState().matching,
    instrument,
    book: engine.worldState().matching.books[String(INSTRUMENT)]!,
    entry: overlapEntry,
    profile: regimeProfileOf(overlapEntry),
    entries: [overlapEntry],
    at: at(4_000),
    seed: definition.seed,
  });
  assert.deepEqual(
    steadyPlan.filter((command) => command.kind === "cancel-order"),
    [],
    "a steady reference keeps every resting maker level",
  );
});

test("aggressive flow follows the seeded per-turn draws exactly (documented RNG stream)", () => {
  const { definition, instrument, book, matching } = context(initialMatchingState(generatedDefinition()));
  // seed one takeable ask level so aggressive buys can act
  const seeded = {
    ...matching,
    books: {
      ...matching.books,
      [String(INSTRUMENT)]: {
        ...book,
        asks: [
          {
            price: "4800.25" as never,
            priceScaled: 4_800_250_000_000n,
            entries: [{ orderId: "ord-x" as never, remaining: 100n, arrivalSequence: 1 as never }],
          },
        ],
      },
    },
  };
  const entry = entryOf("trend", { anchorPrice: 4800, direction: 1, takerRate: 1, noiseRate: 1, momentumRate: 1 });
  const at2 = at(5_000);
  const commands = planGeneratorTurn({
    definition,
    matching: seeded,
    instrument,
    book: seeded.books[String(INSTRUMENT)]!,
    entry,
    profile: regimeProfileOf(entry),
    entries: [entry],
    at: at2,
    seed: definition.seed,
  });
  const marketOrders = commands.filter(
    (command): command is Extract<GeneratedCommand, { kind: "submit-order" }> =>
      command.kind === "submit-order" && command.submission.kind === "market",
  );
  assert.ok(marketOrders.length > 0, "rate-1 participants all act when liquidity exists");
  // the taker's planned command is EXACTLY the documented draw sequence:
  // drawChance(takerRate) → drawChance(takerBias) → drawInt(takerMaxLots)
  const rng = derivedRandom(definition.seed, "taker", String(TAKER), String(INSTRUMENT), at2);
  assert.equal(drawChance(rng, 1), true);
  const side = drawChance(rng, 0.75) ? "buy" : "sell";
  const lots = 1 + drawInt(rng, 5);
  const takerCommand = marketOrders.find((command) => command.issuedBy === TAKER);
  assert.ok(takerCommand !== undefined);
  assert.equal(takerCommand.submission.side, side);
  assert.equal(takerCommand.submission.quantity, String(lots));
  assert.equal(takerCommand.submission.constraints.timeInForce, "IOC");
  // every aggressive command targets a side with resting liquidity
  for (const command of marketOrders) {
    if (command.submission.side === "sell") {
      assert.ok(seeded.books[String(INSTRUMENT)]!.bids.length > 0);
    } else {
      assert.ok(seeded.books[String(INSTRUMENT)]!.asks.length > 0);
    }
  }
});

test("no takeable liquidity ⇒ no aggressive flow; no schedule ⇒ nothing at all", () => {
  const { definition, instrument, book, matching } = context(initialMatchingState(generatedDefinition()));
  const entry = entryOf("high-volatility", { anchorPrice: 4800, takerRate: 1, noiseRate: 1 });
  // the makers quote first, but with no opposite side to hit, the aggressive
  // participants hold: the plan carries only the maker quotes
  const commands = planGeneratorTurn({
    definition,
    matching,
    instrument,
    book,
    entry,
    profile: regimeProfileOf(entry),
    entries: [entry],
    at: at(1_000),
    seed: definition.seed,
  });
  assert.ok(
    commands.every(
      (command) =>
        !(command.kind === "submit-order") || command.submission.kind === "limit",
    ),
    "with nothing to take, only maker limits are planned",
  );
  // a world with no passive makers declared quotes nothing on a cold book
  const makerless = generatedDefinition({
    participants: definition.participants.filter((participant) => participant.kind !== "passive-market-maker"),
  });
  const quiet = planGeneratorTurn({
    definition: makerless,
    matching,
    instrument,
    book,
    entry,
    profile: regimeProfileOf(entry),
    entries: [entry],
    at: at(1_000),
    seed: makerless.seed,
  });
  assert.deepEqual(quiet, []);
});

test("the shock gap: one large directional market order on the window's gap turn", () => {
  const { definition, instrument, matching } = context(initialMatchingState(generatedDefinition()));
  const entry = entryOf("shock", { anchorPrice: 4800, gapAfterMs: 1_000, gapLots: 25 });
  // a book with takeable bids (the makers seeded it on the window's earlier
  // turns) — the shock gap SELLS into resting bids
  const withLiquidity = {
    ...matching,
    books: {
      ...matching.books,
      [String(INSTRUMENT)]: {
        ...matching.books[String(INSTRUMENT)]!,
        bids: [
          {
            price: "4799.75" as never,
            priceScaled: 4_799_750_000_000n,
            entries: [{ orderId: "ord-x" as never, remaining: 100n, arrivalSequence: 1 as never }],
          },
        ],
      },
    },
  };
  const gapTurn = at(1_000);
  const commands = planGeneratorTurn({
    definition,
    matching: withLiquidity,
    instrument,
    book: withLiquidity.books[String(INSTRUMENT)]!,
    entry,
    profile: regimeProfileOf(entry),
    entries: [entry],
    at: gapTurn,
    seed: definition.seed,
  });
  const isGap = (
    command: GeneratedCommand,
  ): command is Extract<GeneratedCommand, { kind: "submit-order" }> =>
    command.kind === "submit-order" &&
    command.submission.kind === "market" &&
    command.issuedBy === TAKER &&
    command.submission.quantity === "25";
  const gap = commands.find(isGap);
  assert.ok(gap !== undefined, "the gap order fires on the gap turn");
  assert.equal(gap.submission.side, "sell", "shock defaults to a dislocating SELL");
  // one turn later the gap does not fire again
  const later = planGeneratorTurn({
    definition,
    matching: withLiquidity,
    instrument,
    book: withLiquidity.books[String(INSTRUMENT)]!,
    entry,
    profile: regimeProfileOf(entry),
    entries: [entry],
    at: at(2_000),
    seed: definition.seed,
  });
  assert.equal(
    later.some(
      (command) =>
        command.kind === "submit-order" &&
        command.submission.kind === "market" &&
        command.submission.quantity === "25",
    ),
    false,
  );
});

test("planning is pure: identical inputs ⇒ identical plans; command ids are turn-scoped", () => {
  const { definition, instrument, book, matching } = context(initialMatchingState(generatedDefinition()));
  const entry = entryOf("trend", { anchorPrice: 4800 });
  const plan = (atTime: number): readonly GeneratedCommand[] =>
    planGeneratorTurn({
      definition,
      matching,
      instrument,
      book,
      entry,
      profile: regimeProfileOf(entry),
      entries: [entry],
      at: at(atTime),
      seed: definition.seed,
    });
  assert.deepEqual(plan(1_000), plan(1_000));
  const ids = createCommandIdSource(String(WORLD), at(1_000));
  assert.equal(ids.next(), `cmd-gen:${String(WORLD)}:1000:1`);
  assert.equal(ids.next(), `cmd-gen:${String(WORLD)}:1000:2`);
  // a different turn time re-numbers from 1 (ids are turn-scoped)
  const otherIds = createCommandIdSource(String(WORLD), at(2_000));
  assert.equal(otherIds.next(), `cmd-gen:${String(WORLD)}:2000:1`);
});
