/**
 * The reference agents against the REAL generated agent world (W023) — the
 * momentum and mean-reversion agents trade the REAL W017 generated market
 * through the REAL W018 provider: real liquidity, real fills, real fees,
 * typed rejections — and their DECLARED policy laws hold across every
 * recorded pass, including the pure-decision law (the same view ⇒ the same
 * decision, re-decided by fresh agent instances).
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parseParticipantDecimal } from "../src/decimal.js";
import { signedPositionScaled } from "../src/agents/momentum.js";
import { createParticipantRuntime } from "../src/runtime.js";
import type {
  ParticipantDecision,
  ReactiveParticipantAgent,
} from "../../tradrl-world-contracts/src/participantProtocol.js";
import { attachReferenceRuntime, driveJourney, referenceAgents } from "./referenceRuntime.js";
import { SIM_START } from "./helpers.js";

const SEC = 1_000;
/** Regime boundaries of the compact agent world (simulation seconds). */
const TREND_FROM = 30;
const HALT_FROM = 70;
const HALT_REOPEN = 74;

test("the momentum agent rides the REAL generated trend with REAL fills", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-agents");
  try {
    runtime.start();
    await driveJourney(client, runtime);
    const telemetry = runtime.telemetry();

    // The agent fired (acked market IOCs) — attribution is clean: every
    // command was issued by the declared momentum participant.
    const momentumOutcomes = telemetry.outcomes.filter((o) => o.agentId === "momentum");
    const acked = momentumOutcomes.filter((o) => o.result.status === "acked");
    assert.ok(acked.length > 0, "the momentum agent issued acked commands");

    // At least one momentum order actually FILLED on generated liquidity —
    // the fill is visible in a LATER view's own orders (the venue's record).
    const filledIds = new Set<string>();
    for (const pass of telemetry.passes) {
      for (const order of pass.view.orders) {
        if (
          String(order.submittedBy).includes("agent-momentum") &&
          (order.status === "filled" || order.status === "partially-filled")
        ) {
          filledIds.add(String(order.orderId));
        }
      }
    }
    assert.ok(filledIds.size > 0, "momentum orders filled on the real generated book");

    // The account's position moved (real fills ⇒ real positions).
    const positionIds = telemetry.passes.filter((pass) =>
      pass.view.portfolio.positions.some((p) => p.quantity !== "0"),
    );
    assert.ok(positionIds.length > 0, "the agents' account held real positions during the run");

    // Direction law (declared policy): the side ALWAYS matches the sign of
    // the measured signal — the rationale pins the sign, the intent pins the
    // side; a mismatch would be an invented decision.
    for (const pass of telemetry.passes) {
      const decision = pass.decisions.get("momentum");
      assert.ok(decision !== undefined);
      const sign = /signal ([+-])/.exec(decision.rationale)?.[1];
      for (const intent of decision.intents) {
        if (intent.kind === "submit-order") {
          assert.ok(sign === "+" || sign === "-", `rationale carries the signal sign: ${decision.rationale}`);
          assert.equal(
            intent.submission.side,
            sign === "+" ? "buy" : "sell",
            "the momentum side follows the signal sign",
          );
        }
      }
    }

    // And the agent rode the +1 trend: at least one acked momentum BUY
    // inside the trend window (the regime whose tape trends up).
    const trendBuys = telemetry.passes.filter((pass) => {
      const seconds = (Number(pass.observedAt) - SIM_START) / SEC;
      if (seconds <= TREND_FROM || seconds >= HALT_FROM) {
        return false;
      }
      return pass.outcomes.some(
        (outcome) =>
          outcome.agentId === "momentum" &&
          outcome.result.status === "acked" &&
          (pass.decisions.get("momentum")?.intents.some(
            (intent) => intent.kind === "submit-order" && intent.submission.side === "buy",
          ) ??
            false),
      );
    });
    assert.ok(trendBuys.length > 0, "the momentum agent bought the real generated uptrend");
  } finally {
    runtime.stop();
    client.dispose();
  }
});

test("the momentum agent's declared caps hold across EVERY settled view", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-caps");
  try {
    runtime.start();
    await driveJourney(client, runtime);
    const { momentum } = referenceAgents("world-w023-caps");
    const instrument = `instrument-es-world-w023-caps` as never;
    const cap = 6; // the declared maxPositionLots of the reference config
    for (const pass of runtime.telemetry().passes) {
      const position = signedPositionScaled(pass.view, instrument);
      const magnitude = position < 0n ? -position : position;
      const lot = parseParticipantDecimal("1");
      assert.ok(
        magnitude <= BigInt(cap) * lot,
        `|position| exceeded the declared cap at +${String((Number(pass.observedAt) - SIM_START) / SEC)}s`,
      );
    }
    assert.ok(momentum.agentId === "momentum");
    // The cooldown law: never two momentum submissions within cooldownMs.
    const submissions = runtime.telemetry().passes.flatMap((pass) =>
      pass.outcomes
        .filter((o) => o.agentId === "momentum")
        .map((o) => ({ at: Number(pass.observedAt), id: o.commandId })),
    );
    for (let i = 1; i < submissions.length; i += 1) {
      assert.ok(
        submissions[i]!.at - submissions[i - 1]!.at >= 4_000,
        "momentum submissions respect the declared 4000ms cooldown",
      );
    }
  } finally {
    runtime.stop();
    client.dispose();
  }
});

