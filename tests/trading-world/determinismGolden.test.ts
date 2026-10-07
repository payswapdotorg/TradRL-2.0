/**
 * THE W019 DETERMINISM GOLDEN — part 2 of the World Alpha golden integration
 * suite: A9 at the INTEGRATION level, RUN ONE of two.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 ("a determinism claim requires fixed
 * world definition, engine version, seed and command stream") and the W019
 * work order: "same definition + seed + clock + commands twice (different
 * wall clocks) ⇒ identical journal digests + manifests".
 *
 * The golden journey (./goldenJourney.helpers.ts — the full multi-regime
 * day, ~96k journal events) runs here under a FIXED wall axis (T1) through
 * the REAL composed attachment (`createAlphaEngineTransport`, the W019
 * disclosed `wallTimeSource` seam — the production default remains the host
 * clock). The TWIN run — `determinismGoldenWallTwin.test.ts` — repeats the
 * SAME journey with the wall axis one full DAY later (T1 + 24h) and asserts
 * the SAME pinned identity (./determinismPins.ts). Part 1
 * (`goldenJourney.test.ts`) pins the same identity observed under the real
 * HOST wall clock. Three wall axes, one digest:
 *   Digest(T_host) = P  ∧  Digest(T1) = P  ∧  Digest(T1 + 24h) = P
 *     ⇒ wall time NEVER enters the journal, the manifest, the published
 *       stream or the financial end state (A9 wall-invariance).
 *
 * The divergence side of A9 is asserted here too: the same command shape on
 * a DIFFERENT world (different seed ⇒ different generated market) journals
 * a different digest — determinism is identity, not coincidence.
 *
 * Wall cost: ONE full journey ≈ 5–6 minutes. The twin file pays the same
 * again; together they are the suite's flagship digest law.
 *
 * Run (repo root): cd packages/ui && ../../node_modules/.bin/tsx --test
 * ../../tests/trading-world/*.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  fixedWallSource,
  GOLDEN_WORLD_ID,
  runGoldenJourney,
  SIM_START,
} from "./goldenJourney.helpers.js";
import {
  PINNED_BALANCES,
  PINNED_CLOCK_VIEWS,
  PINNED_COMMAND_STREAM_HASH,
  PINNED_EVIDENCE_EVENTS,
  PINNED_EVENT_COUNT,
  PINNED_EVENT_HASH,
  PINNED_FINANCIALS,
  PINNED_FINAL_CLOCK,
  PINNED_HIDDEN_EVENTS,
  PINNED_LINEAGE_HASH,
  PINNED_PUBLISHED_BATCHES,
  PINNED_WORLD_DEFINITION_HASH,
} from "./determinismPins.js";
import {
  alphaWorldDefinition,
  createAlphaEngineTransport,
} from "../../packages/ui/src/trading-world/runtime/engineAttachment.js";
import { attachEngineWorldClient } from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";

const DAY_MS = 86_400_000;
/** This run's fixed wall axis (arbitrary; the twin runs one day later). */
const WALL_T1 = 1_700_000_500_000;

const moneyOf = (value: unknown): string => String((value as { amount?: unknown }).amount ?? "?");

// RUN ONE: the full golden journey under the fixed wall axis T1 (top-level
// await — one live engine at a time).
const run = await runGoldenJourney({ wallTimeSource: fixedWallSource(WALL_T1) });

test("A9 run one: the fixed-wall journey journals the PINNED golden identity", () => {
  const report = run.s18.report as {
    worldId?: string;
    mode?: string;
    seed?: string;
    finalSimulationTime?: number;
    eventCount?: number;
    eventHash?: string;
  };
  assert.equal(report.worldId, GOLDEN_WORLD_ID);
  assert.equal(report.mode, "reactive-replay");
  assert.equal(report.seed, `alpha:${GOLDEN_WORLD_ID}`);
  assert.equal(report.finalSimulationTime, SIM_START + 7_231_000);
  assert.equal(report.eventCount, PINNED_EVENT_COUNT);
  assert.equal(report.eventHash, PINNED_EVENT_HASH);
  assert.deepEqual(
    (run.s18.report as { balances?: { amount?: string }[] }).balances?.map((b) => b.amount),
    [...PINNED_BALANCES],
  );
});

test("A9 run one: the determinism manifest is the PINNED identity (wall axis T1)", () => {
  const manifest = run.s18.manifest as {
    worldDefinitionVersion?: string;
    seed?: string;
    inputHashes?: { worldDefinition?: string; lineage?: string };
    dependencyVersions?: { node?: string };
    commandStreamHash?: string;
  };
  assert.equal(manifest.worldDefinitionVersion, "world-alpha@1");
  assert.equal(manifest.seed, `alpha:${GOLDEN_WORLD_ID}`);
  assert.equal(manifest.inputHashes?.worldDefinition, PINNED_WORLD_DEFINITION_HASH);
  assert.equal(manifest.inputHashes?.lineage, PINNED_LINEAGE_HASH);
  assert.equal(manifest.dependencyVersions?.node, process.versions.node);
  assert.equal(manifest.commandStreamHash, PINNED_COMMAND_STREAM_HASH);
});

