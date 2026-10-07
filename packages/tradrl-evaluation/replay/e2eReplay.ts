/**
 * The end-to-end replay verification (W022): dataset → W020
 * `loadHistoricalDataset` → the W031 CLI run/replay path (in-process
 * `main(argv)` — the W021-tested seam) → the A9/W016 verdicts.
 *
 * Execution vs evaluation (the falsifiability seam, as everywhere in this
 * package): `runReplayPipeline` performs ALL the async work once and captures
 * a plain `E2EObservation` (evidence is path-free — temp-dir paths never
 * enter findings, so digests stay environment-independent); the four finding
 * builders are PURE functions of that observation, and this package's own
 * tests mutate observations to prove each verdict can actually fail.
 *
 * Claims verified here (18-21):
 * 18. `e2e-cli-import-parity` — the CLI run's dataset evidence equals the
 *     direct W020 import digest bit-for-bit; the honesty flags
 *     (`journalReadyOnly`) stay true; the printed report equals the written
 *     report file.
 * 19. `e2e-a9-twin-runs` — two independent CLI runs (fresh directories)
 *     produce the identical reportDigest, dataset evidence and journal
 *     checksum; two replays of the same journal are digest-identical too.
 * 20. `e2e-w016-restore-equivalence` — replaying a journal PREFIX (through a
 *     mid-run snapshot) and driving the remaining script equals having run
 *     the whole script in one shot: identical final event checksum, event
 *     count and balances (the W016 restore path).
 * 21. `e2e-replay-input-exactness` — a replay with a TAMPERED datasets
 *     declaration is refused (the replay must reproduce the recorded run's
 *     inputs exactly); a self-contained journal replay restores the recorded
 *     state with the recorded dataset evidence.
 */

import { readFile } from "node:fs/promises";
import type { WorldId } from "tradrl-world-contracts";
import { canonicalString } from "tradrl-world-sim/world";
import { loadHistoricalDataset } from "tradrl-data";
import { nautilusTraderCatalog } from "tradrl-adapters-nautilus/dtypes";
import { mapNautilusDataset } from "tradrl-adapters-nautilus/mapping";
import type { NautilusDatasetMapping } from "tradrl-adapters-nautilus/mapping";
import { findingOf, type CaseVerdict, type FidelityFinding } from "./findings.js";
import { CLEAN_BARS, HARNESS_INSTRUMENTS } from "./fixtures.js";
import {
  e2eContinuationScript,
  e2eDefinition,
  e2eDir,
  e2eFullScript,
  e2ePrefixScript,
  runCliMain,
  writeJson,
} from "./e2eCli.js";

/** One CLI run's captured outcome (defensive extracts from its report). */
export interface CliRunOutcome {
  readonly label: string;
  readonly exitCode: number;
  readonly reportDigest: string;
  readonly eventChecksum: string;
  readonly eventCount: number;
  readonly balancesJson: string;
  readonly datasetsJson: string;
  readonly restoredJson: string;
  /** The typed failure text (stderr) when the run failed; "" on success. */
  readonly failureText: string;
  /** The printed stdout report canonically equals the written report file. */
  readonly printedEqualsWritten: boolean;
  readonly datasets: readonly unknown[];
  readonly restored: Record<string, unknown> | undefined;
}

