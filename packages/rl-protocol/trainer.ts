/**
 * The TrainerPort + the deterministic episode-batch descriptor (W047).
 *
 * Spec: spec/REQUIREMENTS.md R054 — "RL is one learning method among
 * many." The port is METHOD-NEUTRAL: it speaks episodes and batches, never
 * gradients, optimizers, frameworks, or devices (those are W048/W049's
 * adapters). Spec: spec/ARCHITECTURE-LOCK.md A14 — this module TYPES the
 * trainer-facing wiring; it never executes a trainer, never steps a world,
 * never trains anything. The bridge service hands a trainer a batch
 * DESCRIPTOR (the content-addressed set of episode ids); how a trainer
 * consumes it is the trainer's own law.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the batch id is the
 * canonical content digest over the declared selection policy + the
 * canonically-ordered episode ids. Input order NEVER leaks: a permuted
 * declaration of the same episodes yields the IDENTICAL descriptor
 * (deep-equal, same id).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex } from "trajectory";
import type { EpisodeId } from "./episode.js";

// ---------------------------------------------------------------------------
// The deterministic episode-batch descriptor
// ---------------------------------------------------------------------------

/**
 * ONE declared selection-policy parameter (deterministic DATA — a
 * name/value pair, never prose, never a function).
 */
export interface BatchSelectionParameter {
  readonly name: string;
  readonly value: string | number | boolean;
}

/**
 * The declared selection policy of one batch — DATA, never behavior: an
 * opaque policy id plus its declared parameters. R054 keeps this neutral:
 * the policy never names a trainer, a framework, or a gradient method.
 */
export interface BatchSelectionPolicy {
  readonly policyId: string;
  readonly parameters: readonly BatchSelectionParameter[];
}

declare const episodeBatchIdBrand: unique symbol;

/** An OPAQUE episode-batch id (a canonical digest rendering, never parsed). */
export type EpisodeBatchId = string & { readonly [episodeBatchIdBrand]: true };

/** The id prefix (a rendering convention, never a parse target). */
export const EPISODE_BATCH_ID_PREFIX = "batch-";

/**
 * The deterministic batch descriptor: the canonically-ordered episode ids
 * (lexicographic on the opaque id — input order never leaks), the episode
 * count, the content-addressed batch id, and the optional declared
 * selection policy (DATA). This is ALL a trainer is handed — episodes are
 * fetched through the bridge, never embedded in the descriptor.
 */
