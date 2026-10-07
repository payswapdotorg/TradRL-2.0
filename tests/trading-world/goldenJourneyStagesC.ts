/**
 * The W019 golden journey — stages S15–S18 + the end state (clock ops, the
 * A8 refusals, snapshot/branch/lineage, the end-state report and the
 * ACCEPTANCE F surface cross-check reads). Split from
 * goldenJourney.helpers.ts for the 400-line lint law; verbatim stage code.
 */

import { GOLDEN_WORLD_ID, MIN, SIM_START } from "./goldenJourneyFacts.js";
import type { JourneyContext } from "./goldenJourneyContext.js";

/** Run stages S15–S18 + the end-state reads; returns the fact objects. */
export async function stagesS15ThroughS18AndEnd(ctx: JourneyContext) {
  // --- S15: clock ops + the backward-jump A8 refusal --------------------------
  await ctx.client.clock.play();
  const playView = await ctx.client.clock.getClock();
  await ctx.client.clock.setSpeed(2);
  const speedView = await ctx.client.clock.getClock();
  await ctx.client.clock.pause();
  const pauseView = await ctx.client.clock.getClock();
  await ctx.client.clock.step(1_000);
  const stepView = await ctx.client.clock.getClock();
  let jumpError = "";
  try {
    await ctx.client.clock.jumpToEvent(62 as never);
  } catch (error) {
    jumpError = `${(error as Error).name}: ${(error as Error).message}`;
  }
  const s15 = {
    play: playView as unknown as Record<string, unknown>,
    speed2: speedView as unknown as Record<string, unknown>,
    pause: pauseView as unknown as Record<string, unknown>,
    step: stepView as unknown as Record<string, unknown>,
    jumpError,
  };

  // --- S16: the A8 backward-seek refusal ---------------------------------------
  let rewindError = "";
  try {
    await ctx.client.clock.seek((SIM_START + 10 * MIN) as never);
  } catch (error) {
    rewindError = `${(error as Error).name} :: ${(error as Error).message}`;
  }
  const clockAfterRewind = await ctx.client.clock.getClock();
  const s16 = {
    rewindError,
    clockAfter: clockAfterRewind as unknown as Record<string, unknown>,
  };

  // --- S17: snapshot + branch + lineage + parent immutability ------------------
  const tEnd = await ctx.now();
  const snapshotAck = (await ctx.client.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "golden-snapshot" as never,
    worldId: ctx.world,
    issuedBy: ctx.participant,
    issuedAt: tEnd as never,
    label: "golden journey",
  } as never)) as Record<string, unknown>;
  const branchAck = (await ctx.client.command.branchWorld({
    kind: "branch-world",
    commandId: "golden-branch" as never,
    worldId: ctx.world,
    issuedBy: ctx.participant,
    issuedAt: tEnd as never,
    sourceSnapshotId: `snap:${GOLDEN_WORLD_ID}:1`,
    configuration: { label: "golden what-if" },
  } as never)) as Record<string, unknown>;
  const branchEvents = await ctx.client.evidence.getEvents({ types: ["world.branch.created"] } as never);
  const branchEvent = (branchEvents[0] ?? {}) as Record<string, unknown>;
  const branchPayload = (branchEvent.payload ?? {}) as { branchWorldId?: string };
  const childLineage = await ctx.client.evidence.getBranchLineage(branchPayload.branchWorldId as never);
  const selfLineage = await ctx.client.evidence.getBranchLineage();
  const snapshotDescriptor = (await ctx.client.evidence.getSnapshot(
    `snap:${GOLDEN_WORLD_ID}:1` as never,
  )) as Record<string, unknown>;
  // Parent mutation AFTER the branch: the snapshot must stay byte-identical.
  await ctx.client.command.addAnnotation({
    kind: "add-annotation",
    commandId: "golden-annot" as never,
    worldId: ctx.world,
    issuedBy: ctx.participant,
    issuedAt: tEnd as never,
    at: tEnd as never,
    text: "post-branch parent mutation",
  } as never);
  const descriptorAfterMutation = (await ctx.client.evidence.getSnapshot(
    `snap:${GOLDEN_WORLD_ID}:1` as never,
  )) as Record<string, unknown>;
  const s17 = {
    snapshotAck,
    branchAck,
    branchEvent,
    childLineage: childLineage as unknown as readonly Record<string, unknown>[],
    selfLineage,
    snapshotDescriptor,
    snapshotDescriptorAfterParentMutation: descriptorAfterMutation,
  };

  // --- S18: the end state — report, manifest, evidence, published stream ------
  const report = (await ctx.client.host.headlessReport()) as unknown as Record<string, unknown>;
  const manifest = (await ctx.client.evidence.getDeterminismManifest()) as unknown as Record<string, unknown>;
  const evidenceEvents = await ctx.client.evidence.getEvents({} as never);
  const timelineAll = await ctx.client.query.getTimeline({} as never);
  const provenance = (await ctx.client.evidence.getProvenance(
    `evt:${GOLDEN_WORLD_ID}:62` as never,
  )) as unknown as Record<string, unknown>;
  const finalClock = await ctx.client.clock.getClock();
  const s18 = {
    report,
    manifest,
    evidenceEvents: evidenceEvents.length,
    hiddenEventCount: Number(report.eventCount) - evidenceEvents.length,
    firstEvent: (evidenceEvents[0] ?? {}) as Record<string, unknown>,
    lastEvent: (evidenceEvents[evidenceEvents.length - 1] ?? {}) as Record<string, unknown>,
    provenance,
    timelineEvents: timelineAll.events.length,
    publishedBatches: ctx.published.length,
    publishedEvents: ctx.published.reduce(
      (total, projection) =>
        total + ((projection as { events?: readonly unknown[] }).events?.length ?? 0),
      0,
    ),
    clockViews: ctx.clockViews.length,
    finalClock: finalClock as unknown as Record<string, unknown>,
  };

  // --- End-state reads for the surface cross-checks (ACCEPTANCE F) ------------
  const quoteEnd = await ctx.client.query.getQuote(ctx.inst);
  const bookEnd = await ctx.client.query.getOrderBook(ctx.inst, 5);
  const tradesEnd = await ctx.client.query.getTrades(ctx.inst, {});
  const ordersEnd = await ctx.client.query.getOrders({});
  const ourOrdersEnd = ordersEnd.filter((order) => order.accountId === (ctx.account as never));
  const positionsEnd = await ctx.client.query.getPositions(ctx.account);
  const portfolioEnd = await ctx.client.query.getPortfolio(ctx.account);
  const riskEnd = await ctx.client.query.getRisk(ctx.account);
  const regimesEnd = await ctx.regimes();
  const metaEnd = await ctx.client.query.getWorldMeta();
  const fillTimeline = await ctx.client.query.getTimeline({ types: ["matching.order.filled"] });
  const endState = {
    quote: quoteEnd as unknown as Record<string, unknown>,
    book: bookEnd as unknown as Record<string, unknown>,
    trades: tradesEnd as unknown as readonly Record<string, unknown>[],
    orders: ordersEnd as unknown as readonly Record<string, unknown>[],
    ourOrders: ourOrdersEnd as unknown as readonly Record<string, unknown>[],
    positions: positionsEnd as unknown as readonly Record<string, unknown>[],
    portfolio: portfolioEnd as unknown as Record<string, unknown>,
    risk: riskEnd as unknown as Record<string, unknown>,
    regimes: regimesEnd,
    meta: metaEnd as unknown as Record<string, unknown>,
    fillEvents: fillTimeline.events as unknown as readonly Record<string, unknown>[],
  };
  return { s15, s16, s17, s18, endState };
}
