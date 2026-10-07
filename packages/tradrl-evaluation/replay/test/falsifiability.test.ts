/**
 * The falsifiability tests (W022) — the harness's own credibility suite.
 *
 * "A check that cannot fail is worthless": every check family here is
 * proven violable by MUTATION — feeding the pure evaluation halves bad
 * subjects (tampered catalogs, mutated observations, corrupted records) and
 * asserting the harness answers FAIL. The healthy-adapter PASS runs in the
 * sibling test files prove the checks fire on the real surfaces; these
 * tests prove they can fail loudly when the subject drifts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { NautilusCatalogDescriptor } from "tradrl-adapters-nautilus/dtypes";
import { verifyNsConventions } from "../nsChecks.js";
import { verifyDtypeConventions } from "../dtypeChecks.js";
import { verifyTickConventions } from "../tickChecks.js";
import { verifyHonestyClaims } from "../honestyChecks.js";
import {
  cliImportParityFinding,
  restoreEquivalenceFinding,
  replayExactnessFinding,
  runReplayPipeline,
  twinRunsFinding,
  type E2EObservation,
} from "../e2eReplay.js";
import { buildReplayVerificationReport } from "../report.js";
import { findingOf, type FidelityFinding } from "../findings.js";
import { expectImportThrows, expectImported, expectMappedBatch, expectMappedRecord, expectRejectedWith, runCase } from "../cases.js";
import { barRow } from "../fixtures.js";
import { harnessCatalog, verifyFidelityClaims } from "../index.js";

const healthyCatalog = harnessCatalog();

/** A catalog that silently dropped exactly the int64 disclosure (the other five stay). */
function silentGapsCatalog(): NautilusCatalogDescriptor {
  return {
    ...healthyCatalog,
    fidelity: {
      ...healthyCatalog.fidelity,
      knownGaps: healthyCatalog.fidelity.knownGaps.filter((gap) => !gap.includes("safe-integer range")),
    },
  };
}

/** A catalog whose conventions channel was reworded away. */
function rewordedConventionsCatalog(): NautilusCatalogDescriptor {
  return { ...healthyCatalog, fidelity: { ...healthyCatalog.fidelity, conventions: ["we convert timestamps somehow"] } };
}

test("expectation mutations: a mapped record violating the property fails the case", () => {
  const expectation = expectMappedRecord("openTime == T0", (record) => {
    if (record.kind !== "bar") return "not a bar";
    return record.openTime === 1_700_448_000_000 ? undefined : "openTime differs";
  });
  const good = expectation.verify({ kind: "mapped", record: { ...barRow(), kind: "bar", symbol: "BTCUSDT-BINANCE", openTime: 1_700_448_000_000 as never, closeTime: 1_700_448_060_000 as never, open: "48000.1" as never, high: "48000.6" as never, low: "48000" as never, close: "48000.4" as never, volume: "12.5" as never, availableAt: 1_700_448_060_000 as never } as never });
  assert.equal(good, undefined);
  const bad = expectation.verify({ kind: "mapped", record: { kind: "bar", symbol: "X", openTime: 42 as never, closeTime: 43 as never, open: "1" as never, high: "1" as never, low: "1" as never, close: "1" as never, volume: "1" as never } as never });
  assert.match(bad ?? "", /openTime differs/);
});

test("expectation mutations: a healthy row where a loud rejection was required fails the case", () => {
  const expectation = expectRejectedWith("a loud rejection", "timestamp-out-of-range", "sanity window");
  const healthyRowMapped = expectation.verify({ kind: "mapped", record: { kind: "trade", symbol: "X", timestamp: 1 as never, price: "1" as never, quantity: "1" as never, aggressorSide: "buy", tradeId: "1" } as never });
  assert.match(healthyRowMapped ?? "", /expected a loud typed rejection/);
  const wrongKind = expectation.verify({ kind: "rejected", violations: [{ kind: "malformed-record", detail: "other" }] });
  assert.match(wrongKind ?? "", /expected a 'timestamp-out-of-range' violation/);
  const missingNeedle = expectation.verify({ kind: "rejected", violations: [{ kind: "timestamp-out-of-range", detail: "no window named here" }] });
  assert.match(missingNeedle ?? "", /to name 'sanity window'/);
});

