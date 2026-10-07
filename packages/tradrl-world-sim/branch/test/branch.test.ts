/**
 * W016 branch engine tests: A8 branching semantics, ACCEPTANCE G parent
 * immutability, genesis state, rewind-as-branch, lineage and the port
 * surfaces.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A8 — "History is immutable. Rewind creates
 * a child world from an immutable snapshot."
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md G — "Mutating a child world must not
 * alter its parent snapshot/history."
 * Spec: spec/WORLD-PROTOCOL.md "Branches" and "Command lifecycle" (the
 * branch-world command is journaled on the PARENT; the child is created from
 * the immutable source snapshot when the command acks).
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — "Branch lineage is immutable".
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  BranchWorldCommand,
  CreateSnapshotCommand,
  SnapshotId,
} from "tradrl-world-contracts";
import { applyBranchWorldCommand } from "../index.js";
import { branchWorld } from "../index.js";
import { branchWorldIdFor, lineageOf, lineageParentId, lineageSubject, withBranchWorldId } from "../index.js";
import type { BranchLineageRecord } from "../index.js";
import { snapshotIdFor } from "../../snapshot/index.js";
import { verifyWorldSnapshot } from "../../snapshot/index.js";
import type { WorldSnapshot } from "../../snapshot/index.js";
import { createEventJournalFromRecords } from "../../journal/index.js";
import { createHeadlessWorldEngine } from "../../world/index.js";
import {
  START,
  TRADER,
  WALL_START,
  WORLD,
  addAnnotationCommand,
  fixedWallTimeSource,
  setScenarioCommand,
  submitOrderCommand,
  testDefinition,
} from "../../world/test/helpers.js";

function snapshotCommand(overrides: Partial<CreateSnapshotCommand> = {}): CreateSnapshotCommand {
  return {
    kind: "create-snapshot",
    commandId: "cmd-snap-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    ...overrides,
  };
}

function branchCommand(overrides: Partial<BranchWorldCommand> = {}): BranchWorldCommand {
  return {
    kind: "branch-world",
    commandId: "cmd-branch-1" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    sourceSnapshotId: snapshotIdFor(WORLD, 1),
    ...overrides,
  };
}

/**
 * A parent world with real pre-branch history: annotations, TWO resting
 * makers on the book and a scenario in force, snapshotted mid-run.
 */
async function parentWithSnapshot() {
  const definition = testDefinition();
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
  });
  await engine.command.addAnnotation(addAnnotationCommand());
  await engine.clock.step(1_000);
  await engine.command.submitOrder(submitOrderCommand());
  await engine.command.submitOrder(
    submitOrderCommand({
      commandId: "cmd-order-2" as never,
      submission: {
        kind: "limit",
        side: "sell",
        quantity: "4" as never,
        limitPrice: "4800.75" as never,
        constraints: { timeInForce: "GTC" },
      },
    }),
  );
  await engine.command.setScenario(setScenarioCommand());
  const ack = await engine.command.createSnapshot(snapshotCommand({ label: "the branch point" }));
  if (ack.status !== "acked") {
    throw new Error("fixture snapshot failed");
  }
  return { definition, engine, snapshotId: snapshotIdFor(WORLD, 1) };
}

