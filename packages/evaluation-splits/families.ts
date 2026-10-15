/**
 * The split FAMILY record (W052) — the declarative catalogue entry for one
 * evaluation split family, as typed DATA.
 *
 * The chain: W037 shipped the HoldoutSplitDescriptor + the split atoms
 * (period/regime/asset/venue) + the manifest gates; W038 evaluates
 * experiments over those splits; W050 ships point-in-time views (the sealed
 * cutoffs the no-leakage laws reference, R016); W051 ships search integrity
 * (the citation law — a family used in a search must be citable). THIS
 * module types the family: the content-addressed `fam-<digest>` id over the
 * declaration, the family policy (which of the four §13 holdout kinds:
 * walk-forward/regime/asset/venue — a closed set), the input range in W004's
 * own time vocabulary, the declared atom universe in W037's own atom
 * vocabulary, the explicit scope (W050's TimeMachineScope, carried
 * verbatim), the immutable lineage, and the deterministic provenance.
 *
 * Spec: spec/ARCHITECTURE.md §13 — the four holdout kinds are first-class.
 * Spec: spec/REQUIREMENTS.md R016 — no-leakage through sealed cutoffs (the
 * boundary laws live on the generated folds and are re-proven by
 * `./validate.ts`, naming R016 loudly).
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — determinism: the family id is the
 * canonical content digest over the CANONICAL declaration (declaration
 * order never matters); no clocks, no randomness, no env reads.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 — the package GENERATES typed split
 * descriptors as data; it never evaluates, never scores (carry never
 * re-score).
 * Spec: spec/DOMAIN-MODEL.md identity laws — ids are OPAQUE, the scope is
 * EXPLICIT, composite ids use canonical encoders.
 *
 * Fail-closed at construction (never silently repaired): blank scope
 * members, unknown family kinds, policy/universe kinds that disagree with
 * the family kind, a missing or malformed atom universe, malformed ranges
 * (the W004/W037 period law), non-positive window policies, ranges too
 * short to roll one evaluation window, lineage breaks. Generator refusals
 * are carried VERBATIM through the gate.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex, canonicalString } from "trajectory";
import { HOLDOUT_SPLIT_ATOM_KIND } from "experiments";
import type { HoldoutSplitDescriptor, SplitAtom } from "experiments";
import {
  blankTimeMachineScopeMembers,
  isLegalCutoff,
  KNOWLEDGE_FIREWALL_LAW,
} from "tradrl-time-machine";
import type { PointInTimeCutoff, TimeMachineScope } from "tradrl-time-machine";
import { SEARCH_HISTORY_INTEGRITY_LAW } from "search-integrity";
import type { HoldoutSideAssignment } from "evaluation";
import {
  canonicalPolicy,
  canonicalUniverse,
  generateAssetPartitions,
  generateRegimePartitions,
  generateVenuePartitions,
  generateWalkForward,
  isFiniteRange,
  isPositiveInteger,
} from "./generate.js";

// ---------------------------------------------------------------------------
// The family kind vocabulary (closed set — §13's four first-class kinds)
// ---------------------------------------------------------------------------

/**
 * The closed family kind set: §13's four first-class holdout kinds, carried
 * verbatim out of W037's own descriptor kind vocabulary
 * (`HoldoutSplitDescriptor["kind"]` — the W037/learning-objectives
 * `HoldoutKind` closed set minus "unseen-period", which W037 splits
 * directly over its period atoms).
 */
export type SplitFamilyKind = Extract<
  HoldoutSplitDescriptor["kind"],
  "walk-forward" | "regime" | "asset" | "venue"
>;

/** The canonical family kind order (closed-set checks + rendering order). */
export const SPLIT_FAMILY_KINDS: readonly SplitFamilyKind[] = [
  "walk-forward",
  "regime",
  "asset",
  "venue",
];

/** Type guard: is this value one of the closed family kinds? */
export function isSplitFamilyKind(value: unknown): value is SplitFamilyKind {
  return (
    typeof value === "string" &&
    SPLIT_FAMILY_KINDS.includes(value as SplitFamilyKind)
  );
}

