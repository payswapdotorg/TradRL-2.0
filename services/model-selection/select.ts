/**
 * The empirical selection walk (W042) — `selectSubstrate`: the PURE,
 * deterministic, fail-closed derivation of the SelectionPlan. R050: the
 * substrate is SELECTED from measured evidence, never assumed. R052: a
 * capability-demand-free selection is refused, the law named. R054:
 * method-neutral — the walk ranks CARRIED evidence counts, never a
 * re-scored statistic (the W038 carry precedent). A9: same inputs ⇒
 * deep-equal plan and the same canonical id. The walk NEVER executes,
 * never trains, never runs a benchmark (A14: it composes the typed plan
 * W043/W044 consume).
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import {
  matchCapabilityDemand,
  validateCapabilityRegistry,
} from "capability-registry";
import type { CapabilityRegistry, RegistryEntry } from "capability-registry";
import { registryFingerprintOf, validateSkillSet } from "skills";
import type { SkillRecord } from "skills";
import type {
  BenchmarkCoverageProof,
  BenchmarkDescriptor,
  BenchmarkSplitAtom,
  BenchmarkSurface,
  CandidateRejection,
  ChainEvaluation,
  SelectionDemand,
  SelectionError,
  SelectionOutcome,
  SelectionPlan,
  SelectionVariant,
  SelectedCapability,
  SelectedSkill,
} from "./demand.js";
import { atomKey, validateBenchmarkCatalogue } from "./validate.js";
import { selectionIdOf } from "./identity.js";

type SubstrateDescriptor = import("organization-compiler").RegisteredSubstrate["substrate"];

interface WalkCandidate {
  readonly substrateId: string;
  readonly descriptor?: SubstrateDescriptor;
}

function error(input: Omit<SelectionError, "message"> & { readonly message: string }): SelectionError {
  return input;
}


function rejection(
  substrateId: string,
  code: CandidateRejection["code"],
  message: string,
  lifecycle?: CandidateRejection["lifecycle"],
): CandidateRejection {
  return { substrateId, code, message, ...(lifecycle === undefined ? {} : { lifecycle }) };
}

function byId(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
function byCapabilityId(left: SelectedCapability, right: SelectedCapability): number {
  return left.capabilityId < right.capabilityId ? -1 : left.capabilityId > right.capabilityId ? 1 : 0;
}
function bySkillId(left: SelectedSkill, right: SelectedSkill): number {
  return left.skillId < right.skillId ? -1 : left.skillId > right.skillId ? 1 : 0;
}

/** The split atoms of one evaluation aggregation (both sides, as data). */
function splitAtomsOf(evaluation: BenchmarkSurface["evaluations"][number]): ChainEvaluation["splits"] {
  return evaluation.holdoutSplits.map((aggregation) => ({ axisId: String(aggregation.axisId), kind: String(aggregation.kind), trainAtoms: [...aggregation.split.train], evaluationAtoms: [...aggregation.split.evaluation] }));
}

/**
 * THE empirical substrate selection walk. Deterministic (A9): candidates
 * walk in canonical substrate-id order, demands in canonical
 * capability-id order, benchmarks in canonical id order; every carried
 * list in the plan is canonically ordered — input order never leaks.
 */
