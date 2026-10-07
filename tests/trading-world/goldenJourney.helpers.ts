/**
 * The W019 golden journey — shared scripted trader session (suite helper,
 * not a test file).
 *
 * ONE fixed, fully deterministic command + clock stream through the REAL
 * composed product: the W018 provider (`attachEngineWorldClient`) over the
 * TL-wired alpha attachment (`createAlphaEngineTransport` — the W017
 * generated market behind the W018 in-process adapter), i.e. exactly what
 * `TradingWorldShell` attaches for a Trading World pane. Every surface
 * package (W007–W012) is cross-checked against the engine's own projections
 * in the tests that consume this helper.
 *
 * The journey is the multi-regime alpha DAY (definition
 * `alphaWorldDefinition`): mean-reversion cold start → trend →
 * high-volatility → low-liquidity → mean-reversion close, with a scripted
 * trader session on top: complete fill, partial fill + cancel of the
 * remainder, resting orders, cancel, replace, typed rejections (FOK
 * unfillable, unknown-order cancel, invalid price, duplicate command),
 * clock ops (play/speed/pause/step), the A8 backward-seek refusal, a
 * content-addressed snapshot, a branch with complete lineage facts, and a
 * post-branch parent mutation (snapshot immutability evidence).
 *
 * DETERMINISM CONTRACT: the issued commands and clock operations below are
 * FROZEN — reads may be added freely (they never journal), but any change to
 * a command, its issuedAt, or the clock path changes every generated event
 * and therefore every pinned digest. The golden pins live in
 * `goldenJourney.test.ts`.
 */

import {
  attachEngineWorldClient,
  type EngineWorldClient,
} from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";
import {
  alphaWorldDefinition,
  createAlphaEngineTransport,
} from "../../packages/ui/src/trading-world/runtime/engineAttachment.js";

/** The golden world identity (seed = `alpha:world-w019-golden`). */
export const GOLDEN_WORLD_ID = "world-w019-golden";
/** Simulation origin of the alpha definition (2023-11-14T22:13:20Z). */
export const SIM_START = 1_700_000_000_000;
/** One simulation minute. */
export const MIN = 60_000;
/** The golden instrument (the alpha definition's only instrument). */
export const GOLDEN_INSTRUMENT_ID = `instrument-es-${GOLDEN_WORLD_ID}`;
/** The human trader's account + participant (the alpha definition). */
export const GOLDEN_ACCOUNT_ID = `account-trader-${GOLDEN_WORLD_ID}`;
export const GOLDEN_PARTICIPANT_ID = `participant-trader-${GOLDEN_WORLD_ID}`;

/** A wall-time source fixed at an arbitrary origin (determinism runs). */
export function fixedWallSource(at: number): () => number {
  return () => at;
}

/**
 * The per-stage facts the golden tests assert on. Everything is data read
 * from the REAL attached client (the same ports the surfaces consume) — the
 * tests derive the surface models from these and cross-check them.
 */
