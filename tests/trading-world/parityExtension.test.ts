/**
 * THE W019 PARITY EXTENSION — the transport topology is invisible above the
 * W018 seam, on the GENERATED alpha market.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md I ("The same command stream run
 * headlessly and through the UI produces the same deterministic result
 * hash") + spec/ARCHITECTURE-LOCK.md A15, extended by W019 from the W018
 * provider-level proof (`packages/ui/test/tradingWorldTransportParity.test.ts`,
 * plain headless engine) to the COMPOSED alpha product: the W017 generated
 * market behind the REAL provider over BOTH adapter topologies.
 *
 * TWO runtimes, ONE definition + seed + engine wiring + command/clock stream:
 *   (a) the REAL composed attachment (`createAlphaEngineTransport` — the
 *       exact transport `TradingWorldShell` attaches), in-process;
 *   (b) the REAL provider over a REAL `worker_threads` adapter hosting the
 *       SAME generated engine inside a separate thread (see
 *       ./fixtures/generatedEngineWorkerBootstrap.ts) — every message across
 *       a genuine postMessage + structured-clone boundary, on a DIFFERENT
 *       wall clock.
 *
 * The stream crosses a regime boundary (mean-reversion → trend) with a
 * complete fill, a partial fill, a cancel and typed rejections, so the
 * parity law is exercised over generated events, human order events and
 * journal digests — not just a cold world.
 *
 * Scope note (honest): the FULL two-hour golden day is proven twice over the
 * in-process topology in determinismGolden.test.ts (~12 min); running the
 * worker twin over the full day as well would double the suite's wall cost
 * for no additional law — the topology-invisibility law is a property of the
 * transport, not of the day's length. This stream (~5k events) is the
 * deliberate scope of the worker leg, disclosed in the W019 PR.
 *
 * Run (repo root): node_modules/.bin/tsx --test tests/trading-world/*.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { EngineWorldClient } from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";
import { createAlphaEngineTransport } from "../../packages/ui/src/trading-world/runtime/engineAttachment.js";
import { fixedWallSource, GOLDEN_WORLD_ID, SIM_START } from "./goldenJourney.helpers.js";
import { attachRun, workerTransport } from "./workerFixture.helpers.js";

const PARITY_WORLD_ID = "world-w019-parity";
const INSTRUMENT = `instrument-es-${PARITY_WORLD_ID}`;
const ACCOUNT = `account-trader-${PARITY_WORLD_ID}`;
const PARTICIPANT = `participant-trader-${PARITY_WORLD_ID}`;

/**
 * The fixed parity stream: seed the market, trade it (complete + partial
 * fill), rest, cancel, reject (FOK + unknown cancel), then cross the trend
 * regime boundary (+30 min) and journal the transition.
 */
async function runParityJourney(client: EngineWorldClient): Promise<{
  readonly report: Record<string, unknown>;
  readonly manifest: Record<string, unknown>;
  readonly events: readonly unknown[];
}> {
  const world = PARITY_WORLD_ID as never;
  const inst = INSTRUMENT as never;
  const account = ACCOUNT as never;
  const participant = PARTICIPANT as never;
  const now = async () => (await client.clock.getClock()).simulationTime;

  await client.clock.step(10_000);
  const quote = await client.query.getQuote(inst);
  const ask = quote.ask;
  const t1 = await now();
  await client.command.submitOrder({
    kind: "submit-order",
    commandId: "parity-buy-1" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: t1 as never,
    accountId: account,
    instrumentId: inst,
    submission: { kind: "limit", side: "buy", quantity: "1", limitPrice: ask, constraints: { timeInForce: "GTC" } },
  } as never);
  await client.command.submitOrder({
    kind: "submit-order",
    commandId: "parity-buy-10" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: t1 as never,
    accountId: account,
    instrumentId: inst,
    submission: { kind: "limit", side: "buy", quantity: "10", limitPrice: ask, constraints: { timeInForce: "GTC" } },
  } as never);
  const orders = await client.query.getOrders({});
  const remainder = orders.find((order) => order.quantity === "10" && order.status !== "filled");
  await client.command.cancelOrder({
    kind: "cancel-order",
    commandId: "parity-cancel" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: t1 as never,
    orderId: remainder?.orderId,
    reason: "parity",
  } as never);
  await client.command.submitOrder({
    kind: "submit-order",
    commandId: "parity-fok" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: t1 as never,
    accountId: account,
    instrumentId: inst,
    submission: { kind: "limit", side: "buy", quantity: "1", limitPrice: "4000.00" as never, constraints: { timeInForce: "FOK" } },
  } as never);
  await client.command.cancelOrder({
    kind: "cancel-order",
    commandId: "parity-cancel-unknown" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: t1 as never,
    orderId: `ord:${PARITY_WORLD_ID}:999999`,
    reason: "x",
  } as never);
  // Cross the mean-reversion → trend boundary and journal the transition.
  await client.clock.seek((SIM_START + 30 * 60_000 + 30_000) as never);
  await client.command.addAnnotation({
    kind: "add-annotation",
    commandId: "parity-annot" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: (await now()) as never,
    at: (await now()) as never,
    text: "parity: trend boundary crossed",
  } as never);
  return {
    report: (await client.host.headlessReport()) as unknown as Record<string, unknown>,
    manifest: (await client.evidence.getDeterminismManifest()) as unknown as Record<string, unknown>,
    events: (await client.evidence.getEvents({} as never)) as unknown as readonly unknown[],
  };
}

