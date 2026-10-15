/**
 * The episode/batch re-validation (W047) — the whole-record laws, re-proven
 * from the recorded data alone.
 *
 * This gate re-proves the EPISODE'S OWN laws (the identity derivation, the
 * explicit scope, the provenance citations, the carried steps, the §13
 * constraint-aware reward, the immutable lineage) and the BATCH'S OWN laws
 * (the content-addressed id, the canonical order, the count, the declared
 * selection policy). It does NOT re-prove the upstream capture/binding/
 * evaluation gates — that is the bridge service's provenance gate
 * (`services/learning/rl`, through W037/W044/W038's own validators); this
 * module never re-scores, it re-proves shape.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — the re-derivations are pure
 * functions of the record's bytes. Spec: A13 — carried data is re-proven,
 * never trusted.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { blankTrajectoryScopeMembers } from "trajectory";
import {
  barePnlReward,
  blankEpisodeProvenanceMembers,
  episodeIdOf,
} from "./episode.js";
import type { Episode } from "./episode.js";
import { episodeBatchIdOf } from "./trainer.js";
import type { EpisodeBatchDescriptor } from "./trainer.js";

// ---------------------------------------------------------------------------
// The typed error families (closed sets)
// ---------------------------------------------------------------------------

export type EpisodeValidationErrorCode =
  | "identity-mismatch" // the episode id is not the content address of the provenance
  | "blank-scope-member"
  | "blank-provenance-member"
  | "scope-experiment-mismatch"
  | "empty-steps"
  | "pnl-sole-reward" // THE §13 LAW, re-proven on carried data
  | "invalid-lineage";

export interface EpisodeValidationError {
  readonly code: EpisodeValidationErrorCode;
  readonly message: string;
}

export type EpisodeValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly EpisodeValidationError[] };

export type EpisodeBatchValidationErrorCode =
  | "identity-mismatch" // the batch id is not the content address
  | "empty-batch"
  | "non-canonical-order" // the ids are not in canonical order (input leaked)
  | "duplicate-episode-id"
  | "count-mismatch" // the declared count disagrees with the ids
  | "invalid-selection-policy"; // blank/duplicate selection-policy declarations

export interface EpisodeBatchValidationError {
  readonly code: EpisodeBatchValidationErrorCode;
  readonly message: string;
}

export type EpisodeBatchValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly EpisodeBatchValidationError[] };

// ---------------------------------------------------------------------------
// The episode re-validation
// ---------------------------------------------------------------------------

/**
 * Re-validate one ASSEMBLED episode against the episode laws: the identity
 * re-derivation (the id must be the canonical content address of the
 * provenance triple), the explicit scope, the non-blank citations, the
 * scope/experiment agreement, the non-empty carried steps, the §13
 * constraint-aware reward (a bare-P&L signal is refused loudly, naming the
 * law), and the immutable lineage. Carried data, re-proven — never trusted.
 */
