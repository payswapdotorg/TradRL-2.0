/**
 * Branch world definition — rescoping a world definition to a branch world
 * id (W016 `branch` module).
 *
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — tenant/project/world scope is
 * explicit; every world-scoped entity declares its world. A branch is a NEW
 * world: its authoritative state must be scoped to the branch id, so the
 * definition the branch engine runs on is the source definition with the
 * scope AND every world-scoped entity (instruments, venues, accounts,
 * participants, information artifacts) rewritten to the branch world id.
 * Opaque entity ids (orders, annotations, ...) are NEVER rewritten — they
 * are inherited references and the branch's deterministic id allocators
 * (ord:/ann:/fil:/trd: prefixed by the branch world id) cannot collide with
 * them.
 */

import type { WorldId } from "tradrl-world-contracts";
import type { WorldDefinition } from "../world/definition.js";

/** True when the entity's worldId matches the old world scope. */
function wasScopedTo(entity: { readonly worldId: WorldId }, oldWorldId: WorldId): boolean {
  return entity.worldId === oldWorldId;
}

/**
 * Rebuild `definition` scoped to `worldId`: the scope plus every world-scoped
 * entity is rewritten; ids, clock genesis, regime schedule and every other
 * declaration are carried verbatim. The result is validated by the engine at
 * creation (assertValidWorldDefinition) — a coherent source definition
 * always revalidates.
 */
export function withBranchWorldId(
  definition: WorldDefinition,
  worldId: WorldId,
): WorldDefinition {
  const oldWorldId = definition.scope.worldId;
  return {
    ...definition,
    scope: { ...definition.scope, worldId },
    instruments: definition.instruments.map((instrument) =>
      wasScopedTo(instrument, oldWorldId) ? { ...instrument, worldId } : instrument,
    ),
    ...(definition.venues === undefined
      ? {}
      : {
          venues: definition.venues.map((venue) =>
            wasScopedTo(venue, oldWorldId) ? { ...venue, worldId } : venue,
          ),
        }),
    accounts: definition.accounts.map((account) =>
      wasScopedTo(account, oldWorldId) ? { ...account, worldId } : account,
    ),
    participants: definition.participants.map((participant) =>
      wasScopedTo(participant, oldWorldId) ? { ...participant, worldId } : participant,
    ),
    ...(definition.informationArtifacts === undefined
      ? {}
      : {
          informationArtifacts: definition.informationArtifacts.map((artifact) =>
            wasScopedTo(artifact, oldWorldId) ? { ...artifact, worldId } : artifact,
          ),
        }),
  };
}

/**
 * Canonical deterministic branch world id: the parent's n-th branch
 * (`wld:<parentWorldId>:<n>`, the established `prefix:world:counter`
 * encoder pattern — mirroring ann:/ord:/snap:). `n` comes from the
 * event-derived branch registry, so live creation and replay agree.
 */
export function branchWorldIdFor(parentWorldId: WorldId, count: number): WorldId {
  return `wld:${String(parentWorldId)}:${String(count)}` as WorldId;
}
