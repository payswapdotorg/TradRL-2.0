/**
 * The W062 point-in-time / knowledge-firewall PERFORMANCE EVIDENCE suite —
 * REAL imports only (the no-shim law): the firewall is exercised through
 * W050's own `sealView` gate over records built in the W050 fixture shape
 * (W004 market-event envelopes + W027 research-report records — hand-authored
 * deterministic ids/times/delays, the W050 fixture lineage), and the ROUTE
 * side of the same law through W059's own `requireExplicitCutoff` over route
 * declarations derived from W059's own real
 * `pointInTimeRouteDeclarations()`.
 *
 * The discipline (tests/performance/measurements.ts): this suite REPORTS one
 * live PinnedMeasurement per exercised scale (the `PERF-EVIDENCE` lines) BESIDE
 * the pinned baseline — PINNED_BASELINE ships EMPTY at this head (it is filled
 * by a pinning run; the prior session died before pinning), so the
 * baseline-relative 10x law below engages only when a matching entry exists,
 * and the shipped CEILING_* constants govern meanwhile (disclosed here and in
 * the PR body). The ASSERTIONS are over DETERMINISTIC LAWS only — exactness of
 * the sealed/proof counts (carried by the composed records — A6: every
 * expected count is DERIVED from the corpus through the records' own
 * observation law), monotonicity of sealed knowledge (the prefix law), order
 * invariance (A9), and the completeness of the R016 refusals at scale. NEVER
 * wall-clock equality (A9 has no clocks; a measurement here is evidence, not
 * a law).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  CEILING_MS_PER_ROUTE_DECLARATION,
  CEILING_MS_PER_SEAL,
  PINNED_BASELINE,
  measurementOf,
  report,
  type PinnedMeasurement,
} from "./measurements.js";
import {
  KNOWLEDGE_FIREWALL_LAW,
  asPointInTimeCutoff,
  buildPointInTimeQuery,
  compareViewRecords,
  sealView,
  viewRecordObservableAt,
  type PointInTimeQuery,
  type TimeMachineRecordFamily,
  type ViewRecord,
} from "../../packages/tradrl-time-machine/index.js";
import {
  POINT_IN_TIME_CUTOFF_FIELD,
  POINT_IN_TIME_LAW,
  pointInTimeRouteDeclarations,
  requireExplicitCutoff,
  type ApiRouteDeclaration,
} from "../../services/api/index.js";
import type {
  CausationId,
  CorrelationId,
  EventId,
  InformationArtifactId,
  InstrumentId,
  Price,
  ProducerId,
  ProjectId,
  Quantity,
  SequenceNumber,
  TenantId,
  TimestampMs,
  WorldEventEnvelope,
  WorldId,
} from "../../packages/tradrl-world-contracts/src/index.js";
import type { ResearchReportRecord } from "../../packages/tradrl-world-contracts/src/information-data.js";

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
// The deterministic corpus (W004 market events + W027 research reports, the
// W050 fixture lineage — every id, time and delay hand-authored)
// ---------------------------------------------------------------------------

const TENANT = "tenant-w062-perf" as TenantId;
const PROJECT = "project-w062-perf" as ProjectId;
const WORLD = "world-w062-perf" as WorldId;
const FAMILIES: readonly TimeMachineRecordFamily[] = ["market-event", "research-report"];

/** Fixed fixture base time (2023-11-20T00:00:00Z — the W027 fixture clock). */
const T0 = 1_700_044_800_000;
const MINUTE = 60_000;

const at = (ms: number): TimestampMs => ms as TimestampMs;
const eventIdOf = (index: number): EventId => `evt-w062-perf-${String(index)}` as EventId;
const artifactIdOf = (index: number): InformationArtifactId =>
  `artifact-w062-perf-${String(index)}` as InformationArtifactId;

