/**
 * THE DETERMINISM GOLDEN TEST — the W013 package's flagship (A9).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — "A determinism claim requires fixed
 * world definition, engine version, seed and command stream."
 * Spec: spec/WORLD-PROTOCOL.md "Determinism" (the manifest) and "Event
 * envelope" (sequence monotonic per world).
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md I (headless parity: the same command
 * stream produces the same deterministic result hash) and F (one golden
 * command sequence, matching assertions).
 * Spec: spec/SIMULATION.md "Headless report" (event count + event hash).
 *
 * Design: a fixed world definition (seed, versions, entities) and a SEEDED
 * command stream (mulberry32 PRNG choosing commands, rejections, duplicates
 * and clock operations) are run through independent engine instances. The
 * A9 claim under proof:
 *   identical (world definition, engine version, seed, command stream)
 *     ⇒ identical journal digest, identical determinism manifest,
 *       identical authoritative state — and a fresh instance replaying the
 *       same journal reproduces all three, while wall time (varied between
 *       runs) never leaks into any of them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AddAnnotationCommand,
  SetScenarioCommand,
} from "tradrl-world-contracts";
import type { DeterministicStreamVerification } from "tradrl-world-contracts/time";
import { asWallTime } from "tradrl-world-contracts/time";
import { validateEventStream } from "tradrl-world-contracts/time";
import { createEventJournalFromRecords } from "../../journal/index.js";
import { createHeadlessWorldEngine } from "../index.js";
import type { WorldDefinition } from "../index.js";
import {
  START,
  TRADER,
  WALL_START,
  addAnnotationCommand,
  mulberry32,
  setScenarioCommand,
  submitOrderCommand,
  testDefinition,
} from "./helpers.js";

const GOLDEN_PRNG_SEED = 0x5eed_013;
const ITERATIONS = 48;
const REGIMES = ["trend", "mean-reversion", "high-volatility", "low-liquidity", "shock", "halt-reopen"] as const;

/**
 * The one golden scenario runner (the single source of truth — every test
 * derives from it): a deterministic interleaving of clock operations and a
 * seeded command mix (acked annotations, scenario sets, structural
 * rejections, stub rejections, duplicate re-issues). `wallBase` varies the
 * host-axis readings between runs; it must never affect the outcome.
 */
async function runGoldenEngine(options: {
  prngSeed: number;
  wallBase: number;
  definition?: WorldDefinition;
}) {
  const definition = options.definition ?? testDefinition();
  let wallTick = 0;
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: () => asWallTime(options.wallBase + (wallTick += 7)),
  });
  const rng = mulberry32(options.prngSeed);
  const rngInt = (max: number) => Math.floor(rng() * max);

  const annotate = (command: AddAnnotationCommand) => engine.command.addAnnotation(command);
  const scenario = (command: SetScenarioCommand) => engine.command.setScenario(command);

  for (let i = 0; i < ITERATIONS; i += 1) {
    const roll = rng();
    if (roll < 0.25) {
      await engine.clock.step(1_000 + rngInt(9_000));
    } else if (roll < 0.32) {
      // bounded forward seek (backward seeks reject — exercised next)
      const target = engine.clockState().simulationTime + 1_000 + rngInt(5_000);
      await engine.clock.seek(target as never);
    } else if (roll < 0.36) {
      // A8 rejection path: a deliberate backward seek, rejection swallowed
      // by the runner (the clock tests assert the typed rejection itself)
      await engine.clock.seek(engine.clockState().simulationTime as never).catch(() => undefined);
    } else if (roll < 0.42) {
      await engine.clock.setSpeed(0.5 + rngInt(8));
    } else if (roll < 0.46) {
      await engine.clock.pause();
      await engine.clock.play();
    } else if (roll < 0.62) {
      await annotate(
        addAnnotationCommand({
          commandId: `cmd-ann-${String(i)}` as never,
          issuedAt: (START + i) as never,
          at: (START + rngInt(100_000)) as never,
          text: `note-${String(i)}-${String(rngInt(1000))}`,
          ...(rng() < 0.3 ? { instrumentId: definition.instruments[0]!.instrumentId } : {}),
        }),
      );
    } else if (roll < 0.72) {
      await scenario(
        setScenarioCommand({
          commandId: `cmd-scn-${String(i)}` as never,
          issuedAt: (START + i) as never,
          scenario: {
            ...(rng() < 0.5 ? { label: `scenario-${String(rngInt(50))}` } : {}),
            entries: [
              {
                regime: REGIMES[rngInt(REGIMES.length)]!,
                from: (START + rngInt(10_000)) as never,
              },
            ],
          },
        }),
      );
    } else if (roll < 0.78) {
      // structural rejection (validate): blank text
      await annotate(
        addAnnotationCommand({ commandId: `cmd-bad-${String(i)}` as never, text: " " }),
      );
    } else if (roll < 0.84) {
      // unknown-entity rejection (validate)
      await annotate(
        addAnnotationCommand({
          commandId: `cmd-ghost-${String(i)}` as never,
          issuedBy: "participant-nope" as never,
        }),
      );
    } else if (roll < 0.9) {
      // domain-rules stub rejection (W014/W015)
      await engine.command.submitOrder(
        submitOrderCommand({ commandId: `cmd-order-${String(i)}` as never }),
      );
    } else {
      // duplicate re-issue: an earlier acked command id, verbatim
      await annotate(
        addAnnotationCommand({ commandId: `cmd-ann-${String(Math.max(0, i - 1))}` as never }),
      );
    }
  }
  return engine;
}

