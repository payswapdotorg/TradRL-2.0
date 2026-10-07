/**
 * World Protocol port tests.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Ports" — the four canonical ports and their
 * exact method sets; ADR-003 — no engine-specific type may leak through the
 * ports; A4/A5 — every world implementation exposes exactly these ports.
 *
 * These tests pin method completeness (compile-time `keyof` equality with the
 * spec's method lists) and prove the ports are implementable using ONLY this
 * package's contract types.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  CommandPort,
  EvidencePort,
  QueryPort,
  ClockPort,
  WorldProtocol,
} from "../src/ports.js";
import type { WorldEventEnvelope } from "../src/events.js";
import type { SnapshotDescriptor, WorldMeta } from "../src/world.js";
import type { OrderBookSnapshot } from "../src/market.js";
import type { EventId, WorldId } from "../src/ids.js";
import { asId, asTimestamp } from "./helpers.js";
import type { Equal, Expect } from "./helpers.js";

// --- method completeness (compile-time, checked by typecheck) ---------------

type QueryPortMethods = keyof QueryPort;
type _queryExact = Expect<
  Equal<
    QueryPortMethods,
    | "getWorldMeta"
    | "getSnapshot"
    | "getInstrument"
    | "getQuote"
    | "getOrderBook"
    | "getTrades"
    | "getOrders"
    | "getPositions"
    | "getPortfolio"
    | "getRisk"
    | "getNews"
    | "getTimeline"
  >
>;

type CommandPortMethods = keyof CommandPort;
type _commandExact = Expect<
  Equal<
    CommandPortMethods,
    | "submitOrder"
    | "cancelOrder"
    | "replaceOrder"
    | "closePosition"
    | "addAnnotation"
    | "createSnapshot"
    | "branchWorld"
    | "setScenario"
  >
>;

type ClockPortMethods = keyof ClockPort;
type _clockExact = Expect<
  Equal<
    ClockPortMethods,
    | "play"
    | "pause"
    | "step"
    | "seek"
    | "jumpToEvent"
    | "setSpeed"
    | "followRealtime"
    | "getClock"
  >
>;

type EvidencePortMethods = keyof EvidencePort;
type _evidenceExact = Expect<
  Equal<
    EvidencePortMethods,
    | "getEvent"
    | "getEvents"
    | "getProvenance"
    | "getSnapshot"
    | "getBranchLineage"
    | "getInformationBoundary"
    | "getDeterminismManifest"
  >
>;

// The full protocol is exactly four ports.
type _protocolShape = Expect<
  Equal<keyof WorldProtocol, "query" | "command" | "clock" | "evidence">
>;

// --- a contract-only implementation proves no engine types leak through -------

function makeEnvelope(): WorldEventEnvelope {
  return {
    worldId: asId<WorldId>("world-1"),
    sequence: 1 as WorldEventEnvelope["sequence"],
    eventId: asId<EventId>("event-1"),
    eventType: "world.started",
    occurredAt: asTimestamp(0),
    causationId: "command-0" as WorldEventEnvelope["causationId"],
    correlationId: "flow-0" as WorldEventEnvelope["correlationId"],
    producer: "producer-engine" as WorldEventEnvelope["producer"],
    schemaVersion: "1",
    payload: {},
  };
}

const query: QueryPort = {
  async getWorldMeta(): Promise<WorldMeta> {
    return {
      worldId: asId<WorldId>("world-1"),
      scope: {
        tenantId: "tenant-1" as never,
        projectId: "project-1" as never,
        worldId: asId<WorldId>("world-1"),
      },
      mode: "exact-replay",
      executionAuthority: "simulated-only",
      engine: "test",
      engineVersion: "0",
      worldDefinitionVersion: "1",
      seed: "s",
      inputDataSource: "synthetic",
      knownLimitations: [],
      determinism: { kind: "deterministic" },
    };
  },
  async getSnapshot(): Promise<SnapshotDescriptor> {
    return {
      snapshotId: "snap-1" as never,
      worldId: asId<WorldId>("world-1"),
      createdAt: asTimestamp(0),
      journalCursor: 0 as SnapshotDescriptor["journalCursor"],
    };
  },
  async getInstrument() {
    return {
      instrumentId: "instr-1" as never,
      worldId: asId<WorldId>("world-1"),
      venueId: "venue-1" as never,
      symbol: "SIM.INDEX",
      assetClass: "future",
      quoteCurrency: "USD" as never,
      tickSize: "0.25" as never,
      lotSize: "1" as never,
      pricePrecision: 2,
      quantityPrecision: 0,
      tradingState: "open",
      tradable: true,
    };
  },
  async getQuote(instrumentId) {
    return { instrumentId, asOf: asTimestamp(0) };
  },
  async getOrderBook(instrumentId): Promise<OrderBookSnapshot> {
    return {
      instrumentId,
      asOf: asTimestamp(0),
      sequence: 0 as OrderBookSnapshot["sequence"],
      bids: [],
      asks: [],
    };
  },
  async getTrades() {
    return [];
  },
  async getOrders() {
    return [];
  },
  async getPositions() {
    return [];
  },
  async getPortfolio() {
    return {
      accountId: "account-1" as never,
      worldId: asId<WorldId>("world-1"),
      positions: [],
      cash: { amount: "0" as never, currency: "USD" as never },
      buyingPower: { amount: "0" as never, currency: "USD" as never },
      realizedPnl: { amount: "0" as never, currency: "USD" as never },
      unrealizedPnl: { amount: "0" as never, currency: "USD" as never },
      equity: { amount: "0" as never, currency: "USD" as never },
      asOf: asTimestamp(0),
    };
  },
  async getRisk() {
    return {
      accountId: "account-1" as never,
      worldId: asId<WorldId>("world-1"),
      limits: {},
      breaches: [],
      asOf: asTimestamp(0),
    };
  },
  async getNews() {
    return [];
  },
  async getTimeline() {
    return { from: asTimestamp(0), to: asTimestamp(0), events: [], hasMore: false };
  },
};

const command: CommandPort = {
  async submitOrder() {
    return { status: "rejected", rejection: { stage: "authorize", code: "permission-denied", message: "stub" } };
  },
  async cancelOrder() {
    return { status: "rejected", rejection: { stage: "validate", code: "unknown-order", message: "stub" } };
  },
  async replaceOrder() {
    return { status: "rejected", rejection: { stage: "validate", code: "unknown-order", message: "stub" } };
  },
  async closePosition() {
    return { status: "rejected", rejection: { stage: "validate", code: "unknown-instrument", message: "stub" } };
  },
  async addAnnotation() {
    return { status: "rejected", rejection: { stage: "validate", code: "malformed-command", message: "stub" } };
  },
  async createSnapshot() {
    return { status: "rejected", rejection: { stage: "validate", code: "malformed-command", message: "stub" } };
  },
  async branchWorld() {
    return { status: "rejected", rejection: { stage: "validate", code: "malformed-command", message: "stub" } };
  },
  async setScenario() {
    return { status: "rejected", rejection: { stage: "validate", code: "malformed-command", message: "stub" } };
  },
};

const clock: ClockPort = {
  async play() {},
  async pause() {},
  async step() {},
  async seek() {},
  async jumpToEvent() {},
  async setSpeed() {},
  async followRealtime() {},
  async getClock() {
    return { simulationTime: asTimestamp(0), status: "paused", speed: 1, followingRealtime: false };
  },
};

const evidence: EvidencePort = {
  async getEvent() {
    return makeEnvelope();
  },
  async getEvents() {
    return [makeEnvelope()];
  },
  async getProvenance() {
    return undefined;
  },
  async getSnapshot() {
    return undefined;
  },
  async getBranchLineage() {
    return [];
  },
  async getInformationBoundary() {
    return { asOf: asTimestamp(0), visible: [], withheld: [] };
  },
  async getDeterminismManifest() {
    return {
      worldDefinitionVersion: "1",
      engine: "test",
      engineVersion: "0",
      seed: "s",
      inputHashes: {},
      dependencyVersions: {},
      commandStreamHash: "sha256:none",
    };
  },
};

const protocol: WorldProtocol = { query, command, clock, evidence };

// --- runtime checks -------------------------------------------------------------

test("the four ports compose into the World Protocol", () => {
  assert.equal(protocol.query, query);
  assert.equal(protocol.command, command);
  assert.equal(protocol.clock, clock);
  assert.equal(protocol.evidence, evidence);
});

test("ports are implementable using only contract types (no engine leak)", async () => {
  const meta = await protocol.query.getWorldMeta();
  assert.equal(meta.executionAuthority, "simulated-only");
  const view = await protocol.clock.getClock();
  assert.equal(view.status, "paused");
  const event = await protocol.evidence.getEvent(asId<EventId>("event-1"));
  assert.equal(event?.eventType, "world.started");
  const timeline = await protocol.query.getTimeline();
  assert.equal(timeline.hasMore, false);
});

test("clock methods cover the acceptance E control set", async () => {
  await protocol.clock.play();
  await protocol.clock.pause();
  await protocol.clock.step(1_000);
  await protocol.clock.seek(asTimestamp(2_000));
  await protocol.clock.jumpToEvent(asId<EventId>("event-1"));
  await protocol.clock.setSpeed(2);
  await protocol.clock.followRealtime(true);
  const view = await protocol.clock.getClock();
  assert.ok(typeof view.simulationTime === "number");
});
