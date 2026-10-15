/**
 * The W062 operations-trail PERFORMANCE EVIDENCE suite — REAL imports only
 * (the no-shim law): every audit record is minted through W061's own
 * `mintAuditRecord` gate (typed declarations, mixed W028 provenance — the
 * services/operations fixture lineage), every trail assembled + verified
 * through services/operations' own `assembleTrail` + `verifyTrail` (the
 * end-to-end hash-chain tamper gate: ids re-derived, the whole digest chain
 * recomputed from the scope anchor, the head + trail id re-derived).
 *
 * The discipline (tests/performance/measurements.ts): this suite REPORTS one
 * live PinnedMeasurement per exercised scale (the `PERF-EVIDENCE` lines)
 * BESIDE the pinned baseline — PINNED_BASELINE ships EMPTY at this head (it
 * is filled by a pinning run; the prior session died before pinning), so the
 * baseline-relative 10x law below engages only when a matching entry exists,
 * and the shipped CEILING_* constants govern meanwhile (disclosed here and in
 * the PR body). The ASSERTIONS are over DETERMINISTIC LAWS only — the
 * verified record count is carried by the verification outcome itself and
 * equals the composed record count exactly (A6: every expected count is
 * DERIVED from the composed records), order invariance (A9 — the mint order
 * never leaks into the sealed trail), the tamper gate naming the exact break
 * index, and error-collection completeness at scale (never short-circuited).
 * NEVER wall-clock equality (A9 has no clocks; a measurement here is
 * evidence, not a law).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CEILING_MS_PER_SEAL,
  CEILING_MS_PER_TRAIL_RECORD,
  PINNED_BASELINE,
  measurementOf,
  report,
  type PinnedMeasurement,
} from "./measurements.js";
import {
  mintAuditRecord,
  type AuditRecord,
  type OpsScope,
  type SourceCitation,
} from "../../packages/observability/index.js";
import { assembleTrail, verifyTrail } from "../../services/operations/index.js";

// ---------------------------------------------------------------------------
// The measurement discipline (REPORT beside the baseline; assert only laws +
// generous ceilings — never wall-clock equality)
// ---------------------------------------------------------------------------

/** The generous baseline tolerance: a live run may be this much slower than a
 * pinned baseline entry before the suite calls it an environment pathology. */
const BASELINE_TOLERANCE = 10;

function measureMs<T>(run: () => T): { readonly measuredMs: number; readonly value: T } {
  const started = process.hrtime.bigint();
  const value = run();
  const measuredMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  return { measuredMs, value };
}

function reportBesideBaseline(live: PinnedMeasurement, ceilingMs: number): void {
  report(live);
  const pinned = PINNED_BASELINE.find(
    (entry) =>
      entry.law === live.law &&
      entry.subject === live.subject &&
      entry.inputCount === live.inputCount,
  );
  if (pinned === undefined) {
    console.log(
      `PERF-BASELINE ${live.law} | ${live.subject} | input=${String(live.inputCount)} | no pinned entry (PINNED_BASELINE carries ${String(PINNED_BASELINE.length)} entries at this head) — the shipped ceiling ${String(ceilingMs)}ms governs this run (disclosed)`,
    );
  } else {
    console.log(
      `PERF-BASELINE ${live.law} | ${live.subject} | input=${String(live.inputCount)} | pinned ${String(pinned.measuredMs)}ms at head ${pinned.measuredAtHead}`,
    );
    assert.ok(
      live.measuredMs <= BASELINE_TOLERANCE * pinned.measuredMs,
      `${live.law} at input=${String(live.inputCount)}: live ${String(live.measuredMs)}ms exceeds ${String(BASELINE_TOLERANCE)}x the pinned ${String(pinned.measuredMs)}ms — an environment pathology, not a law`,
    );
  }
  assert.ok(
    live.measuredMs <= ceilingMs,
    `${live.law} at input=${String(live.inputCount)}: live ${String(live.measuredMs)}ms exceeds the shipped reliability ceiling ${String(ceilingMs)}ms — a broken build/environment, not a slow machine`,
  );
}

/** A deterministic shuffle (a fixed-seed LCG — no randomness, A9). */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const shuffled = [...items];
  let state = (seed >>> 0) || 1;
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const j = state % (i + 1);
    const swap = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = swap;
  }
  return shuffled;
}

// ---------------------------------------------------------------------------
// The deterministic fixtures (W061's own mint gate — the operations fixture
// lineage, hand-authored ids/times/provenance)
// ---------------------------------------------------------------------------

const SCOPE: OpsScope = {
  kind: "tenant-project-world",
  tenantId: "tenant-w062",
  projectId: "project-w062",
  worldId: "world-w062-perf",
};
const FOREIGN_SCOPE: OpsScope = {
  kind: "tenant-project-world",
  tenantId: "tenant-w062",
  projectId: "project-w062",
  worldId: "world-w062-foreign",
};
const ACTOR = { kind: "platform" as const, actorId: "platform-ops-w062" };
const DATASET_CITATION = {
  kind: "dataset",
  basis: "import-causation",
  datasetId: "ds-w062-perf",
} as unknown as SourceCitation;
const NO_SOURCE_CITATION: SourceCitation = { kind: "none", reason: "no-declared-source" };

