/**
 * THE W019 HONEST-STATE JOURNEYS — part 3 of the World Alpha golden
 * integration suite: the composed product stays honest when things go wrong
 * or do not exist.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md H ("an artifact whose availableAt is
 * after current simulation time must not be observable"), K ("persistent
 * SIMULATED disclosure; no broker credentials; no live execution command"),
 * G/E (the A8 rewind-requires-branch rejection SURFACED through the real
 * clock surface), plus the WORLD-PROTOCOL fail-closed law (a dead transport
 * never yields stale/fabricated projections — ARCHITECTURE-LOCK A6) and the
 * typed-error discipline (unknown entities surface as TYPED errors, engine
 * rejections as VALUES).
 *
 * Journeys:
 * 1. A7 information firewall — a fill's trade print is withheld from the
 *    tape/timeline until the clock passes its availableAt (venue latency).
 * 2. Transport death (in-process AND a REAL worker thread killed mid-seek)
 *    fails closed: the pending call rejects typed, future calls reject
 *    typed, the live surface controllers degrade to honest error states.
 * 3. Unknown entities + unlawful commands surface as typed errors/rejections
 *    (never fabricated values).
 * 4. The A8 backward move refusal, surfaced through the REAL W012 clock
 *    surface controller (visible typed outcome, clock unmoved).
 * 5. The SIMULATED disclosure is present in EVERY composed tool surface
 *    (the real `tradingWorldSurfaceRegistry` — the shell's own composition
 *    point) in both the unattached teaching states and the attached loading
 *    states, plus the pane chrome; World Alpha declares no live authority.
 *
 * Run (repo root): node_modules/.bin/tsx --test tests/trading-world/*.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import * as ReactDOMServer from "react-dom/server";

import {
  alphaWorldDefinition,
  createAlphaEngineTransport,
} from "../../packages/ui/src/trading-world/runtime/engineAttachment.js";
import {
  attachEngineWorldClient,
  TradingWorldRemoteError,
  TradingWorldTransportClosedError,
} from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";
import type { EngineWorldClient } from "../../packages/ui/src/trading-world/runtime/engineWorldClient.js";
import {
  createSimulatedNoopWorldClient,
  TradingWorldClientContext,
} from "../../packages/ui/src/trading-world/runtime/worldClient.js";
import { tradingWorldSurfaceRegistry } from "../../packages/ui/src/trading-world/surfaces.js";
import type { TradingWorldToolSurfaceProps } from "../../packages/ui/src/trading-world/registry/toolRegistry.js";
import { TRADING_WORLD_SIMULATED_DISCLOSURE } from "../../packages/ui/src/trading-world/components/PlaceholderToolSurface.js";
import { TradingWorldSidePane } from "../../packages/ui/src/app-shell/TradingWorldSidePane.js";
import {
  openTradingWorldSidePane,
  type TradingWorldSidePaneTab,
} from "../../packages/ui/src/lib/workspaceSidePane.js";
import { createWatchlistProjectionController } from "../../packages/ui/src/trading-world/market/watchlistProjection.js";
import { createClockTimelineProjectionController } from "../../packages/ui/src/trading-world/simulation/clockTimelineProjection.js";
import { SIM_START } from "./goldenJourney.helpers.js";
import { attachRun, workerTransport } from "./workerFixture.helpers.js";

const SIM_TEN_SECONDS = SIM_START + 10_000;

/**
 * Bounded wait for the clock surface's typed outcome capsule (the W012
 * pattern: the outcome lands on the snapshot through the controller's
 * settled refresh — never a hang, never a stale read).
 */
async function untilOutcome(
  controller: ReturnType<typeof createClockTimelineProjectionController>,
  kind: "acked" | "rejected",
  labelMatch?: string,
): Promise<ReturnType<ReturnType<typeof createClockTimelineProjectionController>["getSnapshot"]>> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const snapshot = controller.getSnapshot() as {
      status: string;
      outcome?: { kind?: string; label?: string };
    };
    if (
      snapshot.outcome !== undefined &&
      snapshot.outcome.kind === kind &&
      (labelMatch === undefined || snapshot.outcome.label === labelMatch)
    ) {
      return controller.getSnapshot();
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return controller.getSnapshot();
}

