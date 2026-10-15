/**
 * The W064 reference journey — STAGE SET A, THE FOUNDING (W041→W045):
 * the forged plan (W041's forge gate), the commissioned body (W043's
 * commissionBody gate), the agent binding (W044's bindAgent gate), the
 * founded population (W045's foundPopulation gate) and its challenger
 * generation (W045's addMembers transition gate). Every record is composed
 * through its own gate RIGHT HERE (the W055 fixture family's declared
 * inputs — the zero-drift cross-package fixture lineage — are the
 * deterministic declared data; the gates are the real ones).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { forgeBody } from "../../services/body-forge/index.js";
import type { ForgedBodyPlan } from "../../services/body-forge/index.js";
import { commissionBody } from "../../services/body-forge/commissioning/index.js";
import type { CommissionedBody } from "../../services/body-forge/commissioning/index.js";
import { bindAgent } from "../../services/world-agent-runtime/index.js";
import type { AgentBinding } from "../../services/world-agent-runtime/index.js";
import { addMembers, foundPopulation } from "../../services/populations/index.js";
import type { Population } from "../../services/populations/index.js";
import {
  bodyRequirements,
  forgeComponents,
  selectionPlanFixture,
} from "../../services/body-forge/commissioning/test/fixtures.js";
import { grantsFor, registryFixture } from "../../services/world-agent-runtime/test/fixtures.js";
import {
  GRANTED_AT,
  SEAT_A,
  additionMember,
  populationMembers,
  populationWorldDefinition,
} from "../../services/populations/test/fixtures.js";
import { mustOk, type StageLine } from "./journeyHelpers.js";

/** The founding family's composed records (all through their own gates). */
export interface FoundingRecords {
  readonly plan: ForgedBodyPlan;
  readonly commissioned: CommissionedBody;
  readonly binding: AgentBinding;
  readonly champion: Population;
  readonly challenger: Population;
}

/** Compose the founding family through every gate, at the journey's scope. */
export function stagesFounding(): { readonly lines: readonly StageLine[]; readonly records: FoundingRecords } {
  const world = populationWorldDefinition();

  // S1 — the canonical plan (the W055 fixture family's own declared
  // requirements: the plan the improvement cycle's re-commissioning step
  // cites at this scope).
  const canonical = mustOk(forgeBody(forgeComponents()), "forge-plan");
  const plan: ForgedBodyPlan = canonical.plan;
  const planLine: StageLine = {
    stage: "S1 forge the body plan",
    gate: "W041 forgeBody",
    recordId: String(plan.planId),
    carriedCount: plan.endowment.entries.length,
  };

  // S2 — the seat commissioning mirrors the population fixture family's
  // own construction (the W045 fixture lineage): the body requirements of
  // the world's DECLARED founding seat, the distinct per-seat grant.
  const seatRequirements = bodyRequirements({
    participantId: SEAT_A.participantId as never,
    accountId: SEAT_A.accountId as never,
    bodyId: "body-pop-a-1" as never,
    grant: {
      grantedBy: "principal-pop-fixture" as never,
      channel: "commissioning",
      grantedAt: GRANTED_AT as never,
      basis: "the reference journey commissions seat participant-pop-exec-a for the selected momentum substrate",
    },
  });

  const seatForged = mustOk(forgeBody(forgeComponents({ bodyRequirements: seatRequirements })), "forge-seat-plan");
  const commissionedOutcome = commissionBody(seatForged.plan, selectionPlanFixture(), registryFixture());
  const commissioned = mustOk(commissionedOutcome, "commission-body").body;
  const commissionLine: StageLine = {
    stage: "S2 commission the body",
    gate: "W043 commissionBody",
    recordId: String(commissioned.commissionedId),
    carriedCount: commissioned.endowment.entries.length,
  };

  const bound = mustOk(bindAgent(world, commissioned, grantsFor(commissioned)), "bind-agent");
  const binding: AgentBinding = bound.binding;
  const bindLine: StageLine = {
    stage: "S3 bind the agent to the world",
    gate: "W044 bindAgent",
    recordId: String(binding.bindingId),
    carriedCount: null,
  };

  const champion = mustOk(foundPopulation(world, populationMembers()), "found-population").population;
  const populationLine: StageLine = {
    stage: "S4 found the population",
    gate: "W045 foundPopulation",
    recordId: String(champion.populationId),
    carriedCount: champion.membership.length,
  };

  const challenger = mustOk(
    addMembers(champion, registryFixture(), [additionMember()]),
    "add-members",
  ).population;
  const transitionLine: StageLine = {
    stage: "S5 grow the challenger generation",
    gate: "W045 addMembers",
    recordId: String(challenger.populationId),
    carriedCount: challenger.membership.length,
  };

  return {
    lines: [planLine, commissionLine, bindLine, populationLine, transitionLine],
    records: { plan, commissioned, binding, champion, challenger },
  };
}