test("branch-world acks on the parent; the child is born with its own empty journal", async () => {
  const { definition, engine, snapshotId } = await parentWithSnapshot();
  const cursorBefore = engine.journal.getCursor();
  const acked = await engine.command.branchWorld(
    branchCommand({ configuration: { label: "what-if" } }),
  );
  assert.equal(acked.status, "acked");
  if (acked.status !== "acked") return;
  assert.equal(acked.ack.resultingEventIds.length, 1, "exactly one parent-journal record");
  assert.equal(acked.ack.journalCursor, cursorBefore + 1);
  const event = engine.journal.records()[cursorBefore]?.envelope;
  assert.equal(event?.eventType, "world.branch.created");

  const children = engine.branchEngines();
  assert.equal(children.length, 1);
  const child = children[0]!;
  assert.equal(child.worldId, branchWorldIdFor(WORLD, 1), "deterministic branch world id");
  assert.equal(child.journal.size(), 0, "the branch journal starts EMPTY at the branch point");
  assert.equal(child.journal.getCursor(), 0);
  assert.notEqual(child.journal, engine.journal, "own journal object, not the parent's");

  // the child accepts commands targeted at ITS world; its journal sequences
  // from 1 (its own history — the inherited one lives in the snapshot)
  const childAck = await child.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-child-1" as never, worldId: child.worldId, text: "on the branch" }),
  );
  assert.equal(childAck.status, "acked");
  assert.equal(child.journal.getCursor(), 1);
  assert.equal(child.journal.records()[0]?.envelope.sequence, 1);
  assert.equal(child.journal.records()[0]?.envelope.worldId, child.worldId);

  // the parent's own registry recorded the lineage-complete branch
  const record = engine.worldState().branches[0]!;
  assert.deepEqual(
    {
      worldId: record.worldId,
      parentWorldId: record.parentWorldId,
      sourceSnapshotId: record.sourceSnapshotId,
      snapshotDigest: record.snapshotDigest,
      branchPointSequence: record.branchPointSequence,
    },
    {
      worldId: child.worldId,
      parentWorldId: WORLD,
      sourceSnapshotId: snapshotId,
      snapshotDigest: engine.getSnapshotPayload(snapshotId)!.descriptor.digest,
      branchPointSequence: engine.getSnapshotPayload(snapshotId)!.descriptor.journalCursor,
    },
    "complete lineage facts on the record (A8)",
  );
  assert.equal(record.createdViaCommand, "cmd-branch-1");
  assert.equal(record.seed, definition.seed);
  assert.ok(record.createdAt >= START);
  assert.ok(record.provenance.producer.length > 0);
});

test("ACCEPTANCE G: mutating a child world never alters its parent snapshot/history", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();

  // capture the parent's full truth BEFORE the branch exists
  const parentRecordsBefore = engine.journal.records();
  const snapshotPayloadBefore = engine.getSnapshotPayload(snapshotId)!;

  const acked = await engine.command.branchWorld(branchCommand());
  assert.equal(acked.status, "acked");
  // the parent's truth AT the branch point: its own single append (the
  // world.branch.created record) is the LAST change the branch may cause
  const parentRecordsAtBranch = engine.journal.records();
  const parentDigestAtBranch = engine.journal.digest();
  const parentStateAtBranch = engine.worldState();
  assert.equal(parentRecordsAtBranch.length, parentRecordsBefore.length + 1);

  const child = engine.branchEngines()[0]!;
  // MUTATE THE CHILD HARD: trade against the inherited book, cancel an
  // INHERITED order, annotate, re-scope the scenario, snapshot the child and
  // branch the child again (a grandchild) — every child-only mutation.
  await child.command.submitOrder(
    submitOrderCommand({
      commandId: "cmd-child-sweep" as never,
      worldId: child.worldId,
      submission: { kind: "market", side: "buy", quantity: "3" as never, constraints: { timeInForce: "IOC" } },
    }),
  );
  await child.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-child-ann" as never, worldId: child.worldId, text: "branch-local" }),
  );
  const inheritedOrderId = child.worldState().matching.orders[0]!.orderId;
  await child.command.cancelOrder({
    kind: "cancel-order",
    commandId: "cmd-child-cancel" as never,
    worldId: child.worldId,
    issuedBy: TRADER,
    issuedAt: START as never,
    orderId: inheritedOrderId,
  });
  await child.command.setScenario(
    setScenarioCommand({ commandId: "cmd-child-scn" as never, worldId: child.worldId }),
  );
  await child.clock.step(5_000);
  const childSnap = await child.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-child-snap" as never,
    worldId: child.worldId,
    issuedBy: TRADER,
    issuedAt: START as never,
  });
  assert.equal(childSnap.status, "acked");
  const grandchildAck = await child.command.branchWorld({
    kind: "branch-world",
    commandId: "cmd-child-branch" as never,
    worldId: child.worldId,
    issuedBy: TRADER,
    issuedAt: START as never,
    sourceSnapshotId: snapshotIdFor(child.worldId, 1),
  });
  assert.equal(grandchildAck.status, "acked");
  assert.equal(child.branchEngines().length, 1, "the grandchild exists");

  // THE PARENT IS UNTOUCHED — state, journal, digest, snapshot payload
  assert.deepEqual(engine.journal.records(), parentRecordsAtBranch, "parent records unchanged");
  assert.deepEqual(engine.journal.digest(), parentDigestAtBranch, "parent digest unchanged after every child mutation");
  assert.deepEqual(engine.worldState(), parentStateAtBranch, "parent authoritative state unchanged");
  assert.deepEqual(
    engine.getSnapshotPayload(snapshotId),
    snapshotPayloadBefore,
    "the source snapshot payload is byte-identical",
  );
  assert.deepEqual(
    engine.worldState().branches.map((record) => record.worldId),
    [child.worldId],
    "the parent knows exactly its own children — not the grandchild",
  );
  // the snapshot still verifies against its own content
  assert.deepEqual(verifyWorldSnapshot(engine.getSnapshotPayload(snapshotId)!), { ok: true });
  // the inherited order the child canceled is still LIVE on the parent
  const parentOrder = engine
    .worldState()
    .matching.orders.find((order) => order.orderId === inheritedOrderId);
  assert.equal(parentOrder?.status, "accepted", "the child's cancel never reached the parent");
  // and the child's own journal diverged from the parent's
  assert.ok(child.journal.size() > 0);
  assert.equal(child.journal.worldId, child.worldId);
});

