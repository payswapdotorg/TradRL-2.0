/**
 * The shared reference runtime of the W023 suite (suite helper, not a test
 * file): the calibrated agent configuration (every threshold declared), the
 * disciplined drive (step + settle), the attach helper and the spy client —
 * the goldenJourneyContext-style harness of this package.
 */

import type { EngineWorldClient } from "../../ui/src/trading-world/runtime/engineWorldClient.js";
import { attachAgentWorld, fixedWallSource } from "./helpers.js";
import { createParticipantRuntime } from "../src/runtime.js";
import { createMomentumAgent } from "../src/agents/momentum.js";
import { createMeanReversionAgent } from "../src/agents/meanReversion.js";
import type { ReactiveParticipantWorldClient } from "../../tradrl-world-contracts/src/participantProtocol.js";

/** The calibrated reference configuration (every threshold declared). */
export function referenceAgents(worldId: string) {
  const instrument = `instrument-es-${worldId}` as never;
  const account = `account-agents-${worldId}` as never;
  const momentum = createMomentumAgent({
    agentId: "momentum",
    participantId: `participant-agent-momentum-${worldId}` as never,
    accountId: account,
    instrumentId: instrument,
    seed: "w023-reference-momentum",
    lookbackTrades: 8,
    thresholdTicks: 4,
    baseLots: 2,
    jitterLots: 2,
    maxPositionLots: 6,
    cooldownMs: 4000,
  });
  const meanReversion = createMeanReversionAgent({
    agentId: "mean-reversion",
    participantId: `participant-agent-mr-${worldId}` as never,
    accountId: account,
    instrumentId: instrument,
    referenceTrades: 10,
    entryDeviationTicks: 3,
    exitDeviationTicks: 1,
    quoteOffsetTicks: 2,
    quoteLots: 1,
    maxPositionLots: 6,
    maxWorkingQuotes: 2,
  });
  return { momentum, meanReversion, instrument, account };
}

/** The disciplined drive: N × 5s steps with settle after each. */
export const DRIVE_STEPS = 24;
export const DRIVE_STEP_MS = 5_000;

/** The reference runtime over a fresh agent-world attachment. */
export async function attachReferenceRuntime(
  worldId: string,
  wallAt: number = 1_700_000_500_000,
): Promise<{
  readonly client: EngineWorldClient;
  readonly runtime: ReturnType<typeof createParticipantRuntime>;
}> {
  const client = await attachAgentWorld(worldId, { wallTimeSource: fixedWallSource(wallAt) });
  const { momentum, meanReversion, instrument, account } = referenceAgents(worldId);
  const runtime = createParticipantRuntime({
    client,
    agents: [momentum, meanReversion],
    views: { instruments: [instrument], accountId: account, tradeWindowMs: 30_000 },
  });
  return { client, runtime };
}

/** Drive the disciplined journey: one step, one settle, N times. */
export async function driveJourney(
  client: EngineWorldClient,
  runtime: ReturnType<typeof createParticipantRuntime>,
  steps: number = DRIVE_STEPS,
): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await client.clock.step(DRIVE_STEP_MS);
    await runtime.settle();
  }
}

/** A recording wrapper: every port call the runtime makes, in wire order. */
export function spyClient(client: EngineWorldClient): {
  readonly client: ReactiveParticipantWorldClient;
  readonly calls: { readonly port: string; readonly method: string; readonly args: readonly unknown[] }[];
} {
  const calls: { port: string; method: string; args: readonly unknown[] }[] = [];
  const record =
    (port: string, method: string) =>
    (...args: unknown[]) => {
      calls.push({ port, method, args });
      const ports = client as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;
      const target = ports[port]![method] as (...a: unknown[]) => unknown;
      return target.apply(ports[port], args);
    };
  const wrapped: ReactiveParticipantWorldClient = {
    worldId: client.worldId,
    query: {
      getInstrument: record("query", "getInstrument") as never,
      getQuote: record("query", "getQuote") as never,
      getOrderBook: record("query", "getOrderBook") as never,
      getTrades: record("query", "getTrades") as never,
      getPortfolio: record("query", "getPortfolio") as never,
      getRisk: record("query", "getRisk") as never,
      getOrders: record("query", "getOrders") as never,
      getNews: record("query", "getNews") as never,
    } as never,
    command: {
      submitOrder: record("command", "submitOrder") as never,
      cancelOrder: record("command", "cancelOrder") as never,
      replaceOrder: record("command", "replaceOrder") as never,
      closePosition: record("command", "closePosition") as never,
    } as never,
    clock: {
      getClock: record("clock", "getClock") as never,
      step: record("clock", "step") as never,
      pause: record("clock", "pause") as never,
      play: record("clock", "play") as never,
      seek: record("clock", "seek") as never,
    } as never,
    onClock(listener) {
      return client.onClock(listener);
    },
  };
  return { client: wrapped, calls };
}