test("the mean-reversion agent's quote discipline: post-only, tick-exact, capped, withdrawn on signal loss", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-quotes");
  try {
    runtime.start();
    await driveJourney(client, runtime);
    const telemetry = runtime.telemetry();
    const tick = parseParticipantDecimal("0.25");

    let submittedQuotes = 0;
    let cancelIntents = 0;
    for (const pass of telemetry.passes) {
      const decision = pass.decisions.get("mean-reversion");
      assert.ok(decision !== undefined);
      for (const intent of decision.intents) {
        if (intent.kind === "submit-order") {
          submittedQuotes += 1;
          // DECLARED POLICY: every MR order is a post-only GTC limit at a
          // tick-multiple price (exact scaled arithmetic).
          assert.equal(intent.submission.kind, "limit");
          assert.deepEqual(intent.submission.constraints, { timeInForce: "GTC", postOnly: true });
          const price = parseParticipantDecimal(String(intent.submission.limitPrice));
          assert.equal(price % tick, 0n, "MR quote prices are tick multiples");
        } else if (intent.kind === "cancel-order") {
          cancelIntents += 1;
          assert.ok(
            intent.reason === "mean-reversion: flat zone" ||
              intent.reason === "mean-reversion: signal flipped",
            `cancel reason is declared policy: ${String(intent.reason)}`,
          );
        } else {
          assert.fail(`the MR agent never issues ${intent.kind} intents`);
        }
      }
      // The per-side working-quote cap, from the venue's own records.
      const workingBuys = pass.view.orders.filter(
        (o) =>
          String(o.submittedBy).includes("agent-mr") &&
          o.side === "buy" &&
          (o.status === "accepted" || o.status === "partially-filled"),
      );
      const workingSells = pass.view.orders.filter(
        (o) =>
          String(o.submittedBy).includes("agent-mr") &&
          o.side === "sell" &&
          (o.status === "accepted" || o.status === "partially-filled"),
      );
      assert.ok(workingBuys.length <= 2, "at most 2 working buy quotes (the declared cap)");
      assert.ok(workingSells.length <= 2, "at most 2 working sell quotes (the declared cap)");
    }
    assert.ok(submittedQuotes > 0, "the MR agent rested quotes");
    assert.ok(cancelIntents > 0, "the MR agent withdrew quotes (flat zone / sign flip)");
  } finally {
    runtime.stop();
    client.dispose();
  }
});

test("the pure-decision law: fresh agents re-decide every recorded view identically", async () => {
  const { client, runtime } = await attachReferenceRuntime("world-w023-pure");
  try {
    runtime.start();
    await driveJourney(client, runtime);
    const { momentum, meanReversion } = referenceAgents("world-w023-pure");
    for (const pass of runtime.telemetry().passes) {
      assert.deepEqual(
        momentum.decide(pass.view),
        pass.decisions.get("momentum"),
        `momentum decision differs on pass ${String(pass.pass)} (the same view must decide the same)`,
      );
      assert.deepEqual(
        meanReversion.decide(pass.view),
        pass.decisions.get("mean-reversion"),
        `mean-reversion decision differs on pass ${String(pass.pass)}`,
      );
    }
  } finally {
    runtime.stop();
    client.dispose();
  }
});

test("typed outcomes: the halt window rejects market orders with market-halted (the venue's own truth)", async () => {
  // A seed-independent probe: an always-on scripted agent (a test-local
  // ReactiveParticipantAgent — the protocol is open to any policy) submits
  // one market IOC every settled view, so the halt window's typed rejection
  // is exercised regardless of the generated tape.
  const { client } = await attachReferenceRuntime("world-w023-halt");
  try {
    const instrument = `instrument-es-world-w023-halt` as never;
    const account = `account-agents-world-w023-halt` as never;
    const alwaysOn: ReactiveParticipantAgent = {
      agentId: "always-on",
      participantId: `participant-agent-momentum-world-w023-halt` as never,
      accountId: account,
      description: "test probe: one market IOC per settled view",
      decide: (): ParticipantDecision => ({
        intents: [
          {
            kind: "submit-order",
            instrumentId: instrument,
            submission: {
              kind: "market",
              side: "buy",
              quantity: "1" as never,
              constraints: { timeInForce: "IOC" },
            },
          },
        ],
        rationale: "always-on probe: buy 1 lot market IOC",
      }),
    };
    const runtime = createParticipantRuntime({
      client,
      agents: [alwaysOn],
      views: { instruments: [instrument], accountId: account, tradeWindowMs: 30_000 },
    });
    runtime.start();
    await driveJourney(client, runtime);
    const telemetry = runtime.telemetry();

    const halted = telemetry.outcomes.filter(
      (outcome) =>
        outcome.result.status === "rejected" && outcome.result.rejection.code === "market-halted",
    );
    // The halt window [70s, 74s): the pass at +70s lands inside it.
    assert.ok(halted.length > 0, "the halt window produced typed market-halted rejections");
    for (const outcome of halted) {
      if (outcome.result.status !== "rejected") {
        continue; // narrowed: only rejected outcomes carry a rejection (TS)
      }
      const pass = telemetry.passes.find((p) => p.outcomes.includes(outcome))!;
      const seconds = (Number(pass.observedAt) - SIM_START) / SEC;
      assert.ok(
        seconds >= HALT_FROM && seconds < HALT_REOPEN,
        `the market-halted rejection happened inside the halt window (+${String(seconds)}s)`,
      );
      assert.equal(outcome.result.rejection.stage, "domain-rules");
    }
    // After the reopen the same probe's orders are accepted again — the
    // rejection was the venue's transient truth, not a dead runtime.
    const postReopenAcked = telemetry.passes.filter((pass) => {
      const seconds = (Number(pass.observedAt) - SIM_START) / SEC;
      return seconds >= HALT_REOPEN && pass.outcomes.some((o) => o.result.status === "acked");
    });
    assert.ok(postReopenAcked.length > 0, "orders acked again after the reopen");
    runtime.stop();
  } finally {
    client.dispose();
  }
});