test("A8 structural enforcement: journal history and snapshot captures are frozen", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();
  await engine.command.branchWorld(branchCommand());

  // every stored record and envelope is frozen — history cannot be edited in place
  for (const record of engine.journal.records()) {
    assert.ok(Object.isFrozen(record), "records are frozen");
    assert.ok(Object.isFrozen(record.envelope), "envelopes are frozen");
    assert.throws(
      () => {
        (record.envelope as unknown as { worldId: string }).worldId = "world-tampered";
      },
      TypeError,
      "mutating a sealed envelope throws",
    );
  }

  const snapshot = engine.getSnapshotPayload(snapshotId)!;
  assert.ok(Object.isFrozen(snapshot), "the snapshot object is frozen");
  assert.ok(Object.isFrozen(snapshot.records), "the snapshot prefix array is frozen");
  assert.throws(
    () => {
      (snapshot.records as unknown as unknown[]).push(snapshot.records[0]!);
    },
    TypeError,
    "the snapshot prefix cannot grow",
  );
  // the snapshot's records ARE the journal's records (shared, frozen, safe)
  assert.equal(
    snapshot.records[0],
    engine.journal.records()[0],
    "prefix records are shared by reference with the parent journal",
  );
});

test("genesis state: inherited state rescoped, registries reset, scenarioOverride applied", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();
  const snapshot = engine.getSnapshotPayload(snapshotId)!;
  const parentOrdersAtCursor = engine.worldState().matching.orders;

  // without an override the inherited scenario carries
  await engine.command.branchWorld(branchCommand({ commandId: "cmd-branch-plain" as never }));
  const plain = engine.branchEngines()[0]!;
  assert.equal(plain.worldState().snapshots.length, 0, "snapshot registry reset");
  assert.equal(plain.worldState().branches.length, 0, "branch registry reset");
  assert.equal(
    plain.worldState().currentScenario?.label,
    engine.worldState().currentScenario?.label,
    "inherited scenario in force",
  );
  // inherited orders keep their opaque ids verbatim but carry the BRANCH world id
  assert.deepEqual(
    plain.worldState().matching.orders.map((order) => [String(order.orderId), String(order.worldId)]),
    parentOrdersAtCursor.map((order) => [String(order.orderId), String(plain.worldId)]),
    "inherited orders rescoped to the branch world",
  );
  assert.deepEqual(
    plain.worldState().matching.orders.map((order) => order.quantity),
    parentOrdersAtCursor.map((order) => order.quantity),
    "market state inherited verbatim",
  );
  // the inherited book still carries the resting makers
  const book = Object.values(plain.worldState().matching.books)[0]!;
  assert.equal(book.bids.length, 1, "the inherited resting maker is on the branch book");
  assert.equal(book.asks.length, 1);

  // with a scenarioOverride the counterfactual scenario replaces the inherited one
  const override = {
    label: "counterfactual shock",
    entries: [{ regime: "shock" as const, from: START as never }],
  };
  await engine.command.branchWorld(
    branchCommand({
      commandId: "cmd-branch-cf" as never,
      configuration: { label: "counterfactual", scenarioOverride: override },
    }),
  );
  const counterfactual = engine.branchEngines()[1]!;
  assert.equal(counterfactual.worldId, branchWorldIdFor(WORLD, 2));
  assert.deepEqual(counterfactual.worldState().currentScenario, override, "scenarioOverride wins");
  assert.equal(
    engine.worldState().currentScenario?.label,
    "stress test",
    "the parent's scenario is untouched by the child's override",
  );
  assert.equal(snapshot.descriptor.worldId, WORLD, "the source snapshot still belongs to the parent");
});

