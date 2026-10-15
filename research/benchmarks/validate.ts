/**
 * THE PUBLICATION GATE (W063) — the fail-closed seam every benchmark/
 * evidence publication passes through, and its whole-record re-validation.
 *
 * `composeBenchmarkPublication` seals one publication over
 * ALREADY-VERIFIED records: the W052 split family re-proven through W052's
 * own `validateSplitFamily`, the W038 evaluation re-proven through W038's
 * own id/digest/order laws, its verification findings through
 * verification's own `findingsDigestOf` machinery, the W051 search history
 * through W051's own `validateSearchHistory`, the W061 audit trail
 * through operations' own end-to-end `verifyTrail` (their own errors
 * carried VERBATIM), scope agreement proven across every citation, the
 * family proven to have JUDGED the evaluation, and every reproducibility
 * claim proven BACKED by a carried W022 fidelity verdict. Publication is
 * COMPOSITION + CITATION (A14): nothing is measured, scored or executed
 * here — every published number is CARRIED by a cited record (A6), and an
 * invented number is a loud typed refusal.
 *
 * `validateBenchmarkPublication` re-validates a whole record from its own
 * carried data; `reproveBenchmarkPublication` re-proves the citations
 * against the live records. Pure and deterministic (A9): the same cited
 * records ⇒ the deep-equal publication, the same `bp-<digest>` id.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import { canonicalDigestHex, canonicalString } from "../../packages/trajectory/index.js";
import { EXPERIMENT_EVALUATION_ID_PREFIX } from "../../packages/evaluation/index.js";
import type { ExperimentEvaluation, TrajectoryOutcomeSummary } from "../../packages/evaluation/index.js";
import { findingsDigestOf } from "../../packages/verification/index.js";
import type { FindingsReport } from "../../packages/verification/index.js";
import { compareCodeUnits, splitFamilyCitationOf, validateSplitFamily } from "../../packages/evaluation-splits/index.js";
import type { SplitFamily, SplitFamilyError } from "../../packages/evaluation-splits/index.js";
import { validateSearchHistory } from "../../packages/search-integrity/index.js";
import type { SearchHistory, SearchHistoryError } from "../../packages/search-integrity/index.js";
import type { AuditTrail } from "../../packages/observability/index.js";
import { verifyTrail } from "../../services/operations/trail.js";
import type { TrailVerification } from "../../services/operations/trail.js";
import { FIDELITY_CLAIM_REGISTRY, findingDigestOf, summarizeVerdicts } from "../../packages/tradrl-evaluation/replay/index.js";
import type { FidelityFinding } from "../../packages/tradrl-evaluation/replay/index.js";
import {
  BENCHMARK_PUBLICATION_FAMILIES,
  BENCHMARK_PUBLICATION_ID_PREFIX,
  PUBLICATION_FAMILY_KINDS,
  PUBLICATION_PROVENANCE_LAWS,
  REPRODUCIBILITY_MANIFEST_SCHEMA,
  benchmarkPublicationIdOf,
} from "./benchmark-publications.js";
import type {
  AuditTrailCitation,
  BenchmarkPublication,
  BenchmarkPublicationId,
  EvaluationCitation,
  FamilyCitation,
  HistoryCitation,
  PublicationLineage,
  PublicationLineageInput,
  PublicationScope,
  ReproducibilityClaim,
  ReproducibilityManifest,
} from "./benchmark-publications.js";

// ---------------------------------------------------------------------------
// The typed error family (closed set — every law named)
// ---------------------------------------------------------------------------

/** A W061 trail verification failure, carried verbatim. */
export type TrailFailure = Exclude<TrailVerification, { readonly ok: true }>;