function marketRecord(index: number, occurredAt: number, availableAt?: number): ViewRecord {
  return {
    family: "market-event",
    recordId: eventIdOf(index),
    event: {
      worldId: WORLD,
      sequence: (index + 1) as SequenceNumber,
      eventId: eventIdOf(index),
      eventType: "market.quote.updated",
      occurredAt: at(occurredAt),
      ...(availableAt === undefined ? {} : { availableAt: at(availableAt) }),
      causationId: "cause-w062-perf" as CausationId,
      correlationId: "corr-w062-perf" as CorrelationId,
      producer: "producer-w062-perf" as ProducerId,
      schemaVersion: "tradrl-w062-perf@1",
      payload: {
        type: "market.quote.updated",
        instrumentId: "instrument-btcusd" as InstrumentId,
        bid: "5200.05" as Price,
        ask: "5200.10" as Price,
        bidSize: "1.5" as Quantity,
        askSize: "0.75" as Quantity,
      },
    } satisfies WorldEventEnvelope,
  };
}

function researchRecord(index: number, publishedAt: number, availableAt?: number): ViewRecord {
  const record: ResearchReportRecord = {
    kind: "research-report",
    source: "acme-research",
    sourceId: `w062-perf-${String(index)}`,
    publishedAt: at(publishedAt),
    headline: "Structural bid for digital gold",
    summary: "Flow analysis argues for sustained institutional accumulation.",
    symbols: ["BTC-USD"],
    rating: "overweight",
    targetPrice: "5200.50" as Price,
    confidence: "medium",
    ...(availableAt === undefined ? {} : { availableAt: at(availableAt) }),
  };
  return { family: "research-report", recordId: artifactIdOf(index), record };
}

/**
 * The load shape: `count` records over `count` minutes — even indexes W004
 * market events (every 6th delayed +30min), odd indexes W027 research reports
 * (every 7th delayed +2min). The observation times are derived through the
 * records' OWN observation law, never asserted by hand.
 */
function corpusOf(count: number): readonly ViewRecord[] {
  const records: ViewRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const minute = (index + 1) * MINUTE;
    if (index % 2 === 0) {
      records.push(
        marketRecord(index, T0 + minute, index % 6 === 0 ? T0 + minute + 30 * MINUTE : undefined),
      );
    } else {
      const publishedAt = T0 + minute + 30_000;
      records.push(researchRecord(index, publishedAt, index % 7 === 0 ? publishedAt + 2 * MINUTE : undefined));
    }
  }
  return records;
}

function queryAt(cutoffMs: number): PointInTimeQuery {
  const outcome = buildPointInTimeQuery({
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    cutoff: asPointInTimeCutoff(cutoffMs),
    families: [...FAMILIES],
  });
  if (!outcome.ok) {
    throw new Error(`fixture query is unlawful: ${outcome.errors[0]?.message ?? "unknown"}`);
  }
  return outcome.query;
}

const CORPUS = corpusOf(240);
/** The cutoff ladder (minutes from T0 — beyond every corpus delay at the top). */
const CUTOFFS = [48, 96, 144, 192, 240, 384].map((minutes) => T0 + minutes * MINUTE);

const lawfulAt = (cutoffMs: number): readonly ViewRecord[] =>
  CORPUS.filter((record) => viewRecordObservableAt(record) <= cutoffMs);

// ---------------------------------------------------------------------------
// The deterministic laws (monotonicity, exactness, completeness, order)
// ---------------------------------------------------------------------------

test("the firewall seals EXACTLY the observable records at every cutoff (completeness + exactness)", () => {
  for (const cutoffMs of CUTOFFS) {
    const lawful = lawfulAt(cutoffMs);
    const outcome = sealView(queryAt(cutoffMs), lawful);
    assert.ok(outcome.ok, `cutoff ${String(cutoffMs)} refused: ${outcome.ok ? "" : outcome.refusal.message}`);
    const view = outcome.view;
    assert.equal(view.records.length, lawful.length, `sealed count at cutoff ${String(cutoffMs)}`);
    assert.equal(view.proof.entries.length, lawful.length, `proof entry count at cutoff ${String(cutoffMs)}`);
    assert.equal(view.proof.law, KNOWLEDGE_FIREWALL_LAW);
    for (let index = 0; index < view.records.length; index += 1) {
      const record = view.records[index]!;
      const entry = view.proof.entries[index]!;
      assert.equal(entry.recordId, String(record.recordId));
      assert.ok(entry.observableAt <= cutoffMs, `entry ${entry.recordId} leaks past the cutoff`);
    }
    for (let index = 1; index < view.records.length; index += 1) {
      assert.ok(
        compareViewRecords(view.records[index - 1]!, view.records[index]!) <= 0,
        "the sealed records are in the contract's canonical order",
      );
    }
  }
});