/** One lawful audit record at the given sequence (deterministic content). */
function auditAt(sequence: number): AuditRecord {
  const outcome = mintAuditRecord({
    sequence,
    action: "world-accessed",
    scope: SCOPE,
    actor: ACTOR,
    subject: `subject-${String(sequence)}`,
    detail: { route: "audit-verify", code: 200, note: `w062-perf-${String(sequence)}` },
    provenance: sequence % 2 === 0 ? DATASET_CITATION : NO_SOURCE_CITATION,
    declaredAt: 20_000 + sequence,
  });
  if (!outcome.ok) {
    throw new Error(`fixture audit record is unlawful: ${JSON.stringify(outcome.violations)}`);
  }
  return outcome.record;
}

/** The load shape: a contiguous 1..n lineage of lawful records. */
function recordsOf(count: number): readonly AuditRecord[] {
  const records: AuditRecord[] = [];
  for (let sequence = 1; sequence <= count; sequence += 1) {
    records.push(auditAt(sequence));
  }
  return records;
}

function assembledTrailOf(count: number) {
  const outcome = assembleTrail(recordsOf(count));
  if (!outcome.ok) {
    throw new Error(`fixture trail is unlawful: ${JSON.stringify(outcome.violations)}`);
  }
  return outcome.trail;
}

// ---------------------------------------------------------------------------
// The deterministic laws (exactness, order invariance, tamper completeness)
// ---------------------------------------------------------------------------

test("the hash chain verifies end-to-end at every scale (the verified count is carried, exactly)", () => {
  for (const count of [40, 80, 160, 320]) {
    const records = recordsOf(count);
    const assembled = assembleTrail(records);
    assert.ok(assembled.ok, `assembly at n=${String(count)}`);
    assert.equal(assembled.trail.records.length, records.length, `the trail carries every record (n=${String(count)})`);
    const verification = verifyTrail(assembled.trail);
    assert.ok(verification.ok, `verification at n=${String(count)}`);
    assert.equal(verification.recordCount, records.length, "the verification outcome carries the exact record count");
    assert.equal(verification.head, assembled.trail.head, "the verified head is the trail's own head");
  }
});

test("A9: the mint order never leaks into the assembled trail (same id, same head, deep-equal)", () => {
  const count = 160;
  const records = recordsOf(count);
  const ordered = assembleTrail(records);
  assert.ok(ordered.ok);
  const shuffled = assembleTrail(seededShuffle(records, 0x5eed061));
  assert.ok(shuffled.ok);
  const reversed = assembleTrail([...records].reverse());
  assert.ok(reversed.ok);
  assert.equal(shuffled.trail.trailId, ordered.trail.trailId);
  assert.equal(reversed.trail.trailId, ordered.trail.trailId);
  assert.equal(shuffled.trail.head, ordered.trail.head);
  assert.deepEqual(shuffled.trail, ordered.trail);
  assert.deepEqual(reversed.trail, ordered.trail);
});

test("the tamper gate names the EXACT break index across the whole record axis (never a silent gap)", () => {
  const count = 320;
  const trail = assembledTrailOf(count);
  const positions = [0, Math.floor(count / 2), count - 1];
  for (const position of positions) {
    const tampered = [...trail.records];
    tampered[position] = {
      ...tampered[position]!,
      detail: { ...tampered[position]!.detail, note: "rewritten-after-the-fact" },
    };
    const verification = verifyTrail({ ...trail, records: tampered });
    if (verification.ok) {
      throw new Error(`unreachable: a rewrite at index ${String(position)} must be caught`);
    }
    assert.equal(verification.kind, "record-unlawful");
    assert.equal(verification.index, position, "the refusal names the exact break index");
  }
  const headTampered = verifyTrail({ ...trail, head: "deadbeef" });
  if (headTampered.ok) {
    throw new Error("unreachable: a forged head must be caught");
  }
  assert.equal(headTampered.kind, "head-mismatch");
  const empty = assembleTrail([]);
  assert.ok(!empty.ok);
  assert.equal(empty.violations[0]?.kind, "empty-input");
});

