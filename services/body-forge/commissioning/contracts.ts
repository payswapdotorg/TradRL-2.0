/**
 * The commissioning contracts (W043) — the CommissionedBody record, the
 * typed DATA that brings an autonomous Body INTO EXISTENCE as an
 * attachable agent, and the closed typed error family. DATA only: the
 * commissioning gate lives in ./commission.ts, the whole-record
 * re-validation in ./validate.ts.
 *
 * The chain this module sits in (ARCHITECTURE.md §12 — "Agent = Body
 * possessed by Cognitive Substrate. Organization discovers capabilities
 * and composes Bodies."): W039 organizations declare positions and
 * compile binding plans, W042 selects the substrate EMPIRICALLY, W041's
 * forge forges the typed ForgedBodyPlan (the plan, never the act) — and
 * THIS module is the record of the ACT: the sealed activation record
 * composed from a ForgedBodyPlan + a SelectionPlan: the attached body
 * (W032 lifecycle, declared — not yet world-bound), the selected-
 * substrate binding (R050: the commissioning RECORDS the selection,
 * never assumes a substrate), the sealed endowment (the plan's skills +
 * their evidence citations, carried — never re-scored), the possession
 * lineage EXTENDED to the commissioned generation (W034's
 * extendPossessionLineage — the anchor is immutable, the chain only
 * grows), and the deterministic content-addressed commissioned id.
 *
 * A14 boundaries: commissioning COMPOSES the activation record — it
 * never executes, never trades, never runs a world. W044's
 * world-agent-runtime binds commissioned bodies to Worlds; this record
 * is the last pure step before runtime.
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
import type { OpaqueId } from "skills";
import type { ForgedPlanId, SkillEndowmentManifest } from "../contracts.js";
import type { SelectionId } from "../../model-selection/index.js";

/** The identity of one commissioned body (opaque; digest-derived). */
export type CommissionedId = OpaqueId<"CommissionedId">;

/** The commissioned id prefix (the W016 family convention). */
export const COMMISSIONED_ID_PREFIX = "commission-";

/**
 * The selected-substrate binding (R050 — "Agent Body distinct from model
 * substrate"): WHICH substrate the commissioning binds the body to,
 * justified by WHICH selection. The selection is RECORDED here — the
 * substrate is never assumed, never re-chosen (carry, never re-score).
 */
export interface SubstrateBinding {
  readonly selectionId: SelectionId;
  readonly selectedSubstrateId: string;
  readonly selectedDisplayName: string;
  /** The selected evidence chain's covering capability ids (carried). */
  readonly selectedCapabilities: readonly string[];
  /** The selection's honest carried-citation count (carried, never re-scored). */
  readonly totalCarriedCitations: number;
}

/**
 * The commissioned possession: the W034 declaration data the record
 * commits to, the lineage anchor (the body's IMMUTABLE identity anchor
 * the plan carried — the commissioned generation EXTENDS from it, never
 * rewrites it), the commissioned head (the content address of the
 * history INCLUDING the commissioned generation), the extended lineage
 * itself, and the world-less compatibility evidence W034 re-proved at
 * commissioning time.
 */
export interface CommissionedPossession {
  readonly possessionId: PossessionId;
  readonly grant: PossessionGrant;
  readonly scope: PossessionScope;
  readonly possessionDigest: string;
  readonly lineageAnchor: string;
  readonly commissionedHead: string;
  readonly lineage: PossessionLineage;
  readonly compatibility: { readonly checked: readonly PossessionCheckKind[] };
}

/**
 * The commissioning provenance — WHICH commissioning run sealed this
 * record: the forged plan it sealed, the selection that justified the
 * substrate, the registry fingerprint it committed to (the exact W040
 * registry content, re-used from the skills package's own seam), and the
 * declared commissioning time (the grant's grantedAt — declared DATA,
 * never a clock read; A9).
 */
export interface CommissioningProvenance {
  readonly planId: ForgedPlanId;
  readonly selectionId: SelectionId;
  readonly registryFingerprint: string;
  readonly commissionedAt: number;
}

/**
 * The CommissionedBody — the sealed activation record, as DATA: the
 * composed W032 body + its (still unattached) attachment, the substrate
 * the body is possessed by, the selected-substrate binding, the sealed
 * endowment manifest (VERBATIM the plan's — commissioning never invents
 * a skill), the commissioned possession, the explicit scope, the
 * commissioning provenance, and the content-addressed commissioned id.
 * W044's world-agent-runtime consumes this; commissioning never executes
 * it.
 */
export interface CommissionedBody {
  readonly commissionedId: CommissionedId;
  readonly body: BodyDescriptor;
  readonly attachment: BodyAttachment;
  readonly substrate: CognitiveSubstrateDescriptor;
  readonly substrateBinding: SubstrateBinding;
  readonly endowment: SkillEndowmentManifest;
  readonly possession: CommissionedPossession;
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly worldId: string };
  readonly provenance: CommissioningProvenance;
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type CommissionErrorCode =
  | "invalid-plan" // the forged plan's own re-proof failed (W032/W034 carried verbatim)
  | "invalid-registry" // the W040 gate refused the registry (carried verbatim)
  | "registry-scope-mismatch" // the registry's scope ≠ the plan body's scope
  | "invalid-selection" // the W042 selection's recorded-data laws (details carried)
  | "selection-scope-mismatch" // the selection's scope ≠ the plan body's scope
  | "substrate-mismatch" // the selected substrate ≠ the plan's substrate reference
  | "endowment-mismatch" // the endowment is not the selection chain's (plan/selection coherence)
  | "unregistered-capability" // the endowment's capability is not in the registry
  | "deprecated-capability" // the W040 lifecycle, carried loudly
  | "revoked-capability" // terminal, carried loudly
  | "incompatible-possession" // W034 incompatibilities carried verbatim
  | "lineage-extension-refused"; // W034's own refusal code + message, carried verbatim

/** One typed commissioning error (fail-closed; upstream errors carried verbatim). */
export interface CommissionError {
  readonly code: CommissionErrorCode;
  readonly message: string;
  readonly planId?: string;
  readonly selectionId?: string;
  readonly skillId?: string;
  readonly capabilityId?: string;
  readonly substrateId?: string;
  /** Present on `invalid-plan`: W032's own body errors, verbatim. */
  readonly bodyErrors?: readonly unknown[];
  /** Present on `invalid-plan`: the re-proof law violations, each named. */
  readonly planErrors?: readonly string[];
  /** Present on `invalid-registry`: W040's own errors, verbatim. */
  readonly registryErrors?: readonly unknown[];
  /** Present on `invalid-selection`: the W042 recorded-data law violations, each named. */
  readonly selectionErrors?: readonly string[];
  /** Present on deprecated/revoked: the W040 lifecycle transitions, carried VERBATIM. */
  readonly lifecycle?: readonly { readonly to: string; readonly reason: string }[];
  /** Present on `incompatible-possession`: W034's own incompatibilities, verbatim. */
  readonly incompatibilities?: readonly PossessionIncompatibility[];
  /** Present on `lineage-extension-refused`: W034's own refusal, verbatim. */
  readonly lineageRefusal?: { readonly code: string; readonly message: string };
}

export type CommissionOutcome =
  | { readonly ok: true; readonly body: CommissionedBody }
  | { readonly ok: false; readonly errors: readonly CommissionError[] };
