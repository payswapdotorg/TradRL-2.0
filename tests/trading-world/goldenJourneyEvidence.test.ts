/**
 * The W019 golden journey tests — parts G/H/L (snapshot + branch + lineage,
 * the information firewall, evidence provenance). Split from the original
 * goldenJourney.test.ts for the 400-line lint law; verbatim. The journey
 * runs ONCE per file (top-level await).
 */

import {
  type GoldenJourneyFacts,
  runGoldenJourney,
  GOLDEN_WORLD_ID,
  SIM_START,
  GOLDEN_ACCOUNT_ID
} from "./goldenJourney.helpers.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveFillRows
} from "../../packages/ui/src/trading-world/orders/orderLifecycle.js";

// The journey runs ONCE for the whole file (top-level await): every test
// below asserts on the captured facts — a single ~6-minute pass.
const facts: GoldenJourneyFacts = await runGoldenJourney();

/** Narrow a captured projection value with a loud failure message. */
function expect<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `expected ${what} to be present`);
  return value;
}

test("G: snapshot + branch at the integration surface — lineage facts, parent immutability", () => {
  // The snapshot is content-addressed and journaled.
  assert.deepEqual(facts.s17.snapshotAck, {
    status: "acked",
    ack: {
      commandId: "golden-snapshot",
      worldId: GOLDEN_WORLD_ID,
      acceptedAt: SIM_START + 7_231_000,
      resultingEventIds: [`evt:${GOLDEN_WORLD_ID}:96207`],
      journalCursor: 96207,
    },
  });
  assert.deepEqual(facts.s17.snapshotDescriptor, {
    snapshotId: `snap:${GOLDEN_WORLD_ID}:1`,
    worldId: GOLDEN_WORLD_ID,
    createdAt: SIM_START + 7_231_000,
    journalCursor: 96206,
    digest: "82f0223c",
  });
  // The branch command journals ONE record with complete lineage facts.
  assert.deepEqual(facts.s17.branchEvent, {
    worldId: GOLDEN_WORLD_ID,
    sequence: 96208,
    eventId: `evt:${GOLDEN_WORLD_ID}:96208`,
    eventType: "world.branch.created",
    occurredAt: SIM_START + 7_231_000,
    causationId: "golden-branch",
    correlationId: "golden-branch",
    producer: "world-core",
    schemaVersion: "tradrl-world-sim.events@1",
    payload: {
      type: "world.branch.created",
      branchWorldId: `wld:${GOLDEN_WORLD_ID}:1`,
      parentWorldId: GOLDEN_WORLD_ID,
      sourceSnapshotId: `snap:${GOLDEN_WORLD_ID}:1`,
      snapshotDigest: "82f0223c",
      branchPointSequence: 96206,
      configuration: { label: "golden what-if" },
      engine: "tradrl-world-sim",
      engineVersion: "0.1.0-skeleton",
      seed: `alpha:${GOLDEN_WORLD_ID}`,
      createdAt: SIM_START + 7_231_000,
      issuedBy: `participant-trader-${GOLDEN_WORLD_ID}`,
      createdViaCommand: "golden-branch",
    },
  });
  // The evidence port knows the child's complete lineage; the parent is a
  // root (empty own lineage).
  assert.equal(facts.s17.childLineage.length, 1);
  assert.deepEqual(facts.s17.selfLineage, []);
  // G at the integration surface: mutating the parent AFTER the branch does
  // not alter the snapshot (byte-identical descriptor).
  assert.deepEqual(
    facts.s17.snapshotDescriptorAfterParentMutation,
    facts.s17.snapshotDescriptor,
    "the content-addressed snapshot is immutable under later parent mutation",
  );
  // …and the parent journal kept advancing past the branch point.
  assert.equal((facts.s18.lastEvent as { eventId?: string }).eventId, `evt:${GOLDEN_WORLD_ID}:96209`);
  assert.equal((facts.s18.lastEvent as { eventType?: string }).eventType, "world.annotation.added");
});

test("H: the information firewall is visible — latent market facts are withheld from evidence reads", () => {
  // The journal holds 96209 events; the A7-filtered evidence read returns
  // 96203 — the final step's market facts are still behind availableAt
  // (ack 250ms + fill propagation 500ms), exactly the firewall's promise.
  assert.equal((facts.s18.report as { eventCount?: number }).eventCount, 96209);
  assert.equal(facts.s18.evidenceEvents, 96203);
  assert.equal(facts.s18.hiddenEventCount, 6);
  assert.equal(facts.s18.timelineEvents, facts.s18.evidenceEvents, "getTimeline applies the same A7 filter");
  // The current-state QUOTE already reflects the post-step book (last
  // 4043.25) while the firewalled TAPE still ends at the last visible print
  // (4043.5) — the two views are honestly different (A7 vs current state).
  assert.equal((facts.endState.quote as { last?: string }).last, "4043.25");
  const lastVisibleTrade = expect(facts.endState.trades[facts.endState.trades.length - 1], "the newest visible trade");
  assert.equal(lastVisibleTrade.price, "4043.5");
  assert.equal(facts.endState.trades.length, 3384, "the final step's prints are withheld from the tape");
});

test("L: evidence — causal journal events and provenance for the order lifecycle", () => {
  // The first journaled event is the origin-rule regime announcement,
  // produced by the generator with its own causation id.
  assert.deepEqual(
    (({ eventId, eventType, occurredAt, producer, causationId }) => ({ eventId, eventType, occurredAt, producer, causationId }))(facts.s18.firstEvent as never),
    {
      eventId: `evt:${GOLDEN_WORLD_ID}:1`,
      eventType: "market.regime.changed",
      occurredAt: SIM_START,
      producer: "market-generator",
      causationId: `gen:${GOLDEN_WORLD_ID}:1700000000000`,
    },
  );
  // Provenance: the accepted event of golden-buy-1 is command-caused.
  assert.deepEqual(facts.s18.provenance, {
    subjectEventId: `evt:${GOLDEN_WORLD_ID}:62`,
    producer: "matching-engine",
    inputs: [{ kind: "command", ref: "golden-buy-1" }],
    recordedAt: SIM_START + 10_000,
  });
  // EVERY one of the trader's fills cites a journaled trade, and the fills
  // per order sum to the order's filled quantity (the causality chain).
  const ourFills = deriveFillRows(
    facts.endState.fillEvents as never,
    GOLDEN_ACCOUNT_ID,
  );
  assert.ok(ourFills.length >= 4, `the trader's fills are projected from the journal (got ${String(ourFills.length)})`);
  const tradeIds = new Set(facts.endState.trades.map((trade) => String(trade.tradeId)));
  for (const fill of ourFills) {
    assert.ok(
      tradeIds.has(fill.marketTradeId),
      `fill ${fill.fillId} cites journaled trade ${fill.marketTradeId}`,
    );
  }
  const filledByOrder = new Map<string, number>();
  for (const fill of ourFills) {
    filledByOrder.set(fill.orderId, (filledByOrder.get(fill.orderId) ?? 0) + Number(fill.quantity));
  }
  for (const order of facts.endState.ourOrders) {
    if (order.status === "replaced") {
      continue; // the replaced order never rested in this journey
    }
    assert.equal(
      filledByOrder.get(String(order.orderId)) ?? 0,
      Number(order.filledQuantity),
      `fills of ${String(order.orderId)} sum to its filled quantity`,
    );
  }
});

