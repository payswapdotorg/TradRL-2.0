/**
 * The body-forge contracts (W041) — the typed component INPUT the forge
 * composes from, the ForgedBodyPlan it produces, and the closed typed
 * error family. DATA only: the forge gate lives in ./forge.ts.
 *
 * The chain this service sits in (ARCHITECTURE.md §12): W037 captured
 * the trajectories, W040 registered the capabilities they measured, the
 * `skills` package (W041) derived the skill records, W039's organizations
 * declare demands and compose — and THIS forge composes a Body ENDOWED
 * with skills: the builder whose typed plans the runtime commissioning
 * path (W043, reserved at ./commissioning/) will consume.
 *
 * A14 boundaries: the forge COMPOSES typed plans, it never executes,
 * never possesses, never runs — there is no world here, no model call,
 * no I/O. The possession compatibility proof therefore runs world-less
 * (the W039 compiler precedent: the W032 attach constraints are NOT
 * claimed — attaching to a concrete world is the runtime's proof).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { BodyAttachment, BodyDescriptor } from "agent-body";
import type { CognitiveSubstrateDescriptor } from "cognitive-substrate";
import type {
  PossessionCheckKind,
  PossessionGrant,
  PossessionId,
  PossessionIncompatibility,
  PossessionLineage,
  PossessionScope,
} from "possession";
import type { CapabilityRegistry } from "capability-registry";
import type { OpaqueId, SkillRecord } from "skills";

/** The identity of one forged plan (opaque; digest-derived). */
export type ForgedPlanId = OpaqueId<"ForgedPlanId">;

/** The plan id prefix (a rendering convention, never a parse target). */
export const FORGED_PLAN_ID_PREFIX = "forge-";

/**
 * The body requirements: everything the composed W032 BodyDescriptor
 * declares — the seat identity (participant/account), the explicit
 * tenant/project/world scope, the embodiment (instruments, venues, order
 * kinds, time-in-force, command kinds), and the risk envelope (A13) —
 * PLUS the W034 possession grant (who bound the substrate to this body,
 * through which channel, on what declared basis — authority is DATA the
 * composer brings, never something the forge invents) and the declared
 * possession scope (proven ⊆ the composed body's own embodiment through
 * W034's own gate). The forge composes the descriptor VERBATIM from
 * these fields and validates it through W032's own gate.
 */
export interface BodyRequirements {
  readonly bodyId: BodyDescriptor["bodyId"];
  readonly scope: BodyDescriptor["scope"];
  readonly participantId: BodyDescriptor["participantId"];
  readonly accountId: BodyDescriptor["accountId"];
  readonly participantKind: BodyDescriptor["participantKind"];
  readonly displayName?: string;
  readonly embodiment: BodyDescriptor["embodiment"];
  readonly riskEnvelope: BodyDescriptor["riskEnvelope"];
  /** The W034 grant carried verbatim into the plan (authority-as-data). */
  readonly grant: PossessionGrant;
  /** The declared possession scope (narrowing ⊆ the embodiment, by W034's law). */
  readonly possessionScope: PossessionScope;
}

/**
 * The typed component input of one forge run: the substrate reference
 * (W033 — the part that decides), the body requirements, the endowed
 * skill records (W041), and the W040 capability registry the endowment
 * is proven against. Declaration only — composition belongs to
 * ./forge.ts.
 */
export interface ForgeComponents {
  readonly substrate: CognitiveSubstrateDescriptor;
  readonly bodyRequirements: BodyRequirements;
  /** The endowment (any input order — the plan is canonical). */
  readonly skills: readonly SkillRecord[];
  readonly registry: CapabilityRegistry;
}

/** One endowment entry: WHICH skill, WHICH capability, WHICH evidence. */
export interface SkillEndowmentEntry {
  readonly skillId: SkillRecord["skillId"];
  readonly capabilityId: SkillRecord["competence"]["capabilityId"];
  /** The trajectory evidence that demonstrated the skill (canonical order, carried). */
  readonly evidenceTrajectoryIds: SkillRecord["evidence"]["trajectoryIds"];
}

/**
 * The skill endowment manifest: the skills the forged body is endowed
 * with, in canonical skill-id order (A9 — input order never leaks), plus
 * the total evidence citation count (an honest count, never a re-score).
 */
export interface SkillEndowmentManifest {
  readonly entries: readonly SkillEndowmentEntry[];
  readonly totalEvidenceCitations: number;
}

/**
 * The possession plan: the W034 declaration data the runtime will bind
 * through — the deterministic possession id, the grant and scope carried
 * verbatim, the possession digest (the content address of the WHOLE
 * declaration the future lineage entries will commit to), the initial
 * lineage + its anchor (W034's own seams), and the compatibility
 * evidence W034 proved world-less.
 */
export interface ForgedPossessionPlan {
  readonly possessionId: PossessionId;
  readonly grant: PossessionGrant;
  readonly scope: PossessionScope;
  readonly possessionDigest: string;
  readonly lineageAnchor: string;
  readonly lineage: PossessionLineage;
  readonly compatibility: { readonly checked: readonly PossessionCheckKind[] };
}

/**
 * The ForgedBodyPlan — the composed plan, as DATA: the composed W032
 * BodyDescriptor, the substrate reference it will be possessed by, the
 * skill endowment manifest, the possession plan, the W032 initial body
 * attachment (declared, not yet bound), and the content-addressed plan
 * id. The runtime (W043+ commissioning) consumes this; the forge never
 * executes it.
 */
export interface ForgedBodyPlan {
  readonly planId: ForgedPlanId;
  readonly body: BodyDescriptor;
  readonly substrate: CognitiveSubstrateDescriptor;
  readonly endowment: SkillEndowmentManifest;
  readonly possession: ForgedPossessionPlan;
  readonly attachment: BodyAttachment;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type ForgeErrorCode =
  | "invalid-body" // the W032 gate refused the composed descriptor (carried)
  | "registry-invalid" // the W040 gate refused the registry (carried)
  | "registry-scope-mismatch" // the registry's scope ≠ the body's scope
  | "invalid-skill" // the skills gate refused a skill record (carried)
  | "duplicate-skill" // the same skill id twice in the endowment
  | "unregistered-skill" // the skill's capability is not in the registry
  | "deprecated-capability" // the W040 lifecycle, carried loudly
  | "revoked-capability" // terminal, carried loudly
  | "skill-scope-mismatch" // the skill's scope ≠ the body's scope
  | "bearer-mismatch" // not demonstrated by the forging substrate
  | "incompatible-possession"; // W034 incompatibilities carried verbatim

/** One typed forge error (fail-closed; carries the upstream errors verbatim). */
export interface ForgeError {
  readonly code: ForgeErrorCode;
  readonly message: string;
  readonly skillId?: string;
  readonly capabilityId?: string;
  /** Present on `invalid-body`: W032's own errors, verbatim. */
  readonly bodyErrors?: readonly unknown[];
  /** Present on `registry-invalid`: W040's own errors, verbatim. */
  readonly registryErrors?: readonly unknown[];
  /** Present on `invalid-skill`: the skills package's own errors, verbatim. */
  readonly skillErrors?: readonly unknown[];
  /** Present on `incompatible-possession`: W034's own incompatibilities, verbatim. */
  readonly incompatibilities?: readonly PossessionIncompatibility[];
}

export type ForgeOutcome =
  | { readonly ok: true; readonly plan: ForgedBodyPlan }
  | { readonly ok: false; readonly errors: readonly ForgeError[] };