/**
 * Which atom family each family kind splits over — DERIVED from W037's own
 * closed table (`HOLDOUT_SPLIT_ATOM_KIND`, carried verbatim: additions to
 * the atom vocabulary flow through W037, never through this package).
 */
export const SPLIT_FAMILY_ATOM_KIND: Readonly<Record<SplitFamilyKind, SplitAtom["kind"]>> = {
  "walk-forward": HOLDOUT_SPLIT_ATOM_KIND["walk-forward"],
  regime: HOLDOUT_SPLIT_ATOM_KIND.regime,
  asset: HOLDOUT_SPLIT_ATOM_KIND.asset,
  venue: HOLDOUT_SPLIT_ATOM_KIND.venue,
};

// ---------------------------------------------------------------------------
// The time + atom vocabulary (carried from W037's atoms — W004 underneath)
// ---------------------------------------------------------------------------

/** W037's own period atom, carried verbatim (W004's TimestampMs inside). */
export type SplitPeriodAtom = Extract<SplitAtom, { kind: "period" }>;

/** W004's timestamp vocabulary, extracted from W037's period atoms. */
export type SplitTimestampMs = SplitPeriodAtom["from"];

/** W037's instrument id vocabulary, extracted from W037's asset atoms. */
export type SplitInstrumentId = Extract<SplitAtom, { kind: "asset" }>["instrumentId"];

/** The family's input range — every boundary a W004 timestamp. */
export interface SplitFamilyRange {
  readonly from: SplitTimestampMs;
  readonly to: SplitTimestampMs;
}

/**
 * The declared atom universe (W037's atom vocabulary, one variant per family
 * kind): the input range itself for walk-forward (the period universe IS
 * the range — a law, not an accident), or the declared id list for the
 * id-based kinds.
 */
export type SplitAtomUniverse =
  | { readonly kind: "period"; readonly from: SplitTimestampMs; readonly to: SplitTimestampMs }
  | { readonly kind: "regime"; readonly regimeIds: readonly string[] }
  | { readonly kind: "asset"; readonly instrumentIds: readonly SplitInstrumentId[] }
  | { readonly kind: "venue"; readonly venueIds: readonly string[] };

// ---------------------------------------------------------------------------
// The family policy (the window policy + the partition rules)
// ---------------------------------------------------------------------------

/**
 * The walk-forward window policy: the axis every rolled fold's split
 * descriptor names (fold axis ids are `${axisId}-fold-<index>`, derived),
 * and the two window lengths. The roll stride IS the evaluation window
 * length — the canonical no-gap/no-overlap roll (evaluation windows tile
 * the range's evaluation span exactly).
 */
export interface WalkForwardWindowPolicy {
  readonly axisId: string;
  readonly trainWindowMs: number;
  readonly evaluationWindowMs: number;
}

/**
 * The deterministic partition rule over an id-based atom universe. Closed
 * set: `tail-holdout` (the LAST n atoms of the canonical order are held
 * out), `round-robin` (atoms whose canonical index % modulus === offset are
 * held out), and `explicit` (both sides declared by id — the gate proves
 * disjointness AND coverage, refusing loudly). No randomness anywhere.
 */
export type PartitionRule =
  | { readonly kind: "tail-holdout"; readonly evaluationCount: number }
  | { readonly kind: "round-robin"; readonly modulus: number; readonly offset: number }
  | {
      readonly kind: "explicit";
      readonly train: readonly string[];
      readonly evaluation: readonly string[];
    };

/**
 * The family policy: which of the four kinds this family generates, plus
 * that kind's own knobs. The policy's kind must equal the family's kind
 * (fail-closed — a policy never re-kinds its family).
 */
export type SplitFamilyPolicy =
  | (WalkForwardWindowPolicy & { readonly kind: "walk-forward" })
  | { readonly kind: "regime"; readonly axisId: string; readonly rule: PartitionRule }
  | { readonly kind: "asset"; readonly axisId: string; readonly rule: PartitionRule }
  | { readonly kind: "venue"; readonly axisId: string; readonly rule: PartitionRule };

// ---------------------------------------------------------------------------
// The walk-forward fold (the generated window — every boundary explicit)
// ---------------------------------------------------------------------------

