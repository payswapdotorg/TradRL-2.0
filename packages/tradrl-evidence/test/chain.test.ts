/**
 * Digest-chain tests (W028 `tradrl-evidence`) — the deterministic
 * content-addressed spine: same inputs ⇒ same chain (A9); the chain commits
 * to its inputs (journal facts, citations, descriptors, artifacts, the
 * observation point); and local verification catches every kind of
 * after-the-fact tampering short of rewriting the frozen journal itself.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chainLinkOf,
  citationDigestOf,
  envelopeDigestOf,
  inventoryDigestOf,
  verifyEvidenceChain,
} from "../chain.js";
import { projectEvidence, type EvidenceProjection, type EvidenceProjectionInput } from "../projection.js";
import type { SourceCitation } from "../citations.js";
import {
  combinedJournal,
  dataDescriptor,
  infoDescriptor,
  sim,
  T0,
  MINUTE,
  WORLD,
} from "./fixtures.js";

/** A deep-mutable view of the projection — for tamper tests only. */
interface TamperEvent {
  envelope: { payload: Record<string, unknown> };
  citation: SourceCitation;
  citationDigest: string;
  chainLink: string;
}
interface TamperView {
  events: TamperEvent[];
  chain: { links: string[]; head: string };
}
type VerificationInput = Parameters<typeof verifyEvidenceChain>[0];

function tamperedCopy(projection: EvidenceProjection): TamperView {
  return structuredClone(projection) as unknown as TamperView;
}

function asVerifiable(view: TamperView): VerificationInput {
  return view as unknown as VerificationInput;
}

function combinedInput(overrides: Partial<EvidenceProjectionInput> = {}): EvidenceProjectionInput {
  const { journal, info } = combinedJournal();
  return {
    worldId: WORLD,
    records: journal.records(),
    artifacts: info.artifacts,
    datasets: [dataDescriptor(), infoDescriptor()],
    ...overrides,
  };
}

test("same inputs ⇒ same chain, bit-for-bit (A9)", () => {
  const first = projectEvidence(combinedInput());
  const second = projectEvidence(combinedInput());
  assert.deepEqual(first.chain, second.chain);
  assert.deepEqual(first, second);
});

test("cloned inputs (fresh object graph) yield the same chain head", () => {
  const input = combinedInput();
  const fromClones = projectEvidence({
    ...input,
    records: structuredClone(input.records),
  });
  assert.equal(fromClones.chain.head, projectEvidence(input).chain.head);
});

test("the chain commits to the journal facts: one changed payload breaks the head", () => {
  const input = combinedInput();
  const records = structuredClone(input.records);
  // Rewrite one journaled fact (the quote's bid) — a different world.
  (records[0]!.envelope as { payload: Record<string, unknown> }).payload = {
    ...(records[0]!.envelope.payload as Record<string, unknown>),
    bid: "4999.99",
  };
  const tampered = projectEvidence({ ...input, records });
  const original = projectEvidence(input);
  assert.notEqual(tampered.chain.head, original.chain.head);
  // The links are per-event: the FIRST link breaks, and every later link
  // shifts because it chains from its predecessor.
  assert.notEqual(tampered.chain.links[0], original.chain.links[0]);
  assert.notEqual(tampered.chain.links[1], original.chain.links[1]);
  assert.notEqual(tampered.chain.head, original.chain.head);
});

test("the chain commits to the citations: an identity rewrite breaks the head", () => {
  const input = combinedInput();
  const records = structuredClone(input.records);
  const news = records[4]!.envelope.payload as {
    identity: { artifactId: string };
  };
  news.identity = { ...news.identity, artifactId: "wire-X" };
  const tampered = projectEvidence({ ...input, records });
  assert.notEqual(tampered.chain.head, projectEvidence(input).chain.head);
});

test("the chain commits to the declared inventory: descriptors, artifacts and asOf", () => {
  const base = projectEvidence(combinedInput());
  // Adding a descriptor changes the inventory anchor and the head.
  const withDescriptor = projectEvidence(
    combinedInput({
      datasets: [
        dataDescriptor(),
        infoDescriptor(),
        dataDescriptor({ datasetId: "ds-extra" as never }),
      ],
    }),
  );
  assert.notEqual(withDescriptor.chain.inventoryDigest, base.chain.inventoryDigest);
  assert.notEqual(withDescriptor.chain.head, base.chain.head);
  // Removing the artifacts changes the anchor (and therefore every link —
  // the anchor feeds link 0; the records' own digests are unchanged).
  const withoutArtifacts = projectEvidence(combinedInput({ artifacts: undefined }));
  assert.notEqual(withoutArtifacts.chain.inventoryDigest, base.chain.inventoryDigest);
  assert.notEqual(withoutArtifacts.chain.head, base.chain.head);
  assert.equal(withoutArtifacts.chain.links.length, base.chain.links.length);
  // A different observation point changes the anchor (and here the view).
  const observed = projectEvidence(combinedInput({ asOf: sim(T0 + 5 * MINUTE) }));
  assert.notEqual(observed.chain.inventoryDigest, base.chain.inventoryDigest);
  assert.notEqual(observed.chain.head, base.chain.head);
});