/** Attach a fresh honest-state world (each journey gets its own seed). */
async function attachHonest(worldId: string): Promise<EngineWorldClient> {
  return attachEngineWorldClient({
    transport: createAlphaEngineTransport(worldId),
    expectedWorldId: worldId,
  });
}

const ORDER_BASE = (worldId: string) => ({
  worldId: worldId as never,
  issuedBy: `participant-trader-${worldId}` as never,
  accountId: `account-trader-${worldId}` as never,
  instrumentId: `instrument-es-${worldId}` as never,
});

test("H: the information firewall — a fill's print is withheld until availableAt passes", async () => {
  const WORLD = "world-w019-honest-a7";
  const client = await attachHonest(WORLD);
  try {
    await client.clock.step(10_000);
    const quote = await client.query.getQuote(`instrument-es-${WORLD}` as never);
    const tradesBefore = await client.query.getTrades(`instrument-es-${WORLD}` as never);
    const fillsBefore = await client.query.getTimeline({ types: ["matching.order.filled"] });

    // A marketable buy fills NOW (the ack carries the fill events).
    const ack = await client.command.submitOrder({
      kind: "submit-order",
      commandId: "a7-buy" as never,
      ...ORDER_BASE(WORLD),
      issuedAt: SIM_TEN_SECONDS as never,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "1",
        limitPrice: quote.ask as never,
        constraints: { timeInForce: "GTC" },
      },
    } as never);
    assert.equal((ack as { status?: string }).status, "acked");
    const positions = await client.query.getPositions(ORDER_BASE(WORLD).accountId);
    assert.equal(positions.length, 1, "the position projection is current state");

    // …but the TAPE and the journal timeline still hide the new print: the
    // venue's fill propagation (ack 250ms + fill 500ms) is ahead of the clock.
    const tradesAtFill = await client.query.getTrades(`instrument-es-${WORLD}` as never);
    assert.equal(
      tradesAtFill.length,
      tradesBefore.length,
      "the trade print is NOT observable before its availableAt (A7)",
    );
    const fillsAtFill = await client.query.getTimeline({ types: ["matching.order.filled"] });
    assert.equal(
      fillsAtFill.events.length,
      fillsBefore.events.length,
      "the fill event is NOT observable on the timeline before its availableAt (A7)",
    );

    // The clock passes availableAt (+750ms): the print and the fill appear.
    await client.clock.step(800);
    const tradesAfter = await client.query.getTrades(`instrument-es-${WORLD}` as never);
    assert.equal(
      tradesAfter.length,
      tradesBefore.length + 1,
      "the print becomes observable once the clock passes availableAt",
    );
    const fillsAfter = await client.query.getTimeline({ types: ["matching.order.filled"] });
    assert.ok(
      fillsAfter.events.length > fillsBefore.events.length,
      "the fill event becomes observable once the clock passes availableAt",
    );
  } finally {
    client.dispose();
  }
});