/**
 * ONE rolled walk-forward fold: the fold's position, its derived axis id,
 * the train window and the evaluation window as W037 period atoms (every
 * boundary an explicit W004 timestamp; the train side STRICTLY precedes the
 * evaluation side — inclusive bounds, so `train.to < evaluation.from`), and
 * the fold's sealed knowledge boundary: a W050 `PointInTimeCutoff` equal to
 * the train side's end. Everything the train side may know is at or below
 * the cutoff; every evaluation-side instant is after it — the R016
 * no-leakage seam, proven per fold and re-proven by `./validate.ts`.
 */
export interface WalkForwardFold {
  readonly foldIndex: number;
  readonly axisId: string;
  readonly train: SplitPeriodAtom;
  readonly evaluation: SplitPeriodAtom;
  readonly cutoff: PointInTimeCutoff;
}

// ---------------------------------------------------------------------------
// The lineage, the provenance, the citation (identity + seam surfaces)
// ---------------------------------------------------------------------------

declare const splitFamilyIdBrand: unique symbol;

/**
 * An OPAQUE split family id (a canonical digest rendering). Produced only
 * by {@link splitFamilyIdOf}; never parsed — the scope, kind, range,
 * universe and policy are carried on the record, never recovered by
 * splitting the id.
 */
export type SplitFamilyId = string & {
  readonly [splitFamilyIdBrand]: true;
};

/** The id prefix (a rendering convention, never a parse target). */
export const SPLIT_FAMILY_ID_PREFIX = "fam-";

/**
 * The immutable lineage (the W037/W051 branch-lineage pattern): a family
 * never branches on its own — a CONTINUATION declares its parent, and the
 * chain's root + ordinal are carried verbatim. The lineage rides BESIDE the
 * id (the id addresses the declaration), so a root's lineage can cite its
 * own id without circularity.
 */
export interface SplitFamilyLineage {
  readonly parent: SplitFamilyId | undefined;
  readonly root: SplitFamilyId;
  readonly ordinal: number;
}

/** The declared lineage at construction (a root family omits it entirely). */
export interface SplitFamilyLineageInput {
  readonly parent?: SplitFamilyId;
  readonly root?: SplitFamilyId;
  readonly ordinal?: number;
}

/** The generator that produced the family (one per kind, closed set). */
export type SplitFamilyGeneratorName =
  | "generate-walk-forward"
  | "generate-regime-partitions"
  | "generate-asset-partitions"
  | "generate-venue-partitions";

/** The generator name for each family kind (the closed dispatch table). */
export const SPLIT_FAMILY_GENERATOR_NAMES: Readonly<Record<SplitFamilyKind, SplitFamilyGeneratorName>> =
  {
    "walk-forward": "generate-walk-forward",
    regime: "generate-regime-partitions",
    asset: "generate-asset-partitions",
    venue: "generate-venue-partitions",
  };

/** The A9 deterministic-replay law, named. */
export const SPLIT_FAMILY_DETERMINISM_LAW = "spec/ARCHITECTURE-LOCK.md A9" as const;

/** The A14 composition law, named. */
export const SPLIT_FAMILY_COMPOSITION_LAW = "spec/ARCHITECTURE-LOCK.md A14" as const;

/**
 * The canonical family law list — the laws every family's provenance
 * carries: §13 (the four first-class holdout kinds, through W051's own
 * constant), R016 (the point-in-time firewall, through W050's own
 * constant), A9 and A14.
 */
export const SPLIT_FAMILY_PROVENANCE_LAWS: readonly string[] = [
  SEARCH_HISTORY_INTEGRITY_LAW,
  KNOWLEDGE_FIREWALL_LAW,
  SPLIT_FAMILY_DETERMINISM_LAW,
  SPLIT_FAMILY_COMPOSITION_LAW,
];

/** The deterministic provenance record (carried as data, re-derivable). */
export interface SplitFamilyProvenance {
  readonly generator: SplitFamilyGeneratorName;
  readonly inputDigest: string;
  readonly laws: readonly string[];
}

/**
 * The citation seam with W051's search-history integrity law: a family used
 * in a search is CITABLE — as data, under §13 — through its opaque
 * content-addressed id and its kind. The citation is produced by
 * {@link splitFamilyCitationOf} and re-derivable by `./validate.ts`.
 */
