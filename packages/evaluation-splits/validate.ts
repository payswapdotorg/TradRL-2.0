/**
 * Whole-family re-validation (W052) — the family record re-proven from its own
 * carried data: the identity re-derivations (fam-<digest>, provenance, lineage),
 * the closed-set + shape laws, the A9 re-generation proof, the disjointness/
 * coverage proofs, and THE NO-LEAKAGE LAW re-proven record-by-record naming
 * R016. The W037 split-shape laws are re-proven with its own error codes,
 * carried verbatim. A14: composes and re-proves typed data — never evaluates,
 * never scores. A9: no clocks, no randomness, no env reads.
 * License: Apache-2.0 (the repository LICENSE).
 */
import { blankTimeMachineScopeMembers, isLegalCutoff, KNOWLEDGE_FIREWALL_LAW } from "tradrl-time-machine";
import { canonicalString } from "trajectory";
import type { HoldoutSplitDescriptor, SplitAtom } from "experiments";
import {
  compareCodeUnits,
  generateAssetPartitions,
  generateRegimePartitions,
  generateVenuePartitions,
  generateWalkForward,
  isFiniteRange,
  isPositiveInteger,
  splitAtomUniverseIds,
} from "./generate.js";
import {
  SPLIT_FAMILY_ATOM_KIND,
  SPLIT_FAMILY_GENERATOR_NAMES,
  SPLIT_FAMILY_KINDS,
  SPLIT_FAMILY_PROVENANCE_LAWS,
  isSplitFamilyKind,
  splitFamilyDeclarationDigest,
  splitFamilyIdOf,
} from "./families.js";
import type {
  SplitAtomUniverse,
  SplitFamily,
  SplitFamilyError,
  SplitFamilyPolicy,
  SplitFamilyRange,
  SplitInstrumentId,
  WalkForwardWindowPolicy,
} from "./families.js";
/** The validation outcome: the lawful record, or every law violated. */
export type SplitFamilyValidation =
  | { readonly ok: true; readonly family: SplitFamily }
  | { readonly ok: false; readonly errors: readonly SplitFamilyError[] };
