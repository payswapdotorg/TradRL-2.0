/**
 * Information-boundary contract tests: stored records, boundary computation,
 * state transitions and fail-closed observation assertions.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7, spec/ACCEPTANCE-WORLD-ALPHA.md H,
 * spec/REQUIREMENTS.md R016, spec/ARCHITECTURE.md §7.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type {
  AvailabilityEntry,
  InformationBoundaryTransition,
  InformationRecord,
  ObservationAssertion,
} from "../src/informationBoundary.js";
import {
  advanceInformationBoundary,
  assertInformationObservation,
  boundaryTransitionsBetween,
  computeInformationBoundary,
  informationRecordOf,
  nextReleaseTime,
  pendingReleases,
} from "../src/informationBoundary.js";
import type {
  InformationArtifact,
  InformationBoundaryState,
} from "../../src/information.js";
import type {
  InformationArtifactId,
  ProducerId,
  WorldId,
} from "../../src/ids.js";
import { asSimulationTime } from "../src/timeSemantics.js";
import { asId, asTimestamp } from "../../test/helpers.js";
import type { Equal, Expect, RequiredKeys } from "../../test/helpers.js";

// --- type-level assertions ---------------------------------------------------

// The firewall record carries all §7 attributes — except the payload.
type _recordKeys = Expect<
  Equal<
    | "artifactId"
    | "worldId"
    | "source"
    | "scope"
    | "createdAt"
    | "availableAt"
    | "provenance"
    | "version" extends RequiredKeys<InformationRecord>
      ? true
      : false,
    true
  >
>;
type _recordHasNoPayload = Expect<
  Equal<"payload" extends keyof InformationRecord ? true : false, false>
>;

// Artifacts satisfy the availability-entry law structurally.
type _artifactIsEntry = Expect<
  Equal<InformationArtifact<unknown> extends AvailabilityEntry ? true : false, true>
>;

// The only transition kind in World Alpha is a release.
type _transitionKind = Expect<
  Equal<InformationBoundaryTransition["kind"], "release">
>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");

function makeArtifact(
  id: string,
  availableAt: number,
): InformationArtifact<{ headline: string }> {
  return {
    artifactId: asId<InformationArtifactId>(id),
    worldId,
    source: "news-wire",
    createdAt: asTimestamp(availableAt - 10),
    availableAt: asTimestamp(availableAt),
    scope: "news",
    provenance: {
      producer: asId<ProducerId>("producer-news"),
      recordedAt: asTimestamp(availableAt - 10),
    },
    version: "1",
    payload: { headline: `headline ${id}` },
  };
}

// Artifacts: a visible at 100, b visible at 150, c visible at 50.
const artifacts = [
  makeArtifact("artifact-a", 100),
  makeArtifact("artifact-b", 150),
  makeArtifact("artifact-c", 50),
];

// --- stored records ---------------------------------------------------------------

test("the firewall stores payload-free records with all §7 attributes", () => {
  const record: InformationRecord = informationRecordOf(artifacts[0]!);
  assert.equal(record.artifactId, "artifact-a" as InformationArtifactId);
  assert.equal(record.worldId, worldId);
  assert.equal(record.source, "news-wire");
  assert.equal(record.scope, "news");
  assert.equal(record.createdAt, 90);
  assert.equal(record.availableAt, 100);
  assert.equal(record.version, "1");
  assert.equal(record.digest, undefined);
  assert.equal("payload" in record, false);
  assert.equal(record.provenance.producer, "producer-news" as ProducerId);
});

test("records and artifacts share one boundary law (AvailabilityEntry)", () => {
  const fromRecords = computeInformationBoundary(
    artifacts.map(informationRecordOf),
    asSimulationTime(100),
  );
  const fromArtifacts = computeInformationBoundary(artifacts, asSimulationTime(100));
  assert.deepEqual(fromRecords, fromArtifacts);
});

// --- boundary computation -----------------------------------------------------------

test("computeInformationBoundary partitions ids at a point in simulation time", () => {
  const state = computeInformationBoundary(artifacts, asSimulationTime(100));
  const expected: InformationBoundaryState = {
    asOf: asTimestamp(100),
    visible: [
      asId<InformationArtifactId>("artifact-a"),
      asId<InformationArtifactId>("artifact-c"),
    ],
    withheld: [asId<InformationArtifactId>("artifact-b")],
  };
  assert.deepEqual(state, expected);
  // Input order is preserved — deterministic.
  assert.deepEqual(state.visible[0], "artifact-a" as InformationArtifactId);
});

test("nothing is withheld after the latest availableAt", () => {
  const state = computeInformationBoundary(artifacts, asSimulationTime(1_000));
  assert.equal(state.withheld.length, 0);
  assert.equal(state.visible.length, 3);
});

// --- pending releases ----------------------------------------------------------------

test("pendingReleases lists what is still withheld, in input order", () => {
  const pending = pendingReleases(artifacts, asSimulationTime(100));
  assert.deepEqual(
    pending.map((entry) => entry.artifactId),
    [asId<InformationArtifactId>("artifact-b")],
  );
  assert.deepEqual(pendingReleases(artifacts, asSimulationTime(1_000)), []);
});

test("nextReleaseTime is the earliest pending availability", () => {
  assert.equal(nextReleaseTime(artifacts, asSimulationTime(60)), 100);
  assert.equal(nextReleaseTime(artifacts, asSimulationTime(100)), 150);
  assert.equal(nextReleaseTime(artifacts, asSimulationTime(1_000)), undefined);
});

// --- boundary state transitions ---------------------------------------------------------

test("advancing the clock releases exactly the (from, to] window, ordered", () => {
  const transitions = boundaryTransitionsBetween(
    artifacts,
    asSimulationTime(60),
    asSimulationTime(150),
  );
  assert.deepEqual(
    transitions.map((t) => t.artifactId),
    [asId<InformationArtifactId>("artifact-a"), asId<InformationArtifactId>("artifact-b")],
  );
  assert.equal(transitions[0]?.kind, "release");
  assert.equal(transitions[0]?.availableAt, 100);
  assert.equal(transitions[0]?.fromAsOf, 60);
  assert.equal(transitions[0]?.toAsOf, 150);
});

test("window edges: availableAt == from stays withheld, availableAt == to is released", () => {
  const fromEdge = boundaryTransitionsBetween(
    artifacts,
    asSimulationTime(100),
    asSimulationTime(200),
  );
  assert.deepEqual(
    fromEdge.map((t) => t.artifactId),
    [asId<InformationArtifactId>("artifact-b")],
  );
  const toEdge = boundaryTransitionsBetween(
    artifacts,
    asSimulationTime(99),
    asSimulationTime(100),
  );
  assert.deepEqual(
    toEdge.map((t) => t.artifactId),
    [asId<InformationArtifactId>("artifact-a")],
  );
});

test("empty and backwards windows release nothing", () => {
  assert.deepEqual(
    boundaryTransitionsBetween(artifacts, asSimulationTime(500), asSimulationTime(600)),
    [],
  );
  assert.deepEqual(
    boundaryTransitionsBetween(artifacts, asSimulationTime(200), asSimulationTime(100)),
    [],
  );
});

test("advanceInformationBoundary moves ids withheld→visible and bumps asOf", () => {
  const before = computeInformationBoundary(artifacts, asSimulationTime(60));
  const transitions = boundaryTransitionsBetween(
    artifacts,
    asSimulationTime(60),
    asSimulationTime(150),
  );
  const after = advanceInformationBoundary(before, asSimulationTime(150), transitions);
  assert.equal(after.asOf, 150);
  assert.deepEqual(
    after.visible,
    [
      asId<InformationArtifactId>("artifact-c"),
      asId<InformationArtifactId>("artifact-a"),
      asId<InformationArtifactId>("artifact-b"),
    ],
  );
  assert.deepEqual(after.withheld, []);
  // Idempotent: applying the same releases again changes nothing.
  const again = advanceInformationBoundary(after, asSimulationTime(150), transitions);
  assert.deepEqual(again, after);
});

test("a zero-release advance still moves the asOf point forward", () => {
  const before = computeInformationBoundary(artifacts, asSimulationTime(60));
  const after = advanceInformationBoundary(before, asSimulationTime(90), []);
  assert.equal(after.asOf, 90);
  assert.deepEqual(after.visible, before.visible);
  assert.deepEqual(after.withheld, before.withheld);
});

// --- observation assertions (proof shapes) ----------------------------------------------

test("an observation strictly before availableAt is withheld with a reason", () => {
  const assertion: ObservationAssertion = assertInformationObservation(
    artifacts[1]!,
    asSimulationTime(149),
  );
  assert.equal(assertion.kind, "withheld");
  if (assertion.kind === "withheld") {
    assert.equal(assertion.artifactId, "artifact-b" as InformationArtifactId);
    assert.equal(assertion.availableAt, 150);
    assert.equal(assertion.observedAt, 149);
    assert.equal(assertion.reason, "before-availableAt");
  }
});

test("an observation at or after availableAt is granted with its threshold", () => {
  const at = assertInformationObservation(artifacts[1]!, asSimulationTime(150));
  const after = assertInformationObservation(artifacts[1]!, asSimulationTime(1_000));
  assert.equal(at.kind, "granted");
  assert.equal(after.kind, "granted");
  if (at.kind === "granted") {
    assert.equal(at.availableAt, 150);
    assert.equal(at.observedAt, 150);
  }
});

test("assertions work on payload-free records too (the firewall's own store)", () => {
  const record = informationRecordOf(artifacts[1]!);
  const withheld = assertInformationObservation(record, asSimulationTime(149));
  const granted = assertInformationObservation(record, asSimulationTime(150));
  assert.equal(withheld.kind, "withheld");
  assert.equal(granted.kind, "granted");
});