function outcomeOf(engine: Awaited<ReturnType<typeof runGoldenEngine>>) {
  const manifest = engine.determinismManifest();
  const digest = engine.journal.digest();
  return {
    digest,
    manifest,
    state: engine.worldState(),
    verification: { manifest, digest } as DeterministicStreamVerification,
    journalSize: engine.journal.size(),
  };
}

test("A9 golden: identical inputs ⇒ identical digest, manifest and state across runs", async () => {
  const runA = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const runB = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));

  assert.ok(runA.journalSize >= 10, "the golden stream journals a meaningful number of events");
  assert.deepEqual(runA.digest, runB.digest, "journal digest identical");
  assert.deepEqual(runA.manifest, runB.manifest, "determinism manifest identical");
  assert.deepEqual(runA.state, runB.state, "authoritative state identical");
  assert.deepEqual(runA.verification, runB.verification, "DeterministicStreamVerification identical");
  assert.equal(runA.digest.lastSequence, runA.journalSize);
});

test("A9 golden: wall time never leaks into the journal (varied wall clock, same digest)", async () => {
  const hostRun = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const otherHost = outcomeOf(
    await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START + 86_400_000 }),
  );
  assert.deepEqual(otherHost.digest, hostRun.digest, "digest is wall-time independent");
  assert.deepEqual(otherHost.state, hostRun.state, "state is wall-time independent");
  assert.equal(otherHost.manifest.commandStreamHash, hostRun.manifest.commandStreamHash);
});

test("A9 golden: a fresh instance replaying the same journal reproduces everything", async () => {
  const definition = testDefinition();
  const source = await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START });
  const original = outcomeOf(source);

  // rebuild a live journal from the original records, then a fresh engine
  const restored = createHeadlessWorldEngine({
    definition,
    wallTimeSource: () => asWallTime(WALL_START),
    restore: {
      journal: createEventJournalFromRecords({
        worldId: definition.scope.worldId,
        records: source.journal.records(),
      }),
    },
  });

  assert.deepEqual(restored.journal.digest(), original.digest, "restored digest identical");
  assert.deepEqual(restored.worldState(), original.state, "replayed state bit-identical");
  const records = restored.journal.records();
  assert.equal(
    restored.clockState().simulationTime,
    records[records.length - 1]?.envelope.occurredAt ?? START,
    "clock defaults to the last replayed event time",
  );

  // the duplicate-command law survives the replay: re-issuing an acked
  // command id rejects exactly as it did live
  const ackedId = original.state.ackedCommandIds.values().next().value as string;
  const duplicate = await restored.command.addAnnotation(
    addAnnotationCommand({ commandId: ackedId as never }),
  );
  assert.equal(
    duplicate.status === "rejected" && duplicate.rejection.code,
    "duplicate-command",
  );
  // and the stub boundary survives: the same order command still rejects
  const stub = await restored.command.submitOrder(submitOrderCommand());
  assert.equal(
    stub.status === "rejected" && stub.rejection.code,
    "not-implemented-in-skeleton",
  );
});

test("A9 golden: the golden journal satisfies the W004 ordered-stream laws", async () => {
  const engine = await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START });
  const records = engine.journal.records();
  const validation = validateEventStream(records.map((record) => record.envelope));
  assert.deepEqual(validation, { ok: true });
  // sequences are dense and strictly monotonic from 1
  assert.deepEqual(
    records.map((record) => record.envelope.sequence),
    records.map((_, index) => index + 1),
  );
});

test("A9 golden sensitivity: a different command stream produces a different digest", async () => {
  const baseline = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const differentStream = outcomeOf(
    await runGoldenEngine({ prngSeed: 0x0dd_5eed, wallBase: WALL_START }),
  );
  assert.ok(differentStream.journalSize >= 10);
  assert.notDeepEqual(differentStream.digest, baseline.digest);
  assert.notEqual(
    differentStream.manifest.commandStreamHash,
    baseline.manifest.commandStreamHash,
  );
});

test("A9 golden: a different world definition changes the manifest input hash", async () => {
  const baseline = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const otherDefinitionRun = outcomeOf(
    await runGoldenEngine({
      prngSeed: GOLDEN_PRNG_SEED,
      wallBase: WALL_START,
      definition: testDefinition({
        seed: "w013-other-seed",
        worldDefinitionVersion: "w013-test-def@2",
      }),
    }),
  );
  assert.notEqual(
    otherDefinitionRun.manifest.inputHashes["worldDefinition"],
    baseline.manifest.inputHashes["worldDefinition"],
  );
  assert.notEqual(otherDefinitionRun.manifest.seed, baseline.manifest.seed);
  // The skeleton's events do not consume the seed (the market generator
  // that will — W017 — is not built yet), so digests MAY match; the
  // manifest is what distinguishes the runs today. Documented honestly.
});

test("A9 golden: annotation ids are derived deterministically from the event-sourced state", async () => {
  const run = outcomeOf(await runGoldenEngine({ prngSeed: GOLDEN_PRNG_SEED, wallBase: WALL_START }));
  const annotations = run.state.annotations;
  assert.ok(annotations.length > 0);
  assert.ok(annotations.every((annotation) => annotation.issuedBy === TRADER));
  assert.deepEqual(
    annotations.map((annotation) => String(annotation.annotationId)),
    annotations.map((_, index) => `ann:world-w013-tests:${String(index + 1)}`),
  );
});