test("the inherited acked-command set keeps the duplicate-command law on the branch", async () => {
  const { engine } = await parentWithSnapshot();
  await engine.command.branchWorld(branchCommand());
  const child = engine.branchEngines()[0]!;

  // a parent command id that was acked BEFORE the snapshot is inherited
  const inherited = await child.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-annotation-1" as never, worldId: child.worldId, text: "re-issue" }),
  );
  assert.equal(inherited.status, "rejected");
  assert.equal(inherited.status === "rejected" && inherited.rejection.code, "duplicate-command");

  // a fresh id is the child's own — it acks on the child journal only
  const fresh = await child.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-branch-fresh" as never, worldId: child.worldId, text: "own" }),
  );
  assert.equal(fresh.status, "acked");
  assert.equal(engine.journal.records().at(-1)?.envelope.eventType, "world.branch.created");
});

test("rewind is branch creation, never in place: the child starts at the earlier time", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();
  const branchTime = engine.getSnapshotPayload(snapshotId)!.descriptor.createdAt;
  await engine.clock.step(30_000);
  assert.ok(engine.clockState().simulationTime > branchTime, "the parent advanced past the branch point");

  // the clock REFUSES the in-place rewind (A8's typed rejection)...
  await assert.rejects(engine.clock.seek(branchTime as never), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal((error as { rejection?: { code?: string } }).rejection?.code, "rewind-requires-branch");
    return true;
  });
  assert.ok(engine.clockState().simulationTime > branchTime, "the parent never moved backward");

  // ...and the branch from the earlier snapshot is the real path
  await engine.command.branchWorld(branchCommand({ commandId: "cmd-branch-rewind" as never }));
  const child = engine.branchEngines()[0]!;
  assert.equal(child.clockState().simulationTime, branchTime, "the child starts at the snapshot time");
  assert.ok(engine.clockState().simulationTime > branchTime, "the parent stays at the later time");
  // the child can advance from the branch point while the parent holds
  await child.clock.step(1_000);
  assert.equal(child.clockState().simulationTime, branchTime + 1_000);
  assert.ok(engine.clockState().simulationTime > child.clockState().simulationTime);
});

test("EvidencePort.getBranchLineage: root, child, grandchild and unknown worlds", async () => {
  const { engine } = await parentWithSnapshot();
  assert.deepEqual(await engine.evidence.getBranchLineage(), [], "a root world's lineage is empty");

  await engine.command.branchWorld(branchCommand({ commandId: "cmd-branch-b" as never }));
  const child = engine.branchEngines()[0]!;

  // the parent's port answers for its direct child
  assert.deepEqual(await engine.evidence.getBranchLineage(child.worldId), child.branchLineage());
  // the child's port carries its own full chain
  const chain = child.branchLineage();
  assert.equal(chain.length, 1);
  assert.equal(lineageSubject(chain), child.worldId);
  assert.equal(lineageParentId(chain), WORLD);
  assert.deepEqual(await child.evidence.getBranchLineage(), chain);

  // grandchild: the chain grows root-first and lineageOf slices ancestors
  await child.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-b-snap" as never,
    worldId: child.worldId,
    issuedBy: TRADER,
    issuedAt: START as never,
  });
  await child.command.branchWorld({
    kind: "branch-world",
    commandId: "cmd-b-branch" as never,
    worldId: child.worldId,
    issuedBy: TRADER,
    issuedAt: START as never,
    sourceSnapshotId: snapshotIdFor(child.worldId, 1),
  });
  const grandchild = child.branchEngines()[0]!;
  const grandChain = grandchild.branchLineage();
  assert.equal(grandChain.length, 2);
  assert.deepEqual(grandChain[0], chain[0], "the ancestry chain is carried verbatim");
  assert.equal(grandChain[1]?.parentWorldId, child.worldId);
  assert.deepEqual(lineageOf(grandChain, child.worldId), chain, "lineageOf slices the ancestor's chain");
  assert.deepEqual(
    await child.evidence.getBranchLineage(grandchild.worldId),
    grandChain,
    "the child's port answers for its own child with the FULL chain",
  );
  // worlds outside this engine's tree: the empty list is the honest answer
  assert.deepEqual(await engine.evidence.getBranchLineage(grandchild.worldId), []);
  assert.deepEqual(await engine.evidence.getBranchLineage("world-unknown" as never), []);
  // the lineage records are immutable once journaled (frozen by the reducer)
  const record: BranchLineageRecord = chain[0]!;
  assert.ok(Object.isFrozen(record), "lineage records are frozen");
  assert.throws(
    () => {
      (record as unknown as { parentWorldId: string }).parentWorldId = "world-tampered";
    },
    TypeError,
    "lineage cannot be edited in place",
  );
  assert.throws(
    () => {
      (child.worldState().branches as unknown as unknown[]).push(record);
    },
    TypeError,
    "the branch registry cannot grow in place",
  );
});

