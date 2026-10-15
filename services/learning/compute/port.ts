/**
 * The GenerationWorkerPort (W048) — the worker-facing contract of
 * distributed episode generation.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — this module TYPES the handshake a
 * generation worker implements; it never executes generation, never steps
 * a world, never touches a network, never spawns a process. A FUTURE
 * distributed runtime (not this package) executes plans by handing work
 * units to workers that satisfy this port; the runtime itself is out of
 * scope and deliberately untyped here.
 *
 * The contract: claim ONE work unit → emit ONE batch reference. The unit is
 * typed DATA (its shard, its population slice, its declared batch
 * descriptor, its declared world/scope); the emitted reference cites the
 * OPAQUE unit id and the W047 `EpisodeBatchId` of the batch the worker
 * produced for it. The worker's own law (documented, never enforced here —
 * the port types the handshake only, the TrainerPort precedent): the
 * emitted batch must be assembled through W047's `assembleBatch` under the
 * unit's DECLARED selection policy, so the plan's declared vocabulary is
 * the one the emitted batch realizes.
 *
 * A9 / A14: the worker identity is DECLARED data (an opaque id chosen by
 * the implementer) — never a discovered node id, hostname, or address;
 * distribution is declared, never discovered.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EpisodeBatchId } from "rl-protocol";
import type { GenerationUnit, GenerationUnitId } from "./plan.js";

// ---------------------------------------------------------------------------
// The emitted batch reference (typed DATA)
// ---------------------------------------------------------------------------

/**
 * The receipt one generation worker emits for a unit it completed: the
 * claimed unit's opaque id, the W047 content-addressed batch id of the
 * batch produced for it, and the emitted episode count. Typed DATA only —
 * never an address, never a node id, never a clock.
 */
export interface GeneratedBatchReference {
  readonly unitId: GenerationUnitId;
  readonly batchId: EpisodeBatchId;
  readonly episodeCount: number;
}

// ---------------------------------------------------------------------------
// The worker descriptor (DECLARED identity, never discovered)
// ---------------------------------------------------------------------------

/**
 * What one generation worker declares about itself — DATA: an opaque
 * worker id. Deliberately minimal and method-neutral (R054): no runtime,
 * no framework, no device, no address. A9: the identity is DECLARED by the
 * implementer, never discovered from the environment.
 */
export interface GenerationWorkerDescriptor {
  readonly workerId: string;
}

// ---------------------------------------------------------------------------
// The typed refusal (fail-closed — a worker may decline a unit loudly)
// ---------------------------------------------------------------------------

/** One typed generation-worker refusal (fail-closed). */
export interface GenerationWorkerError {
  readonly code: "unit-refused";
  readonly message: string;
}

export type GenerationUnitOutcome =
  | { readonly ok: true; readonly reference: GeneratedBatchReference }
  | { readonly ok: false; readonly errors: readonly GenerationWorkerError[] };

// ---------------------------------------------------------------------------
// THE PORT
// ---------------------------------------------------------------------------

/**
 * THE GENERATION WORKER PORT — the minimal PURE interface a generation
 * worker implements: claim one work unit, emit one batch reference (or
 * refuse loudly). THIS package never invokes the port (A14: no execution,
 * no spawning, no networking); the port types the handshake only. A future
 * distributed runtime satisfies itself against this surface; W049 (the
 * JAX-LOB training adapter) consumes the plans the units descend from.
 * Implementations own every semantic beyond the typed handshake.
 */
export interface GenerationWorkerPort {
  readonly descriptor: GenerationWorkerDescriptor;
  /** Claim one deterministic work unit (implementations own semantics). */
  claimUnit(unit: GenerationUnit): GenerationUnitOutcome;
}
