/**
 * The REAL alpha world cases (W033): both reference substrates deciding on
 * REAL alpha-world body views through the W032 maximal view.
 *
 * The REAL definition (packages/ui/src/trading-world/runtime/
 * engineAttachment.ts — the same one the Trading World pane attaches)
 * drives the REAL W017 generated engine; a REAL body binds to it through
 * the W032 attach validation (`validateBodyAttachment`, the agent-body
 * package's own surface — consumed through the relative cross-package seam
 * the agent-body/ui tests use); the view is the W032 `maximalBodyView`;
 * the observed content is the REAL QueryPort's projections at each step's
 * simulation time. Every emitted stream validates against the body; the
 * A9 twin (two engines, wall axes a day apart) reproduces bit-identical
 * views and streams; and any proposed command traverses the REAL
 * CommandPort (the Body executes — never the substrate).
 *
 * Run: ../../node_modules/.bin/tsx --test test/alphaWorld.test.ts
 * (from packages/cognitive-substrate).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGeneratedWorldEngine } from "tradrl-world-sim/generator";
import type { HeadlessWorldEngine } from "tradrl-world-sim/world";
import { alphaWorldDefinition } from "../../ui/src/trading-world/runtime/engineAttachment.js";
import { maximalBodyView, validateBodyAttachment } from "../../agent-body/index.js";
import type { BodyDescriptor } from "../../agent-body/index.js";
import type { ObservedBodyView, DecisionStream } from "../index.js";
import {
  createMeanReversionSubstrate,
  createMomentumSubstrate,
  validateDecisionStream,
  validateObservedView,
  viewDigestOf,
} from "../index.js";

const ALPHA_WORLD_ID = "world-alpha-substrate";
const DEFINITION = alphaWorldDefinition(ALPHA_WORLD_ID);
const TRADER_SEAT = `participant-trader-${ALPHA_WORLD_ID}` as never;
const TRADER_ACCOUNT = `account-trader-${ALPHA_WORLD_ID}` as never;
const ALPHA_INSTRUMENT = `instrument-es-${ALPHA_WORLD_ID}` as never;
const SIM_START = 1_700_000_000_000;
const DAY_MS = 86_400_000;

/** A trader-seat Body on the REAL alpha world (the W032 alpha-test pattern). */
function alphaTraderBody(): BodyDescriptor {
  return {
    bodyId: "body-alpha-substrate" as never,
    scope: DEFINITION.scope,
    participantId: TRADER_SEAT,
    accountId: TRADER_ACCOUNT,
    participantKind: "human",
    embodiment: {
      instruments: [ALPHA_INSTRUMENT],
      venues: ["venue-alpha-sim" as never],
      orderKinds: ["market", "limit", "stop", "stop-limit"],
      timeInForce: ["GTC", "IOC", "FOK"],
      commandKinds: ["submit-order", "cancel-order", "replace-order", "close-position", "add-annotation"],
    },
    riskEnvelope: {
      maxOrderQuantity: "10" as never,
      maxPositionQuantity: "40" as never,
      maxLeverage: 2,
      maxGrossExposure: { amount: "150000" as never, currency: "USD" as never },
      maxDrawdown: { amount: "5000" as never, currency: "USD" as never },
      minBuyingPowerAfterOrder: { amount: "10000" as never, currency: "USD" as never },
    },
  };
}

function alphaEngine(wallTimeOffset: number): HeadlessWorldEngine {
  return createGeneratedWorldEngine({
    definition: DEFINITION,
    wallTimeSource: () => (SIM_START + 5_000 + wallTimeOffset) as never,
  }) as HeadlessWorldEngine;
}

/** Observe the REAL engine at its current simulation time through the W032 view. */
async function observe(engine: HeadlessWorldEngine, view: ReturnType<typeof maximalBodyView>): Promise<ObservedBodyView> {
  const asOf = engine.clockState().simulationTime;
  const [quote, book, trades, orders, positions, portfolio, risk] = await Promise.all([
    engine.query.getQuote(ALPHA_INSTRUMENT),
    engine.query.getOrderBook(ALPHA_INSTRUMENT),
    engine.query.getTrades(ALPHA_INSTRUMENT, {}),
    engine.query.getOrders({ accountId: TRADER_ACCOUNT }),
    engine.query.getPositions(TRADER_ACCOUNT),
    engine.query.getPortfolio(TRADER_ACCOUNT),
    engine.query.getRisk(TRADER_ACCOUNT),
  ]);
  return {
    ...view,
    participantId: TRADER_SEAT,
    asOf,
    quotes: [quote],
    books: [book],
    trades,
    ownOrders: orders,
    ownPositions: positions,
    portfolio,
    riskState: risk,
  };
}

