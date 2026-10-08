/**
 * W030 COMPRESSION (honest characterization, COUNTS ONLY — wall-clock is
 * never asserted, it is not deterministic): a high-rate stream's projection
 * read count and intermediate-state count STRICTLY reduce through the
 * coalescer while the final states stay identical to the raw path.
 *
 * Laws:
 * - the raw path reads EVERY configured key after EVERY signal (the W009
 *   projection-feed behavior);
 * - the coalesced path reads at most ONE value per (surface, key) per drain
 *   — the count of any port method is bounded by the drain count;
 * - larger observation windows (higher `drainEvery`) strictly reduce reads
 *   (monotonic in the window);
 * - per-surface intermediate states strictly reduce for the market surfaces;
 * - the FINAL states are identical to the raw path (compression is lossless
 *   at the observation points — no dropped or blended state);
 * - the degenerate per-signal policy refreshes only what the signals dirtied
 *   (the honest floor: no refresh without a cause).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  allSurfacesConfig,
  createCoalescedConsumer,
  createRawConsumer,
  runHighRateStream,
  type CoalescedPolicy,
  type ConsumerRun,
  type HighRateStreamOptions,
} from "./helpers.js";
import type { ProjectionCoalescerConfig } from "../coalescer.js";

const STREAM: HighRateStreamOptions = { steps: 40, stepMs: 1_000, humanOrderEvery: 2 };

interface RunOutcome {
  readonly run: ConsumerRun;
  readonly signals: number;
}

async function runConsumer(
  options: HighRateStreamOptions,
  config: ProjectionCoalescerConfig,
  policy?: CoalescedPolicy,
): Promise<RunOutcome> {
  if (policy === undefined) {
    const raw = createRawConsumer(config);
    const stream = await runHighRateStream({ ...options, consumers: [raw.factory] });
    return { run: await raw.finish(), signals: stream.signals.length };
  }
  const coalesced = createCoalescedConsumer(config, policy);
  const stream = await runHighRateStream({ ...options, consumers: [coalesced.factory] });
  return { run: await coalesced.finish(), signals: stream.signals.length };
}

test("COMPRESSION: strictly fewer reads and intermediate states on a high-rate stream", async () => {
  const config = allSurfacesConfig();
  const raw = await runConsumer(STREAM, config);
  const coalesced = await runConsumer(STREAM, config, { drainEvery: 4 });
  assert.equal(raw.signals, coalesced.signals, "the same deterministic stream");
  assert.ok(raw.signals >= 100, `a genuinely high-rate stream (${String(raw.signals)} signals)`);

  // The raw path: EVERY configured key re-read after EVERY signal + attach.
  assert.equal(raw.run.reads.getQuote, raw.signals + 1);
  assert.equal(raw.run.reads.getPortfolio, (raw.signals + 1) * 3); // three account keys

  // The coalescing law in counts: at most ONE read per key per drain.
  assert.ok(
    (coalesced.run.reads.getQuote ?? 0) <= coalesced.run.drains,
    `getQuote ${String(coalesced.run.reads.getQuote)} over ${String(coalesced.run.drains)} drains`,
  );
  assert.ok(
    (coalesced.run.reads.getTimeline ?? 0) <= coalesced.run.drains,
    "getTimeline at most once per drain",
  );
  assert.ok(
    coalesced.run.readTotal < raw.run.readTotal,
    `raw ${String(raw.run.readTotal)} port reads vs coalesced ${String(coalesced.run.readTotal)} ` +
      `(${(raw.run.readTotal / coalesced.run.readTotal).toFixed(1)}x fewer) over ${String(raw.signals)} signals`,
  );
  for (const surface of ["quote", "orderbook", "trades", "orders", "portfolio", "timeline"]) {
    assert.ok(
      (coalesced.run.statesPerSurface[surface] ?? 0) < (raw.run.statesPerSurface[surface] ?? 0),
      `surface ${surface}: coalesced ${String(coalesced.run.statesPerSurface[surface])} intermediate states vs raw ${String(raw.run.statesPerSurface[surface])}`,
    );
  }
});

test("COMPRESSION is lossless: the final states equal the raw path's final states", async () => {
  const config = allSurfacesConfig();
  const raw = await runConsumer(STREAM, config);
  const coalesced = await runConsumer(STREAM, config, { drainEvery: 5 });
  assert.deepEqual(
    [...coalesced.run.latest.keys()].sort(),
    [...raw.run.latest.keys()].sort(),
    "the final forced drain covers every key",
  );
  for (const [key, value] of coalesced.run.latest) {
    assert.deepEqual(
      value,
      raw.run.latest.get(key),
      `final state diverged for ${key} — compression dropped or blended state`,
    );
  }
});

test("COMPRESSION scales with the observation window, not the signal rate", async () => {
  const config = allSurfacesConfig();
  const every2 = await runConsumer(STREAM, config, { drainEvery: 2 });
  const every4 = await runConsumer(STREAM, config, { drainEvery: 4 });
  const every8 = await runConsumer(STREAM, config, { drainEvery: 8 });
  assert.ok(
    every8.run.readTotal < every4.run.readTotal && every4.run.readTotal < every2.run.readTotal,
    `reads must shrink as the window grows: 2→${String(every2.run.readTotal)}, ` +
      `4→${String(every4.run.readTotal)}, 8→${String(every8.run.readTotal)}`,
  );
  assert.ok(every8.run.readTotal * 2 < every2.run.readTotal, "the reduction is roughly proportional");
});

test("COMPRESSION floor: the per-signal policy refreshes only what the signals dirtied", async () => {
  const config = allSurfacesConfig();
  const raw = await runConsumer(STREAM, config);
  const degenerate = await runConsumer(STREAM, config, { drainEvery: 1 });
  // One drain per signal + the attach drain + the final forced drain: every
  // refresh has a cause (a dirtying signal or the explicit final observation).
  assert.ok(degenerate.run.readTotal <= raw.run.readTotal);
  assert.equal(
    degenerate.run.statesPerSurface.timeline,
    // timeline is dirtied by EVERY signal (clock ingest + every publication)
    // — one state per signal in both paths, plus the coalesced final drain:
    (raw.run.statesPerSurface.timeline ?? 0) + 1,
    "the timeline parity: every signal refreshed it exactly once",
  );
  assert.ok(
    (degenerate.run.reads.getQuote ?? 0) <= (raw.run.reads.getQuote ?? 0),
    "quote refreshes only when a quote-affecting signal (or clock) arrived",
  );
});