test("the link formula is the documented rolling chain", () => {
  const projection = projectEvidence(combinedInput());
  const { chain } = projection;
  assert.equal(chain.links.length, projection.events.length);
  let previous = chain.inventoryDigest;
  for (let index = 0; index < projection.events.length; index += 1) {
    const event = projection.events[index]!;
    const expected = chainLinkOf(previous, event.envelope, event.citation);
    assert.equal(event.chainLink, expected);
    assert.equal(chain.links[index], expected);
    assert.equal(event.eventDigest, envelopeDigestOf(event.envelope));
    assert.equal(event.citationDigest, citationDigestOf(event.citation));
    previous = expected;
  }
  assert.equal(chain.head, previous);
});

test("a prefix projection chains over its own events only", () => {
  const input = combinedInput();
  const prefix = projectEvidence({ ...input, records: input.records.slice(0, 4) });
  assert.equal(prefix.events.length, 4);
  assert.equal(prefix.chain.links.length, 4);
  // The first four links equal the full projection's first four links
  // (same anchor, same events — the chain is prefix-consistent).
  const full = projectEvidence(input);
  for (let index = 0; index < 4; index += 1) {
    assert.equal(prefix.chain.links[index], full.chain.links[index]);
  }
  assert.notEqual(prefix.chain.head, full.chain.head);
});

test("an empty projection's head is its inventory digest", () => {
  const projection = projectEvidence({ worldId: WORLD, records: [] });
  assert.deepEqual(projection.chain.links, []);
  assert.equal(projection.chain.head, projection.chain.inventoryDigest);
});

test("the inventory digest is deterministic over descriptors and artifacts", () => {
  const { info } = combinedJournal();
  const a = inventoryDigestOf({
    worldId: WORLD,
    datasets: [dataDescriptor(), infoDescriptor()],
    artifacts: info.artifacts,
  });
  const b = inventoryDigestOf({
    worldId: WORLD,
    datasets: [infoDescriptor(), dataDescriptor()],
    artifacts: structuredClone(info.artifacts),
  });
  assert.equal(a, b, "order of inputs never matters (canonical, A9)");
  const c = inventoryDigestOf({
    worldId: WORLD,
    asOf: T0,
    datasets: [dataDescriptor(), infoDescriptor()],
    artifacts: info.artifacts,
  });
  assert.notEqual(a, c, "the observation point is committed");
});

test("verification: an honest projection verifies clean", () => {
  const projection = projectEvidence(combinedInput());
  assert.deepEqual(verifyEvidenceChain(projection), { ok: true });
});

test("verification: a rewritten envelope is caught (event-digest mismatch)", () => {
  const projection = projectEvidence(combinedInput());
  const tampered = tamperedCopy(projection);
  tampered.events[0]!.envelope.payload.bid = "4999.99";
  const verification = verifyEvidenceChain(asVerifiable(tampered));
  assert.equal(verification.ok, false);
  if (!verification.ok) {
    assert.equal(verification.kind, "event-digest-mismatch");
    assert.equal(verification.index, 0);
  }
});

test("verification: an edited citation is caught EVEN with a consistently updated digest", () => {
  const projection = projectEvidence(combinedInput());
  const tampered = tamperedCopy(projection);
  const event = tampered.events[4]!;
  // Rewrite the citation AND recompute its digest consistently — the
  // envelope is the truth: re-resolution catches it.
  const citation: SourceCitation = {
    kind: "information-artifact",
    basis: "payload-identity",
    artifactId: "wire-A" as never,
    datasetId: "a-different-dataset" as never,
    recordDigest: "deadbeef",
    source: "global-wire",
    credibility: "primary-media",
  };
  event.citation = citation;
  event.citationDigest = citationDigestOf(citation);
  const verification = verifyEvidenceChain(asVerifiable(tampered));
  assert.equal(verification.ok, false);
  if (!verification.ok) {
    assert.equal(verification.kind, "citation-resolution-mismatch");
    assert.equal(verification.index, 4);
  }
});

test("verification: a swapped chain link is caught (link mismatch)", () => {
  const projection = projectEvidence(combinedInput());
  const tampered = tamperedCopy(projection);
  tampered.chain.links[2] = "deadbeef";
  const verification = verifyEvidenceChain(asVerifiable(tampered));
  assert.equal(verification.ok, false);
  if (!verification.ok) {
    assert.equal(verification.kind, "link-mismatch");
    assert.equal(verification.index, 2);
  }
});

test("verification: a forged head is caught", () => {
  const projection = projectEvidence(combinedInput());
  const tampered = tamperedCopy(projection);
  tampered.chain.head = "deadbeef";
  const verification = verifyEvidenceChain(asVerifiable(tampered));
  assert.equal(verification.ok, false);
  if (!verification.ok) {
    assert.equal(verification.kind, "link-mismatch");
    assert.equal(verification.index, tampered.events.length);
  }
});

test("verification: a truncated event list is caught", () => {
  const projection = projectEvidence(combinedInput());
  const tampered = tamperedCopy(projection);
  tampered.events = tampered.events.slice(0, 3);
  const verification = verifyEvidenceChain(asVerifiable(tampered));
  assert.equal(verification.ok, false);
  if (!verification.ok) {
    assert.equal(verification.kind, "link-mismatch");
    assert.equal(verification.index, 3);
  }
});
