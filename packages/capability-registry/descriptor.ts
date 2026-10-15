/**
 * Capability descriptor contracts (W040) — the typed DATA a registered
 * capability IS, plus the registry's closed vocabularies and its typed
 * error family.
 *
 * Spec: spec/REQUIREMENTS.md R052 — "Capability discovery is EMPIRICAL":
 * every capability carries PROVENANCE — evidence-linked citations of the
 * measured W037 experiments and W038 evaluations/findings that empirically
 * established it (canonical ids only; the artifacts live in those
 * packages, never re-run here).
 *
 * Spec: spec/DOMAIN-MODEL.md "Capability" (future-intelligence entity,
 * under the identity laws): opaque ids, canonical encoders, explicit
 * scope, immutable lineage.
 *
 * This module is types + closed sets + the error family (the
 * contracts-family law): the registration gate lives in ./register.ts,
 * re-validation in ./validate.ts, lifecycle in ./lifecycle.ts, queries in
 * ./query.ts, identity in ./identity.ts. No execution, no runtime, no
 * model calls.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { ExperimentId } from "experiments";
import type { ExperimentEvaluationId } from "evaluation";
import type { SubstrateId } from "cognitive-substrate";
import type { OrganizationCapabilityId } from "organization";
import type { CapabilityId, CapabilityScope } from "./identity.js";

// ---------------------------------------------------------------------------
// The closed vocabularies (validated at every seam; runtime re-proved —
// the W037/W038 post-parse malformed-member precedent)
// ---------------------------------------------------------------------------

/**
 * What the capability was MEASURED to do. Closed: the registry answers in
 * this vocabulary only — a kind outside the table is a typed error, never
 * a silent stringly entry.
 */
export const CAPABILITY_KINDS = [
  "execution-quality",
  "alpha-generation",
  "risk-control",
  "market-making",
  "information-synthesis",
] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];

/**
 * The market domain the measurement ran in. Closed — cross-domain
 * extrapolation of a measured capability is NOT a registry operation
 * (that would be a label, not a measurement).
 */
export const CAPABILITY_DOMAINS = [
  "equities",
  "futures",
  "fx",
  "crypto-spot",
] as const;
export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];

/** WHO demonstrated the capability: a W033 substrate or a body class. */
export const CAPABILITY_BEARER_KINDS = ["substrate", "body"] as const;
export type CapabilityBearerKind = (typeof CAPABILITY_BEARER_KINDS)[number];

/**
 * The bearer dimension: which substrate demonstrated it (the W033
 * `SubstrateId` — the mind that produced the measured behavior) or which
 * body class did (an opaque body id; the W039 leaf-cast precedent keeps
 * the body package out of this dependency surface).
 */
export type CapabilityBearer =
  | { readonly kind: "substrate"; readonly substrateId: SubstrateId }
  | { readonly kind: "body"; readonly bodyId: string };

// ---------------------------------------------------------------------------
// The descriptor
// ---------------------------------------------------------------------------

/**
 * The versioned immutable lineage of a capability: genesis capabilities
 * have no parent and version 1; every re-measured successor cites its
 * parent and is exactly parent.version + 1 (a gap or a skip is a typed
 * lineage break, never silently accepted). Immutable means derivation
 * never edits a lineage in place — a successor is a NEW registry entry.
 */
export interface CapabilityLineage {
  readonly parentCapabilityId: CapabilityId | null;
  readonly version: number;
}

/**
 * One evidence-linked citation of the MEASURED artifacts that empirically
 * established the capability (A6): the W037 canonical experiment id, the
 * W038 canonical experiment-evaluation id, and the W038 findings report's
 * content digest. Canonical ids only — never a re-run, never a payload.
 */
export interface EvidenceCitation {
  readonly experimentId: ExperimentId;
  readonly evaluationId: ExperimentEvaluationId;
  readonly findingsDigest: string;
}