/** Deep equality through the canonical renderer (order + content exact). */
function sameByCanonical(left: unknown, right: unknown): boolean {
  return canonicalString(left) === canonicalString(right);
}
/** Are the carried universe ids in canonical order, blank-free, duplicate-free? */
function universeIdErrors(universe: SplitAtomUniverse): readonly SplitFamilyError[] {
  const errors: SplitFamilyError[] = [];
  const ids = splitAtomUniverseIds(universe);
  if (ids.length === 0) {
    return [
      {
        code: "empty-universe",
        message: "the carried atom universe is empty — a partition family splits at least two atoms (W037's atom vocabulary)",
      },
    ];
  }
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || id.trim().length === 0) {
      errors.push({ code: "blank-atom", message: `the carried atom universe declares a blank atom id (${typeof id}) — every atom id is explicit`, entryId: String(id) });
      continue;
    }
    if (seen.has(id)) {
      errors.push({ code: "duplicate-atom", message: `the atom '${id}' is declared twice in the carried universe — one atom, once (never silently deduplicated)`, entryId: id });
    }
    seen.add(id);
  }
  const sorted = [...ids].sort(compareCodeUnits);
  if (ids.some((id, index) => id !== sorted[index])) {
    errors.push({ code: "universe-not-canonical", message: "the carried atom universe is not in canonical (code-unit) order — the record carries canonical orders (A9)" });
  }
  return errors;
}
/** The W037-carried split-shape laws, re-proven for one split descriptor. */
function splitShapeErrors(
  split: HoldoutSplitDescriptor,
  expectedKind: string,
  atomKind: SplitAtom["kind"],
): readonly SplitFamilyError[] {
  const errors: SplitFamilyError[] = [];
  const entryId = typeof split.axisId === "string" ? split.axisId : String(split.axisId);
  if (typeof split.axisId !== "string" || split.axisId.trim().length === 0) {
    errors.push({ code: "blank-split-axis", message: "the split declares a blank axis id — every split names its axis (W037 carried)" });
  }
  if (split.kind !== expectedKind) {
    errors.push({ code: "split-kind-mismatch", message: `the split for axis '${entryId}' declares kind '${String(split.kind)}' but its family is '${expectedKind}' — a split never re-kinds its axis (W037 carried)`, entryId });
  }
  const sides: readonly (readonly [string, readonly SplitAtom[]])[] = [
    ["train", split.train],
    ["evaluation", split.evaluation],
  ];
  for (const [sideName, atoms] of sides) {
    if (atoms.length === 0) {
      errors.push({ code: "empty-split-side", message: `the '${sideName}' side of the split for axis '${entryId}' is empty — a side with no atoms is not a split (W037 carried)`, entryId });
    }
    const seen = new Set<string>();
    for (const atom of atoms) {
      const rendering = canonicalString(atom);
      if (seen.has(rendering)) {
        errors.push({ code: "duplicate-split-atom", message: `the '${sideName}' side of the split for axis '${entryId}' declares the same atom twice (${rendering}) — one atom, one side, once (W037 carried)`, entryId });
      }
      seen.add(rendering);
      if (atom === null || typeof atom !== "object" || atom.kind !== atomKind) {
        errors.push({ code: "split-atom-kind-mismatch", message: `the split for axis '${entryId}' (kind '${expectedKind}') carries a '${String(atom?.kind)}' atom — only '${atomKind}' atoms belong to this kind (W037 carried)`, entryId });
        continue;
      }
      if (
        atom.kind === "period" &&
        (!Number.isFinite(Number(atom.from)) ||
          !Number.isFinite(Number(atom.to)) ||
          Number(atom.from) > Number(atom.to))
      ) {
        errors.push({ code: "invalid-period-atom", message: `the period atom of axis '${entryId}' is invalid (${String(atom.from)} → ${String(atom.to)}) — instants are finite and ordered (W037 carried)`, entryId });
      }
    }
  }
  const trainSet = new Set(split.train.map((atom) => canonicalString(atom)));
  for (const atom of split.evaluation) {
    if (trainSet.has(canonicalString(atom))) {
      errors.push({ code: "overlapping-split-sides", message: `the atom ${canonicalString(atom)} is declared on BOTH sides of the split for axis '${entryId}' — a held-out atom never trains (W037 carried)`, entryId });
    }
  }
  return errors;
}
/** The walk-forward fold laws: ordering, sealed cutoff, containment, tiling. */
function foldErrors(
  family: SplitFamily,
  range: SplitFamilyRange,
): readonly SplitFamilyError[] {
  const errors: SplitFamilyError[] = [];
  if (family.folds.length === 0) {
    return [
      {
        code: "generation-mismatch",
        message: "the walk-forward family carries no folds — the window sequence re-derives at least one fold (A9)",
      },
    ];
  }
  family.folds.forEach((fold, index) => {
    const entryId = fold.axisId;
    if (fold.foldIndex !== index) {
      errors.push({ code: "window-sequence", message: `the fold at position ${index} carries index ${String(fold.foldIndex)} — the sequence is dense from 0`, entryId });
    }
    if (fold.train === null || typeof fold.train !== "object" || fold.train.kind !== "period") {
      errors.push({
        code: "split-atom-kind-mismatch",
        message: `the fold '${entryId}' carries a '${String(fold.train?.kind)}' train atom — only period atoms belong to a walk-forward family (W037 carried)`,
        entryId,
      });
      return;
    }
    if (
      fold.evaluation === null ||
      typeof fold.evaluation !== "object" ||
      fold.evaluation.kind !== "period"
    ) {
      errors.push({
        code: "split-atom-kind-mismatch",
        message: `the fold '${entryId}' carries a '${String(fold.evaluation?.kind)}' evaluation atom — only period atoms belong to a walk-forward family (W037 carried)`,
        entryId,
      });
      return;
    }
    const train = fold.train;
    const evaluation = fold.evaluation;
    const trainFrom = Number(train.from);
    const trainTo = Number(train.to);
    const evaluationFrom = Number(evaluation.from);
    const evaluationTo = Number(evaluation.to);
    if (
      !Number.isFinite(trainFrom) ||
      !Number.isFinite(trainTo) ||
      trainFrom > trainTo ||
      !Number.isFinite(evaluationFrom) ||
      !Number.isFinite(evaluationTo) ||
      evaluationFrom > evaluationTo
    ) {
      errors.push({
        code: "invalid-period-atom",
        message: `the fold '${entryId}' carries invalid period atoms (train ${String(train.from)} → ${String(train.to)}, evaluation ${String(evaluation.from)} → ${String(evaluation.to)}) — instants are finite and ordered (W037 carried)`,
        entryId,
      });
      return;
    }
    // THE NO-LEAKAGE LAW (R016): the train side strictly precedes the
    // evaluation side — a fold whose evaluation side reaches back to or
    // past its train side's end could see its train side's future through
    // an unsealed view.
    if (trainTo >= evaluationFrom) {
      errors.push({ code: "no-leakage", message: `the fold '${entryId}' lets its evaluation side begin at ${evaluationFrom} — at or before its train side ends at ${trainTo} — the evaluation side could see its train side's future through an unsealed view (${KNOWLEDGE_FIREWALL_LAW}, the runtime point-in-time information firewall)`, entryId });
    }
    if (!isLegalCutoff(Number(fold.cutoff)) || Number(fold.cutoff) !== trainTo) {
      errors.push({ code: "fold-cutoff-mismatch", message: `the fold '${entryId}' carries cutoff ${String(fold.cutoff)} — the fold's sealed knowledge boundary is its train side's end ${trainTo} (the W050 point-in-time cutoff, ${KNOWLEDGE_FIREWALL_LAW})`, entryId });
    }
    if (trainFrom < Number(range.from) || evaluationTo > Number(range.to)) {
      errors.push({ code: "window-outside-range", message: `the fold '${entryId}' reaches outside the declared input range (${String(range.from)} → ${String(range.to)}) — windows never leave their range`, entryId });
    }
  });
  const first = family.folds[0]!;
  if (Number(first.train.from) !== Number(range.from)) {
    errors.push({ code: "window-sequence", message: `the first fold's train window begins at ${String(first.train.from)} — it must begin at the range's start ${String(range.from)} (the sequence covers its whole input range)`, entryId: first.axisId });
  }
  for (let index = 1; index < family.folds.length; index += 1) {
    const previous = family.folds[index - 1]!;
    const current = family.folds[index]!;
    if (Number(current.evaluation.from) !== Number(previous.evaluation.to) + 1) {
      errors.push({ code: "window-sequence", message: `the evaluation windows must tile without gap or overlap — fold ${index} begins at ${String(current.evaluation.from)} but fold ${index - 1} ended at ${String(previous.evaluation.to)} (disjoint + covering)`, entryId: current.axisId });
    }
  }
  const last = family.folds[family.folds.length - 1]!;
  if (Number(last.evaluation.to) !== Number(range.to)) {
    errors.push({ code: "window-sequence", message: `the last fold's evaluation window ends at ${String(last.evaluation.to)} — it must end at the range's end ${String(range.to)} (covering)`, entryId: last.axisId });
  }
  if (family.splits.length !== family.folds.length) {
    errors.push({ code: "window-sequence", message: `the family carries ${family.folds.length} folds but ${family.splits.length} split descriptors — one split descriptor per fold` });
  }
  return errors;
}
/**
 * Validate one split family — whole-record re-validation from carried data.
 * All violations are collected — the declarer sees every problem, never just
 * the first.
 */