export interface GoldenJourneyFacts {
  readonly worldId: string;
  /** S0 — the world origin (before any clock advance). */
  readonly s0: {
    readonly clock: { simulationTime: number; status: string; speed: number };
    readonly bidLevels: number;
    readonly askLevels: number;
    readonly regimeAnnouncements: number;
  };
  /** S1 — after the first 10s step: the seeded market. */
  readonly s1: {
    readonly quote: Record<string, unknown>;
    readonly book: Record<string, unknown>;
    readonly trades: readonly Record<string, unknown>[];
    readonly regimes: readonly { at: number; to: string; parameters?: unknown }[];
  };
  /** S2 — the marketable buys (complete + partial fill). */
  readonly s2: {
    readonly buy1Ack: Record<string, unknown>;
    readonly buy19Ack: Record<string, unknown>;
    readonly quote: Record<string, unknown>;
    readonly askTop: readonly unknown[];
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly orders: readonly Record<string, unknown>[];
  };
  /** S3 — the resting sell high + resting buy deep. */
  readonly s3: {
    readonly sellAck: Record<string, unknown>;
    readonly deepAck: Record<string, unknown>;
    readonly asks12: readonly unknown[];
    readonly bidsAtOrBelow4792: readonly unknown[];
    readonly orders: readonly Record<string, unknown>[];
  };
  /** S5 — cancel of the partial remainder. */
  readonly s5: {
    readonly cancelAck: Record<string, unknown>;
    readonly canceledOrder: Record<string, unknown>;
    readonly askTop: readonly unknown[];
    readonly portfolio: Record<string, unknown>;
    readonly orders: readonly Record<string, unknown>[];
  };
  /** S6 — replace of the resting sell (4802.25 → 4801.75). */
  readonly s6: {
    readonly replaceAck: Record<string, unknown>;
    readonly asksAtOrAbove4801: readonly unknown[];
    readonly orders: readonly Record<string, unknown>[];
  };
  /** S7 — typed rejections (engine VALUES, not wire errors). */
  readonly s7: {
    readonly fokRejection: Record<string, unknown>;
    readonly unknownCancelRejection: Record<string, unknown>;
  };
  /** S10 — the mean-reversion dwell scan (when the replaced sell fills). */
  readonly s10: {
    readonly scan: readonly { readonly atMs: number; readonly sell: string; readonly deep: string }[];
    readonly sellFilledAtMs: number;
    readonly trades: number;
    readonly lastTrades: readonly Record<string, unknown>[];
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly quote: Record<string, unknown>;
  };
  /** S11 — the trend regime (when the deep resting buy fills). */
  readonly s11: {
    readonly scan: readonly {
      readonly atMs: number;
      readonly quote: Record<string, unknown>;
      readonly deep: string;
      readonly deepFilled: string;
    }[];
    readonly deepFilledAtMs: number;
    readonly regimes: readonly { to: string }[];
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly risk: Record<string, unknown>;
  };
  /** S12/S13/S14 — the HV, LL and closing-MR boundary crossings. */
  readonly s12: {
    readonly quote: Record<string, unknown>;
    readonly trades: number;
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly regimes: readonly { to: string }[];
  };
  readonly s13: { readonly quote: Record<string, unknown>; readonly trades: number; readonly regimes: readonly { to: string }[] };
  readonly s14: {
    readonly quote: Record<string, unknown>;
    readonly trades: number;
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly regimes: readonly { to: string }[];
  };
  /** S15 — clock ops (play/speed/pause/step) + the jump A8 refusal. */
  readonly s15: {
    readonly play: Record<string, unknown>;
    readonly speed2: Record<string, unknown>;
    readonly pause: Record<string, unknown>;
    readonly step: Record<string, unknown>;
    readonly jumpError: string;
  };
  /** S16 — the A8 backward-seek refusal, surfaced verbatim. */
  readonly s16: {
    readonly rewindError: string;
    readonly clockAfter: Record<string, unknown>;
  };
  /** S17 — snapshot + branch + lineage + parent immutability. */
  readonly s17: {
    readonly snapshotAck: Record<string, unknown>;
    readonly branchAck: Record<string, unknown>;
    readonly branchEvent: Record<string, unknown>;
    readonly childLineage: readonly Record<string, unknown>[];
    readonly selfLineage: readonly unknown[];
    readonly snapshotDescriptor: Record<string, unknown>;
    readonly snapshotDescriptorAfterParentMutation: Record<string, unknown>;
  };
  /** S18 — the end state: report, manifest, evidence, published stream. */
  readonly s18: {
    readonly report: Record<string, unknown>;
    readonly manifest: Record<string, unknown>;
    readonly evidenceEvents: number;
    readonly hiddenEventCount: number;
    readonly firstEvent: Record<string, unknown>;
    readonly lastEvent: Record<string, unknown>;
    readonly provenance: Record<string, unknown>;
    readonly timelineEvents: number;
    readonly publishedBatches: number;
    readonly publishedEvents: number;
    readonly clockViews: number;
    readonly finalClock: Record<string, unknown>;
  };
  /** Raw end-state reads for the surface cross-checks (ACCEPTANCE F). */
  readonly endState: {
    readonly quote: Record<string, unknown>;
    readonly book: Record<string, unknown>;
    readonly trades: readonly Record<string, unknown>[];
    readonly orders: readonly Record<string, unknown>[];
    readonly ourOrders: readonly Record<string, unknown>[];
    readonly positions: readonly Record<string, unknown>[];
    readonly portfolio: Record<string, unknown>;
    readonly risk: Record<string, unknown>;
    readonly regimes: readonly { at: number; to: string }[];
    readonly meta: Record<string, unknown>;
    readonly fillEvents: readonly Record<string, unknown>[];
  };
}