test("fail-closed: in-process transport death rejects pending + future calls and degrades the live surfaces", async () => {
  const WORLD = "world-w019-honest-death";
  const run = await attachRun(createAlphaEngineTransport(WORLD), WORLD);
  const { client } = run;
  try {
    await client.clock.step(10_000);
    // The live surfaces are READY before the death.
    const watchlist = createWatchlistProjectionController({
      client,
      instrumentIds: [`instrument-es-${WORLD}` as never],
      discoveryEnabled: false,
      pollMs: 0,
    });
    const clockSurface = createClockTimelineProjectionController({ client, pollMs: 0 });
    watchlist.start();
    clockSurface.start();
    await watchlist.refresh();
    await clockSurface.refresh();
    assert.equal(watchlist.getSnapshot().status, "ready");
    assert.equal(clockSurface.getSnapshot().status, "ready");

    // Kill the transport with a raw seek AND a surface-issued seek in flight:
    // both were posted, neither response has arrived (same tick) — the
    // provider must fail BOTH closed, typed.
    const pendingRawSeek = client.clock.seek((SIM_START + 30 * 60_000) as never);
    const pendingSurfaceSeek = clockSurface.seek((SIM_START + 25 * 60_000) as never);
    client.dispose();
    await assert.rejects(pendingRawSeek, (error: unknown) => {
      assert.ok(
        error instanceof TradingWorldTransportClosedError ||
          (error instanceof Error && error.name === "TradingWorldTransportClosedError"),
        `the in-flight raw call rejects typed (got ${String(error)})`,
      );
      return true;
    });
    await pendingSurfaceSeek; // the surface owns its failure (asserted below)
    // The clock surface failed the WHOLE snapshot closed — never a stale
    // live-looking clock (the W012 fail-closed law).
    const clockSnapshot = clockSurface.getSnapshot();
    assert.equal(clockSnapshot.status, "error");
    assert.match((clockSnapshot as { message?: string }).message ?? "", /transport is closed/i);

    // Future calls over the dead transport reject typed too.
    await assert.rejects(
      client.query.getQuote(`instrument-es-${WORLD}` as never),
      (error: unknown) => {
        assert.equal((error as Error).name, "TradingWorldTransportClosedError");
        return true;
      },
    );
    // And the watchlist degrades on its next refresh (its fetch fails) —
    // it never keeps rendering stale rows as if they were live.
    await watchlist.refresh();
    const watchlistSnapshot = watchlist.getSnapshot();
    assert.equal(watchlistSnapshot.status, "error");
    assert.match((watchlistSnapshot as { message?: string }).message ?? "", /transport is closed/i);
    watchlist.stop();
    clockSurface.stop();
  } finally {
    client.dispose();
  }
});

test("fail-closed: a REAL worker thread killed mid-seek fails closed across the wire", async () => {
  const WORLD = "world-w019-honest-worker-death";
  const { transport, worker } = await workerTransport(WORLD);
  const run = await attachRun(transport, WORLD);
  try {
    await run.client.clock.step(10_000);
    // A long seek is in flight when the thread dies — the pending call must
    // reject typed (the close listener fires on worker exit).
    const pendingSeek = run.client.clock.seek((SIM_START + 20 * 60_000) as never);
    await worker.terminate();
    await assert.rejects(pendingSeek, (error: unknown) => {
      assert.equal(
        (error as Error).name,
        "TradingWorldTransportClosedError",
        "the in-flight call over the dead worker rejects fail-closed",
      );
      return true;
    });
    await assert.rejects(
      run.client.query.getWorldMeta(),
      (error: unknown) => {
        assert.equal((error as Error).name, "TradingWorldTransportClosedError");
        return true;
      },
      "future calls over the dead worker reject fail-closed",
    );
  } finally {
    run.client.dispose();
    await worker.terminate();
  }
});

