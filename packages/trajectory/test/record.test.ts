/**
 * The trajectory capture laws (W037) — the fail-closed gate: terminal
 * session, world agreement, the W036 pairing law, the §10 chain, the
 * evaluation seam, determinism metadata, immutable lineage; and the
 * assembled-record re-validation gate.
 *
 * Run: pnpm --filter trajectory test
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import type { TimestampMs } from "tradrl-world-contracts";
import type { EvaluationPolicy } from "learning-objectives";
import { trajectoryIdOf } from "../identity.js";
import type { TrajectoryId } from "../identity.js";
import { trajectoryRecordOf, validateTrajectoryRecord } from "../record.js";
import type { TrajectoryRecord } from "../record.js";
import {
  DETERMINISM,
  SCOPE,
  canonicalPasses,
  canonicalResultingStates,
  canonicalTelemetry,
  fixturePolicy,
  passRecord,
  portfolio,
  scopeOf,
  telemetryOf,
} from "./fixtures.js";

function capture(overrides: Partial<Parameters<typeof trajectoryRecordOf>[0]> = {}) {
  return trajectoryRecordOf({
    scope: SCOPE,
    telemetry: canonicalTelemetry(),
    resultingStates: canonicalResultingStates(),
    policy: fixturePolicy(),
    determinism: DETERMINISM,
    ...overrides,
  });
}

test("the canonical capture succeeds and binds the whole outcome", () => {
  const outcome = capture();
  assert.ok(outcome.ok);
  const { record } = outcome;
  assert.equal(record.trajectoryId, trajectoryIdOf(SCOPE));
  assert.equal(record.scope, SCOPE);
  assert.equal(record.session.sessionId, "session-1");
  assert.equal(record.session.status, "detached");
  assert.equal(record.session.passCount, 3);
  assert.equal(record.session.commandsIssued, 1);
  assert.equal(record.session.acked, 1);
  assert.equal(record.session.rejected, 0);
  assert.equal(record.session.admissionRefused, 0);
  assert.equal(record.stream.capsules.length, 3);
  assert.equal(record.evaluation.policyId, "pol-fixture");
  assert.equal(record.evaluation.reward.modelId, "model-fixture");
  assert.equal(record.evaluation.constraints.programId, "cp-soft");
  assert.ok(Number.isFinite(record.evaluation.combinedScore));
  // the root lineage: derived, immutable
  assert.equal(record.lineage.parent, undefined);
  assert.equal(record.lineage.root, record.trajectoryId);
  assert.equal(record.lineage.ordinal, 0);
});

test("the twin determinism law: same session records + metadata ⇒ deep-equal record, same id", () => {
  const first = capture();
  const second = capture();
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.record, second.record);
  assert.equal(first.record.trajectoryId, second.record.trajectoryId);
});

test("a blank scope member is refused, naming the member", () => {
  const outcome = capture({ scope: scopeOf({ worldId: " " }) });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "blank-scope-member"));
  assert.ok(outcome.errors.some((entry) => entry.message.includes("worldId")));
});

test("a non-terminal session has no outcome to record (fail-closed)", () => {
  const outcome = capture({ telemetry: telemetryOf({ passes: canonicalPasses(), status: "attached" }) });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "non-terminal-session"));
});

test("a session in another world is a mixed scope (session-world-mismatch)", () => {
  const outcome = capture({
    telemetry: telemetryOf({ passes: canonicalPasses(), worldId: "world-beta" }),
  });
  assert.ok(!outcome.ok);
  assert.ok(outcome.errors.some((entry) => entry.code === "session-world-mismatch"));
});

test("the pairing law fails typed on a state-count mismatch (W036 errors carried)", () => {
  const outcome = capture({ resultingStates: canonicalResultingStates().slice(0, 2) });
  assert.ok(!outcome.ok);
  const error = outcome.errors.find((entry) => entry.code === "pairing-error");
  assert.ok(error !== undefined);
  assert.ok(error.evidenceErrors?.some((entry) => entry.code === "state-count-mismatch"));
});

test("malformed capsules never record (malformed-evidence, W036 errors carried)", () => {
  // The resulting state read PRECEDES the observation — the fourth §10 link
  // runs backwards; W036's own typed error must surface verbatim.
  const outcome = capture({
    telemetry: telemetryOf({ passes: [passRecord({ pass: 1, observedAt: 1000 })] }),
    resultingStates: [{ asOf: 500 as TimestampMs, portfolio: portfolio({ equity: "100000" }) }],
  });
  assert.ok(!outcome.ok);
  const error = outcome.errors.find((entry) => entry.code === "malformed-evidence");
  assert.ok(error !== undefined);
  assert.ok(error.evidenceErrors?.some((entry) => entry.code === "state-precedes-action"));
});

test("a failed evaluation seam never records (evaluation-error, errors carried)", () => {
  // Test-side double of the W036 policy seam (the seam itself is fully
  // tested in learning-objectives; this proves the capture gate carries a
  // fail-closed evaluation verbatim instead of fabricating summaries).
  const refusing: EvaluationPolicy = {
    descriptor: fixturePolicy().descriptor,
    evaluate: () => ({
      ok: false as const,
      errors: [{ code: "reward-error" as const, message: "fixture refusal (test-side double)" }],
    }),
  };
  const outcome = capture({ policy: refusing });
  assert.ok(!outcome.ok);
  const error = outcome.errors.find((entry) => entry.code === "evaluation-error");
  assert.ok(error !== undefined);
  assert.ok(error.policyErrors?.some((entry) => entry.code === "reward-error"));
});

test("missing determinism metadata is refused, naming the member", () => {
  const outcome = capture({ determinism: { ...DETERMINISM, seed: "" } });
  assert.ok(!outcome.ok);
  assert.ok(
    outcome.errors.some(
      (entry) => entry.code === "missing-determinism-metadata" && entry.message.includes("seed"),
    ),
  );
});

test("a root trajectory derives its lineage; declaring root/ordinal without a parent is refused", () => {
  const ownId = trajectoryIdOf(SCOPE);
  const refused = capture({ lineage: { root: ownId, ordinal: 0 } });
  assert.ok(!refused.ok);
  assert.ok(refused.errors.some((entry) => entry.code === "invalid-lineage"));
});

test("a branched trajectory records its immutable lineage", () => {
  const parentId = trajectoryIdOf(scopeOf({ sessionId: "session-0" })) as TrajectoryId;
  const outcome = capture({ lineage: { parent: parentId, root: parentId, ordinal: 1 } });
  assert.ok(outcome.ok);
  assert.equal(outcome.record.lineage.parent, parentId);
  assert.equal(outcome.record.lineage.root, parentId);
  assert.equal(outcome.record.lineage.ordinal, 1);
});

test("lineage laws: parent without root, self-parent, and ordinal < 1 all fail typed", () => {
  const parentId = trajectoryIdOf(scopeOf({ sessionId: "session-0" })) as TrajectoryId;
  for (const lineage of [
    { parent: parentId },
    { parent: trajectoryIdOf(SCOPE), root: parentId, ordinal: 1 },
    { parent: parentId, root: parentId, ordinal: 0 },
  ]) {
    const outcome = capture({ lineage });
    assert.ok(!outcome.ok, `lineage ${JSON.stringify(lineage)} must fail`);
    assert.ok(outcome.errors.some((entry) => entry.code === "invalid-lineage"));
  }
});

// --- the assembled-record re-validation gate -----------------------------------

test("validateTrajectoryRecord re-proves a lawful record", () => {
  const capture1 = capture();
  assert.ok(capture1.ok);
  const gate = validateTrajectoryRecord(capture1.record);
  assert.ok(gate.ok);
  assert.equal(gate.record, capture1.record);
});

test("validateTrajectoryRecord refuses a tampered identity (identity-mismatch)", () => {
  const outcome = capture();
  assert.ok(outcome.ok);
  const tampered: TrajectoryRecord = {
    ...outcome.record,
    trajectoryId: "traj-deadbeef" as TrajectoryId,
  };
  const gate = validateTrajectoryRecord(tampered);
  assert.ok(!gate.ok);
  assert.ok(gate.errors.some((entry) => entry.code === "identity-mismatch"));
});

test("validateTrajectoryRecord refuses a stream from another world (scope-world-mismatch)", () => {
  const outcome = capture();
  assert.ok(outcome.ok);
  const tampered: TrajectoryRecord = {
    ...outcome.record,
    stream: { ...outcome.record.stream, worldId: "world-beta" },
  };
  const gate = validateTrajectoryRecord(tampered);
  assert.ok(!gate.ok);
  assert.ok(gate.errors.some((entry) => entry.code === "scope-world-mismatch"));
});

test("validateTrajectoryRecord refuses a binding that disagrees with the stream", () => {
  const outcome = capture();
  assert.ok(outcome.ok);
  const tampered: TrajectoryRecord = {
    ...outcome.record,
    session: { ...outcome.record.session, passCount: 99 },
  };
  const gate = validateTrajectoryRecord(tampered);
  assert.ok(!gate.ok);
  assert.ok(gate.errors.some((entry) => entry.code === "binding-stream-mismatch"));
});

test("validateTrajectoryRecord refuses a tampered lineage (invalid-lineage)", () => {
  const outcome = capture();
  assert.ok(outcome.ok);
  const tampered: TrajectoryRecord = {
    ...outcome.record,
    lineage: { ...outcome.record.lineage, ordinal: 5 },
  };
  const gate = validateTrajectoryRecord(tampered);
  assert.ok(!gate.ok);
  assert.ok(gate.errors.some((entry) => entry.code === "invalid-lineage"));
});
