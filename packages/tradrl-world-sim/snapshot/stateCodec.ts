/**
 * Canonical serialization of the authoritative world state for snapshots.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Snapshots" — a snapshot is immutable and
 * self-describing and includes "market/account/participant/information state
 * and journal cursor". This module owns the plain-data MIRROR of
 * `WorldState` (world/state.ts) that a snapshot stores, hashes and restores:
 * the live state contains a `ReadonlySet` (not canonical-data friendly), so
 * snapshots carry the ordered array form and hydrate it back.
 *
 * Determinism law (A9): `serializeWorldState` is a pure function of the
 * state; `hydrateWorldState(serializeWorldState(s))` reproduces a state that
 * is deep-equal to `s` (asserted by tests), so a restored engine reduces the
 * journal tail from EXACTLY the state the live engine had at the snapshot's
 * cursor. Wall time never enters the payload.
 */

import type { CommandId, ScenarioDefinition } from "tradrl-world-contracts";
import type { MatchingState } from "../matching/index.js";
import type { WorldAnnotation, WorldState } from "../world/state.js";

/**
 * The plain-data snapshot form of `WorldState` (structured-clone safe; the
 * W018 adapter wire could carry it). `ackedCommandIds` is the ordered array
 * form of the live `ReadonlySet` — insertion order is the deterministic
 * journal order.
 */
export interface WorldStatePayload {
  readonly annotations: readonly WorldAnnotation[];
  readonly currentScenario?: ScenarioDefinition;
  readonly ackedCommandIds: readonly CommandId[];
  readonly matching: MatchingState;
}

/** Serialize the live authoritative state into its snapshot form. */
export function serializeWorldState(state: WorldState): WorldStatePayload {
  return {
    annotations: state.annotations,
    ...(state.currentScenario === undefined ? {} : { currentScenario: state.currentScenario }),
    ackedCommandIds: [...state.ackedCommandIds],
    matching: state.matching,
  };
}

/**
 * Hydrate the live authoritative state from its snapshot form. The result is
 * deep-equal to the state that was serialized (the Set is rebuilt in the
 * recorded order; everything else is already immutable plain data).
 */
export function hydrateWorldState(payload: WorldStatePayload): WorldState {
  return Object.freeze({
    annotations: payload.annotations,
    ...(payload.currentScenario === undefined ? {} : { currentScenario: payload.currentScenario }),
    ackedCommandIds: new Set<CommandId>(payload.ackedCommandIds),
    matching: payload.matching,
    // W016 slices: a snapshot's state never carries snapshot/branch registry
    // entries — those are event-derived and arrive with the journal tail.
    snapshots: [],
    branches: [],
  } as WorldState);
}