test("sealed knowledge accumulates MONOTONICALLY (the prefix law — nothing is ever un-known)", () => {
  const views = CUTOFFS.map((cutoffMs) => {
    const outcome = sealView(queryAt(cutoffMs), lawfulAt(cutoffMs));
    assert.ok(outcome.ok);
    return outcome.view;
  });
  for (let step = 1; step < views.length; step += 1) {
    const earlier = views[step - 1]!;
    const later = views[step]!;
    assert.ok(
      earlier.records.length <= later.records.length,
      `sealed count must not shrink as the cutoff advances (${String(earlier.records.length)} -> ${String(later.records.length)})`,
    );
    assert.deepEqual(later.records.slice(0, earlier.records.length), earlier.records);
    assert.deepEqual(later.proof.entries.slice(0, earlier.proof.entries.length), earlier.proof.entries);
  }
  assert.ok(views[0]!.records.length < views[views.length - 1]!.records.length);
});

test("A9: the corpus input order never leaks into the sealed view (same view id, deep-equal)", () => {
  const cutoffMs = CUTOFFS[CUTOFFS.length - 1]!;
  const lawful = lawfulAt(cutoffMs);
  const ordered = sealView(queryAt(cutoffMs), lawful);
  assert.ok(ordered.ok);
  const shuffled = sealView(queryAt(cutoffMs), seededShuffle(lawful, 0x5eed062));
  assert.ok(shuffled.ok);
  const reversed = sealView(queryAt(cutoffMs), [...lawful].reverse());
  assert.ok(reversed.ok);
  assert.equal(shuffled.view.viewId, ordered.view.viewId);
  assert.equal(reversed.view.viewId, ordered.view.viewId);
  assert.deepEqual(shuffled.view, ordered.view);
  assert.deepEqual(reversed.view, ordered.view);
});

test("THE R016 LAW: a post-cutoff record is refused at ANY position, identically (fail-closed at scale)", () => {
  assert.equal(KNOWLEDGE_FIREWALL_LAW, POINT_IN_TIME_LAW);
  const cutoffMs = CUTOFFS[CUTOFFS.length - 1]!;
  const lawful = lawfulAt(cutoffMs);
  const future = marketRecord(lawful.length + 1_000, cutoffMs + 10 * MINUTE);
  const positions = [0, Math.floor(lawful.length / 2), lawful.length - 1];
  const refusals = positions.map((position) => {
    const input = [...lawful];
    input.splice(position, 0, future);
    const outcome = sealView(queryAt(cutoffMs), input);
    assert.ok(!outcome.ok, "a post-cutoff record must never be sealed");
    return outcome.refusal;
  });
  for (const refusal of refusals) {
    assert.equal(refusal.law, KNOWLEDGE_FIREWALL_LAW);
    assert.equal(refusal.code, "post-cutoff-record");
    assert.ok(refusal.message.includes(String(cutoffMs)), "the refusal names the declared cutoff");
    assert.ok(refusal.message.includes(POINT_IN_TIME_LAW), "the refusal names R016");
  }
  assert.deepEqual(refusals[1], refusals[0]);
  assert.deepEqual(refusals[2], refusals[0]);
});

test("a duplicated record id is refused loudly at scale (immutable views)", () => {
  const cutoffMs = CUTOFFS[CUTOFFS.length - 1]!;
  const lawful = lawfulAt(cutoffMs);
  const outcome = sealView(queryAt(cutoffMs), [...lawful, lawful[0]!]);
  assert.ok(!outcome.ok);
  assert.equal(outcome.refusal.code, "duplicate-record-id");
  assert.equal(outcome.refusal.law, KNOWLEDGE_FIREWALL_LAW);
});

