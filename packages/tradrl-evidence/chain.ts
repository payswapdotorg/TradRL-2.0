/**
 * The projection digest chain (W028 `tradrl-evidence`) — the deterministic
 * content-addressed spine that binds an evidence projection to its inputs.
 *
 * Spec: spec/WORK-ITEMS.md W028 — "the digest chain linking projections to
 * their inputs". Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the same
 * inputs ALWAYS produce the same chain, bit-for-bit (no wall time, no
 * randomness, no insertion order beyond the journal's own sequence order).
 *
 * Shape (content-addressed at every level, using the W016 hashing family —
 * canonical JSON + FNV-1a, `tradrl-world-sim/world` `stableDigest` /
 * `fnv1aChainHex` — so digests agree with the engine's own content
 * addressing):
 *
 * - `inventoryDigest` — digest of the DECLARED SOURCE INVENTORY the
 *   projection was built from: the world id, the observation point (`asOf`,
 *   when the A7 firewall is applied), the provided dataset descriptors and
 *   the provided information artifacts — all in deterministic order.
 * - `links` — one rolling link per projected event, in journal sequence
 *   order: `link[i] = fnv1a(chain[i-1], envelopeDigest, citationDigest)`,
 *   anchored at `inventoryDigest` for the first event. Each link commits to
 *   the WHOLE event envelope (any journaled fact change breaks the chain)
 *   and to its resolved citation (any provenance change breaks the chain).
 * - `head` — the last link (or `inventoryDigest` for an empty projection):
 *   the content address of this evidence view.
 *
 * `verifyEvidenceChain` recomputes the chain from a projection's OWN events
 * and inventory anchor — local tamper evidence: a citation edited after the
 * fact, an envelope rewritten, or a link swapped produces a typed mismatch
 * at the exact index. The anchor itself binds to the inputs: because
 * `projectEvidence` is pure, re-projecting the same inputs reproduces the
 * same head (A9).
 */

import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { fnv1aChainHex, stableDigest } from "tradrl-world-sim/world";
import { resolveSourceCitation, type SourceCitation } from "./citations.js";

/** The deterministic digest chain of one evidence projection. */
export interface EvidenceDigestChain {
  /** Content digest of the declared source inventory (see module doc). */
  readonly inventoryDigest: string;
  /** Rolling per-event links, journal sequence order (may be empty). */
  readonly links: readonly string[];
  /** The head link — the content address of this projection (A9). */
  readonly head: string;
}

/** The digest of one event envelope (canonical content, A9). */
export function envelopeDigestOf(envelope: WorldEventEnvelope): string {
  return stableDigest(envelope);
}

/** The digest of one resolved citation (canonical content, A9). */
export function citationDigestOf(citation: SourceCitation): string {
  return stableDigest(citation);
}

/**
 * One chain link: commits to the previous link, the whole event envelope
 * and the resolved citation. Pure and deterministic.
 */
export function chainLinkOf(
  previous: string,
  envelope: WorldEventEnvelope,
  citation: SourceCitation,
): string {
  return fnv1aChainHex([previous, envelopeDigestOf(envelope), citationDigestOf(citation)]);
}

/** Code-unit comparison — the hashing.ts canonicalize discipline (never localeCompare). */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The declared source inventory digest: world id, observation point, the
 * provided dataset descriptors (deterministic order: by datasetId) and the
 * provided artifacts (deterministic order: by datasetId then artifactId).
 * Same inventory ⇒ same digest, always (A9).
 */
export function inventoryDigestOf(inventory: {
  readonly worldId: string;
  readonly asOf?: number;
  readonly datasets: readonly { readonly datasetId: string }[];
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly datasetId?: string;
  }[];
}): string {
  const datasets = [...inventory.datasets].sort((left, right) =>
    compareText(left.datasetId, right.datasetId),
  );
  const artifacts = [...inventory.artifacts].sort((left, right) =>
    compareText(
      `${String(left.datasetId)}:${left.artifactId}`,
      `${String(right.datasetId)}:${right.artifactId}`,
    ),
  );
  return stableDigest({
    worldId: inventory.worldId,
    ...(inventory.asOf === undefined ? {} : { asOf: inventory.asOf }),
    datasets,
    artifacts,
  });
}

/** The typed outcome of a chain verification. */
export type ChainVerification =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind:
        | "event-digest-mismatch"
        | "citation-resolution-mismatch"
        | "citation-digest-mismatch"
        | "link-mismatch";
      /** Sequence position (0-based over the projection's events) of the break. */
      readonly index: number;
      readonly detail: string;
    };

/**
 * Recompute the chain over a projection's OWN events and verify every link
 * — local tamper evidence (see module doc): each event's digest must match
 * its envelope, its citation must re-resolve from that envelope (the
 * envelope is the truth; the citation is derived — an edited citation is
 * caught even if its digest was updated consistently), and each link must
 * follow from the previous one. Pure; never throws.
 */
export function verifyEvidenceChain(projection: {
  readonly chain: EvidenceDigestChain;
  readonly events: readonly {
    readonly envelope: WorldEventEnvelope;
    readonly citation: SourceCitation;
    readonly eventDigest: string;
    readonly citationDigest: string;
    readonly chainLink: string;
  }[];
}): ChainVerification {
  const { chain, events } = projection;
  let previous = chain.inventoryDigest;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const expectedEventDigest = envelopeDigestOf(event.envelope);
    if (expectedEventDigest !== event.eventDigest) {
      return {
        ok: false,
        kind: "event-digest-mismatch",
        index,
        detail: `event digest at position ${String(index)} (${String(
          event.envelope.eventId,
        )}) does not match its envelope`,
      };
    }
    const resolution = resolveSourceCitation(event.envelope);
    if (
      !resolution.ok ||
      citationDigestOf(resolution.citation) !== citationDigestOf(event.citation)
    ) {
      return {
        ok: false,
        kind: "citation-resolution-mismatch",
        index,
        detail: `citation at position ${String(index)} (${String(
          event.envelope.eventId,
        )}) does not re-resolve from its envelope`,
      };
    }
    const expectedCitationDigest = citationDigestOf(event.citation);
    if (expectedCitationDigest !== event.citationDigest) {
      return {
        ok: false,
        kind: "citation-digest-mismatch",
        index,
        detail: `citation digest at position ${String(index)} (${String(
          event.envelope.eventId,
        )}) does not match its citation`,
      };
    }
    const expectedLink = chainLinkOf(previous, event.envelope, event.citation);
    if (expectedLink !== event.chainLink || expectedLink !== chain.links[index]) {
      return {
        ok: false,
        kind: "link-mismatch",
        index,
        detail: `chain link at position ${String(index)} (${String(
          event.envelope.eventId,
        )}) does not follow from ${previous}`,
      };
    }
    previous = expectedLink;
  }
  if (chain.links.length !== events.length) {
    return {
      ok: false,
      kind: "link-mismatch",
      index: events.length,
      detail: `chain carries ${String(chain.links.length)} links for ${String(
        events.length,
      )} events`,
    };
  }
  if (chain.head !== previous) {
    return {
      ok: false,
      kind: "link-mismatch",
      index: events.length,
      detail: `chain head ${chain.head} does not match the recomputed head ${previous}`,
    };
  }
  return { ok: true };
}
