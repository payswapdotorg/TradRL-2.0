/**
 * THE W019 DETERMINISM GOLDEN — part 2b of the World Alpha golden
 * integration suite: the TWIN RUN of A9 at the INTEGRATION level.
 *
 * THE SAME golden journey (`./goldenJourney.helpers.ts` — the full
 * multi-regime day, ~96k journal events, the frozen command + clock stream)
 * runs here again through the REAL composed attachment
 * (`createAlphaEngineTransport`), but with the WALL AXIS one full day later
 * than `determinismGolden.test.ts`'s run one (T1 + 24h — the W019-disclosed
 * `wallTimeSource` seam). The assertions are the SAME pinned identity
 * (`./determinismPins.ts`):
 *
 *   Digest(T1) = P  (run one)   ∧   Digest(T1 + 24h) = P  (this file)
 *     ⇒ identical journals, manifests, published streams, clock views and
 *       financial end states across a day of wall-clock variance — wall
 *       time never enters the run identity (A9, the W017-golden
 *       methodology at the integration level). Part 1 additionally pins P
 *       under the real HOST wall clock: three wall axes, one digest.
 *
 * The file exists (rather than a second run inside run one's process)
 * because the suite runs one engine at a time per file — one journey per
 * file keeps peak memory at one engine AND every file runnable inside a
 * 10-minute command budget. Run one + this twin together cost ~11 minutes
 * of wall time; that is the deliberate price of the flagship digest law.
 *
 * Run (repo root): cd packages/ui && ../../node_modules/.bin/tsx --test
 * ../../tests/trading-world/*.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import { fixedWallSource, GOLDEN_WORLD_ID, runGoldenJourney, SIM_START } from "./goldenJourney.helpers.js";
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

const DAY_MS = 86_400_000;
/** Run one's fixed wall axis (mirrored from determinismGolden.test.ts). */
const WALL_T1 = 1_700_000_500_000;

const moneyOf = (value: unknown): string => String((value as { amount?: unknown }).amount ?? "?");

// RUN TWO (the twin): the same frozen journey, wall axis one day later.
const run = await runGoldenJourney({
  wallTimeSource: fixedWallSource(WALL_T1 + DAY_MS),
});

test("A9 twin: one wall day later, the journal identity is UNCHANGED", () => {
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
  assert.equal(
    report.eventCount,
    PINNED_EVENT_COUNT,
    "one wall day later: the same journal size",
  );
  assert.equal(
    report.eventHash,
    PINNED_EVENT_HASH,
    "one wall day later: the SAME journal digest (A9 — wall time never enters)",
  );
  assert.deepEqual(
    (run.s18.report as { balances?: { amount?: string }[] }).balances?.map((b) => b.amount),
    [...PINNED_BALANCES],
  );
});

test("A9 twin: the determinism manifest is UNCHANGED one wall day later", () => {
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

test("A9 twin: the projection stream and the firewalled reads are UNCHANGED", () => {
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

test("A9 twin: the financial journey is UNCHANGED (exact figures, one wall day later)", () => {
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
