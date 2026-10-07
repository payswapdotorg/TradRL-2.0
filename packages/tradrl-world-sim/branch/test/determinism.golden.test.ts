/**
 * THE W016 BRANCH DETERMINISM GOLDENS — the branch extension of the A9 claim.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — "A determinism claim requires fixed
 * world definition, engine version, seed and command stream." For a BRANCH
 * world the inputs are (definition, genesis snapshot, journaled events,
 * command stream) — so the goldens here pin:
 *   1. same inputs ⇒ identical branch runs (digest + manifest + state +
 *      report), wall time varied between runs;
 *   2. branch divergence — the same origin snapshot under different command
 *      streams produces different journals and different domain outcomes;
 *      the same stream on two siblings reproduces the same DOMAIN evolution
 *      (their journals differ exactly by world identity, which every
 *      envelope carries — siblings are different worlds by construction);
 *   3. parent immutability across the whole divergence — the parent's
 *      journal, digest, state and source snapshot are byte-identical from
 *      the branch point on, no matter how hard the children mutate;
 *   4. manifest sensitivity — the genesis snapshot digest is a first-class
 *      branch input (branches of different origins differ; a root records
 *      none);
 *   5. a seeded stream (mulberry32) keeps the claim honest under scale.
 *
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md G (branch safety) and I (headless
 * parity) both rest on these.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AddAnnotationCommand,
  BranchWorldCommand,
  SubmitOrderCommand,
} from "tradrl-world-contracts";
import { snapshotIdFor } from "../../snapshot/index.js";
import { verifyWorldSnapshot } from "../../snapshot/index.js";
import { createHeadlessWorldEngine } from "../../world/index.js";
import type { HeadlessWorldEngine } from "../../world/index.js";
import {
  START,
  TRADER,
  WALL_START,
  WORLD,
  addAnnotationCommand,
  fixedWallTimeSource,
  mulberry32,
  submitOrderCommand,
  testDefinition,
} from "../../world/test/helpers.js";

/** A deterministic pre-branch history with real resting liquidity. */
async function parentAtSnapshot(wallBase = WALL_START) {
  const definition = testDefinition();
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(wallBase),
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
  await engine.clock.step(1_000);
  const ack = await engine.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-snap-golden" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    label: "origin",
  });
  if (ack.status !== "acked") {
    throw new Error("golden fixture snapshot failed");
  }
  return { definition, engine, originId: snapshotIdFor(WORLD, 1) };
}

/** One branch child of `parent` from `sourceSnapshotId`, created live. */
async function branchChild(parent: HeadlessWorldEngine, sourceSnapshotId: string, index: number) {
  const command: BranchWorldCommand = {
    kind: "branch-world",
    commandId: `cmd-branch-${String(index)}` as never,
    worldId: parent.worldId,
    issuedBy: TRADER,
    issuedAt: START as never,
    sourceSnapshotId: sourceSnapshotId as never,
  };
  const acked = await parent.command.branchWorld(command);
  if (acked.status !== "acked") {
    throw new Error("golden fixture branch failed");
  }
  return parent.branchEngines()[parent.branchEngines().length - 1]!;
}

type BranchCommand =
  | { readonly kind: "order"; readonly side: "buy" | "sell"; readonly quantity: string }
  | { readonly kind: "annotation"; readonly text: string }
  | { readonly kind: "clock"; readonly delta: number };

const STREAM_A: readonly BranchCommand[] = [
  { kind: "order", side: "buy", quantity: "3" },
  { kind: "annotation", text: "branch stream A" },
  { kind: "clock", delta: 2_000 },
  { kind: "order", side: "sell", quantity: "1" },
  { kind: "annotation", text: "tail of A" },
];

const STREAM_B: readonly BranchCommand[] = [
  { kind: "order", side: "sell", quantity: "2" },
  { kind: "clock", delta: 5_000 },
  { kind: "annotation", text: "branch stream B" },
  { kind: "order", side: "buy", quantity: "4" },
];