test("error collection is COMPLETE at scale (all violations collected, never short-circuited)", () => {
  // Axis 1: every record shares sequence 1 (distinct content, so ids differ) —
  // each record after the first carries BOTH the duplicate-sequence and the
  // sequence-gap violation. The expected count is derived from the input.
  const sharedCount = 120;
  const sharedSequence: AuditRecord[] = [];
  for (let index = 0; index < sharedCount; index += 1) {
    const outcome = mintAuditRecord({
      sequence: 1,
      action: "world-accessed",
      scope: SCOPE,
      actor: ACTOR,
      subject: `subject-shared-${String(index)}`,
      detail: { route: "audit-verify", code: 200, note: `w062-perf-shared-${String(index)}` },
      provenance: index % 2 === 0 ? DATASET_CITATION : NO_SOURCE_CITATION,
      declaredAt: 20_000 + index,
    });
    if (!outcome.ok) {
      throw new Error(`fixture audit record is unlawful: ${JSON.stringify(outcome.violations)}`);
    }
    sharedSequence.push(outcome.record);
  }
  const sharedOutcome = assembleTrail(sharedSequence);
  assert.ok(!sharedOutcome.ok);
  const duplicateKinds = sharedOutcome.violations.filter((violation) => violation.kind === "duplicate-sequence");
  const gapKinds = sharedOutcome.violations.filter((violation) => violation.kind === "sequence-gap");
  assert.equal(duplicateKinds.length, sharedSequence.length - 1);
  assert.equal(gapKinds.length, sharedSequence.length - 1);
  assert.equal(
    sharedOutcome.violations.length,
    duplicateKinds.length + gapKinds.length,
    "no other law is violated by the shared-sequence axis",
  );

  // Axis 2: a contiguous lawful lineage where a derived subset of records
  // sits at a foreign world — each foreign record carries exactly ONE
  // scope-mismatch violation, collected alongside the lawful records.
  const scopedCount = 160;
  const scoped: AuditRecord[] = [];
  for (let sequence = 1; sequence <= scopedCount; sequence += 1) {
    const outcome = mintAuditRecord({
      sequence,
      action: "world-accessed",
      scope: sequence % 2 === 1 ? FOREIGN_SCOPE : SCOPE,
      actor: ACTOR,
      subject: `subject-scoped-${String(sequence)}`,
      detail: { route: "audit-verify", code: 200, note: `w062-perf-scoped-${String(sequence)}` },
      provenance: sequence % 2 === 0 ? DATASET_CITATION : NO_SOURCE_CITATION,
      declaredAt: 20_000 + sequence,
    });
    if (!outcome.ok) {
      throw new Error(`fixture audit record is unlawful: ${JSON.stringify(outcome.violations)}`);
    }
    scoped.push(outcome.record);
  }
  const foreignCount = scoped.filter((record) => record.scope.worldId === FOREIGN_SCOPE.worldId).length;
  assert.ok(foreignCount > 0, "the axis genuinely mixes scopes (derived from the composed records)");
  const scopedOutcome = assembleTrail(scoped);
  assert.ok(!scopedOutcome.ok);
  assert.equal(
    scopedOutcome.violations.length,
    foreignCount,
    "exactly one collected violation per out-of-scope record (carried by the composed records)",
  );
  assert.ok(scopedOutcome.violations.every((violation) => violation.kind === "scope-mismatch"));
});

// ---------------------------------------------------------------------------
// The measurements (REPORT beside the pinned baseline — never asserted equal)
// ---------------------------------------------------------------------------

test("the verification measurements are REPORTED beside the pinned baseline (ceiling-guarded)", () => {
  // The ladder caps at 160: `verifyTrail` is linear in the record count, and
  // 160 keeps ~2 orders of magnitude of headroom under the shipped
  // per-record ceiling on this runner (a wider ladder would ride GC/JIT
  // noise toward the ceiling's intent — disclosed).
  for (const count of [40, 80, 160]) {
    const trail = assembledTrailOf(count);
    const { measuredMs, value: verification } = measureMs(() => verifyTrail(trail));
    assert.ok(verification.ok);
    assert.equal(verification.recordCount, trail.records.length, "the measured run is the complete verification run");
    reportBesideBaseline(
      measurementOf(
        "W061-hash-chain-verification",
        "verifyTrail over an assembled audit trail (ids + chain + head + trail id re-derived)",
        trail.records.length,
        verification.recordCount,
        measuredMs,
      ),
      CEILING_MS_PER_TRAIL_RECORD * trail.records.length,
    );
  }
});

test("the assembly measurements are REPORTED beside the pinned baseline (ceiling-guarded)", () => {
  // DISCLOSED: `assembleTrail` is QUADRATIC in the current implementation
  // (the contract's append-only gate recomputes the whole chain head on every
  // append — `trailHeadOf` walks all records), so the shipped per-TRAIL-RECORD
  // ceiling is reserved for the LINEAR verification law above; the assembly
  // seal is guarded by the shipped per-SEAL ceiling (5000ms) at reduced
  // scales, keeping ~2 orders of magnitude of headroom.
  for (const count of [40, 80, 160]) {
    const shuffled = seededShuffle(recordsOf(count), 0x5eed062 + count);
    const { measuredMs, value: outcome } = measureMs(() => assembleTrail(shuffled));
    assert.ok(outcome.ok);
    assert.equal(outcome.trail.records.length, shuffled.length);
    reportBesideBaseline(
      measurementOf(
        "W061-trail-assembly",
        "assembleTrail over a shuffled contiguous audit lineage (canonical order + append-only gate)",
        shuffled.length,
        outcome.trail.records.length,
        measuredMs,
      ),
      CEILING_MS_PER_SEAL,
    );
  }
});