test("PARITY EXTENSION: the generated alpha market over in-process == over a REAL worker thread", async (t) => {
  // (a) the composed in-process attachment, fixed wall clock.
  const inProcess = await attachRun(
    createAlphaEngineTransport(PARITY_WORLD_ID, {
      wallTimeSource: fixedWallSource(1_700_000_500_000) as () => never,
    }),
    PARITY_WORLD_ID,
  );
  // (b) the REAL provider over a REAL worker thread (real wall clock inside
  // the thread — maximally different from (a)'s fixed source).
  const { transport: workerSide, worker } = await workerTransport(PARITY_WORLD_ID);
  const viaWorker = await attachRun(workerSide, PARITY_WORLD_ID);

  let inProcessResult: Awaited<ReturnType<typeof runParityJourney>>;
  let workerResult: Awaited<ReturnType<typeof runParityJourney>>;
  try {
    inProcessResult = await runParityJourney(inProcess.client);
    workerResult = await runParityJourney(viaWorker.client);
  } finally {
    inProcess.client.dispose();
    viaWorker.client.dispose();
    await worker.terminate();
  }

  t.diagnostic(
    `inproc: ${String(inProcessResult.report.eventCount)} events, hash ${String(inProcessResult.report.eventHash)}`,
  );
  t.diagnostic(
    `worker: ${String(workerResult.report.eventCount)} events, hash ${String(workerResult.report.eventHash)}`,
  );

  // A meaningful generated market was journaled in BOTH topologies.
  assert.ok(
    Number(inProcessResult.report.eventCount) > 2_000,
    "the parity stream journals a multi-thousand-event generated market (regime boundary crossed)",
  );
  // THE journal-digest parity law (ACCEPTANCE I), on the generated market:
  assert.deepEqual(
    workerResult.report,
    inProcessResult.report,
    "REAL provider over in-process vs WORKER adapter: identical headless report (journal digest) — wall clocks differ",
  );
  assert.deepEqual(
    workerResult.manifest,
    inProcessResult.manifest,
    "identical determinism manifests across topologies (A9: wall time never enters)",
  );
  assert.deepEqual(
    workerResult.events,
    inProcessResult.events,
    "identical event envelopes across topologies (A7-filtered evidence reads included)",
  );

  // The UI-side projection streams are identical — the transport topology is
  // invisible above the seam (never renumbered, never fabricated).
  assert.deepEqual(
    viaWorker.published,
    inProcess.published,
    "identical published projections across both topologies (the W019 parity-extension law)",
  );
  assert.deepEqual(
    viaWorker.clockViews,
    inProcess.clockViews,
    "identical settled clock views across both topologies",
  );

  // Projection law, both sides: the flattened published stream IS the journal
  // (count + contiguity; the envelope-verbatim twin is the cross-topology
  // deepEqual above — evidence.getEvents is A7-filtered, the published
  // channel is not, so envelopes are compared across topologies, not against
  // the filtered read).
  for (const [label, run, result] of [
    ["in-process", inProcess, inProcessResult],
    ["worker", viaWorker, workerResult],
  ] as const) {
    const stream = run.published.flatMap((projection) => [...projection.events]);
    assert.equal(
      stream.length,
      Number(result.report.eventCount),
      `${label}: every journaled event crossed the published channel exactly once`,
    );
    let expected = 1;
    for (const event of stream) {
      assert.equal(
        (event as { sequence: number }).sequence,
        expected,
        `${label}: published sequences are contiguous from 1 (never renumbered)`,
      );
      expected += 1;
    }
  }

  // The golden world's definition remains untouched by this run (different
  // world id ⇒ different seed ⇒ different market — the A9 divergence side).
  assert.notEqual(
    PARITY_WORLD_ID,
    GOLDEN_WORLD_ID,
    "the parity world is a distinct world (never the golden world's seed)",
  );
});
