/**
 * The end-to-end replay verification tests (W022): the dataset runs through
 * the REAL W020 loader and the REAL W031 CLI run/replay path (in-process
 * `main(argv)`), and the four pipeline claims hold — import parity, A9 twin
 * stability, the W016 restore equivalence, replay input exactness — plus the
 * composed content-addressed report.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cliImportParityFinding,
  restoreEquivalenceFinding,
  replayExactnessFinding,
  runReplayPipeline,
  twinRunsFinding,
} from "../e2eReplay.js";
import { buildReplayVerificationReport, dumpReplayVerificationReport, REPLAY_VERIFICATION_SCHEMA } from "../report.js";
import { verifyNautilusReplayFidelity, verifyFidelityClaims, harnessCatalog } from "../index.js";

const observation = await runReplayPipeline();

test("the four e2e pipeline claims hold against the real CLI", () => {
  const findings = [
    cliImportParityFinding(observation),
    twinRunsFinding(observation),
    restoreEquivalenceFinding(observation),
    replayExactnessFinding(observation),
  ];
  assert.deepEqual(
    findings.map((f) => f.claimId),
    ["e2e-cli-import-parity", "e2e-a9-twin-runs", "e2e-w016-restore-equivalence", "e2e-replay-input-exactness"],
  );
  for (const finding of findings) {
    assert.equal(finding.verdict, "PASS", `${finding.claimId}: ${finding.problem ?? "held"}`);
  }
});

test("the CLI evidence equals the direct W020 import bit-for-bit", () => {
  const evidence = observation.twinOne.datasets[0] as Record<string, unknown>;
  assert.equal(evidence?.eventChecksum, observation.direct.eventChecksum);
  assert.equal(evidence?.eventCount, observation.direct.eventCount);
  assert.equal(evidence?.journalReadyOnly, true);
  assert.equal(evidence?.mergedIntoDefinition, false);
  assert.equal(observation.twinOne.printedEqualsWritten, true);
});

test("the W016 restore equivalence holds exactly: replay+continuation == one-shot", () => {
  assert.equal(observation.twinOne.exitCode, 0);
  assert.equal(observation.prefixRun.exitCode, 0);
  assert.equal(observation.continuation.exitCode, 0);
  assert.equal(observation.continuation.eventChecksum, observation.twinOne.eventChecksum);
  assert.equal(observation.continuation.eventCount, observation.twinOne.eventCount);
  assert.equal(observation.continuation.balancesJson, observation.twinOne.balancesJson);
  assert.ok(observation.continuation.eventCount > observation.prefixRun.eventCount);
  assert.equal(observation.continuation.restored?.snapshots, 1);
  assert.equal(observation.twinOne.eventChecksum, observation.twinTwo.eventChecksum);
});

test("the tampered-datasets replay is refused with the typed definition-mismatch error", () => {
  assert.equal(observation.tamperedReplay.exitCode, 2);
  assert.match(observation.tamperedReplay.failureText, /definition-mismatch/);
  assert.match(observation.tamperedReplay.failureText, /dataset imports/);
});

test("the full verification report: 21 claims, deterministic content digest, stable typed dump", async () => {
  const reportOne = await verifyNautilusReplayFidelity();
  const reportTwo = await verifyNautilusReplayFidelity();
  assert.equal(reportOne.schemaVersion, REPLAY_VERIFICATION_SCHEMA);
  assert.equal(reportOne.findings.length, 21);
  assert.deepEqual(reportOne.summary, { pass: 19, fail: 0, partial: 2, total: 21 });
  // A9 across two independent full verifications (including the e2e pipeline
  // re-run in fresh temp directories): identical content address.
  assert.equal(reportOne.contentDigest, reportTwo.contentDigest);
  assert.deepEqual(reportOne.findingDigests, reportTwo.findingDigests);
  // The typed dump is stable (same report ⇒ identical text, no time/paths).
  assert.equal(dumpReplayVerificationReport(reportOne), dumpReplayVerificationReport(reportTwo));
  assert.ok(dumpReplayVerificationReport(reportOne).includes("summary: 19 pass / 0 fail / 2 partial (21 claims)"));
  // The report's claims inventory matches the emitted findings 1:1.
  const fidelity = verifyFidelityClaims(harnessCatalog());
  assert.equal(reportOne.findings.length, fidelity.length + 4);
});

test("the report dump names every claim verdict, carries no paths, and content-addresses itself", async () => {
  const report = await verifyNautilusReplayFidelity();
  const dump = dumpReplayVerificationReport(report);
  for (const finding of report.findings) {
    assert.ok(dump.includes(`${finding.verdict}  ${finding.claimId}`), `${finding.claimId}: verdict line present`);
  }
  assert.ok(dump.includes(`content digest: ${report.contentDigest}`));
  assert.ok(!dump.includes("/tmp/"), "the dump carries no filesystem paths (deterministic evidence)");
});

test("the report digest binds to its findings: any finding change breaks the content address", async () => {
  const report = await verifyNautilusReplayFidelity();
  const rebuilt = buildReplayVerificationReport({
    catalogId: report.subject.catalogId,
    findings: report.findings.slice(0, -1),
  });
  assert.notEqual(rebuilt.contentDigest, report.contentDigest);
});