test("branch world meta, manifest and headless report carry the real lineage", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();
  const snapshot = engine.getSnapshotPayload(snapshotId)!;

  const parentMeta = await engine.query.getWorldMeta();
  assert.equal(parentMeta.parentWorldId, undefined, "the root has no parent");

  await engine.command.branchWorld(branchCommand({ commandId: "cmd-branch-meta" as never }));
  const child = engine.branchEngines()[0]!;

  const childMeta = await child.query.getWorldMeta();
  assert.equal(childMeta.worldId, child.worldId);
  assert.equal(childMeta.parentWorldId, WORLD, "WorldMeta.parentWorldId is real for branches");

  const parentManifest = engine.determinismManifest();
  const childManifest = child.determinismManifest();
  assert.equal(parentManifest.inputHashes["genesisSnapshot"], undefined, "a root was not born from a snapshot");
  assert.equal(childManifest.inputHashes["genesisSnapshot"], snapshot.descriptor.digest, "the branch names its genesis snapshot");
  assert.notEqual(childManifest.inputHashes["lineage"], parentManifest.inputHashes["lineage"]);
  assert.equal(childManifest.seed, parentManifest.seed);

  assert.deepEqual(child.headlessReport().branchLineage, child.branchLineage(), "the headless report carries the real lineage");
  assert.deepEqual(engine.headlessReport().branchLineage, []);
});

test("the branchWorld wrapper returns the child engine, record and snapshot; rejections carry through", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();
  const outcome = await branchWorld(engine, branchCommand({ configuration: { label: "wrapped" } }));
  assert.equal(outcome.parent.status, "acked");
  assert.ok(outcome.branch !== undefined);
  assert.ok(outcome.record !== undefined);
  assert.ok(outcome.snapshot !== undefined);
  assert.equal(outcome.branch?.worldId, outcome.record?.worldId);
  assert.equal(outcome.snapshot?.descriptor.snapshotId, snapshotId);
  assert.equal(outcome.record?.configuration.label, "wrapped");

  const rejected = await branchWorld(engine, branchCommand({
    commandId: "cmd-branch-ghost" as never,
    sourceSnapshotId: "snap-ghost" as never,
  }));
  assert.equal(rejected.parent.status, "rejected");
  assert.equal(rejected.parent.status === "rejected" && rejected.parent.rejection.code, "unknown-snapshot");
  assert.equal(rejected.branch, undefined);
  assert.equal(rejected.record, undefined);
  assert.equal(rejected.snapshot, undefined);
});

test("branch-world seam: a foreign-engine snapshot payload is a typed snapshot-engine-mismatch", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();
  const snapshot = engine.getSnapshotPayload(snapshotId)!;
  const foreign: WorldSnapshot = { ...snapshot, engine: "tradrl-foreign" };
  const outcome = applyBranchWorldCommand(branchCommand(), {
    definition: testDefinition(),
    state: engine.worldState(),
    simulationTime: engine.clockState().simulationTime,
    nextSequence: (engine.journal.getCursor() + 1) as never,
    journal: engine.journal,
    snapshotPayloads: new Map<SnapshotId, WorldSnapshot>([[snapshotId, foreign]]),
  });
  assert.equal(outcome.kind, "rejected");
  if (outcome.kind === "rejected") {
    assert.equal(outcome.rejection.stage, "domain-rules");
    assert.equal(outcome.rejection.code, "snapshot-engine-mismatch");
    assert.match(outcome.rejection.message, /tradrl-foreign/);
  }
});

test("B, C and D from one snapshot: three independent worlds, deterministic ids", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();
  for (const id of ["cmd-branch-b", "cmd-branch-c", "cmd-branch-d"] as const) {
    const acked = await engine.command.branchWorld(branchCommand({ commandId: id as never }));
    assert.equal(acked.status, "acked");
  }
  const [b, c, d] = engine.branchEngines();
  assert.deepEqual(
    [b?.worldId, c?.worldId, d?.worldId],
    [branchWorldIdFor(WORLD, 1), branchWorldIdFor(WORLD, 2), branchWorldIdFor(WORLD, 3)],
  );
  // three distinct journals, one shared immutable origin
  assert.ok(new Set([b?.journal, c?.journal, d?.journal]).size === 3);
  for (const child of engine.branchEngines()) {
    assert.equal(child.journal.size(), 0);
    assert.equal(child.getSnapshotPayload(snapshotId), undefined, "the parent's snapshot is not the child's");
  }
  assert.equal(engine.getSnapshotPayload(snapshotId)?.descriptor.snapshotId, snapshotId);
});