export interface SplitFamilyCitation {
  readonly familyId: SplitFamilyId;
  readonly kind: SplitFamilyKind;
  readonly law: typeof SEARCH_HISTORY_INTEGRITY_LAW;
}

// ---------------------------------------------------------------------------
// The record + the typed error family (every law named)
// ---------------------------------------------------------------------------

/**
 * ONE split family: the opaque content-addressed id, the kind, the explicit
 * scope, the input range, the canonical atom universe, the canonical
 * policy, the generated folds (walk-forward only; empty for the partition
 * kinds), the generated splits in W037's own HoldoutSplitDescriptor shapes,
 * the immutable lineage, and the deterministic provenance. Typed DATA —
 * never evaluated, never scored.
 */
export interface SplitFamily {
  readonly familyId: SplitFamilyId;
  readonly kind: SplitFamilyKind;
  readonly scope: TimeMachineScope;
  readonly range: SplitFamilyRange;
  readonly universe: SplitAtomUniverse;
  readonly policy: SplitFamilyPolicy;
  readonly folds: readonly WalkForwardFold[];
  readonly splits: readonly HoldoutSplitDescriptor[];
  readonly lineage: SplitFamilyLineage;
  readonly provenance: SplitFamilyProvenance;
}

/** Everything that can be wrong with a family declaration or record. */
export type SplitFamilyErrorCode =
  | "blank-scope-member" // the identity scope is not explicit (W050 carried)
  | "unknown-family-kind" // §13's four kinds are the closed set
  | "policy-kind-mismatch" // the policy never re-kinds its family
  | "universe-kind-mismatch" // the universe's atom family disagrees with the kind
  | "missing-universe" // an id-based kind without a declared universe
  | "walk-forward-universe-mismatch" // the period universe IS the input range
  | "invalid-range" // malformed ranges (the W004/W037 period law)
  | "invalid-window-policy" // windows are positive integer milliseconds
  | "range-too-short" // no evaluation instant after the first train window
  | "invalid-partition-rule" // a rule outside its own laws
  | "blank-family-axis" // every family names its axis
  | "blank-split-axis" // W037 carried: a split declares a blank axis id
  | "blank-atom" // atom ids are explicit
  | "empty-universe" // a partition family splits at least two atoms
  | "duplicate-atom" // one atom, once — never silently deduplicated
  | "atom-outside-universe" // splits never invent atoms
  | "uncovered-atom" // the partition covers its whole universe
  | "invalid-period-atom" // W037 carried: non-finite instants or from > to
  | "empty-split-side" // W037 carried: a side with no atoms is not a split
  | "duplicate-split-atom" // W037 carried: one atom, one side, once
  | "overlapping-split-sides" // W037 carried: a held-out atom never trains
  | "split-kind-mismatch" // W037 carried: the split never re-kinds its axis
  | "split-atom-kind-mismatch" // W037 carried: only the kind's atoms belong
  | "universe-not-canonical" // the record carries canonical orders (A9)
  | "no-leakage" // R016: the evaluation side could see its train side's future
  | "fold-cutoff-mismatch" // the fold's sealed cutoff is the train side's end
  | "window-outside-range" // windows never reach outside the input range
  | "window-sequence" // covering + disjoint tiling of the evaluation span
  | "lineage-break" // the immutable lineage is incoherent
  | "provenance-mismatch" // the provenance does not re-derive
  | "family-id-mismatch" // the id does not re-derive from the declaration
  | "generation-mismatch"; // the folds/splits do not re-derive (A9)

/** One typed family error (fail-closed; the law named in the message). */
export interface SplitFamilyError {
  readonly code: SplitFamilyErrorCode;
  readonly message: string;
  /** The offending axis/atom/fold id, when the error belongs to one entry. */
  readonly entryId?: string;
}

// ---------------------------------------------------------------------------
// The family id (opaque, content-addressed — A9)
// ---------------------------------------------------------------------------

/**
 * The declaration digest: the canonical content digest over the scope, the
 * kind, the range, the CANONICAL universe and the CANONICAL policy — so
 * declaration order never matters (the same declared family always yields
 * the same digest, and any byte of declared content flips it).
 */
