/**
 * Tests for the headless engine and its four ports (W013 `world` module).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Ports" + "Command lifecycle" + "Event
 * envelope"; spec/ARCHITECTURE-LOCK.md A5 (four ports), A6 (event-driven
 * truth), A7 (information firewall at the observation boundary),
 * spec/ACCEPTANCE-WORLD-ALPHA.md E/L and the stub boundary matrix.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { EventId, TimestampMs } from "tradrl-world-contracts";
import { ClockRejectionError } from "../../clock/index.js";
import {
  createEventJournal,
  createEventJournalFromRecords,
} from "../../journal/index.js";
import {
  ENGINE_ID,
  ENGINE_VERSION,
  EngineInvariantError,
  NotImplementedInSkeletonError,
  UnknownWorldEntityError,
  createHeadlessWorldEngine,
  type HeadlessWorldEngine,
} from "../index.js";
import {
  INSTRUMENT,
  START,
  TRADER,
  WORLD,
  addAnnotationCommand,
  fixedWallTimeSource,
  setScenarioCommand,
  submitOrderCommand,
  testDefinition,
} from "./helpers.js";

function engine(
  overrides: Partial<Parameters<typeof createHeadlessWorldEngine>[0]> = {},
) {
  return createHeadlessWorldEngine({
    wallTimeSource: fixedWallTimeSource(),
    ...overrides,
    definition: overrides.definition ?? testDefinition(),
  });
}

test("a fresh engine starts at the clock origin with the initial state", async () => {
  const e = engine();
  assert.equal(e.worldId, WORLD);
  assert.equal(e.clockState().simulationTime, START);
  assert.equal(e.clockState().status, "paused");
  assert.equal(e.journal.size(), 0);
  assert.deepEqual(e.worldState().annotations, []);
  const meta = await e.query.getWorldMeta();
  assert.equal(meta.engine, ENGINE_ID);
  assert.equal(meta.engineVersion, ENGINE_VERSION);
});

test("addAnnotation runs the full lifecycle: ack, event, journal, state", async () => {
  const e = engine();
  const command = addAnnotationCommand({ at: (START + 500) as TimestampMs });
  const result = await e.command.addAnnotation(command);
  assert.equal(result.status, "acked");
  if (result.status !== "acked") return;
  assert.equal(result.ack.commandId, command.commandId);
  assert.equal(result.ack.acceptedAt, START, "acceptedAt is simulation time");
  assert.equal(result.ack.journalCursor, 1);
  const eventId = result.ack.resultingEventIds[0] as EventId;
  assert.equal(String(eventId), "evt:world-w013-tests:1");

  assert.equal(e.journal.size(), 1);
  const state = e.worldState();
  assert.equal(state.annotations.length, 1);
  assert.deepEqual(state.annotations[0], {
    annotationId: "ann:world-w013-tests:1",
    issuedBy: TRADER,
    at: START + 500,
    text: "golden region start",
    addedAt: START,
  });

  const record = e.journal.getRecordByEventId(eventId);
  assert.equal(record?.envelope.eventType, "world.annotation.added");
  assert.equal(record?.envelope.occurredAt, START);
  assert.equal(record?.envelope.causationId, command.commandId);
  assert.equal(record?.envelope.correlationId, command.commandId);
  assert.equal(record?.envelope.producer, "world-core");
  assert.equal(record?.envelope.schemaVersion, "tradrl-world-sim.events@1");
});

test("setScenario updates the scenario in force and the world meta", async () => {
  const e = engine();
  const result = await e.command.setScenario(setScenarioCommand());
  assert.equal(result.status, "acked");
  assert.equal(e.worldState().currentScenario?.label, "stress test");
  const meta = await e.query.getWorldMeta();
  assert.equal(meta.regimeSchedule?.[0]?.regime, "high-volatility");
});

test("the clock stamps emitted events (occurredAt follows the simulation axis)", async () => {
  const e = engine();
  await e.clock.step(25_000);
  const result = await e.command.addAnnotation(addAnnotationCommand());
  assert.equal(result.status, "acked");
  const record = e.journal.records()[0];
  assert.equal(record?.envelope.occurredAt, START + 25_000);
  assert.equal(e.worldState().annotations[0]?.addedAt, START + 25_000);
});

test("stub boundary through the port: submit-order rejects not-implemented-in-skeleton", async () => {
  const e = engine();
  const result = await e.command.submitOrder(submitOrderCommand());
  assert.deepEqual(result, {
    status: "rejected",
    rejection: {
      stage: "domain-rules",
      code: "not-implemented-in-skeleton",
      message:
        "submit-order: requires the matching engine (W014: packages/tradrl-world-sim/matching) " +
        "and account/risk gating (W015: packages/tradrl-world-sim/account, risk); " +
        "the W013 skeleton implements the command lifecycle, not the domain rules",
    },
  });
  assert.equal(e.journal.size(), 0, "rejected commands journal nothing");
});

test("validation and authorization rejections carry their stage through the port", async () => {
  const e = engine();
  const unknownParticipant = await e.command.addAnnotation(
    addAnnotationCommand({ issuedBy: "participant-ghost" as never }),
  );
  assert.deepEqual(
    unknownParticipant.status === "rejected" && unknownParticipant.rejection,
    { stage: "validate", code: "unknown-participant", message: unknownParticipant.status === "rejected" ? unknownParticipant.rejection.message : "" },
  );

  const denied = await e.command.submitOrder(
    submitOrderCommand({ accountId: "account-other" as never }),
  );
  assert.equal(denied.status === "rejected" && denied.rejection.stage, "authorize");
  assert.equal(denied.status === "rejected" && denied.rejection.code, "permission-denied");
});

test("an acked command id is refused as duplicate; rejected ids stay free", async () => {
  const e = engine();
  const command = addAnnotationCommand();
  assert.equal((await e.command.addAnnotation(command)).status, "acked");
  const duplicate = await e.command.addAnnotation(command);
  assert.deepEqual(
    duplicate.status === "rejected" && duplicate.rejection,
    {
      stage: "validate",
      code: "duplicate-command",
      message: "command cmd-annotation-1 was already acknowledged",
    },
  );

  // a rejected command does not consume its id: the same id with valid
  // fields still acks afterwards
  const badThenGood = addAnnotationCommand({ commandId: "cmd-retry-1" as never, text: "" });
  assert.equal((await e.command.addAnnotation(badThenGood)).status, "rejected");
  const retry = await e.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-retry-1" as never, text: "now valid" }),
  );
  assert.equal(retry.status, "acked");
});

test("QueryPort: instruments resolve; unknown ids are typed errors", async () => {
  const e = engine();
  const instrument = await e.query.getInstrument(INSTRUMENT);
  assert.equal(instrument.symbol, "ES-TEST");
  await assert.rejects(
    e.query.getInstrument("instrument-ghost" as never),
    (error: unknown) => {
      assert.ok(error instanceof UnknownWorldEntityError);
      assert.equal(error.kind, "instrument");
      return true;
    },
  );
});

test("QueryPort: orders and positions are honestly empty projections", async () => {
  const e = engine();
  assert.deepEqual(await e.query.getOrders(), []);
  assert.deepEqual(await e.query.getOrders({ instrumentId: INSTRUMENT }), []);
  assert.deepEqual(await e.query.getPositions(), []);
});

test("QueryPort: domain projections are typed not-implemented rejections", async () => {
  const e = engine();
  const expectations: [Promise<unknown>, string, string][] = [
    [e.query.getQuote(INSTRUMENT), "market-generator", "QueryPort.getQuote"],
    [e.query.getOrderBook(INSTRUMENT), "matching-orderbook", "QueryPort.getOrderBook"],
    [e.query.getTrades(INSTRUMENT), "matching-orderbook", "QueryPort.getTrades"],
    [e.query.getPortfolio(), "account-portfolio-risk", "QueryPort.getPortfolio"],
    [e.query.getRisk(), "account-portfolio-risk", "QueryPort.getRisk"],
    [e.query.getSnapshot(), "snapshot-branch", "QueryPort.getSnapshot"],
  ];
  for (const [promise, surface, operation] of expectations) {
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof NotImplementedInSkeletonError, operation);
      assert.equal(error.surface, surface);
      assert.equal(error.operation, operation);
      return true;
    });
  }
});

test("QueryPort.getNews applies the information firewall at the current simulation time (A7)", async () => {
  const e = engine();
  let news = await e.query.getNews();
  assert.deepEqual(
    news.map((item) => String(item.artifactId)),
    ["news-visible"],
    "news-future (availableAt later) is withheld",
  );
  await e.clock.seek((START + 60_000) as never);
  news = await e.query.getNews();
  assert.deepEqual(
    news.map((item) => String(item.artifactId)),
    ["news-visible", "news-future"],
  );
});

test("QueryPort.getTimeline serves observable journal events with paging", async () => {
  const e = engine();
  await e.clock.step(1_000);
  await e.command.addAnnotation(addAnnotationCommand({ commandId: "cmd-ann-a" as never }));
  await e.clock.step(1_000);
  await e.command.setScenario(setScenarioCommand({ commandId: "cmd-scn-a" as never }));

  const all = await e.query.getTimeline();
  assert.equal(all.events.length, 2);
  assert.equal(all.from, START + 1_000);
  assert.equal(all.to, START + 2_000);
  assert.equal(all.hasMore, false);

  const limited = await e.query.getTimeline({ limit: 1 });
  assert.equal(limited.events.length, 1);
  assert.equal(limited.hasMore, true);

  const typed = await e.query.getTimeline({ types: ["world.scenario.set"] });
  assert.equal(typed.events.length, 1);
  assert.equal(typed.events[0]?.eventType, "world.scenario.set");

  const windowed = await e.query.getTimeline({ from: (START + 1_500) as never });
  assert.deepEqual(
    windowed.events.map((event) => event.eventType),
    ["world.scenario.set"],
  );
});

test("EvidencePort: events, provenance, boundary, empty snapshot/lineage, manifest", async () => {
  const e = engine();
  const acked = await e.command.addAnnotation(addAnnotationCommand());
  assert.equal(acked.status, "acked");
  const eventId = acked.status === "acked" ? acked.ack.resultingEventIds[0]! : undefined;

  const found = await e.evidence.getEvent(eventId as never);
  assert.equal(found?.eventId, eventId);

  const provenance = await e.evidence.getProvenance(eventId as never);
  assert.deepEqual(provenance, {
    subjectEventId: eventId,
    producer: "world-core",
    inputs: [{ kind: "command", ref: "cmd-annotation-1" }],
    recordedAt: START,
  });

  assert.equal(await e.evidence.getEvent("evt:none" as never), undefined);
  assert.equal(await e.evidence.getSnapshot("snap-none" as never), undefined);
  assert.deepEqual(await e.evidence.getBranchLineage(), []);

  const boundary = await e.evidence.getInformationBoundary((START + 2_000) as never);
  assert.deepEqual(boundary, {
    asOf: START + 2_000,
    visible: ["news-visible" as never],
    withheld: ["news-future" as never],
  });
  const atStart = await e.evidence.getInformationBoundary(START as never);
  assert.deepEqual(atStart.visible, ["news-visible" as never]);

  const manifest = await e.evidence.getDeterminismManifest();
  assert.deepEqual(manifest, e.determinismManifest());
});

test("EvidencePort hides events whose availableAt is in the future (A7)", async () => {
  // A restored engine whose journal carries a delayed-availability event
  // (the pattern W017's delayed feeds will produce).
  const journal = createEventJournal(WORLD);
  journal.append([
    {
      eventType: "world.annotation.added",
      occurredAt: (START + 10_000) as never,
      availableAt: (START + 50_000) as never,
      causationId: "cmd-delayed" as never,
      correlationId: "corr-delayed" as never,
      producer: "world-core" as never,
      schemaVersion: "tradrl-world-sim.events@1",
      payload: {
        type: "world.annotation.added",
        annotationId: "ann:world-w013-tests:1",
        issuedBy: TRADER,
        at: START + 10_000,
        text: "delayed annotation",
      },
    },
  ]);
  const restored = createHeadlessWorldEngine({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(),
    restore: { journal },
  });
  // clock defaulted to the last event time: the event occurred but is not
  // observable yet — occurrence and observability are distinct (A7).
  assert.equal(restored.clockState().simulationTime, START + 10_000);
  assert.equal(restored.worldState().annotations.length, 1, "state was rebuilt by replay");
  assert.deepEqual(await restored.evidence.getEvents({}), []);
  assert.equal((await restored.query.getTimeline()).events.length, 0);
  const eventId = restored.journal.records()[0]?.envelope.eventId as EventId;
  assert.equal(await restored.evidence.getEvent(eventId), undefined);
  assert.equal(await restored.evidence.getProvenance(eventId), undefined);

  await restored.clock.seek((START + 50_000) as never);
  assert.equal((await restored.evidence.getEvents({})).length, 1);
  assert.equal((await restored.query.getTimeline()).events.length, 1);
});

test("clock port: operations work through the engine and rejections are typed", async () => {
  const e = engine();
  await e.clock.play();
  assert.equal((await e.clock.getClock()).status, "playing");
  await e.clock.step(5_000);
  await e.clock.setSpeed(2);
  assert.equal((await e.clock.getClock()).speed, 2);
  await e.clock.followRealtime(true);
  assert.equal((await e.clock.getClock()).followingRealtime, true);

  await assert.rejects(e.clock.step(-1), (error: unknown) => {
    assert.ok(error instanceof ClockRejectionError);
    assert.equal(error.rejection.code, "invalid-step-delta");
    return true;
  });
  await assert.rejects(e.clock.seek((START - 1) as never), (error: unknown) => {
    assert.ok(error instanceof ClockRejectionError);
    assert.equal(error.rejection.code, "seek-before-start");
    return true;
  });
  // A8: backward seek demands a branch
  await assert.rejects(e.clock.seek(START as never), (error: unknown) => {
    assert.ok(error instanceof ClockRejectionError);
    assert.equal(error.rejection.code, "rewind-requires-branch");
    return true;
  });
});

test("jumpToEvent: forward jumps land on the event time; backward jumps demand a branch (A8)", async () => {
  const e = engine();
  await e.clock.step(1_000);
  const acked = await e.command.addAnnotation(addAnnotationCommand());
  await e.clock.step(10_000);
  assert.equal(e.clockState().simulationTime, START + 11_000);
  const eventId = acked.status === "acked" ? acked.ack.resultingEventIds[0]! : undefined;
  await assert.rejects(e.clock.jumpToEvent(99 as never), ClockRejectionError);
  // the event happened at START+1_000: jumping to it from START+11_000 is a
  // rewind — refused in place, available through branching (W016)
  await assert.rejects(e.clock.jumpToEvent(eventId as never), (error: unknown) => {
    assert.ok(error instanceof ClockRejectionError);
    assert.equal(error.rejection.code, "rewind-requires-branch");
    return true;
  });

  // forward jumps are legal when the clock sits before a journaled event
  // (restored-journal replay: the clock is placed at the origin)
  const journal = createEventJournal(WORLD);
  journal.append([
    {
      eventType: "world.annotation.added",
      occurredAt: (START + 10_000) as never,
      causationId: "cmd-restored" as never,
      correlationId: "corr-restored" as never,
      producer: "world-core" as never,
      schemaVersion: "tradrl-world-sim.events@1",
      payload: {
        type: "world.annotation.added",
        annotationId: "ann:world-w013-tests:1",
        issuedBy: TRADER,
        at: START + 10_000,
        text: "restored",
      },
    },
  ]);
  const restored = createHeadlessWorldEngine({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(),
    restore: { journal, clockAt: (START + 1_000) as never },
  });
  await restored.clock.jumpToEvent(1 as never);
  assert.equal(restored.clockState().simulationTime, START + 10_000);
});

test("commands and clock operations serialize in arrival order", async () => {
  const e = engine();
  const first = e.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-first" as never, text: "first" }),
  );
  const step = e.clock.step(1_000);
  const second = e.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-second" as never, text: "second" }),
  );
  await Promise.all([first, step, second]);
  const annotations = e.worldState().annotations;
  assert.deepEqual(
    annotations.map((annotation) => annotation.text),
    ["first", "second"],
  );
  assert.equal(annotations[0]?.addedAt, START, "first event stamped before the step");
  assert.equal(annotations[1]?.addedAt, START + 1_000, "second event stamped after the step");
});

test("a rejected queued operation does not break the queue", async () => {
  const e = engine();
  const failing = e.command.submitOrder(submitOrderCommand());
  const succeeding = e.command.addAnnotation(addAnnotationCommand());
  assert.equal((await failing).status, "rejected");
  assert.equal((await succeeding).status, "acked");
});

test("the determinism manifest covers definition, engine, deps and the command stream", async () => {
  const e = engine();
  const empty = e.determinismManifest();
  assert.equal(empty.commandStreamHash.endsWith(":0"), true, "no commands hashed yet");
  assert.equal(empty.worldDefinitionVersion, "w013-test-def@1");
  assert.equal(empty.seed, "w013-test-seed");
  assert.equal(empty.engine, ENGINE_ID);
  assert.equal(empty.engineVersion, ENGINE_VERSION);
  assert.ok(empty.inputHashes["worldDefinition"]);
  assert.equal(empty.dependencyVersions["tradrl-world-contracts"], "0.1.0");

  await e.command.addAnnotation(addAnnotationCommand());
  const one = e.determinismManifest();
  assert.equal(one.commandStreamHash.endsWith(":1"), true);
  // rejected commands are part of the stream too
  await e.command.submitOrder(submitOrderCommand());
  const two = e.determinismManifest();
  assert.equal(two.commandStreamHash.endsWith(":2"), true);
  assert.notEqual(two.commandStreamHash, one.commandStreamHash);

  const otherDefinition = testDefinition({ seed: "w013-other-seed" });
  const other = createHeadlessWorldEngine({
    definition: otherDefinition,
    wallTimeSource: fixedWallTimeSource(),
  });
  assert.notEqual(
    other.determinismManifest().inputHashes["worldDefinition"],
    empty.inputHashes["worldDefinition"],
    "definition changes change the input hash",
  );
});

test("headlessReport reports the SIMULATION.md skeleton subset", async () => {
  const e = engine();
  await e.clock.step(42_000);
  await e.command.addAnnotation(addAnnotationCommand());
  await e.command.setScenario(setScenarioCommand());
  const report = e.headlessReport();
  const digest = e.journal.digest();
  assert.deepEqual(report, {
    worldId: WORLD,
    mode: "reactive-replay",
    seed: "w013-test-seed",
    finalSimulationTime: START + 42_000,
    eventCount: digest.eventCount,
    eventHash: digest.eventChecksum,
    branchLineage: [],
  });
  assert.equal(report.eventCount, 2);
});

test("restore: a fresh engine replaying the journal reproduces state and digest", async () => {
  const e = engine();
  await e.command.addAnnotation(addAnnotationCommand({ text: "alpha" }));
  await e.clock.step(1_000);
  await e.command.setScenario(setScenarioCommand());
  await e.command.submitOrder(submitOrderCommand()); // rejected — not journaled

  const restored = createHeadlessWorldEngine({
    definition: testDefinition(),
    wallTimeSource: fixedWallTimeSource(),
    restore: {
      journal: createEventJournalFromRecords({ worldId: WORLD, records: e.journal.records() }),
    },
  });
  assert.deepEqual(restored.journal.digest(), e.journal.digest());
  assert.equal(restored.journal.getCursor(), e.journal.getCursor());
  assert.deepEqual(
    {
      annotations: restored.worldState().annotations,
      scenario: restored.worldState().currentScenario,
    },
    {
      annotations: e.worldState().annotations,
      scenario: e.worldState().currentScenario,
    },
  );
  assert.equal(restored.clockState().simulationTime, START + 1_000, "clock at last event time");

  // duplicate law survives restore: the acked id is refused again
  const duplicate = await restored.command.addAnnotation(addAnnotationCommand());
  assert.equal(duplicate.status === "rejected" && duplicate.rejection.code, "duplicate-command");
  // the previously-rejected stub command rejects identically
  const stub = await restored.command.submitOrder(submitOrderCommand());
  assert.equal(stub.status === "rejected" && stub.rejection.code, "not-implemented-in-skeleton");
});

test("the reducer refuses unknown event types (corrupt/incompatible journals)", () => {
  const journal = createEventJournal(WORLD);
  journal.append([
    {
      eventType: "market.quote.updated",
      occurredAt: START as never,
      causationId: "cmd-foreign" as never,
      correlationId: "corr-foreign" as never,
      producer: "market-generator" as never,
      schemaVersion: "w017@1",
      payload: { type: "market.quote.updated" },
    },
  ]);
  assert.throws(
    () =>
      createHeadlessWorldEngine({
        definition: testDefinition(),
        wallTimeSource: fixedWallTimeSource(),
        restore: { journal },
      }),
    EngineInvariantError,
  );
});

test("onPublished observes the ack and the ordered events after mutation", async () => {
  const published: string[] = [];
  const e = engine({
    onPublished: ({ ack, events }) => {
      published.push(
        `${String(ack.ack.commandId)}:${String(ack.ack.journalCursor)}:${events.length}`,
      );
    },
  });
  await e.command.addAnnotation(addAnnotationCommand());
  assert.deepEqual(published, ["cmd-annotation-1:1:1"]);
});

test("the engine exposes the four ports grouped as WorldProtocol (A5)", () => {
  const e: HeadlessWorldEngine = engine();
  assert.equal(e.protocol.query, e.query);
  assert.equal(e.protocol.command, e.command);
  assert.equal(e.protocol.clock, e.clock);
  assert.equal(e.protocol.evidence, e.evidence);
  assert.equal(typeof e.protocol.command.addAnnotation, "function");
  assert.equal(typeof e.protocol.clock.step, "function");
  assert.equal(typeof e.protocol.query.getWorldMeta, "function");
  assert.equal(typeof e.protocol.evidence.getEvents, "function");
});
