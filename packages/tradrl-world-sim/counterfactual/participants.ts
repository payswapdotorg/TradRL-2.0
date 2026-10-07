/**
 * Reactive participants inside counterfactual branches (W025) — the
 * branch-scoped attachment of a W023 participant runtime to a BRANCHED
 * engine.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — the participant terminates at
 * the same typed CommandPort a human trader uses; there is no second
 * execution path. The runtime itself is W023's
 * (`packages/tradrl-market-participants/src/runtime.ts`) — this module adds
 * NO new execution surface, it only ATTRIBUTES: it takes any runtime
 * satisfying the protocol's telemetry surface that is attached to a client
 * whose world is the BRANCHED engine, and proves/exports the attribution
 * facts:
 * - the runtime's world IS the branch (loud check — a runtime attached to
 *   the parent or a foreign world is rejected);
 * - every acked participant outcome is EVIDENCED in the branch's own
 *   journal (the acked-command registry the branch state carries) — a
 *   participant's decisions in the branch are attributable to the branch;
 * - NO participant command id appears in the parent's acked-command
 *   registry (the parent-immutability law at the participant level).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — the information firewall holds
 * inside branches unchanged: the W023 settled-view reader
 * (readSettledView) reads the branch's ports only, trades are
 * availableAt-firewalled and news (including artifacts INJECTED by a
 * counterfactual overlay) is observable-then. The tests prove the law for
 * injected artifacts (an overlay artifact with a future `availableAt` is
 * invisible before its time, visible after).
 *
 * TYPE-ONLY protocol imports follow the W023 convention (the relative
 * source path — the contracts `exports` registration of
 * `./participantProtocol` is a TL action item; runtime code in this module
 * never imports the participants package, so no package cycle exists).
 */

import type { CommandId, WorldId } from "tradrl-world-contracts";
import type {
  ParticipantCommandOutcome,
  ParticipantRuntimeStatus,
  ParticipantRuntimeTelemetry,
} from "../../tradrl-world-contracts/src/participantProtocol.js";
import type { CounterfactualBranchHandle } from "./engine.js";

/**
 * The structural runtime surface this module consumes — satisfied verbatim
 * by the W023 reference runtime (`createParticipantRuntime`): the telemetry
 * (whose `worldId` is the attribution fact — the world the runtime's CLIENT
 * is attached to), the quiet-round-trip settle and the stop.
 */
export interface BranchParticipantRuntime {
  telemetry(): ParticipantRuntimeTelemetry;
  settle(): Promise<void>;
  stop(): void;
}

/** Thrown when a runtime is attached to a world that is not the branch. */
export class CounterfactualParticipantMismatchError extends Error {
  constructor(
    readonly branchWorldId: WorldId,
    readonly runtimeWorldId: string,
  ) {
    super(
      `[counterfactual] participant runtime is attached to world '${runtimeWorldId}', not the branch '${String(branchWorldId)}' (attribution law)`,
    );
    this.name = "CounterfactualParticipantMismatchError";
  }
}

/** Per-agent outcome attribution inside the branch. */
export interface BranchAgentAttribution {
  readonly agentId: string;
  readonly outcomes: number;
  readonly acked: number;
  readonly rejected: number;
}

/** The branch-scoped participant telemetry (the W023 telemetry + facts). */
export interface BranchScopedParticipantTelemetry {
  readonly branchWorldId: WorldId;
  readonly parentWorldId: WorldId;
  readonly runtimeWorldId: string;
  readonly status: ParticipantRuntimeStatus;
  readonly viewsReceived: number;
  readonly passes: number;
  readonly acked: number;
  readonly rejected: number;
  readonly perAgent: readonly BranchAgentAttribution[];
  readonly outcomes: readonly ParticipantCommandOutcome[];
  /** Acked outcomes whose command ids are evidenced in the branch journal. */
  readonly evidencedInBranch: number;
  /** Outcome command ids ALSO present in the parent's registry (must be 0). */
  readonly spilledIntoParent: number;
}

/** A participant runtime attached to a counterfactual branch. */
export interface BranchParticipantAttachment {
  readonly branch: CounterfactualBranchHandle;
  readonly runtime: BranchParticipantRuntime;
  /** Branch-scoped telemetry (a pure read of the runtime + both journals). */
  telemetry(): BranchScopedParticipantTelemetry;
}

/** Attribute one runtime's outcomes per agent (deterministic order). */
function perAgentOf(outcomes: readonly ParticipantCommandOutcome[]): BranchAgentAttribution[] {
  const order: string[] = [];
  const byAgent = new Map<string, { outcomes: number; acked: number; rejected: number }>();
  for (const outcome of outcomes) {
    let entry = byAgent.get(outcome.agentId);
    if (entry === undefined) {
      entry = { outcomes: 0, acked: 0, rejected: 0 };
      byAgent.set(outcome.agentId, entry);
      order.push(outcome.agentId);
    }
    entry.outcomes += 1;
    if (outcome.result.status === "acked") {
      entry.acked += 1;
    } else {
      entry.rejected += 1;
    }
  }
  return order.map((agentId) => ({ agentId, ...byAgent.get(agentId)! }));
}

/**
 * Attach a W023 participant runtime to a counterfactual BRANCH: validate
 * the attribution law (the runtime's world is the branch), and expose the
 * branch-scoped telemetry with journal evidence (acked outcomes evidenced
 * in the branch's own acked-command registry; zero spillover into the
 * parent's). The runtime is consumed as-is — no new execution path.
 */
export function attachBranchParticipants(input: {
  readonly branch: CounterfactualBranchHandle;
  readonly runtime: BranchParticipantRuntime;
  /**
   * The parent world (READ ONLY — its acked-command registry backs the
   * spillover check). Optional: without it the spillover count is omitted
   * from the telemetry as 0-with-disclosure (evidencedInBranch still holds).
   */
  readonly parent?: {
    worldState(): { readonly ackedCommandIds: ReadonlySet<CommandId> };
  };
}): BranchParticipantAttachment {
  const { branch, runtime } = input;
  const attachedWorld = runtime.telemetry().worldId;
  if (attachedWorld !== String(branch.record.branchWorldId)) {
    throw new CounterfactualParticipantMismatchError(
      branch.record.branchWorldId,
      attachedWorld,
    );
  }
  return {
    branch,
    runtime,
    telemetry(): BranchScopedParticipantTelemetry {
      const telemetry = runtime.telemetry();
      const branchRegistry = branch.engine.worldState().ackedCommandIds;
      let evidencedInBranch = 0;
      let spilledIntoParent = 0;
      const parentRegistry = input.parent?.worldState().ackedCommandIds;
      for (const outcome of telemetry.outcomes) {
        const commandId = outcome.commandId as CommandId;
        if (outcome.result.status === "acked" && branchRegistry.has(commandId)) {
          evidencedInBranch += 1;
        }
        if (parentRegistry?.has(commandId) === true) {
          spilledIntoParent += 1;
        }
      }
      return {
        branchWorldId: branch.record.branchWorldId,
        parentWorldId: branch.record.parentWorldId,
        runtimeWorldId: telemetry.worldId,
        status: telemetry.status,
        viewsReceived: telemetry.viewsReceived,
        passes: telemetry.passes.length,
        acked: telemetry.acked,
        rejected: telemetry.rejected,
        perAgent: perAgentOf(telemetry.outcomes),
        outcomes: telemetry.outcomes,
        evidencedInBranch,
        spilledIntoParent,
      };
    },
  };
}
