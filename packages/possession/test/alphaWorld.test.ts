/**
 * The REAL alpha world cases (W034): possession, compatibility, lineage
 * and the effective agent over the REAL alpha world and REAL reference
 * minds.
 *
 * The REAL definition (packages/ui/src/trading-world/runtime/
 * engineAttachment.ts — the same one the Trading World pane attaches)
 * drives the REAL W017 generated engine; a REAL body binds to it through
 * the W032 attach validation (consumed through this package's
 * compatibility check); a REAL W033 momentum substrate possesses it; the
 * observed views and decision streams are the REAL minds' outputs over
 * the REAL QueryPort projections at each step's simulation time; every
 * stream proves compatible at the decision level (the ultimate proof);
 * the effective agent projection composes the REAL declarations; the
 * lineage records the whole possession lifecycle and verifies intact;
 * the A9 twin (two engines, wall axes a day apart) reproduces
 * bit-identical lineages; and any proposed command traverses the REAL
 * CommandPort (the Body executes — never the substrate, never the
 * possession).
 *
 * Run: ../../node_modules/.bin/tsx --test test/alphaWorld.test.ts
 * (from packages/possession).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGeneratedWorldEngine } from "tradrl-world-sim/generator";
import type { HeadlessWorldEngine } from "tradrl-world-sim/world";
import { alphaWorldDefinition } from "../../ui/src/trading-world/runtime/engineAttachment.js";
import { createMomentumSubstrate } from "cognitive-substrate/momentum";
import { createMeanReversionSubstrate } from "cognitive-substrate/meanReversion";
import type { BodyDescriptor } from "tradrl-world-contracts/agentBody";
import type { ObservedBodyView, DecisionStream } from "cognitive-substrate";
import type { EffectiveAgent, PossessionDescriptor } from "../index.js";
import {
  activePossessionOf,
  checkDecisionStreamCompatibility,
  checkPossessionCompatibility,
  extendPossessionLineage,
  initialPossessionLineage,
  projectEffectiveAgent,
  verifyPossessionLineage,
} from "../index.js";

const ALPHA_WORLD_ID = "world-alpha-possession";
const DEFINITION = alphaWorldDefinition(ALPHA_WORLD_ID);
const TRADER_SEAT = `participant-trader-${ALPHA_WORLD_ID}` as never;
const TRADER_ACCOUNT = `account-trader-${ALPHA_WORLD_ID}` as never;
const ALPHA_INSTRUMENT = `instrument-es-${ALPHA_WORLD_ID}` as never;
const SIM_START = 1_700_000_000_000;
const DAY_MS = 86_400_000;

/** A trader-seat Body on the REAL alpha world (the W032/W033 alpha pattern). */
function alphaTraderBody(): BodyDescriptor {
  return {
    bodyId: "body-alpha-possession" as never,
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

/** The REAL momentum substrate's possession of the alpha body (the operator grant). */
function alphaMomentumPossession(): PossessionDescriptor {
  const momentum = createMomentumSubstrate({
    substrateId: "substrate-alpha-momentum" as never,
    seed: "alpha-momentum-1",
    instrumentId: ALPHA_INSTRUMENT,
    lookback: 4,
    threshold: "0.75",
    quantity: "1",
  });
  return {
    possessionId: "possession-alpha-momentum" as never,
    body: alphaTraderBody(),
    substrate: momentum.descriptor,
    grant: {
      grantedBy: "principal-alpha-operator" as never,
      channel: "operator",
      grantedAt: SIM_START as never,
      basis: "operator-reviewed momentum mind for the alpha ES desk",
    },
    scope: {
      instruments: [ALPHA_INSTRUMENT],
      observations: [
        "market-quote",
        "market-book",
        "market-trades",
        "own-orders",
        "own-positions",
        "own-portfolio",
        "own-risk",
        "information-artifacts",
      ],
      commandKinds: ["submit-order", "close-position"],
      decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 1000 },
    },
  };
}

/**
 * The REAL mean-reversion substrate's possession of the alpha body (the
 * proposing mind on this market: the W033 alpha fixture's own finding —
 * the momentum mind stays flat on the calm early alpha regime, the
 * mean-reversion mind proposes from the first deviations).
 */
function alphaMeanReversionPossession(): PossessionDescriptor {
  const meanReversion = createMeanReversionSubstrate({
    substrateId: "substrate-alpha-mr" as never,
    seed: "alpha-mr-1",
    instrumentId: ALPHA_INSTRUMENT,
    threshold: "0.75",
    quantity: "1",
  });
  return {
    ...alphaMomentumPossession(),
    possessionId: "possession-alpha-mr" as never,
    substrate: meanReversion.descriptor,
    grant: {
      ...alphaMomentumPossession().grant,
      basis: "operator-reviewed mean-reversion mind for the alpha ES desk",
    },
  };
}

function alphaEngine(wallTimeOffset: number): HeadlessWorldEngine {
  return createGeneratedWorldEngine({
    definition: DEFINITION,
    wallTimeSource: () => (SIM_START + 5_000 + wallTimeOffset) as never,
  }) as HeadlessWorldEngine;
}

/** Observe the REAL engine at its current simulation time through the projected view. */
async function observe(
  engine: HeadlessWorldEngine,
  agent: EffectiveAgent,
): Promise<ObservedBodyView> {
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
    ...agent.view,
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

/** Drive the momentum mind over `steps` views on the REAL engine, threading state. */
async function runMomentum(
  engine: HeadlessWorldEngine,
  possession: PossessionDescriptor,
  steps: number,
) {
  const projection = projectEffectiveAgent(possession, DEFINITION);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("unreachable: the possession is compatible");
  const momentum = createMomentumSubstrate({
    substrateId: possession.substrate.substrateId as never,
    seed: possession.substrate.seed,
    instrumentId: ALPHA_INSTRUMENT,
    lookback: 4,
    threshold: "0.75",
    quantity: "1",
  });
  let state = momentum.initialState;
  const streams: DecisionStream[] = [];
  const views: ObservedBodyView[] = [];
  for (let step = 0; step < steps; step += 1) {
    await engine.clock.step(1000);
    const observed = await observe(engine, projection.agent);
    views.push(observed);
    const outcome = momentum.decide({ view: observed, state });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) continue;
    streams.push(outcome.stream);
    state = outcome.state ?? state;
  }
  return { streams, views, momentum };
}

/** Drive the mean-reversion mind over `steps` views on the REAL engine (stateless). */
async function runMeanReversion(
  engine: HeadlessWorldEngine,
  possession: PossessionDescriptor,
  steps: number,
) {
  const projection = projectEffectiveAgent(possession, DEFINITION);
  assert.equal(projection.ok, true);
  if (!projection.ok) throw new Error("unreachable: the possession is compatible");
  const meanReversion = createMeanReversionSubstrate({
    substrateId: possession.substrate.substrateId as never,
    seed: possession.substrate.seed,
    instrumentId: ALPHA_INSTRUMENT,
    threshold: "0.75",
    quantity: "1",
  });
  const streams: DecisionStream[] = [];
  const views: ObservedBodyView[] = [];
  for (let step = 0; step < steps; step += 1) {
    await engine.clock.step(1000);
    const observed = await observe(engine, projection.agent);
    views.push(observed);
    const outcome = meanReversion.decide({ view: observed });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) continue;
    streams.push(outcome.stream);
  }
  return { streams, views, meanReversion };
}