/** Apply a deterministic command stream to a branch child. */
async function runStream(child: HeadlessWorldEngine, stream: readonly BranchCommand[]) {
  for (const [index, item] of stream.entries()) {
    if (item.kind === "clock") {
      await child.clock.step(item.delta);
      continue;
    }
    if (item.kind === "annotation") {
      const command: AddAnnotationCommand = addAnnotationCommand({
        commandId: `cmd-${String(child.worldId)}-ann-${String(index)}` as never,
        worldId: child.worldId,
        text: item.text,
        at: (START + 1_000) as never,
      });
      const acked = await child.command.addAnnotation(command);
      if (acked.status !== "acked") throw new Error("annotation failed");
      continue;
    }
    const command: SubmitOrderCommand = submitOrderCommand({
      commandId: `cmd-${String(child.worldId)}-ord-${String(index)}` as never,
      worldId: child.worldId,
      submission: {
        kind: "market",
        side: item.side,
        quantity: item.quantity as never,
        constraints: { timeInForce: "IOC" },
      },
    });
    const acked = await child.command.submitOrder(command);
    if (acked.status !== "acked") throw new Error("order failed");
  }
  return child;
}

/**
 * The domain evolution of a world, stripped of world identity: trade tape
 * (price, quantity), order registry (ordinal id suffix, status, quantity)
 * and annotation texts. Two worlds that ran the same stream from the same
 * origin state agree on ALL of it while their journals (which stamp every
 * envelope with the world id) differ exactly by identity.
 */
function domainOutcome(child: HeadlessWorldEngine) {
  const state = child.worldState();
  return {
    trades: state.matching.trades.map((trade) => [String(trade.price), String(trade.quantity)]),
    orders: state.matching.orders.map((order) => [
      String(order.orderId).split(":").pop(),
      order.status,
      String(order.quantity),
    ]),
    fills: state.matching.fills.map((fill) => [String(fill.quantity)]),
    annotations: state.annotations.map((annotation) => annotation.text),
  };
}

test("A9 branch golden 1: same inputs ⇒ identical branch runs (digest, manifest, state, report)", async () => {
  const runOne = await parentAtSnapshot(WALL_START);
  const childOne = await branchChild(runOne.engine, runOne.originId, 1);
  await runStream(childOne, STREAM_A);

  // an independent run: same definition, same origin content, same stream —
  // only the host-axis wall clock differs
  const runTwo = await parentAtSnapshot(WALL_START + 86_400_000);
  const childTwo = await branchChild(runTwo.engine, runTwo.originId, 1);
  await runStream(childTwo, STREAM_A);

  assert.deepEqual(childOne.journal.digest(), childTwo.journal.digest(), "branch journal digest identical");
  assert.deepEqual(
    childOne.determinismManifest(),
    childTwo.determinismManifest(),
    "branch determinism manifest identical (incl. genesisSnapshot + lineage)",
  );
  assert.deepEqual(childOne.worldState(), childTwo.worldState(), "branch state identical");
  assert.deepEqual(childOne.headlessReport(), childTwo.headlessReport(), "headless report identical");
  assert.equal(
    childOne.determinismManifest().inputHashes["genesisSnapshot"],
    runOne.engine.getSnapshotPayload(runOne.originId)!.descriptor.digest,
    "the genesis snapshot digest is the origin's content address",
  );
  assert.ok(childOne.journal.size() >= 4, "the stream journaled a meaningful branch history");
});