test("a replayed parent can branch: payloads rebuild from journaled truth", async () => {
  const { definition, engine, snapshotId } = await parentWithSnapshot();
  // the parent history UP TO (but excluding) the live branch record
  const recordsForReplay = engine.journal.records();

  // the live branch (ground truth)
  await engine.command.branchWorld(branchCommand({ commandId: "cmd-branch-live" as never }));
  const liveChild = engine.branchEngines()[0]!;

  // a bare-journal replay of the SAME parent history (snapshot event included)
  const replayed = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(WALL_START + 555_555),
    restore: {
      journal: createEventJournalFromRecords({
        worldId: definition.scope.worldId,
        records: recordsForReplay,
      }),
    },
  });
  assert.deepEqual(replayed.worldState().snapshots, engine.worldState().snapshots.slice(0, 1));
  const rebuilt = replayed.getSnapshotPayload(snapshotId);
  assert.ok(rebuilt !== undefined, "the replayed engine rebuilt the snapshot payload from the fold");
  assert.deepEqual(rebuilt, engine.getSnapshotPayload(snapshotId));

  // ...and branches from it: same genesis state, same deterministic identity
  const acked = await replayed.command.branchWorld(
    branchCommand({ commandId: "cmd-branch-replay" as never }),
  );
  assert.equal(acked.status, "acked");
  const replayChild = replayed.branchEngines()[0]!;
  assert.equal(replayChild.worldId, liveChild.worldId, "deterministic branch ids agree across replay");
  assert.deepEqual(replayChild.worldState(), liveChild.worldState(), "identical genesis state");
  assert.deepEqual(
    replayChild.branchLineage()[0]?.snapshotDigest,
    liveChild.branchLineage()[0]?.snapshotDigest,
    "identical origin digest in the lineage record",
  );
  assert.deepEqual(
    replayChild.determinismManifest().inputHashes["genesisSnapshot"],
    liveChild.determinismManifest().inputHashes["genesisSnapshot"],
  );
  // and the replayed child accepts commands exactly like the live one
  const liveAck = await liveChild.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-post-branch" as never, worldId: liveChild.worldId, text: "same" }),
  );
  const replayAck = await replayChild.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-post-branch" as never, worldId: replayChild.worldId, text: "same" }),
  );
  assert.equal(liveAck.status, "acked");
  assert.equal(replayAck.status, "acked");
  assert.deepEqual(replayChild.journal.digest(), liveChild.journal.digest(), "the two branch worlds evolve identically");
});

test("the branch child itself replays: genesis snapshot + own journal reproduce the branch world", async () => {
  const { engine, snapshotId } = await parentWithSnapshot();
  const snapshot = engine.getSnapshotPayload(snapshotId)!;
  await engine.command.branchWorld(branchCommand({ commandId: "cmd-branch-r" as never }));
  const child = engine.branchEngines()[0]!;
  await child.command.submitOrder(
    submitOrderCommand({
      commandId: "cmd-b-1" as never,
      worldId: child.worldId,
      submission: { kind: "market", side: "buy", quantity: "2" as never, constraints: { timeInForce: "IOC" } },
    }),
  );
  await child.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-b-2" as never, worldId: child.worldId, text: "branch note" }),
  );

  // the branch world's own inputs: its genesis snapshot + its own journal + lineage
  const replayedChild = createHeadlessWorldEngine({
    definition: withBranchWorldId(snapshot.definition, child.worldId),
    lineage: child.branchLineage(),
    branchGenesis: { snapshot },
    wallTimeSource: fixedWallTimeSource(WALL_START + 777_777),
    restore: {
      journal: createEventJournalFromRecords({
        worldId: child.worldId,
        records: child.journal.records(),
      }),
    },
  });
  assert.deepEqual(replayedChild.worldState(), child.worldState(), "branch replay reproduces the branch state");
  assert.deepEqual(replayedChild.journal.digest(), child.journal.digest());
  assert.deepEqual(replayedChild.branchLineage(), child.branchLineage());
  assert.equal(
    replayedChild.determinismManifest().inputHashes["genesisSnapshot"],
    child.determinismManifest().inputHashes["genesisSnapshot"],
  );
});