export interface EpisodeBatchDescriptor {
  readonly batchId: EpisodeBatchId;
  readonly episodeIds: readonly EpisodeId[];
  readonly episodeCount: number;
  readonly selectionPolicy: BatchSelectionPolicy | undefined;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type EpisodeBatchErrorCode =
  | "empty-batch" // a batch of zero episodes is refused
  | "duplicate-episode-id" // one episode joins one batch once
  | "blank-policy-id" // the declared selection policy has no identity
  | "blank-parameter-name" // a declared parameter is nameless
  | "duplicate-parameter-name"; // one parameter name, one declaration

/** One typed episode-batch error (fail-closed). */
export interface EpisodeBatchError {
  readonly code: EpisodeBatchErrorCode;
  readonly message: string;
}

export type EpisodeBatchDescriptorOutcome =
  | { readonly ok: true; readonly descriptor: EpisodeBatchDescriptor }
  | { readonly ok: false; readonly errors: readonly EpisodeBatchError[] };

// ---------------------------------------------------------------------------
// The construction gate
// ---------------------------------------------------------------------------

function compareIds(left: EpisodeId, right: EpisodeId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function policyViolations(policy: BatchSelectionPolicy | undefined): EpisodeBatchError[] {
  if (policy === undefined) {
    return [];
  }
  const errors: EpisodeBatchError[] = [];
  if (policy.policyId.trim().length === 0) {
    errors.push({
      code: "blank-policy-id",
      message:
        "the declared selection policy id is blank — a batch's selection policy is explicit data (DOMAIN-MODEL identity law), never an anonymous default",
    });
  }
  const seen = new Set<string>();
  for (const parameter of policy.parameters) {
    if (parameter.name.trim().length === 0) {
      errors.push({
        code: "blank-parameter-name",
        message: "a declared selection-policy parameter carries a blank name — parameters are named data",
      });
      continue;
    }
    if (seen.has(parameter.name)) {
      errors.push({
        code: "duplicate-parameter-name",
        message: `the selection-policy parameter '${parameter.name}' is declared twice — one name, one declaration, deterministic data (A9)`,
      });
    }
    seen.add(parameter.name);
  }
  return errors;
}

/**
 * The batch id: the canonical content digest over the declared selection
 * policy + the canonically-ordered episode ids. Pure and deterministic
 * (A9) — and input-order-blind: the ids are canonicalized (sorted) before
 * the digest is taken, so a permuted declaration of the same batch yields
 * the IDENTICAL id.
 */
export function episodeBatchIdOf(
  episodeIds: readonly EpisodeId[],
  policy?: BatchSelectionPolicy,
): EpisodeBatchId {
  const canonicalIds = [...episodeIds].sort(compareIds);
  return `${EPISODE_BATCH_ID_PREFIX}${canonicalDigestHex({
    policy: policy === undefined ? null : policy,
    episodeIds: canonicalIds,
  })}` as EpisodeBatchId;
}

/**
 * Construct one batch descriptor — THE CONSTRUCTION GATE. Laws: a batch
 * carries at least one episode (an empty batch is meaningless data,
 * refused loudly), one episode joins once, the selection policy (when
 * declared) carries a non-blank id and uniquely-named parameters, and the
 * emitted ids are in CANONICAL order regardless of declaration order.
 */
export function episodeBatchDescriptorOf(
  episodeIds: readonly EpisodeId[],
  policy?: BatchSelectionPolicy,
): EpisodeBatchDescriptorOutcome {
  const errors: EpisodeBatchError[] = [];

  if (episodeIds.length === 0) {
    errors.push({
      code: "empty-batch",
      message:
        "the episode batch declares no episodes — a trainer batch carries at least one recorded episode (fail-closed, never an empty hand-off)",
    });
  }

  const seen = new Set<string>();
  for (const id of episodeIds) {
    if (seen.has(String(id))) {
      errors.push({
        code: "duplicate-episode-id",
        message: `the episode '${String(id)}' joins the batch twice — one episode, one membership (deterministic batches, A9)`,
      });
    }
    seen.add(String(id));
  }

  errors.push(...policyViolations(policy));

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const canonicalIds = [...episodeIds].sort(compareIds);
  const descriptor: EpisodeBatchDescriptor = {
    batchId: episodeBatchIdOf(canonicalIds, policy),
    episodeIds: canonicalIds,
    episodeCount: canonicalIds.length,
    selectionPolicy: policy === undefined ? undefined : { ...policy, parameters: [...policy.parameters] },
  };
  Object.freeze(descriptor);
  return { ok: true, descriptor };
}

// ---------------------------------------------------------------------------
// The trainer port (types only — the W048/W049 adapters satisfy this)
// ---------------------------------------------------------------------------

/**
 * What one trainer declares about itself — DATA, method-neutral (R054):
 * an opaque trainer id and the declared method family (e.g. 'rl',
 * 'offline-rl', 'bandit' — the protocol never prescribes the method).
 */
export interface TrainerDescriptor {
  readonly trainerId: string;
  readonly method: string;
}

/** The receipt one trainer returns for a batch it accepted (typed DATA). */
export interface TrainerBatchReceipt {
  readonly trainerId: string;
  readonly batchId: EpisodeBatchId;
  readonly episodeCount: number;
}

/** One typed trainer refusal (fail-closed — a trainer may decline a batch loudly). */
export interface TrainerBatchError {
  readonly code: "batch-refused";
  readonly message: string;
}

export type TrainerBatchOutcome =
  | { readonly ok: true; readonly receipt: TrainerBatchReceipt }
  | { readonly ok: false; readonly errors: readonly TrainerBatchError[] };

/**
 * THE TRAINER PORT — the minimal PURE interface an RL trainer implements:
 * the typed surface W048 (distributed episode generation) and W049
 * (JAX-LOB training adapter) satisfy. The bridge NEVER invokes this port
 * (A14: no trainer execution, no gradients, no stepping); the port types
 * the handshake only. Implementations own every semantic beyond it.
 */
export interface TrainerPort {
  readonly descriptor: TrainerDescriptor;
  /** Accept one deterministic batch descriptor (implementations own semantics). */
  consumeBatch(batch: EpisodeBatchDescriptor): TrainerBatchOutcome;
}