test("A9 branch golden 2: divergence — different streams diverge; same stream reproduces the domain", async () => {
  const { engine, originId } = await parentAtSnapshot();
  const b = await branchChild(engine, originId, 1);
  const c = await branchChild(engine, originId, 2);
  const d = await branchChild(engine, originId, 3);
  assert.equal(String(b.worldId), "wld:world-w013-tests:1");

  await runStream(b, STREAM_A);
  await runStream(c, STREAM_B);
  await runStream(d, STREAM_A);

  // B vs C: different streams ⇒ different journals AND different outcomes
  assert.notDeepEqual(b.journal.digest(), c.journal.digest(), "different streams ⇒ different journals");
  assert.notDeepEqual(domainOutcome(b), domainOutcome(c), "their domain evolutions diverged");
  assert.deepEqual(
    domainOutcome(b).annotations,
    ["golden region start", "branch stream A", "tail of A"],
  );
  assert.deepEqual(
    domainOutcome(c).annotations,
    ["golden region start", "branch stream B"],
  );

  // B vs D: the SAME stream on two siblings ⇒ the identical domain evolution
  assert.deepEqual(domainOutcome(b), domainOutcome(d), "same stream ⇒ same domain outcome");
  // ...while their journals differ exactly by world identity (every envelope
  // is stamped with its own world id — siblings are different worlds)
  assert.notDeepEqual(b.journal.digest(), d.journal.digest(), "sibling journals differ by world identity by construction");
  for (const [index, record] of d.journal.records().entries()) {
    assert.equal(record.envelope.worldId, d.worldId);
    assert.equal(record.envelope.eventId, b.journal.records()[index]?.envelope.eventId.replace(String(b.worldId), String(d.worldId)));
  }
  // the trade tape really traded: B swept 3 then 1
  assert.deepEqual(domainOutcome(b).trades, [["4800.75", "3"], ["4800.25", "1"]]);
});

test("A9 branch golden 3: parent immutability holds across the entire divergence", async () => {
  const { engine, originId } = await parentAtSnapshot();
  const snapshotAtBranch = engine.getSnapshotPayload(originId)!;

  const b = await branchChild(engine, originId, 1);
  const c = await branchChild(engine, originId, 2);
  // the parent's truth AT the branch point (its own two appends — the branch
  // records — are the last writes the branches may cause on it)
  const parentRecordsAtBranch = engine.journal.records();
  const parentDigestAtBranch = engine.journal.digest();
  const parentStateAtBranch = engine.worldState();

  await runStream(b, STREAM_A);
  await runStream(c, STREAM_B);
  // the children even snapshot and branch again, mutating their own children
  await c.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-c-snap" as never,
    worldId: c.worldId,
    issuedBy: TRADER,
    issuedAt: START as never,
  });
  const grandchild = await branchChild(c, String(snapshotIdFor(c.worldId, 1)), 1);
  await runStream(grandchild, STREAM_B);

  // the parent's truth is frozen at the branch point — byte-identical
  assert.deepEqual(engine.journal.records(), parentRecordsAtBranch, "parent records byte-identical");
  assert.deepEqual(engine.journal.digest(), parentDigestAtBranch, "parent digest byte-identical");
  assert.deepEqual(engine.worldState(), parentStateAtBranch, "parent state byte-identical");
  for (const record of engine.journal.records()) {
    assert.ok(Object.isFrozen(record), "history is frozen");
  }
  // the origin snapshot still verifies against its own content
  assert.deepEqual(engine.getSnapshotPayload(originId), snapshotAtBranch, "the origin payload is byte-identical");
  assert.deepEqual(verifyWorldSnapshot(snapshotAtBranch), { ok: true });
  // none of the children's events can be found in the parent's journal
  const parentEventIds = new Set(engine.journal.records().map((record) => String(record.envelope.eventId)));
  for (const child of [b, c, grandchild]) {
    for (const record of child.journal.records()) {
      assert.equal(
        parentEventIds.has(String(record.envelope.eventId)),
        false,
        "child events never enter the parent journal",
      );
    }
  }
  // and the parent keeps evolving independently of everything its children did
  const parentContinues = await engine.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-parent-post" as never, text: "the parent continues" }),
  );
  assert.equal(parentContinues.status, "acked");
  assert.equal(engine.journal.records().length, parentRecordsAtBranch.length + 1);
  assert.deepEqual(
    engine.worldState().matching.orders.map((order) => [String(order.orderId), order.status]),
    parentStateAtBranch.matching.orders.map((order) => [String(order.orderId), order.status]),
    "the parent's book was never touched by the children's trades",
  );
});