test("the ROUTE-side R016 law at scale: every implicit-latest variant refused exactly once; lawful twins never", () => {
  const realRoutes = pointInTimeRouteDeclarations();
  for (const route of realRoutes) {
    assert.deepEqual([...requireExplicitCutoff(route)], [], `the real route ${route.name} is lawful`);
  }
  const base = realRoutes[0]!;
  const baseFields = base.request.fields;
  const COUNT = 300;
  const variants: ApiRouteDeclaration[] = [];
  for (let index = 0; index < COUNT; index += 1) {
    const shape = index % 3 === 0 ? "missing" : index % 3 === 1 ? "optional" : "wrong-kind";
    const fields =
      shape === "missing"
        ? baseFields.filter((field) => field.name !== POINT_IN_TIME_CUTOFF_FIELD)
        : shape === "optional"
          ? baseFields.map((field) =>
              field.name === POINT_IN_TIME_CUTOFF_FIELD ? { ...field, required: false } : field,
            )
          : baseFields.map((field) =>
              field.name === POINT_IN_TIME_CUTOFF_FIELD ? { ...field, kind: "string" as const } : field,
            );
    variants.push({
      ...base,
      name: `time-machine-view-create-perf-${String(index)}`,
      path: `${base.path}/perf/${String(index)}`,
      request: { fields },
    });
  }
  const violations = variants.flatMap((route) => [...requireExplicitCutoff(route)]);
  assert.equal(violations.length, variants.length, "exactly one violation per unlawful declaration (carried by the input)");
  assert.ok(violations.every((violation) => violation.code === "implicit-latest-cutoff"));
  assert.ok(violations.every((violation) => violation.message.includes(POINT_IN_TIME_LAW)));
  assert.deepEqual(
    [...new Set(violations.map((violation) => violation.routeName))].sort(),
    variants.map((route) => route.name).sort(),
    "every unlawful declaration is named (completeness)",
  );
  const lawfulTwins = variants.map((route) => ({ ...route, request: { fields: baseFields } }));
  const twinViolations = lawfulTwins.flatMap((route) => [...requireExplicitCutoff(route)]);
  assert.equal(twinViolations.length, 0, "the law never over-fires on lawful twins");
});

// ---------------------------------------------------------------------------
// The measurements (REPORT beside the pinned baseline — never asserted equal)
// ---------------------------------------------------------------------------

test("the seal measurements are REPORTED beside the pinned baseline (ceiling-guarded)", () => {
  for (const size of [120, 240, 480]) {
    const corpus = corpusOf(size);
    const cutoffMs = T0 + (size + 40) * MINUTE;
    const query = queryAt(cutoffMs);
    const { measuredMs, value: outcome } = measureMs(() => sealView(query, corpus));
    assert.ok(outcome.ok);
    assert.equal(outcome.view.records.length, corpus.length, "full-knowledge completeness at the measurement scale");
    assert.equal(outcome.view.proof.entries.length, corpus.length);
    reportBesideBaseline(
      measurementOf(
        "R016-knowledge-firewall-seal",
        "sealView over the deterministic mixed W004/W027 corpus",
        corpus.length,
        outcome.view.records.length,
        measuredMs,
      ),
      CEILING_MS_PER_SEAL,
    );
  }
});

test("the route-law measurements are REPORTED beside the pinned baseline (ceiling-guarded)", () => {
  const realRoutes = pointInTimeRouteDeclarations();
  const base = realRoutes[0]!;
  const baseFields = base.request.fields;
  const COUNT = 300;
  const variants: ApiRouteDeclaration[] = [];
  for (let index = 0; index < COUNT; index += 1) {
    variants.push({
      ...base,
      name: `time-machine-view-create-perf-${String(index)}`,
      path: `${base.path}/perf/${String(index)}`,
      request: { fields: baseFields.filter((field) => field.name !== POINT_IN_TIME_CUTOFF_FIELD) },
    });
  }
  const { measuredMs, value: violations } = measureMs(() =>
    variants.flatMap((route) => [...requireExplicitCutoff(route)]),
  );
  assert.equal(violations.length, variants.length, "the measured run is the complete refusal run");
  reportBesideBaseline(
    measurementOf(
      "R016-explicit-cutoff-route-law",
      "requireExplicitCutoff over derived time-machine route declarations",
      variants.length,
      violations.length,
      measuredMs,
    ),
    CEILING_MS_PER_ROUTE_DECLARATION * variants.length,
  );
});
