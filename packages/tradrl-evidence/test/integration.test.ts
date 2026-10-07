/**
 * Integration tests (W028 `tradrl-evidence`) — the projection against the
 * REAL surfaces it serves:
 *
 * - a REAL headless engine (W013/W016): a real command journaled through
 *   the command port (command-caused ⇒ the honest no-declared-source
 *   citation), both imports appended to the engine's own journal, and the
 *   evidence view cross-validated against the engine's OWN EvidencePort —
 *   the A7-filtered event sets agree at every clock position, and the
 *   port's `getProvenance` agrees with the `ProvenanceRecord` bridge
 *   (extended with the artifact input for imported information events);
 * - the REAL loaders (W020 `tradrl-data`, W027 `tradrl-information`): one
 *   shared journal, both import families cited exactly as they declare
 *   themselves, and the artifact registry agreeing with the engine's own
 *   `getNews` firewall at every observation point.
 *
 * Engine-level REPLAY of imported events is deliberately NOT tested here:
 * the W020 law assigns engine replay to W021 (the reducers fail closed on
 * foreign producers by design). This package projects the JOURNAL — the
 * authoritative history — and the engine exposes it on its surface.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHeadlessWorldEngine } from "tradrl-world-sim/world";
import { buildWorldSnapshot, verifyWorldSnapshot } from "tradrl-world-sim/snapshot";
import { initialWorldState } from "tradrl-world-sim/world";
import {
  anAnnotationCommand,
  combinedJournal,
  dataDescriptor,
  dataImport,
  fixedWallTimeSource,
  infoDescriptor,
  infoImport,
  sim,
  snapshotIdOf,
  T0,
  MINUTE,
  w028WorldDefinition,
  WORLD,
} from "./fixtures.js";
import { projectEvidence } from "../projection.js";
import { createEvidenceQuery } from "../query.js";

test("a REAL engine journal: command-caused events are honestly uncited; imports cite their sources", async () => {
  const info = infoImport();
  const data = dataImport();
  const definition = w028WorldDefinition(WORLD, info.artifacts);
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
  });

  // A real command through the command port → a journaled engine event.
  const result = await engine.command.addAnnotation(anAnnotationCommand());
  assert.equal(result.status, "acked");

  // Both imports appended to the engine's own journal (the engine surface
  // exposes it; import times follow the annotation's clock time T0).
  engine.journal.append([...data.drafts]);
  engine.journal.append([...info.drafts]);
  assert.equal(engine.journal.size(), 8);

  const projection = projectEvidence({
    worldId: WORLD,
    records: engine.journal.records(),
    artifacts: definition.informationArtifacts,
    datasets: [dataDescriptor(), infoDescriptor()],
  });

  // The annotation: no declared source (honest marker) + its command causation.
  const annotation = projection.events[0]!;
  assert.equal(annotation.eventType, "world.annotation.added");
  assert.deepEqual(annotation.citation, { kind: "none", reason: "no-declared-source" });
  assert.equal(String(annotation.causationId), "cmd-w028-annotation-1");
  assert.equal(projection.summary.noSourceCount, 1);

  // The imports cite exactly what they declare.
  assert.equal(projection.summary.datasetCitationCount, 4);
  assert.equal(projection.summary.artifactCitationCount, 3);
  const query = createEvidenceQuery(projection);
  assert.deepEqual(
    query.getUncitedEvents().map((event) => event.eventType),
    ["world.annotation.added"],
  );

  // The engine's OWN provenance port agrees on the command-caused event —
  // the bridge is a faithful extension of the W016 shape.
  const engineProvenance = await engine.evidence.getProvenance(annotation.eventId);
  const bridgeProvenance = query.toProvenanceRecord(annotation.eventId);
  assert.deepEqual(bridgeProvenance, engineProvenance);

  // For imported events the port projects the command causation; the bridge
  // carries it TOO and adds the artifact input (the W028 extension). The
  // cross-check runs at a clock position where the import is observable.
  await engine.clock.seek(sim(T0 + 5 * MINUTE));
  const newsEventId = projection.events[5]!.eventId;
  const engineNewsProvenance = await engine.evidence.getProvenance(newsEventId);
  const bridgeNewsProvenance = query.toProvenanceRecord(newsEventId);
  assert.equal(engineNewsProvenance!.inputs.length, 1);
  assert.deepEqual(bridgeNewsProvenance.inputs[1], engineNewsProvenance!.inputs[0]);
  assert.deepEqual(bridgeNewsProvenance.inputs[0], {
    kind: "artifact",
    ref: "wire-A",
  });
});

test("the A7-filtered event set agrees with the engine's OWN evidence port at every clock position", async () => {
  const info = infoImport();
  const data = dataImport();
  const definition = w028WorldDefinition(WORLD, info.artifacts);
  const engine = createHeadlessWorldEngine({
    definition,
    wallTimeSource: fixedWallTimeSource(),
  });
  await engine.command.addAnnotation(anAnnotationCommand());
  engine.journal.append([...data.drafts]);
  engine.journal.append([...info.drafts]);

  const projectionAt = (asOf: number) =>
    projectEvidence({
      worldId: WORLD,
      records: engine.journal.records(),
      artifacts: definition.informationArtifacts,
      datasets: [dataDescriptor(), infoDescriptor()],
      asOf: sim(asOf),
    });

  const assertAgreement = async () => {
    const clock = await engine.clock.getClock();
    const engineEvents = await engine.evidence.getEvents({});
    const mine = projectionAt(clock.simulationTime);
    assert.deepEqual(
      [...new Set(engineEvents.map((envelope) => envelope.eventId))].sort(),
      mine.events.map((event) => event.eventId).sort(),
      `agreement at ${String(clock.simulationTime)}`,
    );
  };

  // At the origin: the annotation + the T0 quote are observable, nothing else.
  await assertAgreement();
  assert.equal((await engine.evidence.getEvents({})).length, 2);

  // Mid-window: the market data is out, the delayed research is not.
  await engine.clock.seek(sim(T0 + 3 * MINUTE + 30_000));
  await assertAgreement();
  assert.equal((await engine.evidence.getEvents({})).length, 6);

  // The artifact registry agrees with the engine's own getNews firewall —
  // checked AT this clock position, before moving on.
  const visibleNews = await engine.query.getNews();
  const midView = projectionAt(T0 + 3 * MINUTE + 30_000);
  assert.deepEqual(
    visibleNews.map((item) => String(item.artifactId)),
    ["wire-A"],
  );
  assert.deepEqual(
    midView.artifacts.map((artifact) => String(artifact.artifactId)),
    ["wire-A"],
  );

  // At the end: everything is observable.
  await engine.clock.seek(sim(T0 + 5 * MINUTE));
  await assertAgreement();
  assert.equal((await engine.evidence.getEvents({})).length, 8);
});

test("the evidence view projects a REAL W016 snapshot prefix (records are the snapshot currency)", () => {
  const { journal, info } = combinedJournal();
  const definition = w028WorldDefinition(WORLD, info.artifacts);
  const state = initialWorldState(definition);
  const snapshot = buildWorldSnapshot({
    definition,
    state,
    records: journal.records().slice(0, 5),
    snapshotId: snapshotIdOf(1),
    createdAt: journal.records()[4]!.envelope.occurredAt,
  });
  assert.deepEqual(verifyWorldSnapshot(snapshot), { ok: true });

  // Projecting the snapshot's own record prefix yields exactly the evidence
  // of those events — the snapshot is a valid evidence input.
  const projection = projectEvidence({
    worldId: WORLD,
    records: snapshot.records,
    artifacts: definition.informationArtifacts,
    datasets: [dataDescriptor(), infoDescriptor()],
  });
  assert.equal(projection.summary.journalSize, 5);
  assert.equal(projection.summary.datasetCitationCount, 4);
  assert.equal(projection.summary.artifactCitationCount, 1);
  assert.deepEqual(createEvidenceQuery(projection).verifyChain(), { ok: true });
});

test("the projection over the combined two-import journal is stable across independent runs (A9)", () => {
  const first = projectEvidence({
    worldId: WORLD,
    records: combinedJournal().journal.records(),
    artifacts: infoImport().artifacts,
    datasets: [dataDescriptor(), infoDescriptor()],
  });
  const second = projectEvidence({
    worldId: WORLD,
    records: combinedJournal().journal.records(),
    artifacts: infoImport().artifacts,
    datasets: [dataDescriptor(), infoDescriptor()],
  });
  assert.equal(first.chain.head, second.chain.head);
  assert.deepEqual(first.summary, second.summary);
});