test("the consumed definition is the REAL alpha world and the possession is compatible with it", () => {
  assert.equal(String(DEFINITION.instruments[0]?.venueId), "venue-alpha-sim");
  const outcome = checkPossessionCompatibility(alphaMomentumPossession(), DEFINITION);
  assert.deepEqual(outcome, {
    ok: true,
    checked: [
      "descriptor-structure",
      "embodied-command-kinds",
      "rate-grant",
      "body-attachment",
    ],
  });
});

test("the effective agent composes the REAL declarations (the tighter-of, pure)", () => {
  const outcome = projectEffectiveAgent(alphaMomentumPossession(), DEFINITION);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const agent = outcome.agent;
  assert.deepEqual(agent.commandKinds, ["submit-order", "close-position"]);
  assert.deepEqual(agent.instruments, [ALPHA_INSTRUMENT]);
  assert.deepEqual(agent.view.instruments, [ALPHA_INSTRUMENT]);
  assert.deepEqual(agent.view.observations, [
    "market-quote",
    "market-book",
    "market-trades",
    "own-orders",
    "own-positions",
    "own-portfolio",
    "own-risk",
    "information-artifacts",
  ]);
  assert.equal(String(agent.view.accountId), String(TRADER_ACCOUNT));
  // the alpha world declares no riskLimits → the body's envelope carries verbatim
  assert.deepEqual(agent.riskEnvelope, alphaTraderBody().riskEnvelope);
  assert.deepEqual(agent.decisionRate, { maxDecisionsPerView: 1, minViewIntervalMs: 1000 });
});

