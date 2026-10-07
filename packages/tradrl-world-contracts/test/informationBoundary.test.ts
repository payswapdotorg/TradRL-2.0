/**
 * Participant and information-boundary contract tests.
 *
 * Spec: spec/SIMULATION.md "Participants" (deterministic kinds, cannot
 * bypass venue/account/risk contracts),
 * spec/ARCHITECTURE.md §7 (artifact attributes),
 * spec/ARCHITECTURE-LOCK.md A7 + spec/ACCEPTANCE-WORLD-ALPHA.md H
 * (point-in-time firewall: nothing observable before availableAt).
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { Participant, ParticipantKind } from "../src/participant.js";
import {
  filterObservableArtifacts,
  isInformationAvailable,
} from "../src/information.js";
import type {
  InformationArtifact,
  InformationBoundaryState,
  Provenance,
} from "../src/information.js";
import type {
  AccountId,
  InformationArtifactId,
  ParticipantId,
  ProducerId,
  WorldId,
} from "../src/ids.js";
import { asId, asTimestamp } from "./helpers.js";
import type { Equal, Expect, RequiredKeys } from "./helpers.js";

// --- type-level assertions ---------------------------------------------------

const ALL_PARTICIPANT_KINDS = [
  "human",
  "noise-trader",
  "liquidity-taker",
  "passive-market-maker",
  "momentum",
] as const;

type _participantKinds = Expect<
  Equal<ParticipantKind, (typeof ALL_PARTICIPANT_KINDS)[number]>
>;

// Participants trade through an account; the contracts give them no other
// channel (they must use the CommandPort).
type _participantNeedsAccount = Expect<
  Equal<"accountId" extends RequiredKeys<Participant> ? true : false, true>
>;

// ARCHITECTURE.md §7: every information artifact carries id, source,
// createdAt, availableAt, scope, provenance, version — all REQUIRED.
type _artifactKeys = Expect<
  Equal<
    | "artifactId"
    | "source"
    | "createdAt"
    | "availableAt"
    | "scope"
    | "provenance"
    | "version"
    | "payload" extends RequiredKeys<InformationArtifact>
      ? true
      : false,
    true
  >
>;

type _provenanceKeys = Expect<Equal<RequiredKeys<Provenance>, "producer" | "recordedAt">>;

// --- fixtures ----------------------------------------------------------------

const worldId = asId<WorldId>("world-1");

function makeArtifact(
  overrides: Partial<InformationArtifact<{ headline: string }>> = {},
): InformationArtifact<{ headline: string }> {
  return {
    artifactId: asId<InformationArtifactId>("artifact-1"),
    worldId,
    source: "news-wire",
    createdAt: asTimestamp(90),
    availableAt: asTimestamp(100),
    scope: "news",
    provenance: {
      producer: asId<ProducerId>("producer-news"),
      inputs: ["feed-item-9"],
      recordedAt: asTimestamp(90),
    },
    version: "1",
    payload: { headline: "Sim market opens" },
    ...overrides,
  };
}

// --- information boundary (A7 / R016 / acceptance H) ---------------------------

test("an artifact is not observable strictly before its availableAt", () => {
  const artifact = makeArtifact();
  assert.equal(isInformationAvailable(artifact, asTimestamp(99)), false);
});

test("an artifact becomes observable exactly at its availableAt", () => {
  const artifact = makeArtifact();
  assert.equal(isInformationAvailable(artifact, asTimestamp(100)), true);
  assert.equal(isInformationAvailable(artifact, asTimestamp(101)), true);
});

test("filterObservableArtifacts enforces the firewall over a set", () => {
  const now = asTimestamp(100);
  const artifacts = [
    makeArtifact({ artifactId: asId<InformationArtifactId>("a-visible-now"), availableAt: asTimestamp(100) }),
    makeArtifact({ artifactId: asId<InformationArtifactId>("b-future"), availableAt: asTimestamp(150) }),
    makeArtifact({ artifactId: asId<InformationArtifactId>("c-past"), availableAt: asTimestamp(50) }),
  ];
  const visible = filterObservableArtifacts(artifacts, now);
  assert.deepEqual(
    visible.map((a) => a.artifactId),
    [asId<InformationArtifactId>("a-visible-now"), asId<InformationArtifactId>("c-past")],
  );
});

test("boundary state separates visible and withheld artifacts", () => {
  const state: InformationBoundaryState = {
    asOf: asTimestamp(100),
    visible: [asId<InformationArtifactId>("a-visible-now"), asId<InformationArtifactId>("c-past")],
    withheld: [asId<InformationArtifactId>("b-future")],
  };
  assert.equal(state.visible.length, 2);
  assert.equal(state.withheld.length, 1);
});

// --- participants ---------------------------------------------------------------

test("participants are protocol-conformant traders bound to an account", () => {
  const human: Participant = {
    participantId: asId<ParticipantId>("participant-human"),
    worldId,
    kind: "human",
    displayName: "Trader",
    accountId: asId<AccountId>("account-1"),
  };
  const noise: Participant = {
    participantId: asId<ParticipantId>("participant-noise-1"),
    worldId,
    kind: "noise-trader",
    accountId: asId<AccountId>("account-noise-1"),
  };
  assert.equal(human.kind, "human");
  assert.equal(noise.kind, "noise-trader");
  assert.ok(human.accountId);
  assert.ok(noise.accountId);
});