export function validateSplitFamily(family: SplitFamily): SplitFamilyValidation {
  const errors: SplitFamilyError[] = [];
  if (family === null || typeof family !== "object" || !isSplitFamilyKind(family.kind)) {
    return { ok: false, errors: [{ code: "unknown-family-kind", message: `unknown split family kind '${String(family?.kind)}' (the closed §13 set: ${SPLIT_FAMILY_KINDS.join(", ")}) — the four holdout kinds are first-class` }] };
  }
  const kind = family.kind;
  const atomKind = SPLIT_FAMILY_ATOM_KIND[kind];
  const scopeOk = family.scope !== null && typeof family.scope === "object";
  if (!scopeOk) {
    errors.push({ code: "blank-scope-member", message: "the family scope is not an object — tenantId, projectId, worldId are required (the scope is explicit)" });
  } else {
    for (const member of blankTimeMachineScopeMembers(family.scope)) {
      errors.push({ code: "blank-scope-member", message: `the family scope member '${String(member)}' is blank — the scope is explicit (W050 carried)` });
    }
  }
  const rangeValid = isFiniteRange(family.range);
  if (!rangeValid) {
    errors.push({ code: "invalid-range", message: `the carried input range ${String(family.range?.from)} → ${String(family.range?.to)} is invalid — instants are finite and ordered (the W004/W037 period law)` });
  } else if (
    kind === "walk-forward" &&
    (!isLegalCutoff(Number(family.range.from)) || !isLegalCutoff(Number(family.range.to)))
  ) {
    errors.push({ code: "invalid-range", message: "the walk-forward range instants must be finite non-negative integers — every fold boundary becomes a sealed W050 cutoff (R016)" });
  }
  let universeOk = false;
  if (family.universe === null || typeof family.universe !== "object") {
    errors.push({ code: "universe-kind-mismatch", message: `the '${kind}' family carries no atom universe — the universe carries W037's atom vocabulary` });
  } else if (family.universe.kind !== atomKind) {
    errors.push({ code: "universe-kind-mismatch", message: `the '${kind}' family carries a '${String(family.universe.kind)}' atom universe — the universe's atom family must match the family kind (W037's closed table)` });
  } else if (kind === "walk-forward") {
    const universe = family.universe as Extract<SplitAtomUniverse, { kind: "period" }>;
    if (universe.from !== family.range.from || universe.to !== family.range.to) {
      errors.push({ code: "walk-forward-universe-mismatch", message: `the walk-forward period universe (${String(universe.from)} → ${String(universe.to)}) is not the input range (${String(family.range.from)} → ${String(family.range.to)}) — the period universe IS the range, never a second declaration` });
    } else {
      universeOk = true;
    }
  } else {
    errors.push(...universeIdErrors(family.universe));
    universeOk = errors.length === 0;
  }
  const policyOk =
    family.policy !== null &&
    typeof family.policy === "object" &&
    family.policy.kind === kind;
  if (!policyOk) {
    errors.push({ code: "policy-kind-mismatch", message: `the family policy declares kind '${String(family.policy?.kind)}' but the family is '${kind}' — a policy never re-kinds its family` });
  } else if (
    typeof family.policy.axisId !== "string" ||
    family.policy.axisId.trim().length === 0
  ) {
    errors.push({ code: "blank-family-axis", message: "the family policy declares a blank axis id — every split family names its axis" });
  } else if (
    kind === "walk-forward" &&
    (!isPositiveInteger((family.policy as WalkForwardWindowPolicy).trainWindowMs) ||
      !isPositiveInteger((family.policy as WalkForwardWindowPolicy).evaluationWindowMs))
  ) {
    const windowPolicy = family.policy as WalkForwardWindowPolicy;
    errors.push({ code: "invalid-window-policy", message: `the walk-forward window policy declares train/evaluation windows that are not positive integer milliseconds (train ${String(windowPolicy.trainWindowMs)}, evaluation ${String(windowPolicy.evaluationWindowMs)}) — every window is an explicit W004 time span` });
  }
  // The A9 re-generation proof: the same range + policy re-derive the folds.
  if (policyOk && rangeValid) {
    if (kind === "walk-forward") {
      const regenerated = generateWalkForward(
        family.range,
        family.policy as WalkForwardWindowPolicy,
      );
      if (!regenerated.ok) {
        errors.push(...regenerated.errors);
      } else {
        if (!sameByCanonical(regenerated.generation.folds, family.folds)) {
          errors.push({ code: "generation-mismatch", message: "the carried folds do not re-derive from the declared range + window policy (A9: same input range + same family policy → deep-equal family)" });
        }
        if (!sameByCanonical(regenerated.generation.splits, family.splits)) {
          errors.push({ code: "generation-mismatch", message: "the carried splits do not re-derive from the declared range + window policy (A9: same input range + same family policy → deep-equal family)" });
        }
      }
    } else if (universeOk) {
      const partitionPolicy = family.policy as Extract<
        SplitFamilyPolicy,
        { kind: "regime" | "asset" | "venue" }
      >;
      const regenerated =
        kind === "regime"
          ? generateRegimePartitions(
              splitAtomUniverseIds(family.universe),
              partitionPolicy.rule,
              partitionPolicy.axisId,
            )
          : kind === "asset"
            ? generateAssetPartitions(
                splitAtomUniverseIds(family.universe) as readonly SplitInstrumentId[],
                partitionPolicy.rule,
                partitionPolicy.axisId,
              )
            : generateVenuePartitions(
                splitAtomUniverseIds(family.universe),
                partitionPolicy.rule,
                partitionPolicy.axisId,
              );
      if (!regenerated.ok) {
        errors.push(...regenerated.errors);
      } else if (family.splits.length !== 1 || !sameByCanonical(regenerated.split, family.splits[0])) {
        errors.push({ code: "generation-mismatch", message: "the carried split does not re-derive from the declared universe + partition rule (A9: same atom universe + same family policy → deep-equal split)" });
      }
    }
  }
  // The identity re-derivations.
  if (scopeOk && universeOk && policyOk) {
    const derivedId = splitFamilyIdOf(
      family.scope,
      kind,
      family.range,
      family.universe,
      family.policy,
    );
    if (derivedId !== family.familyId) {
      errors.push({ code: "family-id-mismatch", message: `the family id '${String(family.familyId)}' does not re-derive from its own declaration ('${derivedId}') — A9 content addressing` });
    }
  }
  // The fold laws (walk-forward only) — the R016 no-leakage law lives here.
  if (kind === "walk-forward" && rangeValid) {
    errors.push(...foldErrors(family, family.range));
  }
  // The W037-carried split-shape laws.
  for (const split of family.splits) {
    if (split === null || typeof split !== "object") {
      errors.push({ code: "blank-split-axis", message: "the family carries a malformed split descriptor — splits are typed data (W037 carried)" });
      continue;
    }
    errors.push(...splitShapeErrors(split, kind, atomKind));
  }
  // The lineage laws.
  const lineage = family.lineage;
  if (lineage === null || typeof lineage !== "object") {
    errors.push({ code: "lineage-break", message: "the family carries no lineage — the lineage is explicit (the immutable lineage law)" });
  } else if (lineage.parent === undefined) {
    if (lineage.ordinal !== 0 || lineage.root !== family.familyId) {
      errors.push({ code: "lineage-break", message: `a root family's lineage cites its own id at ordinal 0 — it declares root '${String(lineage.root)}' at ordinal ${String(lineage.ordinal)} (the immutable lineage law)` });
    }
  } else if (
    String(lineage.root).trim().length === 0 ||
    String(lineage.parent).trim().length === 0 ||
    typeof lineage.ordinal !== "number" ||
    !Number.isInteger(lineage.ordinal) ||
    lineage.ordinal < 1
  ) {
    errors.push({ code: "lineage-break", message: "a continuation's lineage is explicit — a non-blank parent, the chain's root carried verbatim, and an ordinal ≥ 1 (the immutable lineage law)" });
  }
  // The provenance re-derivation.
  const provenance = family.provenance;
  if (provenance === null || typeof provenance !== "object") {
    errors.push({ code: "provenance-mismatch", message: "the family carries no provenance — the provenance is deterministic data (the provenance law)" });
  } else {
    const expectedGenerator = SPLIT_FAMILY_GENERATOR_NAMES[kind];
    if (provenance.generator !== expectedGenerator) {
      errors.push({ code: "provenance-mismatch", message: `the provenance names generator '${String(provenance.generator)}' but a '${kind}' family is generated by '${expectedGenerator}' (the provenance law)` });
    }
    if (scopeOk && universeOk && policyOk) {
      const expectedDigest = splitFamilyDeclarationDigest(
        family.scope,
        kind,
        family.range,
        family.universe,
        family.policy,
      );
      if (provenance.inputDigest !== expectedDigest) {
        errors.push({ code: "provenance-mismatch", message: "the provenance's input digest does not re-derive from the declaration (the provenance law)" });
      }
    }
    if (!sameByCanonical(provenance.laws, SPLIT_FAMILY_PROVENANCE_LAWS)) {
      errors.push({ code: "provenance-mismatch", message: "the provenance's law list is not the canonical family law list (§13, R016, A9, A14)" });
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, family };
}