export function splitFamilyDeclarationDigest(
  scope: TimeMachineScope,
  kind: SplitFamilyKind,
  range: SplitFamilyRange,
  universe: SplitAtomUniverse,
  policy: SplitFamilyPolicy,
): string {
  return canonicalDigestHex({
    kind,
    policy: canonicalPolicy(policy),
    range: { from: range.from, to: range.to },
    scope: {
      projectId: scope.projectId,
      tenantId: scope.tenantId,
      worldId: scope.worldId,
    },
    universe: canonicalUniverse(universe),
  });
}

/**
 * The family id: `fam-<digest>` over the canonical declaration. Pure and
 * deterministic (A9): the same declaration always yields the same id; the
 * lineage rides beside it, never inside it.
 */
export function splitFamilyIdOf(
  scope: TimeMachineScope,
  kind: SplitFamilyKind,
  range: SplitFamilyRange,
  universe: SplitAtomUniverse,
  policy: SplitFamilyPolicy,
): SplitFamilyId {
  const digest = splitFamilyDeclarationDigest(scope, kind, range, universe, policy);
  return `${SPLIT_FAMILY_ID_PREFIX}${digest}` as SplitFamilyId;
}

// ---------------------------------------------------------------------------
// The construction gate
// ---------------------------------------------------------------------------

/** The family declaration (the input, before generation). */
export interface SplitFamilyInput {
  readonly scope: TimeMachineScope;
  readonly kind: SplitFamilyKind;
  readonly range: SplitFamilyRange;
  /** Required for regime/asset/venue; derived from the range for walk-forward. */
  readonly universe?: SplitAtomUniverse;
  readonly policy: SplitFamilyPolicy;
  readonly lineage?: SplitFamilyLineageInput;
}

/** The construction outcome: the lawful family, or every law violated. */
export type SplitFamilyOutcome =
  | { readonly ok: true; readonly family: SplitFamily }
  | { readonly ok: false; readonly errors: readonly SplitFamilyError[] };

/** Resolve the declared lineage against the family's own id (fail-closed). */
function resolveLineage(
  input: SplitFamilyLineageInput | undefined,
  familyId: SplitFamilyId,
): { readonly ok: true; readonly lineage: SplitFamilyLineage } | { readonly ok: false; readonly errors: readonly SplitFamilyError[] } {
  const parent = input?.parent;
  if (parent === undefined) {
    const declaredRoot = input?.root;
    if (declaredRoot !== undefined && declaredRoot !== familyId) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root family's lineage must cite its own id ('${familyId}') — it declares '${declaredRoot}' (the immutable lineage law)` }] };
    }
    const ordinal = input?.ordinal ?? 0;
    if (ordinal !== 0) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root family's lineage ordinal is 0 — it declares ${String(ordinal)} (the immutable lineage law)` }] };
    }
    return { ok: true, lineage: { parent: undefined, root: familyId, ordinal: 0 } };
  }
  if (String(parent).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: "the family declares a blank parent id — the lineage is explicit, never defaulted" }] };
  }
  const root = input?.root;
  if (root === undefined || String(root).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: `the continuation of '${parent}' declares no chain root — a continuation carries the chain's root verbatim (the immutable lineage law)` }] };
  }
  const ordinal = input?.ordinal;
  if (typeof ordinal !== "number" || !Number.isInteger(ordinal) || ordinal < 1) {
    return { ok: false, errors: [{ code: "lineage-break", message: `a continuation's lineage ordinal is a positive integer — it declares ${String(ordinal)} (the immutable lineage law)` }] };
  }
  return { ok: true, lineage: { parent, root, ordinal } };
}

/**
 * Build one split family — THE CONSTRUCTION GATE. Every declaration law is
 * checked and every violation collected (the W004 `validateEventStream`
 * pattern — the declarer sees all problems, never just the first); the
 * generators' own refusals are carried VERBATIM. On success the record
 * carries the CANONICAL universe and policy (declaration order never leaks,
 * A9), the generated folds/splits, the resolved lineage, and the
 * deterministic provenance.
 */