export function selectSubstrate(
  demand: SelectionDemand,
  registry: CapabilityRegistry,
  skills: readonly SkillRecord[],
  benchmarks: BenchmarkSurface,
): SelectionOutcome {
  const errors: SelectionError[] = [];

  // --- Input gates: the upstream surfaces re-proved through their OWN gates.
  const registryValidation = validateCapabilityRegistry(registry);
  if (!registryValidation.ok) {
    errors.push(error({ code: "registry-invalid", message: `the capability registry violates ${String(registryValidation.errors.length)} registry law(s) — carried verbatim, nothing selected`, registryErrors: registryValidation.errors }));
  }
  const skillValidation = validateSkillSet(skills);
  if (!skillValidation.ok) {
    errors.push(error({ code: "skills-invalid", message: `the skill set violates ${String(skillValidation.errors.length)} skill law(s) — carried verbatim, nothing selected`, skillErrors: skillValidation.errors }));
  }
  const catalogueValidation = validateBenchmarkCatalogue(benchmarks.catalogue);
  if (!catalogueValidation.ok) {
    errors.push(error({ code: "catalogue-invalid", message: `the benchmark catalogue violates ${String(catalogueValidation.errors.length)} catalogue law(s) — carried verbatim, nothing selected`, catalogueErrors: catalogueValidation.errors }));
  }

  // --- The demand's own shape: explicit scope, named position, no duplicates.
  const scope = demand.scope;
  if (String(demand.position.title ?? "").trim() === "" || String(scope.tenantId ?? "").trim() === "" || String(scope.projectId ?? "").trim() === "" || String(scope.worldId ?? "").trim() === "") {
    errors.push(error({ code: "blank-demand-member", message: "the demand declares a blank title or scope member — a selection demand is explicit, never blank" }));
  }
  const seenCandidates = new Set<string>();
  for (const candidate of demand.candidates) {
    const id = String(candidate.substrate.substrateId);
    if (seenCandidates.has(id)) {
      errors.push(error({ code: "duplicate-candidate", message: `substrate '${id}' is registered twice in the demand's candidates — one substrate, one candidacy`, substrateId: id }));
      continue;
    }
    seenCandidates.add(id);
  }
  const seenPolicy = new Set<string>();
  for (const benchmarkId of demand.benchmarkPolicy) {
    const id = String(benchmarkId);
    if (seenPolicy.has(id)) {
      errors.push(error({ code: "duplicate-benchmark-policy", message: `benchmark '${id}' is demanded twice — one benchmark demanded once`, benchmarkId: id }));
      continue;
    }
    seenPolicy.add(id);
  }
  if (demand.position.capabilityDemands.length === 0) {
    errors.push(error({ code: "unmeasured-selection", message: "R052 (Capability discovery is EMPIRICAL): the demand declares no capability demand — a selection citing no measured evidence is REJECTED, never defaulted" }));
  }

  // --- Scope agreement (field equality, never parsed).
  if (String(registry.scope.tenantId) !== String(scope.tenantId) || String(registry.scope.projectId) !== String(scope.projectId) || String(registry.scope.worldId) !== String(scope.worldId)) {
    errors.push(error({ code: "scope-mismatch", message: `the demand declares scope (${String(scope.tenantId)}, ${String(scope.projectId)}, ${String(scope.worldId)}) which disagrees with the capability registry's — selection happens WHERE the capability was measured` }));
  }
  for (const skill of skills) {
    if (String(skill.scope.tenantId) !== String(scope.tenantId) || String(skill.scope.projectId) !== String(scope.projectId) || String(skill.scope.worldId) !== String(scope.worldId)) {
      errors.push(error({ code: "scope-mismatch", message: `skill '${String(skill.skillId)}' was extracted in a scope which disagrees with the demand's — skills are consumed WHERE they were measured` }));
    }
  }
  const reference = benchmarks.catalogue[0];
  if (reference !== undefined && (String(reference.scope.tenantId) !== String(scope.tenantId) || String(reference.scope.projectId) !== String(scope.projectId) || String(reference.scope.worldId) !== String(scope.worldId))) {
    errors.push(error({ code: "scope-mismatch", message: `the benchmark catalogue declares scope (${String(reference.scope.tenantId)}, ${String(reference.scope.projectId)}, ${String(reference.scope.worldId)}) which disagrees with the demand's — the catalogue is single-scope`, benchmarkId: String(reference.benchmarkId) }));
  }

  // --- The benchmark policy resolves against the catalogue (loud, never silent).
  const byBenchmarkId = new Map<string, BenchmarkDescriptor>();
  for (const benchmark of benchmarks.catalogue) byBenchmarkId.set(String(benchmark.benchmarkId), benchmark);
  for (const benchmarkId of demand.benchmarkPolicy) {
    if (!byBenchmarkId.has(String(benchmarkId))) {
      errors.push(error({ code: "unknown-benchmark", message: `the benchmark policy cites '${String(benchmarkId)}' which the catalogue does not declare — a selection is justified against DECLARED benchmarks only`, benchmarkId: String(benchmarkId) }));
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // --- The registry-level demand proofs (W040's own seam, reasons verbatim).
  const demands = [...demand.position.capabilityDemands]
    .map((entry) => ({ id: String(entry.capabilityId), demand: entry }))
    .sort((left, right) => byId(left, right));
  const declaredById = new Map<string, (typeof demand.capabilities)[number]>();
  for (const capability of demand.capabilities) declaredById.set(String(capability.capabilityId), capability);
  const matchEvidenceByDemand = new Map<string, readonly string[]>();
  for (const entry of demands) {
    const declared = declaredById.get(entry.id);
    if (declared === undefined) {
      errors.push(error({ code: "unknown-declared-capability", message: `the demand names organization capability '${entry.id}' which the demand's declared catalogue does not declare — a demand asks for a DECLARED capability` }));
      continue;
    }
    const match = matchCapabilityDemand(registry, { scope: { tenantId: String(scope.tenantId), projectId: String(scope.projectId), worldId: String(scope.worldId) }, capability: declared, demand: entry.demand });
    if (match.ok) {
      matchEvidenceByDemand.set(entry.id, match.evidence);
      continue;
    }
    const unprovided = match.reasons.find((reason) => reason.code === "unprovided-demand");
    if (unprovided !== undefined) {
      errors.push(error({ code: "unprovided-demand", message: `demand '${entry.id}': ${unprovided.message} — the selection is refused (fail-closed, never a silent skip)` }));
      continue;
    }
    errors.push(error({ code: "lifecycle-refused", message: `demand '${entry.id}' is provided only by deprecated/revoked capabilities — refused with the W040 lifecycle carried verbatim: ${match.reasons.map((reason) => reason.message).join("; ")}` }));
  }
  if (errors.length > 0) return { ok: false, errors };

  // --- The candidates: the demand's registered substrates ∪ the skill bearers.
  const candidates = new Map<string, WalkCandidate>();
  for (const registered of demand.candidates) {
    candidates.set(String(registered.substrate.substrateId), { substrateId: String(registered.substrate.substrateId), descriptor: registered.substrate });
  }
  for (const skill of skills) {
    if (skill.bearer.kind !== "substrate") continue; // body-class bearers are not substrate candidacies (W039 pairs bodies)
    const id = String(skill.bearer.substrateId);
    if (!candidates.has(id)) candidates.set(id, { substrateId: id });
  }
  const ordered = [...candidates.values()].sort((left, right) => (left.substrateId < right.substrateId ? -1 : left.substrateId > right.substrateId ? 1 : 0));

  const evaluationsById = new Map<string, BenchmarkSurface["evaluations"][number]>();
  for (const evaluation of benchmarks.evaluations) evaluationsById.set(String(evaluation.evaluationId), evaluation);
  const policyBenchmarks = [...seenPolicy].sort().map((id) => byBenchmarkId.get(id)!);
  const requirement = demand.position.substrateRequirement;
  const rejections: CandidateRejection[] = [];
  const eligible: {
    readonly candidate: WalkCandidate;
    readonly capabilities: readonly SelectedCapability[];
    readonly skills: readonly SelectedSkill[];
    readonly citations: number;
    readonly trajectoryEvidence: number;
    readonly coverage: readonly BenchmarkCoverageProof[];
    readonly evaluations: readonly ChainEvaluation[];
  }[] = [];

  for (const candidate of ordered) {
    const candidateRejections: CandidateRejection[] = [];
    let eligibleNow = true;

    // (1) Eligibility — the W039 substrate requirement, compared as data.
    if (candidate.descriptor === undefined) {
      candidateRejections.push(rejection(candidate.substrateId, "bearer-without-descriptor", `skill bearer '${candidate.substrateId}' has no registered W033 descriptor in the demand's candidates — eligibility cannot be proven, so the candidacy is refused loudly (never silently dropped)`));
      eligibleNow = false;
    } else {
      const substrate = candidate.descriptor;
      const failures: string[] = [];
      if (requirement.stateMode !== undefined && String(substrate.stateMode) !== String(requirement.stateMode)) {
        failures.push(`stateMode '${String(substrate.stateMode)}' ≠ required '${String(requirement.stateMode)}'`);
      }
      if (Number(substrate.decisionRate?.maxDecisionsPerView ?? 0) < Number(requirement.minMaxDecisionsPerView)) {
        failures.push(`decisionRate.maxDecisionsPerView ${String(substrate.decisionRate?.maxDecisionsPerView)} < required minimum ${String(requirement.minMaxDecisionsPerView)}`);
      }
      const missing = requirement.commandKinds.filter((kind) => !substrate.commandKinds.some((owned) => String(owned) === String(kind)));
      if (missing.length > 0) failures.push(`commandKinds missing [${missing.map(String).join(", ")}]`);
      if (failures.length > 0) {
        candidateRejections.push(rejection(candidate.substrateId, "requirement-incompatibility", `substrate '${candidate.substrateId}' fails the position's substrate requirement: ${failures.join("; ")}`));
        eligibleNow = false;
      }
    }

    // (2) Capability coverage — the candidate's OWN measured providers.
    const covering: SelectedCapability[] = [];
    const citedEvaluations = new Map<string, ChainEvaluation>();
    for (const entry of demands) {
      const providers = registry.entries.filter(
        (registryEntry: RegistryEntry) =>
          registryEntry.descriptor.bearer.kind === "substrate" &&
          String(registryEntry.descriptor.bearer.substrateId) === candidate.substrateId &&
          registryEntry.descriptor.providesOrganizationCapabilityIds.some((provided) => String(provided) === entry.id),
      );
      const live = providers.find((registryEntry) => registryEntry.state === "registered");
      if (live === undefined) {
        const dead = providers[0];
        if (dead === undefined) {
          candidateRejections.push(rejection(candidate.substrateId, "unprovided-demand", `substrate '${candidate.substrateId}' demonstrates no measured capability providing '${entry.id}' — R052: coverage without measurement is refused`));
        } else {
          candidateRejections.push(rejection(candidate.substrateId, dead.state === "deprecated" ? "capability-deprecated" : "capability-revoked", `substrate '${candidate.substrateId}' covers demand '${entry.id}' only through capability '${String(dead.descriptor.capabilityId)}' which is ${dead.state.toUpperCase()} — the W040 lifecycle is carried verbatim`, dead.transitions.map((transition) => ({ to: String(transition.to), reason: String(transition.reason) }))));
        }
        eligibleNow = false;
        continue;
      }
      covering.push({
        capabilityId: String(live.descriptor.capabilityId),
        name: String(live.descriptor.name),
        kind: String(live.descriptor.kind),
        domain: String(live.descriptor.domain),
        state: String(live.state),
        satisfiesDemandId: entry.id,
        provenance: live.descriptor.provenance.map((citation) => ({ experimentId: String(citation.experimentId), evaluationId: String(citation.evaluationId), findingsDigest: String(citation.findingsDigest) })),
        matchReasons: matchEvidenceByDemand.get(entry.id) ?? [],
      });
      for (const citation of live.descriptor.provenance) {
        const evaluation = evaluationsById.get(String(citation.evaluationId));
        if (evaluation === undefined) {
          errors.push(error({ code: "unknown-evaluation", message: `capability '${String(live.descriptor.capabilityId)}' cites evaluation '${String(citation.evaluationId)}' which the benchmark surface does not carry — the evidence chain resolves or the selection is refused (fail-closed)`, substrateId: candidate.substrateId }));
          continue;
        }
        if (String(evaluation.experimentId) !== String(citation.experimentId)) {
          errors.push(error({ code: "unknown-evaluation", message: `the surface's evaluation '${String(citation.evaluationId)}' binds experiment '${String(evaluation.experimentId)}' but the citation names '${String(citation.experimentId)}' — the evidence chain resolves or the selection is refused (fail-closed)`, substrateId: candidate.substrateId }));
          continue;
        }
        if (!citedEvaluations.has(String(evaluation.evaluationId))) {
          citedEvaluations.set(String(evaluation.evaluationId), {
            evaluationId: String(evaluation.evaluationId),
            experimentId: String(evaluation.experimentId),
            splits: splitAtomsOf(evaluation),
          });
        }
      }
    }
    if (errors.length > 0) return { ok: false, errors };

    // (3) The linked skills — the candidate's demonstrated, extracted skills.
    const linked = skills
      .filter((skill) => skill.bearer.kind === "substrate" && String(skill.bearer.substrateId) === candidate.substrateId)
      .map((skill): SelectedSkill => ({
        skillId: String(skill.skillId),
        capabilityId: String(skill.competence.capabilityId),
        trajectoryIds: skill.evidence.trajectoryIds.map(String),
        experimentIds: skill.evidence.experimentIds.map(String),
      }))
      .sort(bySkillId);

    // (4) Benchmark coverage — the cited evaluations' declared holdout atoms.
    const coverage: BenchmarkCoverageProof[] = [];
    for (const benchmark of policyBenchmarks) {
      const axes: BenchmarkCoverageProof["axes"][number][] = [];
      let failed = false;
      for (const axis of benchmark.requiredAxes) {
        const coverageEntries: BenchmarkCoverageProof["axes"][number]["coverage"][number][] = [];
        axis.atoms.forEach((atom, atomIndex) => {
          const requiredKey = atomKey(atom);
          for (const chain of citedEvaluations.values()) {
            const covered = chain.splits.some((split) =>
              [...split.trainAtoms, ...split.evaluationAtoms].some(
                (splitAtom: BenchmarkSplitAtom) => String(splitAtom.kind) === String(axis.kind) && atomKey(splitAtom) === requiredKey,
              ),
            );
            if (covered) {
              coverageEntries.push({ atomIndex, evaluationId: chain.evaluationId });
              break;
            }
          }
        });
        if (coverageEntries.length < axis.atoms.length) {
          const missing = axis.atoms.filter((_, index) => !coverageEntries.some((entry) => entry.atomIndex === index)).map((atom) => atomKey(atom));
          candidateRejections.push(rejection(candidate.substrateId, "benchmark-coverage-failure", `substrate '${candidate.substrateId}' does not cover benchmark '${String(benchmark.benchmarkId)}' axis '${String(axis.axisId)}' (${String(axis.kind)}): required atoms [${missing.join(", ")}] appear in no cited evaluation's declared holdout splits — the atoms are compared AS DATA, never assumed`));
          failed = true;
        }
        axes.push({ axisId: String(axis.axisId), kind: axis.kind, requiredAtomCount: axis.atoms.length, coveredAtomCount: coverageEntries.length, coverage: coverageEntries.sort((left, right) => left.atomIndex - right.atomIndex || (left.evaluationId < right.evaluationId ? -1 : 1)) });
      }
      if (!failed) {
        coverage.push({ benchmarkId: String(benchmark.benchmarkId), axes });
      } else {
        eligibleNow = false;
      }
    }

    if (!eligibleNow) {
      rejections.push(...candidateRejections);
      continue;
    }
    const citations = covering.reduce((total, capability) => total + capability.provenance.length, 0);
    const trajectoryEvidence = linked.reduce((total, skill) => total + skill.trajectoryIds.length, 0);
    eligible.push({ candidate, capabilities: covering.sort(byCapabilityId), skills: linked, citations, trajectoryEvidence, coverage, evaluations: [...citedEvaluations.values()].sort((left, right) => (left.evaluationId < right.evaluationId ? -1 : 1)) });
  }

  if (eligible.length === 0) {
    errors.push(error({ code: "no-eligible-candidate", message: `every candidate (${String(ordered.length)}) was rejected — no selection is derived; every rejection is carried (never a silent drop)`, rejections }));
    return { ok: false, errors };
  }

  // --- The deterministic rank: carried evidence counts, canonical-id tiebreaks.
  const ranked = [...eligible].sort((left, right) => {
    const byCitations = right.citations + right.trajectoryEvidence - (left.citations + left.trajectoryEvidence);
    if (byCitations !== 0) {
      return byCitations;
    }
    return left.candidate.substrateId < right.candidate.substrateId ? -1 : left.candidate.substrateId > right.candidate.substrateId ? 1 : 0;
  });
  const winner = ranked[0]!;
  const selectedCitations = winner.citations + winner.trajectoryEvidence;
  const variants: SelectionVariant[] = ranked.slice(1).map((entry) => ({
    kind: "model-substitution" as const,
    substituteSubstrateId: entry.candidate.substrateId,
    substituteDisplayName: String(entry.candidate.descriptor?.displayName ?? entry.candidate.substrateId),
    carriedCitations: entry.citations + entry.trajectoryEvidence,
    selectedCarriedCitations: selectedCitations,
  }));
  const plan: SelectionPlan = {
    selectionId: selectionIdOf({
      scope: { tenantId: String(scope.tenantId), projectId: String(scope.projectId), worldId: String(scope.worldId) },
      positionTitle: String(demand.position.title),
      substrateRequirement: requirement,
      bodyRequirement: demand.position.bodyRequirement,
      capabilityDemandIds: demands.map((entry) => entry.id),
      benchmarkPolicy: [...seenPolicy].sort(),
      candidateSubstrateIds: ordered.map((entry) => entry.substrateId),
      registryFingerprint: registryFingerprintOf(registry),
      skillIds: skills.map((skill) => String(skill.skillId)),
      benchmarkIds: [...byBenchmarkId.keys()].sort(),
      selectedSubstrateId: winner.candidate.substrateId,
    }),
    scope: { tenantId: String(scope.tenantId), projectId: String(scope.projectId), worldId: String(scope.worldId) },
    demandedBenchmarks: [...seenPolicy].sort(),
    selected: {
      selectedSubstrateId: winner.candidate.substrateId,
      selectedDisplayName: String(winner.candidate.descriptor?.displayName ?? winner.candidate.substrateId),
      capabilities: winner.capabilities,
      skills: winner.skills,
      evaluations: winner.evaluations,
      benchmarkCoverage: winner.coverage,
      totalCarriedCitations: selectedCitations,
    },
    ranking: ranked.map((entry) => ({
      substrateId: entry.candidate.substrateId,
      displayName: String(entry.candidate.descriptor?.displayName ?? entry.candidate.substrateId),
      carriedCitations: entry.citations + entry.trajectoryEvidence,
      coveredDemandCount: entry.capabilities.length,
      linkedSkillCount: entry.skills.length,
    })),
    rejections,
    variants,
  };
  return { ok: true, plan };
}