test("A9 branch golden 4: manifest sensitivity — the genesis snapshot is a first-class input", async () => {
  const { engine, originId } = await parentAtSnapshot();
  const early = await branchChild(engine, originId, 1);

  // a SECOND, later origin: the parent advances and snapshots again
  await engine.clock.step(10_000);
  await engine.command.addAnnotation(
    addAnnotationCommand({ commandId: "cmd-late-ann" as never, text: "later history" }),
  );
  const secondAck = await engine.command.createSnapshot({
    kind: "create-snapshot",
    commandId: "cmd-snap-late" as never,
    worldId: WORLD,
    issuedBy: TRADER,
    issuedAt: START as never,
    label: "later origin",
  });
  assert.equal(secondAck.status, "acked");
  const lateOriginId = String(snapshotIdFor(WORLD, 2));
  const late = await branchChild(engine, lateOriginId, 2);

  assert.equal(engine.determinismManifest().inputHashes["genesisSnapshot"], undefined, "the parent/root records no genesis snapshot");
  assert.equal(
    early.determinismManifest().inputHashes["genesisSnapshot"],
    engine.getSnapshotPayload(originId as never)!.descriptor.digest,
  );
  assert.equal(
    late.determinismManifest().inputHashes["genesisSnapshot"],
    engine.getSnapshotPayload(lateOriginId as never)!.descriptor.digest,
  );
  assert.notEqual(
    early.determinismManifest().inputHashes["genesisSnapshot"],
    late.determinismManifest().inputHashes["genesisSnapshot"],
    "branches of different origins have different genesis inputs",
  );
  assert.notEqual(String(early.journal.worldId), String(late.journal.worldId));
  assert.notEqual(early.branchLineage()[0]?.snapshotDigest, late.branchLineage()[0]?.snapshotDigest, "each lineage record carries its own origin's digest");
  assert.equal(late.worldState().annotations.length, early.worldState().annotations.length + 1, "the later origin inherited one more annotation");
});

test("A9 branch golden 5: a seeded stream keeps the branch claim honest under scale", async () => {
  // a seeded (mulberry32) branch stream: 60 interleaved orders/annotations/
  // clock steps — two independent branch children under the SAME seed must
  // agree on digest and state; a different seed must diverge. The A9 claim
  // under a realistic mix, not just hand-written streams.
  async function seededChild(seed: number, wallBase: number) {
    const parent = await parentAtSnapshot(wallBase);
    const child = await branchChild(parent.engine, parent.originId, 1);
    const rng = mulberry32(seed);
    const rngInt = (max: number) => Math.floor(rng() * max);
    for (let i = 0; i < 60; i += 1) {
      const roll = rng();
      if (roll < 0.2) {
        await child.clock.step(500 + rngInt(3_000));
      } else if (roll < 0.6) {
        const acked = await child.command.submitOrder(
          submitOrderCommand({
            commandId: `cmd-${String(child.worldId)}-s${String(i)}` as never,
            worldId: child.worldId,
            submission: {
              kind: "market",
              side: rng() < 0.5 ? "buy" : "sell",
              quantity: String(1 + rngInt(3)) as never,
              constraints: { timeInForce: "IOC" },
            },
          }),
        );
        if (acked.status !== "acked") throw new Error("seeded order failed");
      } else {
        const acked = await child.command.addAnnotation(
          addAnnotationCommand({
            commandId: `cmd-${String(child.worldId)}-s${String(i)}` as never,
            worldId: child.worldId,
            text: `seeded-${String(i)}`,
          }),
        );
        if (acked.status !== "acked") throw new Error("seeded annotation failed");
      }
    }
    return child;
  }

  const first = await seededChild(0x5eed_b16, WALL_START);
  const twin = await seededChild(0x5eed_b16, WALL_START + 123_456);
  const other = await seededChild(0x0dd_b16, WALL_START);
  assert.deepEqual(first.journal.digest(), twin.journal.digest(), "same seed ⇒ same branch journal");
  assert.deepEqual(first.worldState(), twin.worldState(), "same seed ⇒ same branch state");
  assert.notDeepEqual(first.journal.digest(), other.journal.digest(), "different seed ⇒ different branch journal");
  assert.ok(first.journal.size() >= 60);
});
