/**
 * The W063 publication-gate tests — REAL imports only (the no-shim law):
 * the cited records are built through the genuine seams of the consumed
 * packages: the completed outcome (W052 family + W038 evaluation +
 * verification findings + W051 history) through the W053 fixture lineage
 * (`services/outcome-learning/test/fixtures` — itself built through W052's
 * own `buildSplitFamily`, W038's own `evaluateExperiment` +
 * `verifyExperimentEvaluation` over a REAL W037 experiment, and W051's own
 * `buildSearchHistory` over the REAL W051 sealed-view fixtures); the audit
 * trail through W061's own `mintAuditRecord` + operations' own
 * `assembleTrail`; the replay-fidelity verdicts through W022's own
 * `verifyFidelityClaims`. The gate under test is this directory's own
 * `validate.ts`. Zero fixture drift; only opaque-id leaf values are cast.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  aForeignExperimentHistory,
  aForeignScopeFamily,
  aSoftOutcome,
  aStrangerFamily,
} from "../../services/outcome-learning/test/fixtures.js";
import { PROJECT, TENANT, WORLD } from "../../packages/tradrl-time-machine/test/fixtures.js";
import { validateSplitFamily } from "../../packages/evaluation-splits/index.js";
import type { SplitFamilyId } from "../../packages/evaluation-splits/index.js";
import { mintAuditRecord as mintAudit } from "../../packages/observability/index.js";
import type {
  AuditRecord,
  AuditTrail,
  OpsScope,
  SourceCitation,
} from "../../packages/observability/index.js";
import { assembleTrail, verifyTrail } from "../../services/operations/trail.js";
import { verifyFidelityClaims } from "../../packages/tradrl-evaluation/replay/index.js";
import { validateSearchHistory } from "../../packages/search-integrity/index.js";
import type { SearchHistoryId } from "../../packages/search-integrity/index.js";
import { composeBenchmarkPublication, reproveBenchmarkPublication, validateBenchmarkPublication } from "./validate.js";
import type { PublicationRecordsInput } from "./validate.js";
import type { BenchmarkPublication, BenchmarkPublicationId } from "./benchmark-publications.js";

const WALK_FORWARD = "pub-walk-forward-evidence-v1";
const HEX8 = /[0-9a-f]{8}/;

/** The cited records, built through the real seams (module-deterministic). */
const OUTCOME = aSoftOutcome();
const FIDELITY = verifyFidelityClaims();

const PUBLICATION_SCOPE: OpsScope = {
  kind: "tenant-project-world",
  tenantId: TENANT,
  projectId: PROJECT,
  worldId: WORLD,
};

const NO_SOURCE: SourceCitation = { kind: "none", reason: "no-declared-source" };

function auditAt(sequence: number): AuditRecord {
  const outcome = mintAudit({
    sequence,
    action: "world-accessed",
    scope: PUBLICATION_SCOPE,
    actor: { kind: "platform", actorId: "platform-core" },
    subject: `subject-${sequence}`,
    detail: { route: "benchmark-publication", code: 200 },
    provenance: NO_SOURCE,
    declaredAt: 30_000 + sequence,
  });
  if (!outcome.ok) {
    throw new Error(`fixture audit record is unlawful: ${JSON.stringify(outcome.violations)}`);
  }
  return outcome.record;
}

function aTrail(): AuditTrail {
  const outcome = assembleTrail([auditAt(1), auditAt(2), auditAt(3)]);
  if (!outcome.ok) {
    throw new Error(`fixture trail is unlawful: ${JSON.stringify(outcome.violations)}`);
  }
  return outcome.trail;
}

const TRAIL = aTrail();

function records(): PublicationRecordsInput {
  return {
    family: OUTCOME.family,
    evaluation: OUTCOME.evaluation,
    findings: OUTCOME.findings,
    history: OUTCOME.history,
    trail: TRAIL,
    fidelity: FIDELITY,
  };
}

function composeOver(input: PublicationRecordsInput, familyId: string = WALK_FORWARD) {
  return composeBenchmarkPublication({ ...input, familyId });
}

const BASE = composeOver(records());
if (!BASE.ok) {
  throw new Error(`fixture publication failed composition: ${JSON.stringify(BASE.errors)}`);
}
const PUBLICATION = BASE.publication;