test("every REAL substrate stream proves compatible at the decision level (the ultimate proof)", async () => {
  // the mean-reversion mind is the proposing mind on the calm early
  // alpha regime (the W033 alpha fixture's own finding); the momentum
  // mind's lawful EMPTY streams are proven just the same — both are the
  // real minds' outputs over the real market.
  const mrPossession = alphaMeanReversionPossession();
  const { streams: mrStreams, views } = await runMeanReversion(alphaEngine(0), mrPossession, 12);
  assert.ok(views.some((one) => (one.trades?.length ?? 0) > 0), "the REAL market printed trades");
  const deciding = mrStreams.filter((stream) => stream.decisions.length > 0);
  assert.ok(deciding.length > 0, "the mean-reversion mind proposed on the real market");
  for (const stream of mrStreams) {
    const outcome = checkDecisionStreamCompatibility(stream, mrPossession);
    assert.equal(outcome.ok, true, "every real mean-reversion stream proves compatible");
  }

  const momentumPossession = alphaMomentumPossession();
  const { streams: momentumStreams } = await runMomentum(alphaEngine(0), momentumPossession, 12);
  assert.ok(momentumStreams.length > 0, "the momentum mind observed the real market");
  for (const stream of momentumStreams) {
    const outcome = checkDecisionStreamCompatibility(stream, momentumPossession);
    assert.equal(outcome.ok, true, "every real momentum stream proves compatible");
  }
});

test("the mean-reversion mind proves compatible under a widened possession (stateless)", async () => {
  const meanReversion = createMeanReversionSubstrate({
    substrateId: "substrate-alpha-mr" as never,
    seed: "alpha-mr-1",
    instrumentId: ALPHA_INSTRUMENT,
    threshold: "0.75",
    quantity: "1",
  });
  const possession: PossessionDescriptor = {
    ...alphaMomentumPossession(),
    possessionId: "possession-alpha-mr" as never,
    substrate: meanReversion.descriptor,
    scope: {
      ...alphaMomentumPossession().scope,
      commandKinds: ["submit-order", "close-position"],
      decisionRate: { maxDecisionsPerView: 1 },
    },
  };
  const projection = projectEffectiveAgent(possession, DEFINITION);
  assert.equal(projection.ok, true);
  if (!projection.ok) return;
  const engine = alphaEngine(0);
  const streams: DecisionStream[] = [];
  for (let step = 0; step < 10; step += 1) {
    await engine.clock.step(1000);
    const observed = await observe(engine, projection.agent);
    const outcome = meanReversion.decide({ view: observed });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) continue;
    streams.push(outcome.stream);
  }
  for (const stream of streams) {
    assert.deepEqual(checkDecisionStreamCompatibility(stream, possession).ok, true);
  }
});