test("typed errors: unknown entities are TYPED remote errors, unlawful commands are typed rejection VALUES", async () => {
  const WORLD = "world-w019-honest-typed";
  const client = await attachHonest(WORLD);
  try {
    await client.clock.step(10_000);

    // Unknown instrument: the engine's UnknownWorldEntityError crosses the
    // wire as a TradingWorldRemoteError preserving the typed extras.
    await assert.rejects(
      client.query.getQuote("instrument-nope" as never),
      (error: unknown) => {
        assert.ok(error instanceof TradingWorldRemoteError);
        assert.equal(error.remoteName, "UnknownWorldEntityError");
        assert.deepEqual(error.remoteData, { kind: "instrument", id: "instrument-nope" });
        return true;
      },
    );
    // Unknown account, same typed class.
    await assert.rejects(
      client.query.getPositions("account-nope" as never),
      (error: unknown) => {
        assert.ok(error instanceof TradingWorldRemoteError);
        assert.equal(error.remoteName, "UnknownWorldEntityError");
        return true;
      },
    );

    // Unlawful commands come back as typed rejection VALUES (never thrown) —
    // the typed stage+code is the assertion (the message text is engine-owned).
    const rejectionKind = (value: unknown): { stage?: string; code?: string } | undefined => {
      const rejection = (value as { rejection?: { stage?: string; code?: string } }).rejection;
      return rejection === undefined ? undefined : { stage: rejection.stage, code: rejection.code };
    };
    const t = SIM_TEN_SECONDS as never;
    const invalidTick = await client.command.submitOrder({
      kind: "submit-order",
      commandId: "typed-invalid-tick" as never,
      ...ORDER_BASE(WORLD),
      issuedAt: t,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "1",
        limitPrice: "4800.13" as never,
        constraints: { timeInForce: "GTC" },
      },
    } as never);
    assert.deepEqual(rejectionKind(invalidTick), { stage: "domain-rules", code: "invalid-price" });

    const quote = await client.query.getQuote(`instrument-es-${WORLD}` as never);
    const acked = await client.command.submitOrder({
      kind: "submit-order",
      commandId: "typed-dup" as never,
      ...ORDER_BASE(WORLD),
      issuedAt: t,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "1",
        limitPrice: quote.ask as never,
        constraints: { timeInForce: "GTC" },
      },
    } as never);
    assert.equal((acked as { status?: string }).status, "acked");
    const duplicate = await client.command.submitOrder({
      kind: "submit-order",
      commandId: "typed-dup" as never,
      ...ORDER_BASE(WORLD),
      issuedAt: t,
      submission: {
        kind: "limit",
        side: "buy",
        quantity: "1",
        limitPrice: quote.ask as never,
        constraints: { timeInForce: "GTC" },
      },
    } as never);
    assert.deepEqual(rejectionKind(duplicate), { stage: "validate", code: "duplicate-command" });

    // Unknown participant: rejected at the engine's validate stage (the
    // reference-integrity stage — validate → authorize → domain-rules).
    const ghost = await client.command.addAnnotation({
      kind: "add-annotation",
      commandId: "typed-ghost" as never,
      worldId: WORLD as never,
      issuedBy: "participant-ghost" as never,
      issuedAt: t,
      at: t,
      text: "ghost",
    } as never);
    assert.deepEqual(rejectionKind(ghost), { stage: "validate", code: "unknown-participant" });
  } finally {
    client.dispose();
  }
});

test("A8 surfaced: the clock surface shows the rewind-requires-branch refusal, verbatim and unmoved", async () => {
  const WORLD = "world-w019-honest-a8";
  const client = await attachHonest(WORLD);
  try {
    // Advance past the origin so a backward target exists.
    await client.clock.step(10_000);
    await client.clock.seek((SIM_START + 60_000) as never);
    const before = await client.clock.getClock();

    // The REAL W012 clock surface controller issues the backward seek and
    // must SURFACE the engine's typed refusal (never swallow it). The typed
    // outcome lands on the snapshot through the controller's settled refresh
    // (the W012 pattern: bounded polling, never a hang).
    const clockSurface = createClockTimelineProjectionController({ client, pollMs: 0 });
    clockSurface.start();
    await clockSurface.refresh();
    await clockSurface.seek(SIM_TEN_SECONDS);
    const snapshot = await untilOutcome(clockSurface, "rejected");
    assert.equal(snapshot.status, "ready", "the surface stays READY — a refusal is not a failure");
    const outcome = (snapshot as { outcome?: { kind?: string; rejection?: { code?: string; message?: string } } }).outcome;
    assert.equal(outcome?.kind, "rejected");
    assert.equal(outcome?.rejection?.code, "rewind-requires-branch");
    assert.equal(
      outcome?.rejection?.message,
      "in-place backward move to 1700000010000 is refused: rewind creates a branch from an immutable snapshot (ARCHITECTURE-LOCK A8)",
    );

    // The backward JUMP is refused with the same typed code.
    await clockSurface.jumpToEvent(1);
    const jumpSnapshot = await untilOutcome(clockSurface, "rejected", "jump to event #1");
    const jumpOutcome = (jumpSnapshot as { outcome?: { rejection?: { code?: string } } }).outcome;
    assert.equal(jumpOutcome?.rejection?.code, "rewind-requires-branch");

    // And the engine's clock did not move: history is immutable (A8).
    const after = await client.clock.getClock();
    assert.equal(after.simulationTime, before.simulationTime);
    assert.equal((jumpSnapshot as { clock?: { simulationTime?: number } }).clock?.simulationTime, before.simulationTime);
    clockSurface.stop();
  } finally {
    client.dispose();
  }
});

