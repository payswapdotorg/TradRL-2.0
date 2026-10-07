/**
 * World meta / snapshot / branch / determinism contract tests.
 *
 * Spec: spec/WORLD-PROTOCOL.md (Snapshots, Branches, Determinism),
 * spec/ARCHITECTURE.md §8 (simulation modes), §9 (branching),
 * spec/SIMULATION.md (Fidelity declarations, Synthetic regimes),
 * spec/ARCHITECTURE-LOCK.md A8 (branching not destructive), A9 (determinism
 * claims), A14 (fail-closed simulation/live boundary).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  BranchRecord,
  DeterminismDeclaration,
  DeterminismManifest,
  ExecutionAuthority,
  RegimeKind,
  ScenarioDefinition,
  SnapshotDescriptor,
  WorldMeta,
  WorldMode,
} from "../src/world.js";
import type {
  CommandId,
  ProducerId,
  SnapshotId,
  WorldId,
  ProjectId,
  TenantId,
} from "../src/ids.js";
import { asId, asTimestamp } from "./helpers.js";
import type { Equal, Expect, RequiredKeys } from "./helpers.js";

// --- type-level assertions ---------------------------------------------------

const ALL_MODES = ["exact-replay", "reactive-replay", "counterfactual", "live-mirror"] as const;
const ALL_REGIMES = [
  "trend",
  "mean-reversion",
  "high-volatility",
  "low-liquidity",
  "shock",
  "halt-reopen",
] as const;

type _modesExact = Expect<Equal<WorldMode, (typeof ALL_MODES)[number]>>;
type _regimesExact = Expect<Equal<RegimeKind, (typeof ALL_REGIMES)[number]>>;

// A14 fail-closed: World Alpha execution authority is a literal type that
// only permits simulated-only.
type _authorityFailClosed = Expect<Equal<ExecutionAuthority, "simulated-only">>;
type _metaDeclaresAuthority = Expect<
  Equal<"executionAuthority" extends RequiredKeys<WorldMeta> ? true : false, true>
>;

// SIMULATION.md fidelity declarations are required on every world.
type _fidelityDeclarations = Expect<
  Equal<
    | "mode"
    | "inputDataSource"
    | "engine"
    | "engineVersion"
    | "knownLimitations"
    | "determinism" extends RequiredKeys<WorldMeta>
      ? true
      : false,
    true
  >
>;

// WORLD-PROTOCOL.md determinism manifest contents.
type _manifestKeys = Expect<
  Equal<
    | "worldDefinitionVersion"
    | "engine"
    | "engineVersion"
    | "seed"
    | "inputHashes"
    | "dependencyVersions"
    | "commandStreamHash" extends RequiredKeys<DeterminismManifest>
      ? true
      : false,
    true
  >
>;

// A branch records parentWorldId, sourceSnapshotId, configuration,
// engine/version, seed, creation command and provenance (ARCHITECTURE §9).
type _branchKeys = Expect<
  Equal<
    | "worldId"
    | "parentWorldId"
    | "sourceSnapshotId"
    | "configuration"
    | "engine"
    | "engineVersion"
    | "seed"
    | "createdViaCommand"
    | "provenance"
    | "createdAt" extends RequiredKeys<BranchRecord>
      ? true
      : false,
    true
  >
>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");
const parentWorldId = asId<WorldId>("world-0");

const deterministic: DeterminismDeclaration = { kind: "deterministic" };
const nondeterministic: DeterminismDeclaration = {
  kind: "nondeterministic",
  sources: ["wall-clock inputs"],
};

const worldMeta: WorldMeta = {
  worldId,
  scope: {
    tenantId: asId<TenantId>("tenant-1"),
    projectId: asId<ProjectId>("project-1"),
    worldId,
  },
  mode: "reactive-replay",
  executionAuthority: "simulated-only",
  engine: "tradrl-world-sim",
  engineVersion: "0.1.0",
  worldDefinitionVersion: "1",
  seed: "seed-42",
  inputDataSource: "synthetic",
  knownLimitations: ["single venue", "no options"],
  determinism: deterministic,
  regimeSchedule: [
    { regime: "trend", from: asTimestamp(0), to: asTimestamp(60_000) },
    { regime: "halt-reopen", from: asTimestamp(60_000) },
  ],
  parentWorldId,
};

const snapshot: SnapshotDescriptor = {
  snapshotId: asId<SnapshotId>("snapshot-7"),
  worldId,
  createdAt: asTimestamp(5_000),
  journalCursor: 128 as SnapshotDescriptor["journalCursor"],
  digest: "sha256:abc",
};

const branch: BranchRecord = {
  worldId: asId<WorldId>("world-2"),
  parentWorldId: worldId,
  sourceSnapshotId: snapshot.snapshotId,
  configuration: { label: "what-if tighter risk" },
  engine: "tradrl-world-sim",
  engineVersion: "0.1.0",
  seed: "seed-43",
  createdViaCommand: asId<CommandId>("command-9"),
  provenance: { producer: asId<ProducerId>("producer-tl"), recordedAt: asTimestamp(6_000) },
  createdAt: asTimestamp(6_000),
};

const manifest: DeterminismManifest = {
  worldDefinitionVersion: "1",
  engine: "tradrl-world-sim",
  engineVersion: "0.1.0",
  seed: "seed-42",
  inputHashes: { marketData: "sha256:aaa", regimes: "sha256:bbb" },
  dependencyVersions: { typescript: "6.0.2" },
  commandStreamHash: "sha256:commands",
};

// --- runtime invariants --------------------------------------------------------

test("world meta declares mode, fidelity and simulated-only authority", () => {
  assert.equal(worldMeta.mode, "reactive-replay");
  assert.ok((ALL_MODES as readonly string[]).includes(worldMeta.mode));
  assert.equal(worldMeta.executionAuthority, "simulated-only");
  assert.equal(worldMeta.knownLimitations.length, 2);
  assert.equal(worldMeta.determinism.kind, "deterministic");
});

test("nondeterministic worlds must declare their sources (A9)", () => {
  assert.equal(nondeterministic.kind, "nondeterministic");
  if (nondeterministic.kind === "nondeterministic") {
    assert.equal(nondeterministic.sources.length, 1);
  }
});

test("regime schedules are part of world metadata", () => {
  const schedule = worldMeta.regimeSchedule ?? [];
  assert.equal(schedule.length, 2);
  for (const entry of schedule) {
    assert.ok((ALL_REGIMES as readonly string[]).includes(entry.regime));
    if (entry.to !== undefined) {
      assert.ok(entry.to > entry.from);
    }
  }
});

test("a scenario is an ordered regime schedule", () => {
  const scenario: ScenarioDefinition = {
    label: "stress",
    entries: [
      { regime: "high-volatility", from: asTimestamp(0) },
      { regime: "shock", from: asTimestamp(30_000), parameters: { magnitudePct: 5 } },
    ],
  };
  assert.equal(scenario.entries.length, 2);
  assert.ok(scenario.entries[0]!.from <= scenario.entries[1]!.from);
});

test("snapshots are immutable descriptors with a journal cursor", () => {
  assert.ok(snapshot.snapshotId);
  assert.ok(snapshot.journalCursor >= 0);
  assert.ok(snapshot.digest);
});

test("a branch references its parent and source snapshot, never mutating them", () => {
  assert.notEqual(branch.worldId, branch.parentWorldId);
  assert.equal(branch.sourceSnapshotId, snapshot.snapshotId);
  assert.ok(branch.createdViaCommand);
  // A8: parent lineage is immutable — the record only references, never rewrites.
  assert.equal(worldMeta.worldId, branch.parentWorldId);
});

test("the determinism manifest carries every verification input", () => {
  assert.ok(manifest.seed);
  assert.ok(manifest.commandStreamHash);
  assert.ok(manifest.inputHashes.marketData);
  assert.ok(manifest.dependencyVersions.typescript);
});
