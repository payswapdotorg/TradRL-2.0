/**
 * The A7 information-firewall honesty tests (W023): a reactive participant
 * CANNOT see future-dated information — every settled view is exactly what
 * the ports serve "as available then":
 *
 * - the trade tape is availableAt-gated (venue latency): trades printed at
 *   T are invisible until the clock passes T + acknowledgementMs +
 *   fillPropagationMs — asserted through the runtime's OWN recorded views;
 * - no view, at any pass, ever carries a trade from beyond the observation
 *   time (the never-future law, asserted across a whole run);
 * - news (information artifacts) appear only once observable (availableAt),
 *   asserted with future-dated artifacts declared in the world;
 * - the observation surface is the declared set (structurally: the view
 *   shape) — the spy-client proof lives in runtime.protocol.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createParticipantRuntime } from "../src/runtime.js";
import { createMomentumAgent } from "../src/agents/momentum.js";
import { attachAgentWorld, fixedWallSource, SIM_START } from "./helpers.js";
import { DRIVE_STEPS, driveJourney } from "./referenceRuntime.js";

const WALL_T1 = 1_700_000_500_000;

/** The reference momentum-only runtime (the firewall applies to the loop). */
async function attachMomentumOnly(worldId: string, wallAt: number = WALL_T1, options = {}) {
  const client = await attachAgentWorld(worldId, {
    wallTimeSource: fixedWallSource(wallAt),
    ...options,
  });
  const instrument = `instrument-es-${worldId}` as never;
  const account = `account-agents-${worldId}` as never;
  const momentum = createMomentumAgent({
    agentId: "momentum",
    participantId: `participant-agent-momentum-${worldId}` as never,
    accountId: account,
    instrumentId: instrument,
    seed: "w023-a7",
    lookbackTrades: 8,
    thresholdTicks: 4,
    baseLots: 2,
    jitterLots: 2,
    maxPositionLots: 6,
    cooldownMs: 4000,
  });
  const runtime = createParticipantRuntime({
    client,
    agents: [momentum],
    views: { instruments: [instrument], accountId: account, tradeWindowMs: 30_000 },
  });
  return { client, runtime };
}

test("A7: the trade tape is latency-gated — fresh prints are invisible until availableAt", async () => {
  // The venue declares acknowledgementMs 250 + fillPropagationMs 500, so a
  // print at T becomes observable exactly at T + 750ms (SIMULATION.md's venue
  // latency as event observability). The generated world's first print time
  // is seed-dependent — the test DISCOVERS it from the world itself, then
  // asserts the gate: the print is invisible while the clock is inside the
  // latency window and visible at the first observation past it.
  const GATE_MS = 750; // helpers' venue: acknowledgementMs 250 + fillPropagationMs 500
  const STEP_MS = 250; // fine steps so the gate window is actually observed
  const { client, runtime } = await attachMomentumOnly("world-w023-a7-latency");
  try {
    runtime.start();
    await runtime.settle();

    // Drive fine steps until the first print becomes visible (bounded; this
    // world's first print lands well inside the bound).
    let firstVisibleAt = -1;
    for (let i = 0; i < 80 && firstVisibleAt < 0; i += 1) {
      await client.clock.step(STEP_MS);
      await runtime.settle();
      const pass = runtime.telemetry().passes.at(-1)!;
      if (pass.view.trades.length > 0) {
        firstVisibleAt = Number(pass.observedAt);
      }
    }
    assert.ok(firstVisibleAt > 0, "the world printed at least one trade within the drive bound");

    const passes = runtime.telemetry().passes;
    const first = passes.find((p) => p.view.trades.length > 0)!;
    const printAt = Number(first.view.trades[0]!.occurredAt);

    // The gate law for the first print: invisible through the whole latency
    // window, visible at the first observation past it (within one step).
    assert.ok(
      firstVisibleAt >= printAt + GATE_MS,
      `the print at +${printAt - SIM_START}ms is invisible until its availableAt (+${printAt + GATE_MS - SIM_START}ms), first seen +${firstVisibleAt - SIM_START}ms`,
    );
    assert.ok(
      firstVisibleAt < printAt + GATE_MS + STEP_MS,
      "the print becomes visible at the FIRST observation past the gate (no extra delay)",
    );
    const gatedObservations = passes.filter(
      (p) =>
        Number(p.observedAt) >= printAt &&
        Number(p.observedAt) < printAt + GATE_MS,
    );
    assert.ok(
      gatedObservations.length > 0,
      "the latency window was actually observed (fine steps) while the gate was closed",
    );
    for (const pass of gatedObservations) {
      assert.equal(
        pass.view.trades.length,
        0,
        `a view at +${Number(pass.observedAt) - SIM_START}ms (inside the latency window) must not carry the print`,
      );
    }

    // The general law across the whole run so far: every visible print of
    // this venue is past its own availableAt.
    for (const pass of passes) {
      for (const trade of pass.view.trades) {
        assert.ok(
          Number(trade.occurredAt) + GATE_MS <= Number(pass.observedAt),
          `a print at +${Number(trade.occurredAt) - SIM_START}ms was visible at +${Number(pass.observedAt) - SIM_START}ms (before its availableAt)`,
        );
      }
    }
    runtime.stop();
  } finally {
    client.dispose();
  }
});