test("expectation mutations: batch and import expectations fail on the wrong outcome shape", () => {
  const batch = expectMappedBatch("gaps declared", (b) => (b.knownGaps.length === 1 ? undefined : "gaps differ"));
  const rejectedBatch = batch.verify({ kind: "rejected", violations: [] });
  assert.match(rejectedBatch ?? "", /expected the adapter to map the batch/);
  const wrongGaps = batch.verify({
    kind: "mapped-batch",
    records: [],
    datasetId: "d",
    range: {},
    knownGaps: [],
    limitations: [],
  });
  assert.match(wrongGaps ?? "", /gaps differ/);
  const imported = expectImported("imported cleanly");
  const threw = imported.verify({ kind: "import-threw", violations: [] });
  assert.match(threw ?? "", /expected the W020 loader to import/);
  const expectThrow = expectImportThrows("rejected loudly", "out-of-order-records");
  const clean = expectThrow.verify({ kind: "imported", recordCount: 1, eventCount: 1, eventChecksum: "x", summary: {} as never });
  assert.match(clean ?? "", /expected the W020 loader to reject the import/);
});

test("runCase fails closed when the harness itself crashes (never a pass)", () => {
  const verdict = runCase({
    id: "crash",
    describe: "a crashing execution",
    expectation: expectMappedRecord("anything", () => undefined),
    observe: () => {
      throw new Error("boom");
    },
  });
  assert.match(verdict.problem ?? "", /the harness itself failed/);
});

test("a catalog that dropped one disclosure fails exactly that scoped claim (undisclosed limitation)", () => {
  const nsFindings = verifyNsConventions(silentGapsCatalog());
  const carrier = nsFindings.find((f) => f.claimId === "int64-carrier-fidelity");
  assert.ok(carrier);
  assert.equal(carrier.verdict, "FAIL");
  assert.match(carrier.problem ?? "", /limitation-disclosed/);
  // The OTHER scoped claim still holds (its own limitation stays disclosed)
  // — the honesty channel is per-limitation, never all-or-nothing.
  const truncation = nsFindings.find((f) => f.claimId === "ns-to-ms-exact-digit-truncation");
  assert.ok(truncation);
  assert.equal(truncation.verdict, "PARTIAL");
  const disclosures = verifyHonestyClaims(silentGapsCatalog()).find((f) => f.claimId === "known-gap-declaration-honesty");
  assert.ok(disclosures);
  assert.equal(disclosures.verdict, "FAIL");
  assert.equal(violatedCaseCount(disclosures), 1);
  assert.equal(disclosures.cases.find((entry) => entry.problem !== undefined)?.caseId, "discloses-int64-json-rounding");
});

test("a catalog that reworded its conventions away fails the declaration binding (never a stale quote)", () => {
  const nsFindings = verifyNsConventions(rewordedConventionsCatalog());
  // The two conventions-bound claims fail the binding (never a stale quote)…
  for (const id of ["ns-to-ms-exact-digit-truncation", "ns-sanity-window-1990-2100"]) {
    const finding = nsFindings.find((f) => f.claimId === id);
    assert.ok(finding);
    assert.equal(finding.verdict, "FAIL", id);
    assert.match(finding.problem ?? "", /no longer declares this claim/);
  }
  // …while the knownGaps-bound carrier claim is untouched (its own channel
  // still carries the disclosure) — binding is per-declaration-channel.
  const carrier = nsFindings.find((f) => f.claimId === "int64-carrier-fidelity");
  assert.ok(carrier);
  assert.equal(carrier.verdict, "PARTIAL");
  const tickFindings = verifyTickConventions(rewordedConventionsCatalog());
  for (const id of ["aggressor-side-mapping", "float64-canonical-decimal"]) {
    const finding = tickFindings.find((f) => f.claimId === id);
    assert.ok(finding);
    assert.equal(finding.verdict, "FAIL");
    assert.match(finding.problem ?? "", /no longer declares this claim/);
  }
  const dtypeFindings = verifyDtypeConventions({ ...rewordedConventionsCatalog(), dtypes: [] });
  for (const finding of dtypeFindings) {
    assert.equal(finding.verdict, "FAIL");
  }
});

test("a catalog claiming parquet IO fails the acquisition claim BY LAW", () => {
  const dishonest = {
    ...healthyCatalog,
    acquisition: { ...healthyCatalog.acquisition, parquetCatalog: "implemented" as never },
  };
  const acquisition = verifyHonestyClaims(dishonest).find((f) => f.claimId === "acquisition-honesty");
  assert.ok(acquisition);
  assert.equal(acquisition.verdict, "FAIL");
  // The by-law case itself HELD (the invalid-catalog law fired on the tampered
  // claim); the finding fails because the dishonesty cascades — the tampered
  // catalog can no longer map the clean batch the sibling case needs.
  const lawCase = acquisition.cases.find((c) => c.caseId === "catalog-claiming-parquet-is-invalid");
  assert.equal(lawCase?.problem, undefined);
  const cascade = acquisition.cases.find((c) => c.caseId === "descriptor-limitations-carry-baseline-disclosure");
  assert.ok(cascade?.problem);
  // Crash isolation: a check that cannot run at all (the batch engine refuses
  // the invalid catalog) still reports its claim instead of crashing the harness.
  const determinism = verifyHonestyClaims(dishonest).find((f) => f.claimId === "a9-double-map-determinism");
  assert.equal(determinism?.verdict, "FAIL");
  assert.match(determinism?.cases[0]?.problem ?? "", /the harness failed while verifying this claim/);
});