/** Everything the publication gate can refuse. */
export type PublicationErrorCode =
  | "malformed-input" // the input is not lawful typed data
  | "unknown-publication-family" // the declared family id is not in the catalogue
  | "family-kind-mismatch" // the cited family's kind ≠ the declared family's kind
  | "invalid-family" // W052 whole-record re-validation failed (errors carried verbatim)
  | "invalid-evaluation" // W038 carried: the evaluation id/order does not re-prove
  | "invalid-findings" // W038 carried: the findings digest/subject/counts do not re-prove
  | "invalid-history" // W051 whole-record re-validation failed (errors carried verbatim)
  | "invalid-trail" // W061 end-to-end verification failed (failure carried verbatim)
  | "unknown-claim" // a required claim id is not in W022's registry
  | "unbacked-reproducibility-claim" // a required claim has no carried fidelity verdict
  | "scope-mismatch" // family ≢ history ≢ trail scope members
  | "experiment-mismatch" // history.experimentId ≢ evaluation.experimentId
  | "family-did-not-judge" // a family split the evaluation never carried
  | "carried-number-mismatch" // a published number ≠ the cited record's own (A6)
  | "lineage-break" // the immutable lineage is incoherent
  | "invalid-publication"; // whole-record re-validation: id/manifest/provenance drift

/** One typed publication error (fail-closed; the law named in the message). */
export interface PublicationError {
  readonly code: PublicationErrorCode;
  readonly message: string;
  readonly entryId?: string;
  /** `invalid-family` only: W052's own errors, carried VERBATIM. */
  readonly familyErrors?: readonly SplitFamilyError[];
  /** `invalid-history` only: W051's own errors, carried VERBATIM. */
  readonly historyErrors?: readonly SearchHistoryError[];
  /** `invalid-trail` only: W061's own verification failure, carried VERBATIM. */
  readonly trailFailure?: TrailFailure;
}

// ---------------------------------------------------------------------------
// The W038 outcome-side re-proofs (evaluation + findings, from carried data)
// ---------------------------------------------------------------------------

function summaryTuple(summary: TrajectoryOutcomeSummary): unknown[] {
  return [String(summary.trajectoryId), summary.policyId, summary.combinedScore, summary.appliedSoftPenaltyTotal, summary.hardViolationCount, summary.compliance];
}

/** Re-derive the evaluation's content-addressed id from its OWN carried
 * bytes — the same canonical content W038's walker digests (A9: recorded
 * data is re-proven, never trusted; never re-scored). */
function rederivedEvaluationId(evaluation: ExperimentEvaluation): string {
  return `${EXPERIMENT_EVALUATION_ID_PREFIX}${canonicalDigestHex({
    experimentId: String(evaluation.experimentId),
    integrity: [...evaluation.integrity],
    holdoutSplits: evaluation.holdoutSplits.map((aggregation) => [
      aggregation.axisId, String(aggregation.kind), aggregation.derivation,
      aggregation.train.map((summary) => String(summary.trajectoryId)),
      aggregation.evaluation.map((summary) => String(summary.trajectoryId)),
      aggregation.unassigned.map((summary) => String(summary.trajectoryId)),
    ]),
    policyId: evaluation.policyId,
    reduction: evaluation.reduction,
    trajectories: evaluation.trajectories.map(summaryTuple),
  })}`;
}

function isCanonicalSummaryOrder(summaries: readonly TrajectoryOutcomeSummary[]): boolean {
  for (let index = 1; index < summaries.length; index += 1) {
    if (compareCodeUnits(String(summaries[index - 1]?.trajectoryId), String(summaries[index]?.trajectoryId)) > 0) {
      return false;
    }
  }
  return true;
}