test("A7: the never-future law holds across a whole run — no view ever carries a future fact", async () => {
  const { client, runtime } = await attachMomentumOnly("world-w023-a7-never");
  try {
    runtime.start();
    await driveJourney(client, runtime, DRIVE_STEPS);
    const passes = runtime.telemetry().passes;
    assert.ok(passes.length > 20, "a full run of settled views");
    for (const pass of passes) {
      const observedAt = Number(pass.observedAt);
      for (const trade of pass.view.trades) {
        assert.ok(
          Number(trade.occurredAt) <= observedAt,
          `a view at +${String(observedAt - SIM_START)}ms carried a trade from +${String(Number(trade.occurredAt) - SIM_START)}ms`,
        );
      }
      for (const quote of pass.view.quotes) {
        assert.ok(Number(quote.asOf) <= observedAt);
      }
      for (const book of pass.view.books) {
        assert.ok(Number(book.asOf) <= observedAt);
      }
      assert.ok(Number(pass.view.portfolio.asOf) <= observedAt);
      assert.ok(Number(pass.view.risk.asOf) <= observedAt);
      if (pass.view.news !== undefined) {
        for (const item of pass.view.news) {
          assert.ok(
            Number(item.availableAt) <= observedAt,
            "news is only visible once observable (availableAt)",
          );
        }
      }
    }
    runtime.stop();
  } finally {
    client.dispose();
  }
});

test("A7: future-dated news artifacts stay invisible until availableAt", async () => {
  // A world with three information artifacts: one always observable, one at
  // +15s, one at +45s. The runtime reads the news view (includeNews) and the
  // recorded passes show the firewall: the artifact list only ever grows at
  // the declared availability times.
  const worldId = "world-w023-a7-news";
  const news = [
    {
      artifactId: `news-past-${worldId}` as never,
      worldId: worldId as never,
      source: "w023-test-wire",
      createdAt: (SIM_START - 60_000) as never,
      availableAt: (SIM_START - 60_000) as never,
      scope: "world",
      provenance: {
        producer: "producer-w023-test" as never,
        recordedAt: (SIM_START - 60_000) as never,
      },
      version: "1",
      payload: { headline: "yesterday's anchor report" },
    },
    {
      artifactId: `news-15s-${worldId}` as never,
      worldId: worldId as never,
      source: "w023-test-wire",
      createdAt: (SIM_START + 15_000) as never,
      availableAt: (SIM_START + 15_000) as never,
      scope: "world",
      provenance: {
        producer: "producer-w023-test" as never,
        recordedAt: (SIM_START + 15_000) as never,
      },
      version: "1",
      payload: { headline: "mid-journal flash" },
    },
    {
      artifactId: `news-45s-${worldId}` as never,
      worldId: worldId as never,
      source: "w023-test-wire",
      createdAt: (SIM_START + 45_000) as never,
      availableAt: (SIM_START + 45_000) as never,
      scope: "world",
      provenance: {
        producer: "producer-w023-test" as never,
        recordedAt: (SIM_START + 45_000) as never,
      },
      version: "1",
      payload: { headline: "late journal flash" },
    },
  ];
  const client = await attachAgentWorld(worldId, {
    wallTimeSource: fixedWallSource(WALL_T1),
    informationArtifacts: news,
  });
  try {
    const instrument = `instrument-es-${worldId}` as never;
    const account = `account-agents-${worldId}` as never;
    const momentum = createMomentumAgent({
      agentId: "momentum",
      participantId: `participant-agent-momentum-${worldId}` as never,
      accountId: account,
      instrumentId: instrument,
      seed: "w023-a7",
      lookbackTrades: 8,
      thresholdTicks: 4,
      baseLots: 2,
      jitterLots: 2,
      maxPositionLots: 6,
      cooldownMs: 4000,
    });
    const runtime = createParticipantRuntime({
      client,
      agents: [momentum],
      views: {
        instruments: [instrument],
        accountId: account,
        tradeWindowMs: 30_000,
        includeNews: true,
      },
    });
    runtime.start();

    const headlinesAt = async (): Promise<string[]> => {
      await runtime.settle();
      const pass = runtime.telemetry().passes.at(-1)!;
      return (pass.view.news ?? []).map((item) => String(item.payload.headline));
    };

    await client.clock.step(10_000); // +10s: only the past artifact
    assert.deepEqual(await headlinesAt(), ["yesterday's anchor report"]);

    await client.clock.step(10_000); // +20s: the +15s artifact is observable
    assert.deepEqual(await headlinesAt(), [
      "yesterday's anchor report",
      "mid-journal flash",
    ]);

    await client.clock.step(10_000); // +30s: the +45s artifact is STILL future
    assert.deepEqual(await headlinesAt(), [
      "yesterday's anchor report",
      "mid-journal flash",
    ]);

    await client.clock.step(20_000); // +50s: all three observable
    assert.deepEqual(await headlinesAt(), [
      "yesterday's anchor report",
      "mid-journal flash",
      "late journal flash",
    ]);
    runtime.stop();
  } finally {
    client.dispose();
  }
});
