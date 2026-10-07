/**
 * The effective agent projection (W034): the composed agent AS DATA —
 * `Agent = Body possessed by Cognitive Substrate` (spec/ARCHITECTURE.md
 * §12) as one pure, typed value.
 *
 * Spec: spec/REQUIREMENTS.md R051 — the projection is only defined for a
 * COMPATIBLE possession: `projectEffectiveAgent` runs the compatibility
 * check (declaration level; plus the W032 attach constraints when a world
 * is given) and refuses loudly on any incompatibility (fail-closed).
 *
 * What the projection composes (every field the tighter-of intersection,
 * the W032 `effectiveRiskEnvelope` precedent — both source declarations
 * stay intact; nothing is clipped or mutated):
 * - `commandKinds` — substrate-declared ∩ scope-granted (⊆ the body's
 *   embodiment): the commands the composed agent may issue;
 * - `instruments` — the possession scope (⊆ the embodiment): where the
 *   composed agent may act;
 * - `view` — the view grant intersection: `maximalBodyView(body)` ∩ the
 *   possession scope (the substrate's observed-view needs, declared by
 *   the possession): instruments and observation families narrowed,
 *   identity and account preserved — the ONLY view the substrate receives
 *   through this possession (A7);
 * - `decisionRate` — the tighter-of the substrate's declared rate
 *   envelope and the possession's rate grant (the lower per-view cap; the
 *   LONGER minimum view interval — the spacing both sides honor);
 * - `riskEnvelope` — with a world, the W032
 *   `effectiveRiskEnvelope(body.riskEnvelope, worldLimits)` (on a
 *   compatible possession the body's declared values are carried through
 *   unchanged); without a world, the body's declared envelope verbatim.
 *
 * Purity: the projection never mutates its inputs and performs no IO —
 * it is a function of the declarations alone (A9: same descriptors ⇒
 * same agent, bit-for-bit).
 */

import type { WorldDefinition } from "tradrl-world-sim/world";
import { resolveRiskLimits } from "tradrl-world-sim/risk";
import { maximalBodyView } from "tradrl-world-contracts/agentBody";
import type { BodyView } from "tradrl-world-contracts/agentBody";
import type { DecisionRateEnvelope } from "tradrl-world-contracts/cognitiveSubstrate";
import { effectiveRiskEnvelope } from "agent-body/envelope";
import type {
  EffectiveAgent,
  EffectiveAgentProjection,
  PossessionDescriptor,
} from "./contracts.js";
import { checkPossessionCompatibility } from "./compatibility.js";

/**
 * Project the composed agent from a possession declaration (plus,
 * optionally, the world the body binds — when given, the W032 attach
 * constraints are part of the compatibility gate and the effective risk
 * envelope is the tighter-of intersection with the world's limits).
 */
export function projectEffectiveAgent(
  descriptor: PossessionDescriptor,
  world?: WorldDefinition,
): EffectiveAgentProjection {
  const compatibility = checkPossessionCompatibility(descriptor, world);
  if (!compatibility.ok) {
    return { ok: false, incompatibilities: compatibility.incompatibilities };
  }

  const { body, substrate, scope } = descriptor;

  // The effective command surface: the substrate's declaration, narrowed
  // to what this possession grants (both ⊆ the embodiment on a valid
  // descriptor) — declaration order preserved, no invented kinds.
  const commandKinds = substrate.commandKinds.filter((kind) =>
    scope.commandKinds.includes(kind),
  );

  // The view grant intersection: the body's MAXIMAL legal view, narrowed
  // to the possession scope (identity and account preserved — only the
  // instruments and observation families intersect).
  const maximal = maximalBodyView(body);
  const view: BodyView = {
    bodyId: maximal.bodyId,
    worldId: maximal.worldId,
    accountId: maximal.accountId,
    instruments: scope.instruments,
    observations: scope.observations,
  };

  // The effective decision rate: the tighter-of both declarations (the
  // lower cap; the longer minimum spacing — unset = not enforced, the
  // W003 law, so a one-sided declaration wins).
  const granted = scope.decisionRate;
  const maxDecisionsPerView = Math.min(
    substrate.decisionRate.maxDecisionsPerView,
    granted?.maxDecisionsPerView ?? Number.POSITIVE_INFINITY,
  );
  const intervals = [
    substrate.decisionRate.minViewIntervalMs,
    granted?.minViewIntervalMs,
  ].filter((value): value is number => value !== undefined);
  const decisionRate: DecisionRateEnvelope = {
    maxDecisionsPerView,
    ...(intervals.length === 0 ? {} : { minViewIntervalMs: Math.max(...intervals) }),
  };

  // The effective risk envelope: the W032 tighter-of intersection with
  // the world's declared limits (valid attachment ⇒ the body's declared
  // values carry through), or the body's declaration verbatim without a
  // world (nothing to intersect).
  const riskEnvelope =
    world === undefined
      ? body.riskEnvelope
      : effectiveRiskEnvelope(
          body.riskEnvelope,
          resolveRiskLimits(world.riskLimits, String(body.accountId)),
        );

  const agent: EffectiveAgent = {
    possessionId: descriptor.possessionId,
    bodyId: body.bodyId,
    substrateId: substrate.substrateId,
    worldId: body.scope.worldId,
    participantId: body.participantId,
    accountId: body.accountId,
    body,
    substrate,
    commandKinds,
    instruments: scope.instruments,
    view,
    decisionRate,
    riskEnvelope,
  };
  return { ok: true, agent };
}