test("A9 run one: the projection stream and the firewalled reads are the PINNED identity", () => {
  assert.equal(run.s18.publishedBatches, PINNED_PUBLISHED_BATCHES);
  assert.equal(run.s18.publishedEvents, PINNED_EVENT_COUNT);
  assert.equal(
    run.s18.publishedEvents,
    (run.s18.report as { eventCount?: number }).eventCount,
    "every journaled event crossed the published channel exactly once",
  );
  assert.equal(run.s18.clockViews, PINNED_CLOCK_VIEWS);
  assert.equal(run.s18.evidenceEvents, PINNED_EVIDENCE_EVENTS);
  assert.equal(run.s18.timelineEvents, PINNED_EVIDENCE_EVENTS);
  assert.equal(run.s18.hiddenEventCount, PINNED_HIDDEN_EVENTS);
  assert.deepEqual(run.s18.finalClock, { ...PINNED_FINAL_CLOCK });
});

test("A9 run one: the financial journey is the PINNED identity (exact figures)", () => {
  assert.equal(moneyOf((run.s10.portfolio as { cash?: unknown }).cash), PINNED_FINANCIALS.s10Cash);
  assert.equal(moneyOf((run.s10.portfolio as { equity?: unknown }).equity), PINNED_FINANCIALS.s10Equity);
  assert.equal(moneyOf((run.s11.portfolio as { cash?: unknown }).cash), PINNED_FINANCIALS.s11Cash);
  const position11 = run.s11.positions[0] as
    | { averageEntryPrice?: string; unrealizedPnl?: { amount?: string } }
    | undefined;
  assert.equal(position11?.averageEntryPrice, PINNED_FINANCIALS.s11AverageEntryPrice);
  assert.equal(moneyOf(position11?.unrealizedPnl), PINNED_FINANCIALS.s11UnrealizedPnl);
  const position14 = run.s14.positions[0] as { unrealizedPnl?: { amount?: string } } | undefined;
  assert.equal(moneyOf(position14?.unrealizedPnl), PINNED_FINANCIALS.s14UnrealizedPnl);
  assert.equal(moneyOf((run.endState.portfolio as { cash?: unknown }).cash), PINNED_FINANCIALS.endCash);
  assert.equal(moneyOf((run.endState.portfolio as { equity?: unknown }).equity), PINNED_FINANCIALS.endEquity);
  const reportPnl = (run.s18.report as {
    pnl?: readonly { realized?: { amount?: string }; unrealized?: { amount?: string }; total?: { amount?: string } }[];
  }).pnl;
  assert.equal(reportPnl?.[0]?.realized?.amount, "1.5");
  assert.equal(reportPnl?.[0]?.unrealized?.amount, PINNED_FINANCIALS.endUnrealizedPnl);
  assert.equal(reportPnl?.[0]?.total?.amount, PINNED_FINANCIALS.endTotalPnl);
});

test("A9 (divergence side): a different seed journals a different market", async () => {
  // Same definition shape + same clock + same command shape, DIFFERENT world
  // (the seed is `alpha:<worldId>`): the generated day must diverge.
  const shortRun = async (worldId: string): Promise<{ eventCount: number; eventHash: string }> => {
    const client = await attachEngineWorldClient({
      transport: createAlphaEngineTransport(worldId, {
        wallTimeSource: fixedWallSource(WALL_T1 + 2 * DAY_MS) as () => never,
      }),
      expectedWorldId: worldId,
    });
    try {
      await client.clock.step(10_000);
      const quote = await client.query.getQuote(`instrument-es-${worldId}` as never);
      await client.command.submitOrder({
        kind: "submit-order",
        commandId: "det-probe" as never,
        worldId: worldId as never,
        issuedBy: `participant-trader-${worldId}` as never,
        issuedAt: (SIM_START + 10_000) as never,
        accountId: `account-trader-${worldId}` as never,
        instrumentId: `instrument-es-${worldId}` as never,
        submission: {
          kind: "limit",
          side: "buy",
          quantity: "1",
          limitPrice: quote.ask as never,
          constraints: { timeInForce: "GTC" },
        },
      } as never);
      const report = (await client.host.headlessReport()) as { eventCount: number; eventHash: string };
      return { eventCount: report.eventCount, eventHash: report.eventHash };
    } finally {
      client.dispose();
    }
  };

  const worldA = await shortRun("world-w019-det-a");
  const worldB = await shortRun("world-w019-det-b");
  assert.notEqual(
    worldB.eventHash,
    worldA.eventHash,
    "a different seed (different world) journals a different digest — determinism is identity",
  );
  // And the two divergence worlds use the same definition SHAPE (the alpha
  // definition, different ids): same worldDefinitionVersion.
  assert.equal(
    alphaWorldDefinition("world-w019-det-a").worldDefinitionVersion,
    alphaWorldDefinition("world-w019-det-b").worldDefinitionVersion,
  );
  // The golden world is untouched by this test's runs.
  assert.equal(GOLDEN_WORLD_ID, "world-w019-golden");
});
