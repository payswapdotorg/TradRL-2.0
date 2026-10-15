/**
 * Event-vocabulary tests (W061 `observability`) — the closed kind set, the
 * typed payloads, the §14 scope laws, the DECLARED-timestamp laws and the
 * fail-closed construction gate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  eventIdOf,
  mintOperationalEvent,
  OPS_ACTOR_KINDS,
  OPS_EVENT_ID_PREFIX,
  OPS_EVENT_KINDS,
  type OpsEventKind,
} from "../events.js";
import {
  datasetEventDeclaration,
  eventDeclaration,
  platformActor,
  TENANT,
  PROJECT,
  tenantScope,
  worldScope,
} from "./fixtures.js";

test("a lawful event declaration mints an oev- id", () => {
  const outcome = mintOperationalEvent(eventDeclaration());
  assert.ok(outcome.ok);
  assert.match(outcome.event.eventId, /^oev-/);
});

test("the same declaration always mints the same id (A9)", () => {
  const declaration = eventDeclaration();
  assert.equal(eventIdOf(declaration), eventIdOf(declaration));
});

test("a law-bearing edit mints a different id", () => {
  const base = eventDeclaration();
  const edited = eventDeclaration({ declaredAt: base.declaredAt + 1 });
  assert.notEqual(eventIdOf(base), eventIdOf(edited));
});

test("an unknown event kind is refused", () => {
  const outcome = mintOperationalEvent(
    eventDeclaration({ kind: "nope" as unknown as OpsEventKind }),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "unknown-event-kind"));
});

test("a blank scope member is a loud violation (§14)", () => {
  const outcome = mintOperationalEvent(
    eventDeclaration({ scope: { ...worldScope(), tenantId: "" } }),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "blank-scope-member"));
});

test("a missing required scope member is refused (§14)", () => {
  const scope = {
    kind: "tenant-project-world",
    tenantId: TENANT,
    projectId: PROJECT,
  } as unknown as ReturnType<typeof worldScope>;
  const outcome = mintOperationalEvent(eventDeclaration({ scope }));
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "missing-scope-member"));
});

test("a scope member below the kind's prefix is refused (§14)", () => {
  const outcome = mintOperationalEvent(
    eventDeclaration({ scope: { ...tenantScope(), worldId: "world-w" } }),
  );
  assert.ok(!outcome.ok);
  assert.ok(
    outcome.violations.some((violation) => violation.kind === "scope-member-not-permitted"),
  );
});

test("an unknown scope kind is refused", () => {
  const outcome = mintOperationalEvent(
    eventDeclaration({ scope: { kind: "galaxy" } as unknown as ReturnType<typeof worldScope> }),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "unknown-scope-kind"));
});

test("a non-integer or non-positive sequence is refused", () => {
  const fractional = mintOperationalEvent(eventDeclaration({ sequence: 1.5 }));
  assert.ok(!fractional.ok);
  assert.ok(fractional.violations.some((violation) => violation.kind === "non-integer-sequence"));
  const zero = mintOperationalEvent(eventDeclaration({ sequence: 0 }));
  assert.ok(!zero.ok);
  assert.ok(zero.violations.some((violation) => violation.kind === "non-positive-sequence"));
});

test("a non-integer or negative declared timestamp is refused (A9: declared data)", () => {
  const fractional = mintOperationalEvent(eventDeclaration({ declaredAt: 1.5 }));
  assert.ok(!fractional.ok);
  assert.ok(fractional.violations.some((violation) => violation.kind === "non-integer-timestamp"));
  const negative = mintOperationalEvent(eventDeclaration({ declaredAt: -1 }));
  assert.ok(!negative.ok);
  assert.ok(negative.violations.some((violation) => violation.kind === "negative-timestamp"));
});

test("a payload that does not carry the event's own kind is refused", () => {
  const outcome = mintOperationalEvent(
    eventDeclaration({
      payload: {
        kind: "dataset-imported",
        datasetId: "ds",
        recordCount: 1,
      },
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "payload-kind-mismatch"));
});

test("a blank payload field is refused (typed payloads)", () => {
  const outcome = mintOperationalEvent(
    datasetEventDeclaration({
      payload: { kind: "dataset-imported", datasetId: "", recordCount: 1 },
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "payload-field-invalid"));
});

test("a negative payload count is refused (typed payloads)", () => {
  const outcome = mintOperationalEvent(
    datasetEventDeclaration({
      payload: { kind: "dataset-imported", datasetId: "ds", recordCount: -3 },
    }),
  );
  assert.ok(!outcome.ok);
  assert.ok(outcome.violations.some((violation) => violation.kind === "payload-field-invalid"));
});

test("an unknown actor kind or blank actor id is refused", () => {
  const unknownKind = mintOperationalEvent(
    eventDeclaration({ actor: { kind: "robot" as never, actorId: "x" } }),
  );
  assert.ok(!unknownKind.ok);
  assert.ok(unknownKind.violations.some((violation) => violation.kind === "unknown-actor-kind"));
  const blankId = mintOperationalEvent(
    eventDeclaration({ actor: { ...platformActor(), actorId: "" } }),
  );
  assert.ok(!blankId.ok);
  assert.ok(blankId.violations.some((violation) => violation.kind === "blank-actor-id"));
});

test("the closed vocabularies are canonical and complete", () => {
  assert.deepEqual(OPS_EVENT_KINDS, [...OPS_EVENT_KINDS].sort());
  assert.equal(OPS_EVENT_KINDS.length, 9);
  assert.deepEqual(OPS_ACTOR_KINDS, [...OPS_ACTOR_KINDS].sort());
  assert.equal(OPS_ACTOR_KINDS.length, 4);
  assert.equal(OPS_EVENT_ID_PREFIX, "oev-");
});