test("the possession lifecycle and lineage over the REAL flow verify intact", async () => {
  const possession = alphaMeanReversionPossession();
  const compatibility = checkPossessionCompatibility(possession, DEFINITION);
  assert.equal(compatibility.ok, true);

  let lineage = initialPossessionLineage(alphaTraderBody());
  assert.deepEqual(activePossessionOf(lineage), { ok: false, code: "no-active-possession" });

  let step = extendPossessionLineage(
    lineage,
    possession,
    { kind: "possess", compatibility },
    SIM_START as never,
  );
  assert.equal(step.ok, true);
  if (!step.ok) return;
  lineage = step.lineage;
  assert.deepEqual(activePossessionOf(lineage), {
    ok: true,
    possessionId: possession.possessionId,
    sinceSequence: 0,
  });

  // the possessed agent decides on the real market — the proposing mind,
  // so the history surrounds real proposals (a real history deserves real work)
  const { streams } = await runMeanReversion(alphaEngine(0), possession, 8);
  assert.ok(streams.length > 0);
  assert.ok(streams.some((stream) => stream.decisions.length > 0));

  step = extendPossessionLineage(
    lineage,
    possession,
    { kind: "release", reason: "operator-request" },
    (SIM_START + 60_000) as never,
  );
  assert.equal(step.ok, true);
  if (!step.ok) return;
  lineage = step.lineage;
  assert.deepEqual(activePossessionOf(lineage), { ok: false, code: "no-active-possession" });
  assert.deepEqual(verifyPossessionLineage(lineage), { ok: true });

  // a successor possession of the same body records into the same lineage
  const successor: PossessionDescriptor = {
    ...possession,
    possessionId: "possession-alpha-successor" as never,
    substrate: {
      ...possession.substrate,
      substrateId: "substrate-alpha-successor" as never,
      seed: "alpha-successor-1",
    },
  };
  const successorCompatibility = checkPossessionCompatibility(successor, DEFINITION);
  assert.equal(successorCompatibility.ok, true);
  const extended = extendPossessionLineage(
    lineage,
    successor,
    { kind: "possess", compatibility: successorCompatibility },
    (SIM_START + 120_000) as never,
  );
  assert.equal(extended.ok, true);
  if (!extended.ok) return;
  assert.deepEqual(verifyPossessionLineage(extended.lineage), { ok: true });
  assert.deepEqual(activePossessionOf(extended.lineage), {
    ok: true,
    possessionId: successor.possessionId,
    sinceSequence: 2,
  });
});

test("A9 twin: two engines a wall-day apart produce identical lineages", async () => {
  const build = async (wallOffset: number) => {
    const possession = alphaMeanReversionPossession();
    const compatibility = checkPossessionCompatibility(possession, DEFINITION);
    assert.equal(compatibility.ok, true);
    let lineage = initialPossessionLineage(alphaTraderBody());
    let step = extendPossessionLineage(
      lineage,
      possession,
      { kind: "possess", compatibility },
      SIM_START as never,
    );
    assert.equal(step.ok, true);
    if (!step.ok) throw new Error("unreachable");
    lineage = step.lineage;
    const { streams } = await runMeanReversion(alphaEngine(wallOffset), possession, 8);
    const digestTrail = streams.map((stream) => stream.viewDigest);
    step = extendPossessionLineage(
      lineage,
      possession,
      { kind: "release", reason: "operator-request" },
      (SIM_START + 60_000) as never,
    );
    assert.equal(step.ok, true);
    if (!step.ok) throw new Error("unreachable");
    return { lineage: step.lineage, digestTrail };
  };
  const first = await build(0);
  const second = await build(DAY_MS);
  assert.deepEqual(first.lineage, second.lineage);
  assert.deepEqual(first.digestTrail, second.digestTrail);
});

test("the Body executes: an effective-agent proposal traverses the REAL CommandPort", async () => {
  const possession = alphaMeanReversionPossession();
  const { streams } = await runMeanReversion(alphaEngine(0), possession, 12);
  const firstProposal = streams
    .flatMap((stream) => stream.decisions.map((decision) => ({ stream, decision })))
    .find((entry) => entry.decision.command.kind === "submit-order");
  if (firstProposal === undefined) {
    assert.fail("expected at least one submit-order proposal on the real market");
  }
  // the ultimate proof holds for the exact proposal being executed
  const outcome = checkDecisionStreamCompatibility(firstProposal.stream, possession);
  assert.equal(outcome.ok, true);
  // the possession never touched a port — the BODY submits its proposal
  const engine = alphaEngine(0);
  const result = await engine.command.submitOrder(firstProposal.decision.command as never);
  assert.equal(result.status === "acked" || result.status === "rejected", true);
  if (result.status === "rejected") {
    // a typed rejection is a LAWFUL outcome (the port's own gates decide)
    assert.equal(typeof result.rejection.code, "string");
  }
});