/** Input for {@link runGoldenJourney}. */
export interface GoldenJourneyInput {
  /**
   * Wall-axis source for the composed attachment (the W019 disclosed seam).
   * Default: the transport's own host clock — the production path.
   */
  readonly wallTimeSource?: () => number;
}

/**
 * Run the golden journey against a FRESH composed alpha attachment and
 * return every pinned fact. Disposes the client before resolving.
 */
export async function runGoldenJourney(
  input: GoldenJourneyInput = {},
): Promise<GoldenJourneyFacts> {
  const client = await attachEngineWorldClient({
    transport: createAlphaEngineTransport(GOLDEN_WORLD_ID, {
      ...(input.wallTimeSource === undefined
        ? {}
        : { wallTimeSource: input.wallTimeSource as () => never }),
    }),
    expectedWorldId: GOLDEN_WORLD_ID,
  });
  try {
    return await runJourneyOn(client);
  } finally {
    client.dispose();
  }
}

/** The journey proper, against an already-attached client. */
async function runJourneyOn(client: EngineWorldClient): Promise<GoldenJourneyFacts> {
  const published: unknown[] = [];
  const clockViews: unknown[] = [];
  client.onPublished((projection) => published.push(projection));
  client.onClock((clock) => clockViews.push(clock));

  const inst = GOLDEN_INSTRUMENT_ID as never;
  const account = GOLDEN_ACCOUNT_ID as never;
  const participant = GOLDEN_PARTICIPANT_ID as never;
  const world = GOLDEN_WORLD_ID as never;

  const now = async () => (await client.clock.getClock()).simulationTime;
  const ourOrders = async () => {
    const all = await client.query.getOrders({});
    return all.filter((order) => order.accountId === (GOLDEN_ACCOUNT_ID as never));
  };
  const regimes = async () => {
    const timeline = await client.query.getTimeline({ types: ["market.regime.changed"] });
    return timeline.events.map((event) => {
      const payload = (event as { payload?: { to?: string } }).payload;
      // Only the origin-rule announcement carries parameters (the anchor);
      // absent parameters stay ABSENT (deepStrictEqual key discipline).
      const parameters = (payload as { parameters?: unknown } | undefined)?.parameters;
      return {
        at: (event as { occurredAt?: number }).occurredAt ?? 0,
        to: payload?.to ?? "?",
        ...(parameters === undefined ? {} : { parameters }),
      };
    });
  };
  const submit = (commandId: string, submission: Record<string, unknown>, issuedAt: number) =>
    client.command.submitOrder({
      kind: "submit-order",
      commandId: commandId as never,
      worldId: world,
      issuedBy: participant,
      issuedAt: issuedAt as never,
      accountId: account,
      instrumentId: inst,
      submission,
    } as never) as Promise<Record<string, unknown>>;

  // --- S0: the world origin -------------------------------------------------
  const clock0 = await client.clock.getClock();
  const book0 = await client.query.getOrderBook(inst, 5);
  const regimes0 = await regimes();
  const s0 = {
    clock: { simulationTime: clock0.simulationTime, status: clock0.status, speed: clock0.speed },
    bidLevels: book0.bids.length,
    askLevels: book0.asks.length,
    regimeAnnouncements: regimes0.length,
  };

  // --- S1: step 10s — the generated market seeds itself ---------------------
  await client.clock.step(10_000);
  const q1 = await client.query.getQuote(inst);
  const book1 = await client.query.getOrderBook(inst, 5);
  const trades1 = await client.query.getTrades(inst, {});
  const regimes1 = await regimes();
  const s1 = {
    quote: q1 as unknown as Record<string, unknown>,
    book: book1 as unknown as Record<string, unknown>,
    trades: trades1 as unknown as readonly Record<string, unknown>[],
    regimes: regimes1,
  };

  // --- S2: marketable limit buys (complete fill, then partial fill) ----------
  const t1 = await now();
  const buy1Ack = await submit(
    "golden-buy-1",
    { kind: "limit", side: "buy", quantity: "1", limitPrice: "4800.25", constraints: { timeInForce: "GTC" } },
    t1,
  );
  const buy19Ack = await submit(
    "golden-buy-19",
    { kind: "limit", side: "buy", quantity: "19", limitPrice: "4800.25", constraints: { timeInForce: "GTC" } },
    t1,
  );
  const q2 = await client.query.getQuote(inst);
  const book2 = await client.query.getOrderBook(inst, 5);
  const positions2 = await client.query.getPositions(account);
  const portfolio2 = await client.query.getPortfolio(account);
  const orders2 = await ourOrders();
  const s2 = {
    buy1Ack,
    buy19Ack,
    quote: q2 as unknown as Record<string, unknown>,
    askTop: book2.asks.slice(0, 3),
    positions: positions2 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio2 as unknown as Record<string, unknown>,
    orders: orders2 as unknown as readonly Record<string, unknown>[],
  };

  // --- S3: resting sell high + resting buy deep ------------------------------
  const t2 = await now();
  const sellAck = await submit(
    "golden-sell-rest",
    { kind: "limit", side: "sell", quantity: "1", limitPrice: "4802.25", constraints: { timeInForce: "GTC" } },
    t2,
  );
  const deepAck = await submit(
    "golden-buy-deep",
    { kind: "limit", side: "buy", quantity: "1", limitPrice: "4790.00", constraints: { timeInForce: "GTC" } },
    t2,
  );
  const book12 = await client.query.getOrderBook(inst, 12);
  const book60 = await client.query.getOrderBook(inst, 60);
  const orders3 = await ourOrders();
  const s3 = {
    sellAck,
    deepAck,
    asks12: book12.asks,
    bidsAtOrBelow4792: book60.bids.filter((level) => Number(level.price) <= 4792),
    orders: orders3 as unknown as readonly Record<string, unknown>[],
  };

  // --- S5: cancel the buy-19 remainder ---------------------------------------
  const beforeCancel = await ourOrders();
  const remainder = beforeCancel.find(
    (order) => order.quantity === "19" && order.status !== "filled",
  );
  const cancelAck = (await client.command.cancelOrder({
    kind: "cancel-order",
    commandId: "golden-cancel-remainder" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: (await now()) as never,
    orderId: remainder?.orderId,
    reason: "golden journey",
  } as never)) as Record<string, unknown>;
  const book5 = await client.query.getOrderBook(inst, 5);
  const portfolio5 = await client.query.getPortfolio(account);
  const orders5 = await ourOrders();
  const s5 = {
    cancelAck,
    canceledOrder: (orders5.find((order) => order.quantity === "19") ?? {}) as Record<string, unknown>,
    askTop: book5.asks.slice(0, 2),
    portfolio: portfolio5 as unknown as Record<string, unknown>,
    orders: orders5 as unknown as readonly Record<string, unknown>[],
  };

  // --- S6: replace the resting sell 4802.25 → 4801.75 ------------------------
  const sellOrder = (await ourOrders()).find(
    (order) => order.side === "sell" && order.status !== "canceled" && order.status !== "filled",
  );
  const replaceAck = (await client.command.replaceOrder({
    kind: "replace-order",
    commandId: "golden-replace-sell" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: (await now()) as never,
    orderId: sellOrder?.orderId,
    limitPrice: "4801.75" as never,
  } as never)) as Record<string, unknown>;
  const book12b = await client.query.getOrderBook(inst, 12);
  const orders6 = await ourOrders();
  const s6 = {
    replaceAck,
    asksAtOrAbove4801: book12b.asks.filter((level) => Number(level.price) >= 4801),
    orders: orders6 as unknown as readonly Record<string, unknown>[],
  };

  // --- S7: typed rejections (values, never wire errors) -----------------------
  const t3 = await now();
  const fokRejection = await submit(
    "golden-fok",
    { kind: "limit", side: "buy", quantity: "1", limitPrice: "4000.00", constraints: { timeInForce: "FOK" } },
    t3,
  );
  const unknownCancelRejection = (await client.command.cancelOrder({
    kind: "cancel-order",
    commandId: "golden-cancel-unknown" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: t3 as never,
    orderId: `ord:${GOLDEN_WORLD_ID}:999999`,
    reason: "x",
  } as never)) as Record<string, unknown>;
  const s7 = { fokRejection, unknownCancelRejection };

  // --- S10: mean-reversion dwell — when does the replaced sell fill? ----------
  const dwellScan: { atMs: number; sell: string; deep: string }[] = [];
  let sellFilledAtMs = 0;
  for (const offset of [70_000, 150_000, 300_000, 600_000, 900_000, 1_200_000, 1_770_000]) {
    await client.clock.seek((SIM_START + 10_000 + offset) as never);
    const orders = await ourOrders();
    const newSell = orders.find((order) => order.limitPrice === "4801.75" && order.side === "sell");
    const deep = orders.find((order) => order.limitPrice === "4790.00");
    const atMs = 10_000 + offset;
    dwellScan.push({
      atMs,
      sell: newSell?.status ?? "MISSING",
      deep: deep?.status ?? "MISSING",
    });
    if (newSell !== undefined && newSell.status === "filled") {
      sellFilledAtMs = atMs;
      break;
    }
  }
  const trades10 = await client.query.getTrades(inst, {});
  const positions10 = await client.query.getPositions(account);
  const portfolio10 = await client.query.getPortfolio(account);
  const quote10 = await client.query.getQuote(inst);
  const s10 = {
    scan: dwellScan,
    sellFilledAtMs,
    trades: trades10.length,
    lastTrades: trades10.slice(-3) as unknown as readonly Record<string, unknown>[],
    positions: positions10 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio10 as unknown as Record<string, unknown>,
    quote: quote10 as unknown as Record<string, unknown>,
  };

  // --- S11: the trend regime — when does the deep buy fill? -------------------
  const trendScan: {
    atMs: number;
    quote: Record<string, unknown>;
    deep: string;
    deepFilled: string;
  }[] = [];
  let deepFilledAtMs = 0;
  for (const target of [30 * MIN + 30_000, 31 * MIN, 32 * MIN]) {
    await client.clock.seek((SIM_START + target) as never);
    const quote = await client.query.getQuote(inst);
    const orders = await ourOrders();
    const deep = orders.find((order) => order.limitPrice === "4790.00");
    trendScan.push({
      atMs: target,
      quote: quote as unknown as Record<string, unknown>,
      deep: deep?.status ?? "MISSING",
      deepFilled: deep?.filledQuantity ?? "0",
    });
    if (deep !== undefined && deep.status === "filled") {
      deepFilledAtMs = target;
      break;
    }
  }
  const regimes11 = await regimes();
  const positions11 = await client.query.getPositions(account);
  const portfolio11 = await client.query.getPortfolio(account);
  const risk11 = await client.query.getRisk(account);
  const s11 = {
    scan: trendScan,
    deepFilledAtMs,
    regimes: regimes11.map(({ to }) => ({ to })),
    positions: positions11 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio11 as unknown as Record<string, unknown>,
    risk: risk11 as unknown as Record<string, unknown>,
  };

  // --- S12/S13/S14: the HV, LL and closing-MR boundaries ----------------------
  await client.clock.seek((SIM_START + 60 * MIN + 30_000) as never);
  const quote12 = await client.query.getQuote(inst);
  const trades12 = await client.query.getTrades(inst, {});
  const positions12 = await client.query.getPositions(account);
  const portfolio12 = await client.query.getPortfolio(account);
  const regimes12 = await regimes();
  const s12 = {
    quote: quote12 as unknown as Record<string, unknown>,
    trades: trades12.length,
    positions: positions12 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio12 as unknown as Record<string, unknown>,
    regimes: regimes12.map(({ to }) => ({ to })),
  };

  await client.clock.seek((SIM_START + 90 * MIN + 30_000) as never);
  const quote13 = await client.query.getQuote(inst);
  const trades13 = await client.query.getTrades(inst, {});
  const regimes13 = await regimes();
  const s13 = {
    quote: quote13 as unknown as Record<string, unknown>,
    trades: trades13.length,
    regimes: regimes13.map(({ to }) => ({ to })),
  };

  await client.clock.seek((SIM_START + 120 * MIN + 30_000) as never);
  const quote14 = await client.query.getQuote(inst);
  const trades14 = await client.query.getTrades(inst, {});
  const positions14 = await client.query.getPositions(account);
  const portfolio14 = await client.query.getPortfolio(account);
  const regimes14 = await regimes();
  const s14 = {
    quote: quote14 as unknown as Record<string, unknown>,
    trades: trades14.length,
    positions: positions14 as unknown as readonly Record<string, unknown>[],
    portfolio: portfolio14 as unknown as Record<string, unknown>,
    regimes: regimes14.map(({ to }) => ({ to })),
  };

  // --- S15: clock ops + the backward-jump A8 refusal --------------------------
  await client.clock.play();
  const playView = await client.clock.getClock();
  await client.clock.setSpeed(2);
  const speedView = await client.clock.getClock();
  await client.clock.pause();
  const pauseView = await client.clock.getClock();
  await client.clock.step(1_000);
  const stepView = await client.clock.getClock();
  let jumpError = "";
  try {
    await client.clock.jumpToEvent(62 as never);
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
    await client.clock.seek((SIM_START + 10 * MIN) as never);
  } catch (error) {
    rewindError = `${(error as Error).name} :: ${(error as Error).message}`;
  }
  const clockAfterRewind = await client.clock.getClock();
  const s16 = {
    rewindError,
    clockAfter: clockAfterRewind as unknown as Record<string, unknown>,
  };

  // --- S17: snapshot + branch + lineage + parent immutability ------------------
  const tEnd = await now();
  const snapshotAck = (await client.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "golden-snapshot" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: tEnd as never,
    label: "golden journey",
  } as never)) as Record<string, unknown>;
  const branchAck = (await client.command.branchWorld({
    kind: "branch-world",
    commandId: "golden-branch" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: tEnd as never,
    sourceSnapshotId: `snap:${GOLDEN_WORLD_ID}:1`,
    configuration: { label: "golden what-if" },
  } as never)) as Record<string, unknown>;
  const branchEvents = await client.evidence.getEvents({ types: ["world.branch.created"] } as never);
  const branchEvent = (branchEvents[0] ?? {}) as Record<string, unknown>;
  const branchPayload = (branchEvent.payload ?? {}) as { branchWorldId?: string };
  const childLineage = await client.evidence.getBranchLineage(branchPayload.branchWorldId as never);
  const selfLineage = await client.evidence.getBranchLineage();
  const snapshotDescriptor = (await client.evidence.getSnapshot(
    `snap:${GOLDEN_WORLD_ID}:1` as never,
  )) as Record<string, unknown>;
  // Parent mutation AFTER the branch: the snapshot must stay byte-identical.
  await client.command.addAnnotation({
    kind: "add-annotation",
    commandId: "golden-annot" as never,
    worldId: world,
    issuedBy: participant,
    issuedAt: tEnd as never,
    at: tEnd as never,
    text: "post-branch parent mutation",
  } as never);
  const descriptorAfterMutation = (await client.evidence.getSnapshot(
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
  const report = (await client.host.headlessReport()) as unknown as Record<string, unknown>;
  const manifest = (await client.evidence.getDeterminismManifest()) as unknown as Record<string, unknown>;
  const evidenceEvents = await client.evidence.getEvents({} as never);
  const timelineAll = await client.query.getTimeline({} as never);
  const provenance = (await client.evidence.getProvenance(
    `evt:${GOLDEN_WORLD_ID}:62` as never,
  )) as unknown as Record<string, unknown>;
  const finalClock = await client.clock.getClock();
  const s18 = {
    report,
    manifest,
    evidenceEvents: evidenceEvents.length,
    hiddenEventCount: Number(report.eventCount) - evidenceEvents.length,
    firstEvent: (evidenceEvents[0] ?? {}) as Record<string, unknown>,
    lastEvent: (evidenceEvents[evidenceEvents.length - 1] ?? {}) as Record<string, unknown>,
    provenance,
    timelineEvents: timelineAll.events.length,
    publishedBatches: published.length,
    publishedEvents: published.reduce(
      (total, projection) =>
        total + ((projection as { events?: readonly unknown[] }).events?.length ?? 0),
      0,
    ),
    clockViews: clockViews.length,
    finalClock: finalClock as unknown as Record<string, unknown>,
  };

  // --- End-state reads for the surface cross-checks (ACCEPTANCE F) ------------
  const quoteEnd = await client.query.getQuote(inst);
  const bookEnd = await client.query.getOrderBook(inst, 5);
  const tradesEnd = await client.query.getTrades(inst, {});
  const ordersEnd = await client.query.getOrders({});
  const ourOrdersEnd = ordersEnd.filter((order) => order.accountId === (GOLDEN_ACCOUNT_ID as never));
  const positionsEnd = await client.query.getPositions(account);
  const portfolioEnd = await client.query.getPortfolio(account);
  const riskEnd = await client.query.getRisk(account);
  const regimesEnd = await regimes();
  const metaEnd = await client.query.getWorldMeta();
  const fillTimeline = await client.query.getTimeline({ types: ["matching.order.filled"] });
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

  return {
    worldId: GOLDEN_WORLD_ID,
    s0,
    s1,
    s2,
    s3,
    s5,
    s6,
    s7,
    s10,
    s11,
    s12,
    s13,
    s14,
    s15,
    s16,
    s17,
    s18,
    endState,
  };
}

/** The alpha definition of the golden world (imported for definition-level assertions). */
export { alphaWorldDefinition };