export function buildSplitFamily(input: SplitFamilyInput): SplitFamilyOutcome {
  const errors: SplitFamilyError[] = [];
  if (input === null || typeof input !== "object") {
    return { ok: false, errors: [{ code: "unknown-family-kind", message: `the family declaration is not an object — the closed ${SEARCH_HISTORY_INTEGRITY_LAW} kind set (${SPLIT_FAMILY_KINDS.join(", ")}) is required` }] };
  }
  if (!isSplitFamilyKind(input.kind)) {
    return { ok: false, errors: [{ code: "unknown-family-kind", message: `unknown split family kind '${String(input.kind)}' (the closed ${SEARCH_HISTORY_INTEGRITY_LAW} set: ${SPLIT_FAMILY_KINDS.join(", ")}) — the four holdout kinds are first-class` }] };
  }
  const kind = input.kind;

  if (input.scope === null || typeof input.scope !== "object") {
    errors.push({ code: "blank-scope-member", message: "the family scope is not an object — tenantId, projectId, worldId are required (the scope is explicit)" });
  } else {
    for (const member of blankTimeMachineScopeMembers(input.scope)) {
      errors.push({ code: "blank-scope-member", message: `the family scope member '${String(member)}' is blank — the scope is explicit (W050 carried)` });
    }
  }

  const rangeValid = isFiniteRange(input.range);
  if (!rangeValid) {
    errors.push({ code: "invalid-range", message: `the input range ${String(input.range?.from)} → ${String(input.range?.to)} is invalid — instants are finite and ordered (the W004/W037 period law)` });
  } else if (
    kind === "walk-forward" &&
    (!isLegalCutoff(Number(input.range.from)) || !isLegalCutoff(Number(input.range.to)))
  ) {
    errors.push({ code: "invalid-range", message: "the walk-forward range instants must be finite non-negative integers — every fold boundary becomes a sealed W050 cutoff (R016)" });
  }

  if (kind === "walk-forward") {
    if (input.universe !== undefined) {
      if (input.universe === null || typeof input.universe !== "object" || input.universe.kind !== "period") {
        errors.push({ code: "universe-kind-mismatch", message: `the walk-forward family declares a '${String(input.universe?.kind)}' atom universe — only the period universe belongs (the universe carries W037's atom vocabulary)` });
      } else if (
        rangeValid &&
        (input.universe.from !== input.range.from || input.universe.to !== input.range.to)
      ) {
        errors.push({ code: "walk-forward-universe-mismatch", message: `the walk-forward period universe (${String(input.universe.from)} → ${String(input.universe.to)}) is not the input range (${String(input.range.from)} → ${String(input.range.to)}) — the period universe IS the range, never a second declaration` });
      }
    }
  } else if (input.universe === undefined || input.universe === null || typeof input.universe !== "object") {
    errors.push({ code: "missing-universe", message: `the '${kind}' family declares no atom universe — an id-based partition family declares its universe (W037's atom vocabulary)` });
  } else if (input.universe.kind !== kind) {
    errors.push({ code: "universe-kind-mismatch", message: `the '${kind}' family declares a '${String(input.universe.kind)}' atom universe — the universe's atom family must match the family kind (W037's closed table)` });
  }

  if (input.policy === null || typeof input.policy !== "object" || input.policy.kind !== kind) {
    errors.push({ code: "policy-kind-mismatch", message: `the family policy declares kind '${String(input.policy?.kind)}' but the family is '${kind}' — a policy never re-kinds its family` });
  } else if (typeof input.policy.axisId !== "string" || input.policy.axisId.trim().length === 0) {
    errors.push({ code: "blank-family-axis", message: "the family policy declares a blank axis id — every split family names its axis" });
  } else if (
    kind === "walk-forward" &&
    (!isPositiveInteger((input.policy as WalkForwardWindowPolicy).trainWindowMs) ||
      !isPositiveInteger((input.policy as WalkForwardWindowPolicy).evaluationWindowMs))
  ) {
    const windowPolicy = input.policy as WalkForwardWindowPolicy;
    errors.push({ code: "invalid-window-policy", message: `the walk-forward window policy declares train/evaluation windows that are not positive integer milliseconds (train ${String(windowPolicy.trainWindowMs)}, evaluation ${String(windowPolicy.evaluationWindowMs)}) — every window is an explicit W004 time span` });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const policy = input.policy as SplitFamilyPolicy;
  const resolvedUniverse: SplitAtomUniverse =
    kind === "walk-forward"
      ? input.universe ?? {
          kind: "period",
          from: input.range.from,
          to: input.range.to,
        }
      : canonicalUniverse(input.universe as SplitAtomUniverse);

  let folds: readonly WalkForwardFold[] = [];
  let splits: readonly HoldoutSplitDescriptor[] = [];
  if (kind === "walk-forward") {
    const generation = generateWalkForward(
      input.range,
      policy as WalkForwardWindowPolicy,
    );
    if (!generation.ok) {
      return { ok: false, errors: generation.errors };
    }
    folds = generation.generation.folds;
    splits = generation.generation.splits;
  } else {
    const partitionPolicy = policy as Extract<SplitFamilyPolicy, { kind: "regime" | "asset" | "venue" }>;
    const outcome =
      kind === "regime"
        ? generateRegimePartitions(
            (resolvedUniverse as Extract<SplitAtomUniverse, { kind: "regime" }>).regimeIds,
            partitionPolicy.rule,
            partitionPolicy.axisId,
          )
        : kind === "asset"
          ? generateAssetPartitions(
              (resolvedUniverse as Extract<SplitAtomUniverse, { kind: "asset" }>).instrumentIds,
              partitionPolicy.rule,
              partitionPolicy.axisId,
            )
          : generateVenuePartitions(
              (resolvedUniverse as Extract<SplitAtomUniverse, { kind: "venue" }>).venueIds,
              partitionPolicy.rule,
              partitionPolicy.axisId,
            );
    if (!outcome.ok) {
      return { ok: false, errors: outcome.errors };
    }
    splits = [outcome.split];
  }

  const canonicalForm = canonicalPolicy(policy);
  const familyId = splitFamilyIdOf(input.scope, kind, input.range, resolvedUniverse, canonicalForm);
  const lineage = resolveLineage(input.lineage, familyId);
  if (!lineage.ok) {
    return { ok: false, errors: lineage.errors };
  }
  const provenance: SplitFamilyProvenance = {
    generator: SPLIT_FAMILY_GENERATOR_NAMES[kind],
    inputDigest: splitFamilyDeclarationDigest(input.scope, kind, input.range, resolvedUniverse, canonicalForm),
    laws: SPLIT_FAMILY_PROVENANCE_LAWS,
  };
  const family: SplitFamily = Object.freeze({
    familyId,
    kind,
    scope: input.scope,
    range: { from: input.range.from, to: input.range.to },
    universe: resolvedUniverse,
    policy: canonicalForm,
    folds,
    splits,
    lineage: lineage.lineage,
    provenance,
  });
  return { ok: true, family };
}

// ---------------------------------------------------------------------------
// The per-side vocabulary + the citation seam
// ---------------------------------------------------------------------------

/**
 * Which side of ONE split an atom is declared on, by canonical rendering —
 * W038's own side assignment vocabulary, carried verbatim. An atom on both
 * sides of a malformed split is "unassigned" (surfaced, not resolved — the
 * W038 discipline); record-level membership derivation over trajectory data
 * stays W038's own (`evaluation`'s `holdoutMembershipOf`).
 */
export function atomSideOf(
  split: HoldoutSplitDescriptor,
  atom: SplitAtom,
): HoldoutSideAssignment {
  const rendering = canonicalString(atom);
  const onTrain = split.train.some((declared) => canonicalString(declared) === rendering);
  const onEvaluation = split.evaluation.some(
    (declared) => canonicalString(declared) === rendering,
  );
  if (onTrain && onEvaluation) {
    return "unassigned";
  }
  if (onTrain) {
    return "train";
  }
  if (onEvaluation) {
    return "evaluation";
  }
  return "unassigned";
}

/**
 * The citation for a family used in a search (the W051 integrity seam): the
 * opaque family id + the kind, citable under §13 (W051's own law constant).
 * A citation is data — it never re-opens or re-derives the family (A14:
 * carry never re-score).
 */
export function splitFamilyCitationOf(family: SplitFamily): SplitFamilyCitation {
  return Object.freeze({
    familyId: family.familyId,
    kind: family.kind,
    law: SEARCH_HISTORY_INTEGRITY_LAW,
  });
}
