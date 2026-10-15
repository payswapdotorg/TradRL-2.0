/**
 * Shared deterministic fixtures for the W046 learning-populations tests —
 * REAL imports only (the no-shim law): REAL W045 populations founded and
 * transitioned through the populations package's OWN gates over its own
 * test fixtures (the W045 fixture lineage): the champion genesis, the
 * challenger as the champion's REAL next generation through addMembers,
 * and an ablate-origin challenger through ablateMembers citing the W039
 * model-substitution axis vocabulary.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { ablateMembers, addMembers, foundPopulation, retireMembers } from "populations";
import type { Population, PopulationOutcome, PopulationTransitionOutcome } from "populations";
import { additionMember, populationMembers, populationWorldDefinition, registryFixture, thaw } from "../../../populations/test/fixtures.js";
import type { Writable } from "../../../populations/test/fixtures.js";

export { thaw };
export type { Writable };

function sealedPopulation(outcome: PopulationOutcome | PopulationTransitionOutcome, label: string): Population {
  if (!outcome.ok) {
    throw new Error(`${label} failed (${outcome.errors.map((entry) => String(entry.code)).join(", ")})`);
  }
  return outcome.population;
}

let cachedChampion: Population | undefined;

/** The champion: the REAL founding population (two agents + one organization). */
export function championPopulation(): Population {
  cachedChampion ??= sealedPopulation(foundPopulation(populationWorldDefinition(), populationMembers()), "champion fixture");
  return cachedChampion;
}

let cachedChallenger: Population | undefined;

/** The challenger: the champion's REAL next generation (W045's own addMembers gate). */
export function challengerPopulation(): Population {
  cachedChallenger ??= sealedPopulation(addMembers(championPopulation(), registryFixture(), [additionMember()]), "challenger fixture");
  return cachedChallenger;
}

let cachedAblated: Population | undefined;

/** An ablate-origin challenger: the W039 model-substitution axis, one agent member retired. */
export function ablatedChallenger(): Population {
  cachedAblated ??= (() => {
    const champion = championPopulation();
    const agent = champion.membership.find((member) => member.kind === "agent");
    if (agent === undefined || agent.kind !== "agent") {
      throw new Error("ablation fixture needs an agent member to retire");
    }
    return sealedPopulation(ablateMembers(champion, registryFixture(), {
      ablation: {
        kind: "model-substitution",
        operation: "substitute-substrate-requirement",
        subject: String(agent.substrateId),
      },
      retirements: [{ memberId: String(agent.bindingId), reason: "the model-substitution axis swapped what mind the seat requires (W039 substitute-substrate-requirement)" }],
    }), "ablated challenger fixture");
  })();
  return cachedAblated;
}

/** The canonical member ids of the champion, in canonical order. */
export function championMemberIds(): string[] {
  return championPopulation().membership.map((member) => String(member.bindingId)).sort();
}

let cachedGrandchild: Population | undefined;

/** A REAL generation-2 population (the challenger's own next generation, via W045's retireMembers gate). */
export function grandchildPopulation(): Population {
  cachedGrandchild ??= (() => {
    const challenger = challengerPopulation();
    const leaving = challenger.membership.map((member) => String(member.bindingId)).sort()[0]!;
    return sealedPopulation(retireMembers(challenger, registryFixture(), [{ memberId: leaving, reason: "the adversarial fixture rotates the seat to reach generation two" }]), "grandchild fixture");
  })();
  return cachedGrandchild;
}