/**
 * A capability as the registry records it: identity, the closed
 * kind/domain vocabulary, the bearer that demonstrated it, the explicit
 * scope, the W039 organization capabilities it provides (the compiler's
 * `providesCapabilities` vocabulary — same shape, so that registry input
 * builds directly from this one), the lineage, and the measured
 * provenance. DATA only: laws live in ./register.ts and ./validate.ts.
 */
export interface CapabilityDescriptor {
  readonly capabilityId: CapabilityId;
  /** Non-blank human-facing name (data, never a prompt). */
  readonly name: string;
  readonly description?: string;
  readonly kind: CapabilityKind;
  readonly domain: CapabilityDomain;
  readonly bearer: CapabilityBearer;
  readonly scope: CapabilityScope;
  readonly providesOrganizationCapabilityIds: readonly OrganizationCapabilityId[];
  readonly lineage: CapabilityLineage;
  readonly provenance: readonly EvidenceCitation[];
}

// ---------------------------------------------------------------------------
// Lifecycle (typed data, immutable transitions)
// ---------------------------------------------------------------------------

/** The lifecycle states of a registered capability. */
export const CAPABILITY_STATES = ["registered", "deprecated", "revoked"] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

/**
 * One recorded lifecycle transition. Transitions only ever move AWAY from
 * "registered" (to deprecated or revoked); `reason` is rationale-as-data
 * (the §10 discipline — non-blank; a declared basis, never a clock read:
 * A9 has no time).
 */
export interface LifecycleTransition {
  readonly to: Exclude<CapabilityState, "registered">;
  readonly reason: string;
}

/** One registry entry: the descriptor + its current state + its transition record. */
export interface RegistryEntry {
  readonly descriptor: CapabilityDescriptor;
  readonly state: CapabilityState;
  readonly transitions: readonly LifecycleTransition[];
}

/**
 * The capability registry: a declared single scope (every entry must agree
 * with it — the W039 component-registry law) and the entries in CANONICAL
 * capability-id order (A9: registration order never leaks into the
 * registry value). An immutable value: every operation returns a NEW
 * registry, never a mutation.
 */
export interface CapabilityRegistry {
  readonly scope: CapabilityScope;
  readonly entries: readonly RegistryEntry[];
}

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

export type CapabilityErrorCode =
  | "blank-capability-name"
  | "blank-scope-member" // tenant/project/world scope is explicit, never blank
  | "unknown-capability-kind" // the closed vocabulary, loudly enforced
  | "unknown-capability-domain"
  | "unknown-capability-state"
  | "unknown-bearer-kind"
  | "blank-bearer-id"
  | "blank-provides-member"
  | "duplicate-provides" // the W039 duplicate-offering law
  | "invalid-lineage-version"
  | "lineage-break" // missing parent, skipped version, or wrong root shape
  | "unmeasured-capability" // R052 — THE law of this package
  | "blank-citation-member"
  | "scope-mismatch" // a citation's experiment scope disagrees
  | "citation-experiment-mismatch" // experimentIdOf ≠ the evaluation's binding
  | "citation-findings-mismatch" // the findings' subject ≠ the evaluation id
  | "citation-digest-mismatch" // findingsDigestOf re-derivation disagrees
  | "citation-count-mismatch" // the findings' counts disagree with its findings
  | "failed-evidence" // the cited measurement FAILED — not evidence of capability
  | "unmeasured-evidence" // nothing PASSED — no positive measurement
  | "registry-scope-mismatch" // the capability's scope ≠ the registry's
  | "duplicate-capability"
  | "unknown-capability" // by-id resolution misses
  | "blank-reason"
  | "invalid-lifecycle-transition"
  | "non-canonical-order"; // the registry value's A9 ordering law

/** One typed registry error (fail-closed; the law named in the message). */
export interface CapabilityError {
  readonly code: CapabilityErrorCode;
  readonly message: string;
  /** The offending capability/experiment id, when the error belongs to one entry. */
  readonly entryId?: string;
}