function codesOf(outcome: { ok: boolean; errors?: readonly { code: string }[] }): string[] {
  return outcome.ok ? [] : (outcome.errors ?? []).map((error) => error.code);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("the happy path: a publication composes, validates and re-proves over REAL cited records", () => {
  const composed = composeOver(records());
  assert.ok(composed.ok);
  const publication = composed.publication;
  assert.match(publication.publicationId, /^bp-[0-9a-f]{8}$/);
  assert.equal(publication.familyId, WALK_FORWARD);
  assert.equal(publication.scope.tenantId, TENANT);
  assert.equal(publication.scope.projectId, PROJECT);
  assert.equal(publication.scope.worldId, WORLD);
  // every citation member is CARRIED by the cited record (A6) — asserted
  // against the live records' own values, never re-derived here
  assert.equal(publication.family.familyId, String(OUTCOME.family.familyId));
  assert.equal(publication.family.kind, OUTCOME.family.kind);
  assert.equal(publication.family.splitCount, OUTCOME.family.splits.length);
  assert.equal(publication.family.foldCount, OUTCOME.family.folds.length);
  assert.equal(publication.evaluation.evaluationId, String(OUTCOME.evaluation.evaluationId));
  assert.equal(publication.evaluation.experimentId, String(OUTCOME.evaluation.experimentId));
  assert.equal(publication.evaluation.findingsDigest, String(OUTCOME.findings.digest));
  assert.equal(publication.evaluation.trajectoryCount, OUTCOME.evaluation.trajectories.length);
  assert.equal(publication.evaluation.passCount, OUTCOME.findings.passCount);
  assert.equal(publication.history.historyId, String(OUTCOME.history.historyId));
  assert.equal(publication.history.trialCount, OUTCOME.history.trials.length);
  assert.equal(publication.trail.trailId, String(TRAIL.trailId));
  assert.equal(publication.trail.recordCount, TRAIL.records.length);
  assert.equal(publication.trail.head, TRAIL.head);
  assert.ok(publication.reproducibility.claims.length >= 1);
  for (const claim of publication.reproducibility.claims) {
    assert.match(claim.findingDigest, HEX8);
  }
  assert.deepEqual(validateBenchmarkPublication(publication), { ok: true, publication });
  const reproved = reproveBenchmarkPublication(publication, records());
  assert.ok(reproved.ok);
});

test("the A9 twin: the same cited records compose the deep-equal publication, the same id, and the input order never leaks", () => {
  const twin = composeOver(deepClone(records()));
  assert.ok(twin.ok);
  assert.deepEqual(twin.publication, PUBLICATION);
  assert.equal(String(twin.publication.publicationId), String(PUBLICATION.publicationId));
  const reversed = composeOver({ ...records(), fidelity: [...FIDELITY].reverse() });
  assert.ok(reversed.ok);
  assert.deepEqual(reversed.publication, PUBLICATION);
});

test("unknown-publication-family: a publication citing an undeclared family is refused", () => {
  const outcome = composeOver(records(), "pub-not-in-the-catalogue");
  assert.deepEqual(codesOf(outcome), ["unknown-publication-family"]);
});

test("family-kind-mismatch: the declared family's kind must agree with the cited split family", () => {
  const outcome = composeOver(records(), "pub-regime-evidence-v1");
  assert.ok(codesOf(outcome).includes("family-kind-mismatch"));
});

test("invalid-family: W052's own whole-record re-validation errors are carried VERBATIM", () => {
  const tampered = { ...OUTCOME.family, familyId: "fam-tampered-0000" as SplitFamilyId };
  const expected = validateSplitFamily(tampered);
  assert.ok(!expected.ok);
  const outcome = composeOver({ ...records(), family: tampered });
  const carried = outcome.ok ? undefined : outcome.errors.find((error) => error.code === "invalid-family")?.familyErrors;
  assert.deepEqual(carried, expected.errors);
});

test("invalid-history: W051's own whole-record re-validation errors are carried VERBATIM", () => {
  const tampered = { ...OUTCOME.history, historyId: "sh-tampered-0000" as SearchHistoryId };
  const expected = validateSearchHistory(tampered);
  assert.ok(!expected.ok);
  const outcome = composeOver({ ...records(), history: tampered });
  const carried = outcome.ok ? undefined : outcome.errors.find((error) => error.code === "invalid-history")?.historyErrors;
  assert.deepEqual(carried, expected.errors);
});

test("invalid-trail: W061's own end-to-end verification failure is carried VERBATIM", () => {
  const tampered = { ...TRAIL, records: TRAIL.records.slice(0, 2) };
  const expected = verifyTrail(tampered);
  assert.ok(!expected.ok);
  const outcome = composeOver({ ...records(), trail: tampered });
  const carried = outcome.ok ? undefined : outcome.errors.find((error) => error.code === "invalid-trail")?.trailFailure;
  assert.deepEqual(carried, expected);
});

test("scope-mismatch: a lawful family scoped to another world is refused", () => {
  const outcome = composeOver({ ...records(), family: aForeignScopeFamily() });
  assert.ok(codesOf(outcome).includes("scope-mismatch"));
});

test("experiment-mismatch: a search history from another experiment is refused", () => {
  const outcome = composeOver({ ...records(), history: aForeignExperimentHistory("exp-not-this-one") });
  assert.ok(codesOf(outcome).includes("experiment-mismatch"));
});

test("family-did-not-judge: a lawful stranger family that never judged this evaluation is refused", () => {
  const outcome = composeOver({ ...records(), family: aStrangerFamily() });
  assert.ok(codesOf(outcome).includes("family-did-not-judge"));
});

test("unbacked-reproducibility-claim: a required claim without a carried fidelity verdict is refused", () => {
  const thinned = FIDELITY.filter((finding) => finding.claimId !== "int64-carrier-fidelity");
  const outcome = composeOver({ ...records(), fidelity: thinned });
  const codes = codesOf(outcome);
  assert.ok(codes.includes("unbacked-reproducibility-claim"));
  const message = outcome.ok ? "" : (outcome.errors.find((error) => error.code === "unbacked-reproducibility-claim")?.message ?? "");
  assert.match(message, /int64-carrier-fidelity/);
});

test("unknown-claim: a manifest claim outside W022's registry is refused loudly", () => {
  const tampered: BenchmarkPublication = {
    ...PUBLICATION,
    reproducibility: {
      ...PUBLICATION.reproducibility,
      claims: PUBLICATION.reproducibility.claims.map((claim, index) =>
        index === 0 ? { ...claim, claimId: "claim-not-in-the-registry" } : claim,
      ),
    },
  };
  const outcome = validateBenchmarkPublication(tampered);
  assert.ok(codesOf(outcome).includes("unknown-claim"));
});

test("carried-number-mismatch: an invented trajectory count is refused loudly (A6)", () => {
  const tampered: BenchmarkPublication = {
    ...PUBLICATION,
    evaluation: { ...PUBLICATION.evaluation, trajectoryCount: PUBLICATION.evaluation.trajectoryCount + 1 },
  };
  const outcome = reproveBenchmarkPublication(tampered, records());
  const codes = codesOf(outcome);
  assert.ok(codes.includes("carried-number-mismatch"));
  const message = outcome.ok ? "" : (outcome.errors.find((error) => error.code === "carried-number-mismatch")?.message ?? "");
  assert.match(message, /trajectory count/);
});

test("carried-number-mismatch: manifest tallies that disagree with the carried verdicts are refused", () => {
  const tampered: BenchmarkPublication = {
    ...PUBLICATION,
    reproducibility: { ...PUBLICATION.reproducibility, passCount: PUBLICATION.reproducibility.passCount + 1 },
  };
  const outcome = validateBenchmarkPublication(tampered);
  assert.ok(codesOf(outcome).includes("carried-number-mismatch"));
});

test("unbacked manifest drift: an edited verdict that the cited findings do not carry is refused", () => {
  const claims = PUBLICATION.reproducibility.claims;
  const first = claims[0];
  assert.ok(first !== undefined);
  const flipped = first.verdict === "PASS" ? "FAIL" : "PASS";
  const tampered: BenchmarkPublication = {
    ...PUBLICATION,
    reproducibility: {
      ...PUBLICATION.reproducibility,
      claims: claims.map((claim, index) => (index === 0 ? { ...claim, verdict: flipped } : claim)),
    },
  };
  const outcome = reproveBenchmarkPublication(tampered, records());
  assert.ok(codesOf(outcome).includes("invalid-publication"));
});

test("lineage-break: an incoherent immutable lineage is refused", () => {
  const continuation = composeBenchmarkPublication({
    ...records(),
    familyId: WALK_FORWARD,
    lineage: { parent: PUBLICATION.publicationId },
  });
  assert.ok(!continuation.ok);
  assert.deepEqual(codesOf(continuation), ["lineage-break"]);
  const ordinalled = composeBenchmarkPublication({
    ...records(),
    familyId: WALK_FORWARD,
    lineage: { ordinal: 5 },
  });
  assert.ok(!ordinalled.ok);
  assert.deepEqual(codesOf(ordinalled), ["lineage-break"]);
});

test("invalid-publication: a rewritten record id does not re-derive (A9)", () => {
  const tampered: BenchmarkPublication = {
    ...PUBLICATION,
    publicationId: `bp-deadbeef` as BenchmarkPublicationId,
  };
  const outcome = validateBenchmarkPublication(tampered);
  const codes = codesOf(outcome);
  assert.ok(codes.includes("invalid-publication"));
  const message = outcome.ok ? "" : (outcome.errors.find((error) => error.code === "invalid-publication")?.message ?? "");
  assert.match(message, /does not re-derive/);
});

test("malformed-input: an input carrying no cited records is refused", () => {
  const outcome = composeBenchmarkPublication({ familyId: WALK_FORWARD } as unknown as Parameters<typeof composeBenchmarkPublication>[0]);
  assert.deepEqual(codesOf(outcome), ["malformed-input"]);
});
