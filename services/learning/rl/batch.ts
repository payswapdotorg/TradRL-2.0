/**
 * assembleBatch (W047) — the deterministic batch construction.
 *
 * Builds the trainer-facing batch from assembled episodes: the episodes
 * are re-proven through the protocol's own whole-record validation (carried
 * data re-proven, never trusted — A13), the episode ids are placed in
 * CANONICAL order (input order never leaks — A9), the content-addressed
 * batch id is derived through the protocol's own construction gate, and
 * the optional selection policy rides as DATA (R054: method-neutral —
 * never a trainer, never a gradient).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — this constructs a DESCRIPTOR; it
 * never executes a trainer (W049) and never generates episodes (W048).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { episodeBatchDescriptorOf, validateEpisode } from "rl-protocol";
import type { BatchSelectionPolicy, Episode, EpisodeBatchDescriptor } from "rl-protocol";
import { type RlBridgeError } from "./validate.js";

// ---------------------------------------------------------------------------
// The batch assembly outcome
// ---------------------------------------------------------------------------

export type EpisodeBatchAssemblyOutcome =
  | { readonly ok: true; readonly batch: EpisodeBatchDescriptor }
  | { readonly ok: false; readonly errors: readonly RlBridgeError[] };

// ---------------------------------------------------------------------------
// THE BATCH GATE
// ---------------------------------------------------------------------------

/**
 * Assemble one deterministic episode batch — THE BATCH GATE. Laws: a batch
 * carries at least one episode (an empty hand-off is refused loudly);
 * every episode re-proves through the protocol's whole-record validation
 * (its errors carried verbatim); one episode joins once; the emitted ids
 * are in canonical order and the batch id is the content address over the
 * declared selection policy + those ids (A9 — a permuted input yields the
 * IDENTICAL descriptor).
 */
export function assembleBatch(
  episodes: readonly Episode[],
  policy?: BatchSelectionPolicy,
): EpisodeBatchAssemblyOutcome {
  const errors: RlBridgeError[] = [];

  if (episodes.length === 0) {
    errors.push({
      code: "empty-batch",
      message:
        "the batch assembles no episodes — a trainer batch carries at least one recorded episode (fail-closed, never an empty hand-off)",
    });
  }

  const seen = new Set<string>();
  for (const episode of episodes) {
    const id = String(episode.episodeId);
    if (seen.has(id)) {
      errors.push({
        code: "duplicate-episode",
        message: `the episode '${id}' joins the batch twice — one episode, one membership (deterministic batches, A9)`,
      });
    }
    seen.add(id);

    const validation = validateEpisode(episode);
    if (!validation.ok) {
      errors.push({
        code: "malformed-episode",
        message: `[learning-rl] the episode '${id}' failed the protocol's whole-record re-validation (${String(validation.errors.length)} error(s)) — carried data is re-proven, never trusted (A13)`,
        episodeErrors: validation.errors,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const canonicalIds = episodes.map((episode) => episode.episodeId).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const descriptor = episodeBatchDescriptorOf(canonicalIds, policy);
  if (!descriptor.ok) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid-selection-policy",
          message: `[learning-rl] the episode batch failed the protocol's batch construction gate (${String(descriptor.errors.length)} error(s)) — the protocol's errors carried verbatim`,
          batchErrors: descriptor.errors,
        },
      ],
    };
  }
  return { ok: true, batch: descriptor.descriptor };
}