/** Drive both minds over `steps` views, threading the momentum state. */
async function runMinds(engine: HeadlessWorldEngine, view: ReturnType<typeof maximalBodyView>, steps: number) {
  const momentum = createMomentumSubstrate({
    substrateId: "substrate-alpha-momentum" as never,
    seed: "alpha-momentum-1",
    instrumentId: ALPHA_INSTRUMENT,
    lookback: 4,
    threshold: "0.75",
    quantity: "1",
  });
  const meanReversion = createMeanReversionSubstrate({
    substrateId: "substrate-alpha-mr" as never,
    seed: "alpha-mr-1",
    instrumentId: ALPHA_INSTRUMENT,
    threshold: "0.75",
    quantity: "1",
  });
  let momentumState = momentum.initialState;
  const momentumStreams: DecisionStream[] = [];
  const mrStreams: DecisionStream[] = [];
  const views: ObservedBodyView[] = [];
  for (let step = 0; step < steps; step += 1) {
    await engine.clock.step(1000);
    const observed = await observe(engine, view);
    views.push(observed);
    const viewErrors = validateObservedView(observed);
    assert.deepEqual(viewErrors, { ok: true }, `step ${String(step)}: the real projections are inside the grant`);
    const momentumOutcome = momentum.decide({ view: observed, state: momentumState });
    assert.equal(momentumOutcome.ok, true);
    if (!momentumOutcome.ok) continue;
    momentumStreams.push(momentumOutcome.stream);
    momentumState = momentumOutcome.state ?? momentumState;
    const mrOutcome = meanReversion.decide({ view: observed });
    assert.equal(mrOutcome.ok, true);
    if (!mrOutcome.ok) continue;
    mrStreams.push(mrOutcome.stream);
  }
  return { momentum, meanReversion, momentumStreams, mrStreams, views };
}

test("the consumed definition is the REAL alpha world and the body binds through W032", () => {
  assert.equal(String(DEFINITION.instruments[0]?.venueId), "venue-alpha-sim");
  assert.deepEqual(validateBodyAttachment(alphaTraderBody(), DEFINITION), { ok: true });
});

test("both reference minds decide lawfully on REAL alpha-world views (the maximal W032 view)", async () => {
  const body = alphaTraderBody();
  const view = maximalBodyView(body);
  const engine = alphaEngine(0);
  const { momentum, meanReversion, momentumStreams, mrStreams, views } = await runMinds(engine, view, 12);

  // the REAL market produced real two-sided quotes and a real tape
  assert.ok(views.every((one) => one.quotes?.[0] !== undefined));
  assert.ok(views.some((one) => (one.trades?.length ?? 0) > 0));

  // every emitted stream validates against the REAL body embodiment
  for (const stream of momentumStreams) {
    assert.deepEqual(validateDecisionStream(stream, body, momentum.descriptor), { ok: true });
  }
  for (const stream of mrStreams) {
    assert.deepEqual(validateDecisionStream(stream, body, meanReversion.descriptor), { ok: true });
  }
  // the minds had at least one opinion on the real market
  const totalDecisions =
    momentumStreams.reduce((sum, stream) => sum + stream.decisions.length, 0) +
    mrStreams.reduce((sum, stream) => sum + stream.decisions.length, 0);
  assert.ok(totalDecisions > 0, "the reference minds are expected to propose on the real alpha market");

  // every decision cites its view's digest and carries rationale as data
  for (const stream of [...momentumStreams, ...mrStreams]) {
    for (const decision of stream.decisions) {
      assert.equal(decision.viewDigest, stream.viewDigest);
      assert.equal(decision.rationale.signals.length > 0, true);
      assert.ok(decision.confidence >= 0.5 && decision.confidence <= 1);
    }
  }
});

test("A9 twin: two engines a wall-day apart produce identical views and identical streams", async () => {
  const body = alphaTraderBody();
  const view = maximalBodyView(body);
  const first = await runMinds(alphaEngine(0), view, 8);
  const second = await runMinds(alphaEngine(DAY_MS), view, 8);
  assert.deepEqual(first.views, second.views);
  assert.deepEqual(first.momentumStreams, second.momentumStreams);
  assert.deepEqual(first.mrStreams, second.mrStreams);
  assert.deepEqual(
    first.views.map((one) => viewDigestOf(one)),
    second.views.map((one) => viewDigestOf(one)),
  );
});

test("the Body executes: a substrate proposal traverses the REAL CommandPort", async () => {
  const body = alphaTraderBody();
  const view = maximalBodyView(body);
  const engine = alphaEngine(0);
  const { momentum, meanReversion, momentumStreams, mrStreams } = await runMinds(engine, view, 12);
  const firstProposal = [...momentumStreams, ...mrStreams]
    .flatMap((stream) => stream.decisions.map((decision) => ({ stream, decision })))
    .find((entry) => entry.decision.command.kind === "submit-order");
  if (firstProposal === undefined) {
    assert.fail("expected at least one submit-order proposal on the real market");
  }
  const descriptor =
    momentumStreams.includes(firstProposal.stream) ? momentum.descriptor : meanReversion.descriptor;
  assert.deepEqual(
    validateDecisionStream(firstProposal.stream, body, descriptor),
    { ok: true },
  );
  // the substrate never touched a port — the BODY submits its proposal
  const result = await engine.command.submitOrder(firstProposal.decision.command as never);
  assert.equal(result.status === "acked" || result.status === "rejected", true);
  if (result.status === "rejected") {
    // a typed rejection is a LAWFUL outcome (the port's own gates decide) —
    // but an untyped failure would not be
    assert.equal(typeof result.rejection.code, "string");
  }
});

test("a view beyond the maximal grant is refused even on the real world (fail-closed)", async () => {
  const body = alphaTraderBody();
  const view = maximalBodyView(body);
  const engine = alphaEngine(0);
  await engine.clock.step(1000);
  const observed = await observe(engine, view);
  const beyond: ObservedBodyView = {
    ...observed,
    instruments: [], // the grant narrowed to nothing
  };
  const outcome = validateObservedView(beyond);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.ok(outcome.errors.every((one) => one.code === "instrument-not-in-view"));
});