/** The complete e2e observation (path-free evidence). */
export interface E2EObservation {
  readonly worldId: string;
  readonly direct: { readonly eventCount: number; readonly eventChecksum: string };
  readonly twinOne: CliRunOutcome;
  readonly twinTwo: CliRunOutcome;
  readonly prefixRun: CliRunOutcome;
  readonly continuation: CliRunOutcome;
  readonly replayOne: CliRunOutcome;
  readonly replayTwo: CliRunOutcome;
  readonly tamperedReplay: CliRunOutcome;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function fieldOf(value: unknown, field: string): unknown {
  return asRecord(value)?.[field];
}

/** Defensive string field of a record ("" when absent/not a string). */
function stringField(record: Record<string, unknown> | undefined, field: string): string {
  const value = record?.[field];
  return typeof value === "string" ? value : "";
}

/** Defensive number field of a record (-1 when absent/not a number). */
function numberField(record: Record<string, unknown> | undefined, field: string): number {
  const value = record?.[field];
  return typeof value === "number" ? value : -1;
}

/** Run one CLI invocation and defensively extract its report fields. */
async function collect(label: string, argv: readonly string[], reportPath: string): Promise<CliRunOutcome> {
  const captured = await runCliMain(argv);
  let written: unknown;
  try {
    written = JSON.parse(await readFile(reportPath, "utf8")) as unknown;
  } catch {
    written = undefined;
  }
  let printed: unknown;
  try {
    printed = JSON.parse(captured.stdout) as unknown;
  } catch {
    printed = undefined;
  }
  const report = asRecord(written) ?? asRecord(printed);
  const headless = fieldOf(report, "headlessReport");
  const restored = asRecord(fieldOf(report, "restored"));
  const datasets = Array.isArray(fieldOf(report, "datasets")) ? (fieldOf(report, "datasets") as unknown[]) : [];
  const outcome: CliRunOutcome = {
    label,
    exitCode: captured.exitCode,
    reportDigest: typeof fieldOf(report, "reportDigest") === "string" ? (fieldOf(report, "reportDigest") as string) : "",
    eventChecksum:
      typeof fieldOf(headless, "eventHash") === "string" ? (fieldOf(headless, "eventHash") as string) : "",
    eventCount: typeof fieldOf(headless, "eventCount") === "number" ? (fieldOf(headless, "eventCount") as number) : -1,
    balancesJson: canonicalString(fieldOf(headless, "balances")),
    datasetsJson: canonicalString(datasets),
    restoredJson: restored === undefined ? "" : canonicalString(restored),
    failureText: captured.exitCode === 0 ? "" : captured.stderr,
    printedEqualsWritten: printed !== undefined && written !== undefined && canonicalString(printed) === canonicalString(written),
    datasets,
    restored,
  };
  return outcome;
}

/** Options of one pipeline verification run (all deterministic defaults). */
export interface ReplayPipelineOptions {
  readonly worldId?: WorldId;
  readonly datasetRows?: readonly unknown[];
}

/** The harness's precondition: the dataset must map and import directly. */
function mappedDataset(rows: readonly unknown[]): NautilusDatasetMapping & { ok: true } {
  const catalog = nautilusTraderCatalog(HARNESS_INSTRUMENTS);
  const mapping = mapNautilusDataset(catalog, "nautilus.bars", rows);
  if (!mapping.ok) {
    throw new Error(
      `the harness expected the e2e dataset to map: ${mapping.violations.map((v) => v.detail).join("; ")}`,
    );
  }
  return mapping;
}

/** Execute the whole e2e pipeline once and capture the observation. */
export async function runReplayPipeline(options: ReplayPipelineOptions = {}): Promise<E2EObservation> {
  const worldId = String(options.worldId ?? "world-w022-e2e");
  const mapping = mappedDataset(options.datasetRows ?? CLEAN_BARS);
  const direct = loadHistoricalDataset({
    worldId: options.worldId ?? ("world-w022-e2e" as WorldId),
    descriptor: mapping.datasetDescriptor,
    records: [...mapping.records],
    symbolMap: mapping.symbolMap,
  });
  const datasetFile = { descriptor: mapping.datasetDescriptor, records: mapping.records, symbolMap: mapping.symbolMap };

  const dirA = await e2eDir("w022-e2e-a-");
  const dirB = await e2eDir("w022-e2e-b-");
  const dirC = await e2eDir("w022-e2e-c-");
  await writeJson(dirA, "dataset.json", datasetFile);
  await writeJson(dirB, "dataset.json", datasetFile);
  await writeJson(dirC, "dataset.json", datasetFile);
  const defA = await writeJson(dirA, "definition.json", e2eDefinition(worldId, "./dataset.json"));
  await writeJson(dirB, "definition.json", e2eDefinition(worldId, "./dataset.json"));
  await writeJson(dirC, "definition.json", e2eDefinition(worldId, "./dataset.json"));
  const scriptA = await writeJson(dirA, "script.json", e2eFullScript());
  const scriptB = await writeJson(dirB, "script.json", e2eFullScript());
  const scriptPrefix = await writeJson(dirC, "prefix.json", e2ePrefixScript());
  const scriptCont = await writeJson(dirC, "continuation.json", e2eContinuationScript());

  const twinOne = await collect(
    "run-one-shot",
    ["run", "--definition", defA, "--script", scriptA, "--report", at(dirA, "report.json"), "--journal", at(dirA, "journal.jsonl")],
    at(dirA, "report.json"),
  );
  const twinTwo = await collect(
    "run-twin",
    ["run", "--definition", at(dirB, "definition.json"), "--script", scriptB, "--report", at(dirB, "report.json")],
    at(dirB, "report.json"),
  );
  const prefixRun = await collect(
    "run-prefix",
    ["run", "--definition", at(dirC, "definition.json"), "--script", scriptPrefix, "--report", at(dirC, "prefix-report.json"), "--journal", at(dirC, "prefix-journal.jsonl")],
    at(dirC, "prefix-report.json"),
  );
  const continuation = await collect(
    "replay-continuation",
    ["replay", "--journal", at(dirC, "prefix-journal.jsonl"), "--script", scriptCont, "--report", at(dirC, "continuation-report.json")],
    at(dirC, "continuation-report.json"),
  );
  const replayOne = await collect(
    "replay-self-contained-1",
    ["replay", "--journal", at(dirA, "journal.jsonl"), "--report", at(dirC, "replay-1.json")],
    at(dirC, "replay-1.json"),
  );
  const replayTwo = await collect(
    "replay-self-contained-2",
    ["replay", "--journal", at(dirA, "journal.jsonl"), "--report", at(dirC, "replay-2.json")],
    at(dirC, "replay-2.json"),
  );
  const tamperedDefinition = e2eDefinition(worldId, "./dataset.json");
  (tamperedDefinition.datasets as { id: string }[])[0]!.id = "nautilus-bars-tampered";
  const tamperedDefPath = await writeJson(dirC, "tampered-definition.json", tamperedDefinition);
  const tamperedReplay = await collect(
    "replay-tampered-datasets",
    ["replay", "--journal", at(dirA, "journal.jsonl"), "--definition", tamperedDefPath, "--report", at(dirC, "tampered-report.json")],
    at(dirC, "tampered-report.json"),
  );
  const dirs = [dirA, dirB, dirC];
  return {
    worldId,
    direct: { eventCount: direct.digest.eventCount, eventChecksum: direct.digest.eventChecksum },
    twinOne: scrubPaths(twinOne, dirs),
    twinTwo: scrubPaths(twinTwo, dirs),
    prefixRun: scrubPaths(prefixRun, dirs),
    continuation: scrubPaths(continuation, dirs),
    replayOne: scrubPaths(replayOne, dirs),
    replayTwo: scrubPaths(replayTwo, dirs),
    tamperedReplay: scrubPaths(tamperedReplay, dirs),
  };
}

function at(dir: string, name: string): string {
  return `${dir}/${name}`;
}

/**
 * Scrub machine-local temp paths out of a failed invocation's typed error
 * text: the full message is kept, only the run's own directories are
 * normalized (`<dir-N>`) so the captured evidence stays PATH-FREE — the
 * same verification must produce the same finding digests on any machine
 * (A9), and a tmpdir name is not evidence.
 */
function scrubPaths(outcome: CliRunOutcome, dirs: readonly string[]): CliRunOutcome {
  if (outcome.failureText === "") {
    return outcome;
  }
  let text = outcome.failureText;
  for (const [index, dir] of dirs.entries()) {
    text = text.split(dir).join(`<dir-${String(index)}>`);
  }
  return { ...outcome, failureText: text };
}

/** A pure e2e case verdict (over the captured observation). */
function e2eCase(id: string, describe: string, expected: string, observed: string, problem?: string): CaseVerdict {
  return Object.freeze({
    caseId: id,
    describe,
    expected,
    observed,
    ...(problem === undefined ? {} : { problem }),
  });
}

function failedRunProblem(run: CliRunOutcome): string | undefined {
  return run.exitCode === 0 ? undefined : `the '${run.label}' invocation failed (exit ${String(run.exitCode)}): ${run.failureText.trim()}`;
}

/** Claim 18: the CLI import parity. */
export function cliImportParityFinding(o: E2EObservation): FidelityFinding {
  const run = o.twinOne;
  const evidence = run.datasets[0] as Record<string, unknown> | undefined;
  const checksum = stringField(evidence, "eventChecksum");
  const eventCount = numberField(evidence, "eventCount");
  return findingOf({
    claimId: "e2e-cli-import-parity",
    claim:
      "records every import's journal-ready digest + summary as run-report evidence (journalReadyOnly: true — never claimed as appended) " +
      "(the W031 datasets module declaration)",
    declaredIn: "apps/tradrl-world-cli/src/datasets.ts (module declaration — behavior-bound claim)",
    cases: [
      e2eCase(
        "cli-run-succeeds",
        "the one-shot CLI run over the dataset-declaring definition succeeds",
        "exit code 0",
        `exit code ${String(run.exitCode)}${run.failureText === "" ? "" : `: ${run.failureText.trim()}`}`,
        failedRunProblem(run),
      ),
      e2eCase(
        "cli-evidence-digest-parity",
        "the CLI's dataset evidence carries the same W004 checksum and event count as the direct W020 import of the same triple",
        `eventChecksum == ${o.direct.eventChecksum}, eventCount == ${String(o.direct.eventCount)}`,
        `eventChecksum ${checksum}, eventCount ${String(eventCount)}`,
        checksum === o.direct.eventChecksum && eventCount === o.direct.eventCount
          ? undefined
          : "the CLI evidence and the direct import disagree — the replay-path alignment is broken",
      ),
      e2eCase(
        "cli-honesty-flags",
        "the evidence is journal-ready only and NOT merged into the engine definition (never claimed as appended)",
        "journalReadyOnly === true, mergedIntoDefinition === false",
        `journalReadyOnly ${String(evidence?.journalReadyOnly)}, mergedIntoDefinition ${String(evidence?.mergedIntoDefinition)}`,
        evidence?.journalReadyOnly === true && evidence?.mergedIntoDefinition === false
          ? undefined
          : "the honesty flags drifted — an imported dataset may never be claimed as engine-appended",
      ),
      e2eCase(
        "cli-printed-report-contract",
        "the report printed to stdout canonically equals the written report file",
        "printed == written",
        run.printedEqualsWritten ? "printed == written" : "the printed and written reports differ",
        run.printedEqualsWritten ? undefined : "stdout and the --report file disagree",
      ),
    ],
  });
}

/** Claim 19: twin-run determinism. */
export function twinRunsFinding(o: E2EObservation): FidelityFinding {
  return findingOf({
    claimId: "e2e-a9-twin-runs",
    claim:
      "Determinism (A9): the run is a pure function of (definition + datasets + script) — wall time never enters events, digests, " +
      "the manifest or the report digest (the W031 runner module declaration)",
    declaredIn: "apps/tradrl-world-cli/src/runner.ts (module declaration — behavior-bound claim)",
    cases: [
      e2eCase(
        "twin-report-digests-identical",
        "two independent CLI runs (fresh directories) produce the identical reportDigest",
        `both reportDigest == ${o.twinOne.reportDigest}`,
        `run-1 ${o.twinOne.reportDigest} / run-2 ${o.twinTwo.reportDigest}`,
        failedRunProblem(o.twinOne) ?? failedRunProblem(o.twinTwo) ??
          (o.twinOne.reportDigest === o.twinTwo.reportDigest && o.twinOne.reportDigest !== ""
            ? undefined
            : "the twin runs' report digests differ (A9 broken through the CLI)"),
      ),
      e2eCase(
        "twin-datasets-evidence-identical",
        "the twin runs carry identical dataset evidence",
        "datasets evidence deep-equal",
        o.twinOne.datasetsJson === o.twinTwo.datasetsJson ? "deep-equal" : "different",
        o.twinOne.datasetsJson === o.twinTwo.datasetsJson ? undefined : "the twin runs' dataset evidence differs",
      ),
      e2eCase(
        "twin-journal-checksums-identical",
        "the twin runs produce the identical journal event checksum",
        `both eventChecksum == ${o.twinOne.eventChecksum}`,
        `run-1 ${o.twinOne.eventChecksum} / run-2 ${o.twinTwo.eventChecksum}`,
        o.twinOne.eventChecksum === o.twinTwo.eventChecksum && o.twinOne.eventChecksum !== ""
          ? undefined
          : "the twin runs' journal checksums differ",
      ),
      e2eCase(
        "replay-twin-digests-identical",
        "two replays of the same journal produce the identical reportDigest",
        `both reportDigest == ${o.replayOne.reportDigest}`,
        `replay-1 ${o.replayOne.reportDigest} / replay-2 ${o.replayTwo.reportDigest}`,
        failedRunProblem(o.replayOne) ?? failedRunProblem(o.replayTwo) ??
          (o.replayOne.reportDigest === o.replayTwo.reportDigest && o.replayOne.reportDigest !== ""
            ? undefined
            : "the twin replays' report digests differ"),
      ),
    ],
  });
}

/** Claim 20: the W016 restore equivalence. */
export function restoreEquivalenceFinding(o: E2EObservation): FidelityFinding {
  const restoredChecksum = stringField(o.continuation.restored, "eventChecksum");
  const restoredSnapshots = numberField(o.continuation.restored, "snapshots");
  const continuationContinued = o.continuation.eventCount > o.prefixRun.eventCount;
  return findingOf({
    claimId: "e2e-w016-restore-equivalence",
    claim:
      "the engine restored via createEventJournalFromRecords + the engine's restore.journal genesis (full deterministic replay — " +
      "A9-proven exactly equivalent; snapshot payloads referenced by world.snapshot.created records are rebuilt from the journal " +
      "by the engine fold) (the W031 replay module declaration)",
    declaredIn: "apps/tradrl-world-cli/src/replay.ts (module declaration — behavior-bound claim)",
    cases: [
      e2eCase(
        "restored-journal-digest-matches-recording",
        "the replay's restored journal checksum equals the recorded prefix run's final checksum",
        `restored.eventChecksum == ${o.prefixRun.eventChecksum}`,
        `restored ${restoredChecksum} / recorded ${o.prefixRun.eventChecksum}`,
        failedRunProblem(o.prefixRun) ?? failedRunProblem(o.continuation) ??
          (restoredChecksum === o.prefixRun.eventChecksum && restoredChecksum !== ""
            ? undefined
            : "the restored journal's digest differs from the recorded run's"),
      ),
      e2eCase(
        "continuation-advanced-the-world",
        "the continuation journaled NEW events beyond the restored prefix",
        "continuation.eventCount > prefix.eventCount",
        `continuation ${String(o.continuation.eventCount)} / prefix ${String(o.prefixRun.eventCount)}`,
        continuationContinued ? undefined : "the continuation produced no new events — it did not actually continue",
      ),
      e2eCase(
        "replay-then-continuation-equals-one-shot",
        "replaying the prefix and driving the remaining script equals the one-shot run: identical final checksum, event count and balances",
        `checksum == ${o.twinOne.eventChecksum}, eventCount == ${String(o.twinOne.eventCount)}, balances deep-equal`,
        `checksum ${o.continuation.eventChecksum} / eventCount ${String(o.continuation.eventCount)} / balances ${o.continuation.balancesJson === o.twinOne.balancesJson ? "deep-equal" : "different"}`,
        failedRunProblem(o.twinOne) ?? failedRunProblem(o.continuation) ??
          (o.continuation.eventChecksum === o.twinOne.eventChecksum &&
            o.continuation.eventCount === o.twinOne.eventCount &&
            o.continuation.balancesJson === o.twinOne.balancesJson
            ? undefined
            : "the replay+continuation path diverged from the uninterrupted run (the W016 restore equivalence is broken)"),
      ),
      e2eCase(
        "mid-run-snapshot-rebuilt-by-fold",
        "the mid-run snapshot record was rebuilt by the restore fold (restored.snapshots == 1)",
        "restored.snapshots == 1",
        `restored.snapshots ${String(restoredSnapshots)}`,
        restoredSnapshots === 1 ? undefined : "the restored world did not rebuild the recorded snapshot",
      ),
    ],
  });
}

/** Claim 21: replay input exactness. */
export function replayExactnessFinding(o: E2EObservation): FidelityFinding {
  const refused = o.tamperedReplay.exitCode !== 0 && o.tamperedReplay.failureText.includes("definition-mismatch");
  const selfContainedOk =
    o.replayOne.exitCode === 0 &&
    o.replayOne.restored?.source === "journal-header" &&
    o.replayOne.datasetsJson === o.twinOne.datasetsJson;
  const restoredMatchesRecording =
    stringField(o.replayOne.restored, "eventChecksum") === o.twinOne.eventChecksum && o.twinOne.eventChecksum !== "";
  return findingOf({
    claimId: "e2e-replay-input-exactness",
    claim:
      "a replay must reproduce the recorded run's definition exactly, dataset imports included (the W031 replay module declaration)",
    declaredIn: "apps/tradrl-world-cli/src/replay.ts (module declaration — behavior-bound claim)",
    cases: [
      e2eCase(
        "tampered-datasets-declaration-refused",
        "a replay offered a definition whose datasets declaration was tampered is refused with the typed definition-mismatch error",
        "non-zero exit + 'definition-mismatch' naming the dataset imports",
        `exit ${String(o.tamperedReplay.exitCode)}: ${o.tamperedReplay.failureText.trim().split("\n")[0] ?? ""}`,
        refused && o.tamperedReplay.failureText.includes("dataset imports")
          ? undefined
          : "the tampered datasets declaration was not refused as a definition-mismatch naming the dataset imports",
      ),
      e2eCase(
        "self-contained-replay-restores-recording",
        "a self-contained journal replay (no --definition) restores the recorded state and echoes the recorded dataset evidence",
        "exit 0, restored.source == 'journal-header', datasets evidence == the run's",
        `exit ${String(o.replayOne.exitCode)}, source ${String(o.replayOne.restored?.source)}`,
        selfContainedOk ? undefined : "the self-contained replay did not restore the recorded run faithfully",
      ),
      e2eCase(
        "self-contained-restored-checksum-matches-run",
        "the self-contained replay's restored checksum equals the recorded run's final checksum",
        `restored.eventChecksum == ${o.twinOne.eventChecksum}`,
        `restored ${stringField(o.replayOne.restored, "eventChecksum")}`,
        restoredMatchesRecording ? undefined : "the restored journal's checksum differs from the recorded run's",
      ),
    ],
  });
}

/** Run the pipeline and build all four e2e findings. */
export async function verifyReplayPipeline(options: ReplayPipelineOptions = {}): Promise<readonly FidelityFinding[]> {
  const observation = await runReplayPipeline(options);
  return [
    cliImportParityFinding(observation),
    twinRunsFinding(observation),
    restoreEquivalenceFinding(observation),
    replayExactnessFinding(observation),
  ];
}