test("K: the SIMULATED disclosure is present in EVERY composed tool surface, and World Alpha has no live authority", async () => {
  // The REAL composed registry — exactly what TradingWorldShell mounts.
  const descriptors = tradingWorldSurfaceRegistry.listTools();
  assert.ok(descriptors.length >= 11, `the composed registry carries every W006 tool slot (got ${String(descriptors.length)})`);

  const render = (surface: (props: TradingWorldToolSurfaceProps) => ReactElement, clientValue: ReturnType<typeof createSimulatedNoopWorldClient> | EngineWorldClient): string =>
    ReactDOMServer.renderToStaticMarkup(
      createElement(
        TradingWorldClientContext.Provider,
        { value: clientValue },
        createElement(surface, {
          toolId: "probe",
          worldId: "world-w019-disclosure",
          layoutProfileId: "default",
          active: true,
          phase: "mounted-focused",
          onRequestClose: () => {},
        } satisfies TradingWorldToolSurfaceProps),
      ),
    );

  // 1) The unattached (teaching) states: every real surface discloses.
  const noop = createSimulatedNoopWorldClient("world-w019-disclosure");
  for (const descriptor of descriptors) {
    const markup = render(descriptor.surface, noop);
    assert.ok(
      markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE),
      `the ${String(descriptor.id)} surface discloses SIMULATED in its unattached state`,
    );
  }

  // 2) The attached (loading) states: disclosure persists with a live client.
  const WORLD = "world-w019-honest-disclosure";
  const attached = await attachHonest(WORLD);
  try {
    for (const descriptor of descriptors) {
      const markup = render(descriptor.surface, attached);
      assert.ok(
        markup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE),
        `the ${String(descriptor.id)} surface discloses SIMULATED in its attached state`,
      );
    }

    // 3) The world declares simulated-only authority; the definition's every
    //    account denies live execution (K: no live execution command).
    const meta = (await attached.query.getWorldMeta()) as { executionAuthority?: string; mode?: string };
    assert.equal(meta.executionAuthority, "simulated-only");
    assert.equal(meta.mode, "reactive-replay");
    const definition = alphaWorldDefinition(WORLD);
    for (const account of definition.accounts) {
      assert.equal(
        account.permissions.liveExecutionAllowed,
        false,
        `account ${String(account.accountId)} carries no live execution authority`,
      );
    }
    // The CommandPort surface is the closed World Alpha set — no live
    // execution command exists on the wire.
    assert.deepEqual(Object.keys(attached.command).sort(), [
      "addAnnotation",
      "branchWorld",
      "cancelOrder",
      "closePosition",
      "createSnapshot",
      "replaceOrder",
      "setScenario",
      "submitOrder",
    ]);
  } finally {
    attached.dispose();
  }

  // 4) The pane chrome discloses too (the W005 pane around the cockpit).
  const state = openTradingWorldSidePane(null, {
    workspaceKey: "/ws/w019",
    worldId: "world-w019-disclosure",
    layoutProfileId: "default",
  });
  const tab = state.tabs[0] as TradingWorldSidePaneTab;
  const paneMarkup = ReactDOMServer.renderToStaticMarkup(
    createElement(TradingWorldSidePane, { tab, visible: true, focused: true, onClose: () => {} }),
  );
  assert.ok(paneMarkup.includes(TRADING_WORLD_SIMULATED_DISCLOSURE));
  assert.ok(paneMarkup.includes('data-trading-world-simulation-disclosure=""'));
});