function completedEvaluationErrors(evaluation: ExperimentEvaluation, findings: FindingsReport): readonly PublicationError[] {
  const errors: PublicationError[] = [];
  const evaluationId = String(evaluation.evaluationId);
  if (!evaluationId.startsWith(EXPERIMENT_EVALUATION_ID_PREFIX)) {
    errors.push({ code: "invalid-evaluation", message: `the evaluation id '${evaluationId}' is not a '${EXPERIMENT_EVALUATION_ID_PREFIX}' rendering — W038's own id vocabulary is required` });
  }
  if (rederivedEvaluationId(evaluation) !== evaluationId) {
    errors.push({ code: "invalid-evaluation", message: `the evaluation id '${evaluationId}' does not re-derive from its own carried bytes (spec/ARCHITECTURE-LOCK.md A9 — recorded data is re-proven, never trusted)` });
  }
  if (!isCanonicalSummaryOrder(evaluation.trajectories)) {
    errors.push({ code: "invalid-evaluation", message: "the evaluation's carried outcome summaries are not in canonical trajectory-id order — the record's own canonical order is re-proven" });
  }
  for (const aggregation of evaluation.holdoutSplits) {
    if (!isCanonicalSummaryOrder(aggregation.train) || !isCanonicalSummaryOrder(aggregation.evaluation) || !isCanonicalSummaryOrder(aggregation.unassigned)) {
      errors.push({ code: "invalid-evaluation", message: `the holdout aggregation for axis '${aggregation.axisId}' carries sides out of canonical trajectory-id order — the record's own canonical order is re-proven`, entryId: aggregation.axisId });
    }
  }
  if (String(findings.subject) !== evaluationId) {
    errors.push({ code: "invalid-findings", message: `the findings report answers subject '${String(findings.subject)}' but the evaluation is '${evaluationId}' — the verdict record must answer the evaluation it judges` });
  }
  if (findingsDigestOf(findings.subject, findings.findings) !== String(findings.digest)) {
    errors.push({ code: "invalid-findings", message: `the findings digest '${String(findings.digest)}' does not re-derive from its own carried findings through W038 verification's own digest machinery (spec/ARCHITECTURE-LOCK.md A9)` });
  }
  if (findings.passCount + findings.failCount + findings.partialCount + findings.undeclaredCount !== findings.findings.length) {
    errors.push({ code: "invalid-findings", message: `the findings report's verdict counts (pass ${String(findings.passCount)}, fail ${String(findings.failCount)}, partial ${String(findings.partialCount)}, undeclared ${String(findings.undeclaredCount)}) do not add up to its ${String(findings.findings.length)} carried findings — incoherent verdict records are refused` });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------------

/** The already-verified records a publication composes + cites. */
export interface PublicationRecordsInput {
  readonly family: SplitFamily;
  readonly evaluation: ExperimentEvaluation;
  readonly findings: FindingsReport;
  readonly history: SearchHistory;
  readonly trail: AuditTrail;
  /** W022 replay-fidelity findings — the verdicts the manifest carries. */
  readonly fidelity: readonly FidelityFinding[];
}

/** The composition input: the records + the declared family + the lineage. */
export interface ComposeBenchmarkPublicationInput extends PublicationRecordsInput {
  readonly familyId: string;
  readonly lineage?: PublicationLineageInput;
}

/** The composition outcome: the sealed publication, or every law violated. */
export type ComposeBenchmarkPublicationOutcome =
  | { readonly ok: true; readonly publication: BenchmarkPublication }
  | { readonly ok: false; readonly errors: readonly PublicationError[] };

function resolveLineage(input: PublicationLineageInput | undefined, publicationId: BenchmarkPublicationId): { readonly ok: true; readonly lineage: PublicationLineage } | { readonly ok: false; readonly errors: readonly PublicationError[] } {
  const parent = input?.parent;
  if (parent === undefined) {
    const declaredRoot = input?.root;
    if (declaredRoot !== undefined && declaredRoot !== publicationId) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root publication's lineage must cite its own id ('${publicationId}') — it declares '${declaredRoot}' (the immutable lineage law)` }] };
    }
    const ordinal = input?.ordinal ?? 0;
    if (ordinal !== 0) {
      return { ok: false, errors: [{ code: "lineage-break", message: `a root publication's lineage ordinal is 0 — it declares ${String(ordinal)} (the immutable lineage law)` }] };
    }
    return { ok: true, lineage: { parent: undefined, root: publicationId, ordinal: 0 } };
  }
  if (String(parent).trim().length === 0) {
    return { ok: false, errors: [{ code: "lineage-break", message: "the publication declares a blank parent id — the lineage is explicit, never defaulted" }] };
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
 * Compose one publication — THE GATE. Every citation is re-proven through
 * its source package's own validators (errors carried verbatim), scope
 * agreement is proven across family/history/trail, the family is proven
 * to have JUDGED the evaluation, and every reproducibility claim is
 * proven BACKED by a carried W022 fidelity verdict. Only then is the
 * publication sealed: citations carrying the records' OWN counts, the
 * manifest in the W022 claim shape, the resolved lineage, the
 * deterministic provenance, the `bp-<digest>` id. Pure (A9); nothing is
 * measured or scored (A14).
 */
export function composeBenchmarkPublication(input: ComposeBenchmarkPublicationInput): ComposeBenchmarkPublicationOutcome {
  if (input === null || typeof input !== "object") {
    return { ok: false, errors: [{ code: "malformed-input", message: "the publication composition input is not an object — a declared family id and the cited records (family, evaluation, findings, history, trail, fidelity verdicts) are required" }] };
  }
  const errors: PublicationError[] = [];
  for (const member of ["family", "evaluation", "findings", "history", "trail", "fidelity"] as const) {
    const value = (input as unknown as Record<string, unknown>)[member];
    if (value === null || value === undefined || typeof value !== "object") {
      return { ok: false, errors: [{ code: "malformed-input", message: `the publication composition input carries no '${member}' record — a publication composes the already-verified family, evaluation, findings, history, trail and fidelity verdicts` }] };
    }
  }
  const declared = BENCHMARK_PUBLICATION_FAMILIES.find((family) => family.publicationId === input.familyId);
  if (declared === undefined) {
    return { ok: false, errors: [{ code: "unknown-publication-family", message: `the declared publication family '${input.familyId}' is not in the catalogue — a publication cites a declared family (research/benchmarks), never an invented one` }] };
  }
  const familyValidation = validateSplitFamily(input.family);
  if (!familyValidation.ok) {
    errors.push({ code: "invalid-family", message: `the split family '${String(input.family.familyId)}' fails W052's own whole-record re-validation — a publication cites only citable records`, familyErrors: familyValidation.errors });
  }
  if (input.family.kind !== declared.familyKind) {
    errors.push({ code: "family-kind-mismatch", message: `the declared family '${declared.publicationId}' publishes ${declared.familyKind} evidence but the cited split family '${String(input.family.familyId)}' is of kind '${input.family.kind}' — the declared surface and the cited record must agree` });
  }
  const registryIds = new Set(FIDELITY_CLAIM_REGISTRY.map((entry) => entry.claimId));
  for (const claimId of declared.requiredClaims) {
    if (!registryIds.has(claimId)) {
      errors.push({ code: "unknown-claim", message: `the required claim '${claimId}' is not in W022's fidelity claim registry — an uncitable claim is a loud typed refusal (spec/ARCHITECTURE-LOCK.md A6)`, entryId: claimId });
    }
  }
  errors.push(...completedEvaluationErrors(input.evaluation, input.findings));
  const historyValidation = validateSearchHistory(input.history);
  if (!historyValidation.ok) {
    errors.push({ code: "invalid-history", message: `the search history '${String(input.history.historyId)}' fails W051's own whole-record re-validation — a publication cites only citable records`, historyErrors: historyValidation.errors });
  }
  const trailVerification = verifyTrail(input.trail);
  if (!trailVerification.ok) {
    errors.push({ code: "invalid-trail", message: `the audit trail '${String(input.trail.trailId)}' fails W061's own end-to-end verification — a publication cites only tamper-evidenced custody (failure carried verbatim)`, trailFailure: trailVerification });
  }
  const familyScope = input.family.scope;
  const historyScope = input.history.scope;
  for (const member of ["tenantId", "projectId", "worldId"] as const) {
    if (String(familyScope[member]) !== String(historyScope[member])) {
      errors.push({ code: "scope-mismatch", message: `the split family declares scope.${member} '${String(familyScope[member])}' but the search history declares '${String(historyScope[member])}' — a publication's citations share one explicit scope` });
    }
  }
  if (input.trail.scope.kind !== "tenant-project-world" || String(input.trail.scope.tenantId) !== String(familyScope.tenantId) || String(input.trail.scope.projectId) !== String(familyScope.projectId) || String(input.trail.scope.worldId) !== String(familyScope.worldId)) {
    errors.push({ code: "scope-mismatch", message: `the audit trail's §14 scope (kind '${input.trail.scope.kind}') does not carry the publication's tenant/project/world members — every citation shares one explicit scope` });
  }
  const experimentId = String(input.evaluation.experimentId);
  if (String(historyScope.experimentId) !== experimentId) {
    errors.push({ code: "experiment-mismatch", message: `the search history ran under experiment '${String(historyScope.experimentId)}' but the evaluation walked '${experimentId}' — the integrity linkage never crosses experiments` });
  }
  const judgedAxes = new Set(input.evaluation.holdoutSplits.map((aggregation) => aggregation.axisId));
  for (const split of input.family.splits) {
    if (!judgedAxes.has(split.axisId)) {
      errors.push({ code: "family-did-not-judge", message: `the family split for axis '${split.axisId}' is not carried by evaluation '${experimentId}' — the publication's family is the family that JUDGED this outcome (cited, never assumed)`, entryId: split.axisId });
    }
  }
  const selectedTrialIds = new Set(input.history.selections.map((decision) => String(decision.chosenTrialId)));
  const familyCitation: FamilyCitation = { ...splitFamilyCitationOf(input.family), splitCount: input.family.splits.length, foldCount: input.family.folds.length };
  const evaluationCitation: EvaluationCitation = {
    evaluationId: String(input.evaluation.evaluationId), experimentId, policyId: input.evaluation.policyId,
    findingsDigest: String(input.findings.digest), trajectoryCount: input.evaluation.trajectories.length,
    passCount: input.findings.passCount, failCount: input.findings.failCount,
    partialCount: input.findings.partialCount, undeclaredCount: input.findings.undeclaredCount,
  };
  const historyCitation: HistoryCitation = { historyId: String(input.history.historyId), trialCount: input.history.trials.length, selectionCount: input.history.selections.length, selectedTrialCount: selectedTrialIds.size, law: "spec/ARCHITECTURE-LOCK.md A6" };
  const trailCitation: AuditTrailCitation = { trailId: String(input.trail.trailId), head: input.trail.head, recordCount: input.trail.records.length, law: "spec/ARCHITECTURE-LOCK.md A6" };
  const claims: ReproducibilityClaim[] = [];
  const backed: FidelityFinding[] = [];
  for (const entry of FIDELITY_CLAIM_REGISTRY) {
    if (!declared.requiredClaims.includes(entry.claimId)) {
      continue;
    }
    const finding = input.fidelity.find((candidate) => candidate.claimId === entry.claimId);
    if (finding === undefined) {
      errors.push({ code: "unbacked-reproducibility-claim", message: `the reproducibility claim '${entry.claimId}' is not backed by any carried W022 fidelity verdict — a publication never asserts a verdict the cited record does not carry (spec/ARCHITECTURE-LOCK.md A6)`, entryId: entry.claimId });
      continue;
    }
    backed.push(finding);
    claims.push({ claimId: entry.claimId, title: entry.title, family: entry.family, module: entry.module, verdict: finding.verdict, findingDigest: findingDigestOf(finding) });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const tallies = summarizeVerdicts(backed);
  const manifest: ReproducibilityManifest = { schema: REPRODUCIBILITY_MANIFEST_SCHEMA, claims, passCount: tallies.pass, failCount: tallies.fail, partialCount: tallies.partial };
  const scope: PublicationScope = { tenantId: String(familyScope.tenantId), projectId: String(familyScope.projectId), worldId: String(familyScope.worldId) };
  const record: BenchmarkPublication = {
    publicationId: "bp-pending" as BenchmarkPublicationId,
    familyId: declared.publicationId,
    scope,
    family: familyCitation,
    evaluation: evaluationCitation,
    history: historyCitation,
    trail: trailCitation,
    reproducibility: manifest,
    lineage: { parent: undefined, root: "bp-pending" as BenchmarkPublicationId, ordinal: 0 },
    provenance: {
      deriver: "compose-benchmark-publication",
      inputDigest: canonicalDigestHex({ claims: [...declared.requiredClaims], evaluationId: evaluationCitation.evaluationId, familyId: declared.publicationId, familyRecordId: familyCitation.familyId, historyId: historyCitation.historyId, trailId: trailCitation.trailId }),
      laws: [...PUBLICATION_PROVENANCE_LAWS],
    },
  };
  const publicationId = benchmarkPublicationIdOf(record);
  const lineageOutcome = resolveLineage(input.lineage, publicationId);
  if (!lineageOutcome.ok) {
    return { ok: false, errors: lineageOutcome.errors };
  }
  return { ok: true, publication: { ...record, publicationId, lineage: lineageOutcome.lineage } };
}

// ---------------------------------------------------------------------------
// Whole-record re-validation (from the record's own carried data)
// ---------------------------------------------------------------------------

const HEX_DIGEST = /^[0-9a-f]{8}$/;

function countError(message: string): PublicationError {
  return { code: "carried-number-mismatch", message };
}

/**
 * Re-validate a whole publication from its own carried data: the id
 * re-derived from the canonical bytes (A9), the citation shape laws (the
 * consumed vocabularies' own prefixes + closed kinds), the manifest
 * re-proven against W022's registry (title/family/module carried
 * verbatim; claims in registry order; tallies coherent with the carried
 * verdicts), the lineage, the provenance laws. A number that does not
 * re-derive from the record's own carried content is refused loudly.
 */
export function validateBenchmarkPublication(publication: BenchmarkPublication): { readonly ok: true; readonly publication: BenchmarkPublication } | { readonly ok: false; readonly errors: readonly PublicationError[] } {
  const errors: PublicationError[] = [];
  const declared = BENCHMARK_PUBLICATION_FAMILIES.find((family) => family.publicationId === publication.familyId);
  if (declared === undefined) {
    errors.push({ code: "unknown-publication-family", message: `the publication cites family '${publication.familyId}' which is not in the catalogue — a publication cites a declared family (research/benchmarks), never an invented one` });
  }
  if (!String(publication.publicationId).startsWith(BENCHMARK_PUBLICATION_ID_PREFIX)) {
    errors.push({ code: "invalid-publication", message: `the publication id '${String(publication.publicationId)}' is not a '${BENCHMARK_PUBLICATION_ID_PREFIX}' rendering — the publication id vocabulary is required` });
  }
  if (benchmarkPublicationIdOf(publication) !== String(publication.publicationId)) {
    errors.push({ code: "invalid-publication", message: `the publication id '${String(publication.publicationId)}' does not re-derive from its own carried bytes (spec/ARCHITECTURE-LOCK.md A9 — a rewritten record is caught loudly)` });
  }
  if (!publication.family.familyId.startsWith("fam-")) {
    errors.push({ code: "invalid-publication", message: `the family citation id '${publication.family.familyId}' is not a 'fam-' rendering — W052's own id vocabulary is required` });
  }
  if (!(PUBLICATION_FAMILY_KINDS as readonly string[]).includes(publication.family.kind)) {
    errors.push({ code: "invalid-publication", message: `the family citation kind '${publication.family.kind}' is outside the closed §13 holdout-kind family` });
  }
  if (!publication.evaluation.evaluationId.startsWith(EXPERIMENT_EVALUATION_ID_PREFIX)) {
    errors.push({ code: "invalid-publication", message: `the evaluation citation id '${publication.evaluation.evaluationId}' is not an '${EXPERIMENT_EVALUATION_ID_PREFIX}' rendering — W038's own id vocabulary is required` });
  }
  if (!publication.trail.trailId.startsWith("atr-")) {
    errors.push({ code: "invalid-publication", message: `the audit trail citation id '${publication.trail.trailId}' is not an 'atr-' rendering — W061's own id vocabulary is required` });
  }
  for (const member of ["tenantId", "projectId", "worldId"] as const) {
    if (String(publication.scope[member]).trim().length === 0) {
      errors.push({ code: "invalid-publication", message: `the publication scope member '${member}' is blank — the explicit single-scope law` });
    }
  }
  const manifest = publication.reproducibility;
  if (manifest.schema !== REPRODUCIBILITY_MANIFEST_SCHEMA) {
    errors.push({ code: "invalid-publication", message: `the reproducibility manifest schema '${manifest.schema}' is not '${REPRODUCIBILITY_MANIFEST_SCHEMA}'` });
  }
  let lastRegistryIndex = -1;
  let pass = 0;
  let fail = 0;
  let partial = 0;
  for (const claim of manifest.claims) {
    const registryIndex = FIDELITY_CLAIM_REGISTRY.findIndex((entry) => entry.claimId === claim.claimId);
    const entry = registryIndex >= 0 ? FIDELITY_CLAIM_REGISTRY[registryIndex] : undefined;
    if (entry === undefined) {
      errors.push({ code: "unknown-claim", message: `the reproducibility claim '${claim.claimId}' is not in W022's fidelity claim registry — an uncitable claim is a loud typed refusal (spec/ARCHITECTURE-LOCK.md A6)`, entryId: claim.claimId });
      continue;
    }
    if (registryIndex <= lastRegistryIndex) {
      errors.push({ code: "invalid-publication", message: `the reproducibility claims are not in W022's registry order at '${claim.claimId}' — the canonical order never leaks the input order` });
    }
    lastRegistryIndex = registryIndex;
    if (claim.title !== entry.title || claim.family !== entry.family || claim.module !== entry.module) {
      errors.push({ code: "invalid-publication", message: `the reproducibility claim '${claim.claimId}' does not carry W022's registry descriptor verbatim (title/family/module drift) — the manifest CARRIES the registry, it never paraphrases it`, entryId: claim.claimId });
    }
    if (claim.verdict !== "PASS" && claim.verdict !== "FAIL" && claim.verdict !== "PARTIAL") {
      errors.push({ code: "invalid-publication", message: `the reproducibility claim '${claim.claimId}' carries verdict '${String(claim.verdict)}' — outside W022's closed verdict vocabulary`, entryId: claim.claimId });
    }
    if (!HEX_DIGEST.test(claim.findingDigest)) {
      errors.push({ code: "invalid-publication", message: `the reproducibility claim '${claim.claimId}' carries a malformed finding digest — W022's own digest rendering is required`, entryId: claim.claimId });
    }
    if (claim.verdict === "PASS") { pass += 1; } else if (claim.verdict === "FAIL") { fail += 1; } else { partial += 1; }
  }
  if (manifest.passCount !== pass || manifest.failCount !== fail || manifest.partialCount !== partial) {
    errors.push(countError(`the manifest tallies (pass ${String(manifest.passCount)}, fail ${String(manifest.failCount)}, partial ${String(manifest.partialCount)}) do not match its own carried claim verdicts (pass ${String(pass)}, fail ${String(fail)}, partial ${String(partial)}) — an invented number is a loud typed refusal (spec/ARCHITECTURE-LOCK.md A6)`));
  }
  if (publication.family.splitCount < 1 || publication.evaluation.trajectoryCount < 1 || publication.trail.recordCount < 1 || publication.history.trialCount < 1) {
    errors.push(countError("a publication cites at least one split, trajectory, trail record and trial — a citation of an empty record is a degenerate publication"));
  }
  if (publication.provenance.deriver !== "compose-benchmark-publication" || canonicalString(publication.provenance.laws) !== canonicalString([...PUBLICATION_PROVENANCE_LAWS]) || !HEX_DIGEST.test(publication.provenance.inputDigest)) {
    errors.push({ code: "invalid-publication", message: "the provenance is not the deterministic composition provenance (deriver/laws/inputDigest) — the record's own provenance is re-proven" });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, publication };
}

// ---------------------------------------------------------------------------
// Live-record re-proof (every citation re-proven, every number re-carried)
// ---------------------------------------------------------------------------

function numericDiff(label: string, actual: number, expected: number): PublicationError | undefined {
  if (actual === expected) {
    return undefined;
  }
  return countError(`the published ${label} is ${String(actual)} but the cited record carries ${String(expected)} — every published number is CARRIED by a cited record (spec/ARCHITECTURE-LOCK.md A6), an invented number is refused loudly`);
}

/**
 * Re-prove a whole publication against the LIVE records it claims to cite:
 * the records are re-run through the gate (their own validators' errors
 * carried verbatim), and every citation member and manifest entry is
 * compared against what the gate re-derives from the live records — a
 * carried number that differs from the record's own is the A6 invented-
 * number refusal.
 */
export function reproveBenchmarkPublication(publication: BenchmarkPublication, records: PublicationRecordsInput): { readonly ok: true; readonly publication: BenchmarkPublication } | { readonly ok: false; readonly errors: readonly PublicationError[] } {
  const composed = composeBenchmarkPublication({ ...records, familyId: publication.familyId, lineage: publication.lineage });
  if (!composed.ok) {
    return composed;
  }
  const expected = composed.publication;
  const errors: PublicationError[] = [
    numericDiff("family split count", publication.family.splitCount, expected.family.splitCount),
    numericDiff("family fold count", publication.family.foldCount, expected.family.foldCount),
    numericDiff("trajectory count", publication.evaluation.trajectoryCount, expected.evaluation.trajectoryCount),
    numericDiff("findings pass count", publication.evaluation.passCount, expected.evaluation.passCount),
    numericDiff("findings fail count", publication.evaluation.failCount, expected.evaluation.failCount),
    numericDiff("findings partial count", publication.evaluation.partialCount, expected.evaluation.partialCount),
    numericDiff("findings undeclared count", publication.evaluation.undeclaredCount, expected.evaluation.undeclaredCount),
    numericDiff("trial count", publication.history.trialCount, expected.history.trialCount),
    numericDiff("selection count", publication.history.selectionCount, expected.history.selectionCount),
    numericDiff("selected trial count", publication.history.selectedTrialCount, expected.history.selectedTrialCount),
    numericDiff("audit trail record count", publication.trail.recordCount, expected.trail.recordCount),
  ].filter((error): error is PublicationError => error !== undefined);
  if (canonicalString(publication.family) !== canonicalString(expected.family) || canonicalString(publication.evaluation) !== canonicalString(expected.evaluation) || canonicalString(publication.history) !== canonicalString(expected.history) || canonicalString(publication.trail) !== canonicalString(expected.trail)) {
    errors.push({ code: "invalid-publication", message: "a citation does not match the citation re-derived from the cited records' own members — the publication carries the records' own citations verbatim (ids, kinds, laws, digests)" });
  }
  if (canonicalString(publication.reproducibility) !== canonicalString(expected.reproducibility)) {
    errors.push({ code: "invalid-publication", message: "the reproducibility manifest does not match the manifest re-derived from the cited W022 fidelity verdicts — a verdict the cited record does not carry is an unbacked claim (spec/ARCHITECTURE-LOCK.md A6)" });
  }
  if (canonicalString(publication.scope) !== canonicalString(expected.scope)) {
    errors.push({ code: "scope-mismatch", message: "the published scope does not match the cited records' own explicit scope" });
  }
  if (canonicalString(publication.provenance.inputDigest) !== canonicalString(expected.provenance.inputDigest)) {
    errors.push({ code: "invalid-publication", message: "the published provenance input digest does not match the cited records' own identity" });
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return validateBenchmarkPublication(publication);
}