test("a record whose availableAt precedes its close fails the A7 property (the corruption the adapter must catch)", () => {
  const availability = expectMappedRecord("availableAt >= closeTime", (record) => {
    if (record.kind !== "bar") return "not a bar";
    return record.availableAt !== undefined && record.availableAt < record.closeTime ? "A7 violated" : undefined;
  });
  const corrupted = availability.verify({
    kind: "mapped",
    record: {
      kind: "bar",
      symbol: "BTCUSDT-BINANCE",
      openTime: 1 as never,
      closeTime: 1_700_448_060_000 as never,
      open: "1" as never,
      high: "1" as never,
      low: "1" as never,
      close: "1" as never,
      volume: "1" as never,
      availableAt: 1_700_448_030_000 as never,
    } as never,
  });
  assert.match(corrupted ?? "", /A7 violated/);
});

test("the e2e findings fail on mutated pipeline observations (each verdict is falsifiable)", async () => {
  const healthy = await runReplayPipeline();
  // Sanity: the healthy observation passes everything (the sibling suite pins this).
  for (const finding of [cliImportParityFinding(healthy), twinRunsFinding(healthy), restoreEquivalenceFinding(healthy), replayExactnessFinding(healthy)]) {
    assert.equal(finding.verdict, "PASS", `${finding.claimId}: healthy pipeline passes`);
  }
  // Mutation 1: the twin digests diverge.
  const divergent: E2EObservation = { ...healthy, twinTwo: { ...healthy.twinTwo, reportDigest: "a-different-digest" } };
  assert.equal(twinRunsFinding(divergent).verdict, "FAIL");
  // Mutation 2: the CLI evidence checksum disagrees with the direct import.
  const mismatchedEvidence: E2EObservation = {
    ...healthy,
    twinOne: { ...healthy.twinOne, datasets: [{ ...(healthy.twinOne.datasets[0] as Record<string, unknown>), eventChecksum: "not-the-direct-checksum" }] },
  };
  const parity = cliImportParityFinding(mismatchedEvidence);
  assert.equal(parity.verdict, "FAIL");
  assert.match(parity.problem ?? "", /cli-evidence-digest-parity/);
  // Mutation 3: the replayed continuation diverges from the one-shot run.
  const divergentRestore: E2EObservation = { ...healthy, continuation: { ...healthy.continuation, eventChecksum: "a-divergent-checksum" } };
  const restore = restoreEquivalenceFinding(divergentRestore);
  assert.equal(restore.verdict, "FAIL");
  assert.match(restore.problem ?? "", /replay-then-continuation-equals-one-shot/);
  // Mutation 4: the tampered datasets declaration was silently accepted.
  const acceptedTamper: E2EObservation = { ...healthy, tamperedReplay: { ...healthy.tamperedReplay, exitCode: 0, failureText: "" } };
  const exactness = replayExactnessFinding(acceptedTamper);
  assert.equal(exactness.verdict, "FAIL");
  assert.match(exactness.problem ?? "", /tampered-datasets-declaration-refused/);
});

test("the report is tamper-evident: mutating a finding changes the content digest", () => {
  const healthy = verifyFidelityClaims(healthyCatalog);
  const pass = buildReplayVerificationReport({ catalogId: "nautilus", findings: healthy });
  const corrupted: FidelityFinding = findingOf({
    claimId: "corrupted",
    claim: "a claim",
    declaredIn: "d",
    cases: [{ caseId: "c", describe: "d", expected: "e", observed: "o", problem: "p" }],
  });
  const tampered = buildReplayVerificationReport({ catalogId: "nautilus", findings: [corrupted] });
  assert.equal(pass.summary.fail, 0);
  assert.equal(tampered.summary.fail, 1);
  assert.notEqual(pass.contentDigest, tampered.contentDigest);
  assert.equal(buildReplayVerificationReport({ catalogId: "nautilus", findings: healthy }).contentDigest, pass.contentDigest);
});

/** Count a finding's violated cases (helper for the disclosure assertion). */
function violatedCaseCount(finding: FidelityFinding): number {
  return finding.cases.filter((entry) => entry.problem !== undefined).length;
}