export function validateEpisode(episode: Episode): EpisodeValidationOutcome {
  const errors: EpisodeValidationError[] = [];

  if (episodeIdOf(episode.provenance) !== episode.episodeId) {
    errors.push({
      code: "identity-mismatch",
      message: `the episode id is not the canonical content address of its provenance — identity is a function of recorded bytes (A9), never an arbitrary label`,
    });
  }

  for (const member of blankTrajectoryScopeMembers(episode.scope)) {
    errors.push({
      code: "blank-scope-member",
      message: `the episode scope member '${member}' is blank — scope is explicit (DOMAIN-MODEL identity law), never defaulted`,
    });
  }

  for (const member of blankEpisodeProvenanceMembers(episode.provenance)) {
    errors.push({
      code: "blank-provenance-member",
      message: `the episode provenance member '${member}' is blank — citations are opaque ids, never blank`,
    });
  }

  if (String(episode.scope.experimentId) !== String(episode.provenance.experimentId)) {
    errors.push({
      code: "scope-experiment-mismatch",
      message: `the episode scope cites experiment '${String(episode.scope.experimentId)}' but the provenance cites '${String(episode.provenance.experimentId)}' — one episode, one experiment`,
    });
  }

  if (episode.steps.length === 0) {
    errors.push({
      code: "empty-steps",
      message: "the episode carries no observation→action→outcome steps — an empty evidence carry is malformed (fail-closed)",
    });
  }

  if (barePnlReward(episode.reward)) {
    errors.push({
      code: "pnl-sole-reward",
      message:
        "the carried reward signal is bare P&L (every component financial-outcome, or none exists) — 'Raw P&L is never the sole objective' (§13): components + constraints ride verbatim through the W036 PolicyEvaluation or the record is refused",
    });
  }

  const lineage = episode.lineage.trajectory;
  if (lineage.parent === undefined) {
    if (lineage.root !== episode.provenance.trajectoryId || lineage.ordinal !== 0) {
      errors.push({
        code: "invalid-lineage",
        message: "a root trajectory's lineage must be (root = own id, ordinal 0) — carried lineage is immutable",
      });
    }
  } else if (
    lineage.parent === episode.provenance.trajectoryId ||
    String(lineage.root).trim().length === 0 ||
    !Number.isInteger(lineage.ordinal) ||
    lineage.ordinal < 1
  ) {
    errors.push({
      code: "invalid-lineage",
      message: "the carried branch lineage is invalid (self-parent, blank root, or ordinal < 1) — lineage is immutable",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The batch-descriptor re-validation
// ---------------------------------------------------------------------------

/**
 * Re-validate one batch descriptor against the batch laws: the identity
 * re-derivation (the id must be the canonical content address over the
 * policy + the ids), the canonical order (input order never leaks), the
 * count agreement, uniqueness, and the declared selection policy's own
 * declarations. Deterministic data re-proven (A9).
 */
export function validateEpisodeBatchDescriptor(
  descriptor: EpisodeBatchDescriptor,
): EpisodeBatchValidationOutcome {
  const errors: EpisodeBatchValidationError[] = [];

  if (descriptor.episodeIds.length === 0) {
    errors.push({
      code: "empty-batch",
      message: "the episode batch declares no episodes — a batch carries at least one recorded episode",
    });
  }

  const seen = new Set<string>();
  descriptor.episodeIds.forEach((id, index) => {
    const asText = String(id);
    if (seen.has(asText)) {
      errors.push({
        code: "duplicate-episode-id",
        message: `the episode '${asText}' joins the batch twice — one episode, one membership`,
      });
    }
    seen.add(asText);
    const previous = index > 0 ? String(descriptor.episodeIds[index - 1]) : undefined;
    if (previous !== undefined && asText <= previous) {
      errors.push({
        code: "non-canonical-order",
        message: `the batch's episode ids are not in canonical order ('${asText}' at index ${String(index)} follows '${previous}') — input order never leaks into a deterministic batch (A9)`,
      });
    }
  });

  if (descriptor.episodeCount !== descriptor.episodeIds.length) {
    errors.push({
      code: "count-mismatch",
      message: `the batch declares ${String(descriptor.episodeCount)} episode(s) but carries ${String(descriptor.episodeIds.length)} id(s) — the count summarizes the ids, never invents them`,
    });
  }

  if (descriptor.selectionPolicy !== undefined) {
    const policy = descriptor.selectionPolicy;
    if (policy.policyId.trim().length === 0) {
      errors.push({
        code: "invalid-selection-policy",
        message: "the declared selection policy id is blank — the policy is explicit data, never anonymous",
      });
    }
    const names = new Set<string>();
    for (const parameter of policy.parameters) {
      if (parameter.name.trim().length === 0) {
        errors.push({
          code: "invalid-selection-policy",
          message: "a declared selection-policy parameter carries a blank name",
        });
        continue;
      }
      if (names.has(parameter.name)) {
        errors.push({
          code: "invalid-selection-policy",
          message: `the selection-policy parameter '${parameter.name}' is declared twice — deterministic data (A9)`,
        });
      }
      names.add(parameter.name);
    }
  }

  if (errors.length === 0 && episodeBatchIdOf(descriptor.episodeIds, descriptor.selectionPolicy) !== descriptor.batchId) {
    errors.push({
      code: "identity-mismatch",
      message: "the batch id is not the canonical content address of the policy + the canonically-ordered episode ids (A9)",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
