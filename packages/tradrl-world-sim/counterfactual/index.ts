/**
 * Public surface of the W025 `counterfactual` module.
 *
 * Spec: spec/ARCHITECTURE.md §8 (counterfactual worlds — snapshot-derived
 * child worlds with explicit altered scenario rules) and §9 (branching);
 * spec/ARCHITECTURE-LOCK.md A8 (parent immutability — a counterfactual
 * branch never writes its parent), A9 (determinism — content-addressed
 * branch identity), A4/A15 (participants in branches use the same
 * CommandPort), A7 (the information firewall holds inside branches).
 *
 * Composition: the W016 snapshot/branch engine (../snapshot, ../branch —
 * the genesis state, the content-addressed capture, the restore path) and
 * the W017 generated market (the regime overlay drives the generator
 * through the branch's own clock), with the W023 participant protocol
 * attached branch-scoped (type-only; the runtime lives in
 * packages/tradrl-market-participants).
 *
 * NOTE (TL action item): this module is deliberately NOT re-exported from
 * the sim package root (packages/tradrl-world-sim/index.ts) and has no
 * `exports` entry in the package manifest — both files are outside W025's
 * frozen write surface. Import it directly:
 * `tradrl-world-sim/counterfactual` once registered, or the relative
 * `../counterfactual/index.js` from inside the package (the tests'
 * convention until then).
 */

export {
  CounterfactualBranchValidationError,
  counterfactualBranchDefinition,
  counterfactualEngineIdentity,
  counterfactualWorldIdFor,
  regimeEntryProblems,
  type AppliedCounterfactualOverlay,
  type CounterfactualBranch,
  type CounterfactualBranchRecord,
  type CounterfactualProblem,
  type CounterfactualScenarioOverlay,
  type InjectedInformationArtifact,
} from "./definition.js";
export {
  planCounterfactualBranch,
  type CounterfactualBranchPlan,
} from "./genesis.js";
export {
  createCounterfactualBranchEngine,
  createCounterfactualBranchTransport,
  type CounterfactualBranchHandle,
  type CounterfactualEngineFactory,
  type CreateCounterfactualBranchOptions,
  type CreateCounterfactualBranchTransportOptions,
} from "./engine.js";
export {
  branchDigestOf,
  compareBranchWithParentContinuation,
  compareCounterfactualBranches,
  counterfactualRecordDigest,
  type BranchAccountDiffEntry,
  type BranchDivergenceSummary,
  type BranchPositionDiffEntry,
  type CounterfactualBranchDigest,
  type DivergenceIdentity,
  type JournalDivergence,
  type ParentContinuationDivergence,
  type PortfolioDivergence,
  type PositionSide,
  type AccountSide,
  type SharedBranchOrigin,
} from "./comparison.js";
export {
  attachBranchParticipants,
  CounterfactualParticipantMismatchError,
  type BranchAgentAttribution,
  type BranchParticipantAttachment,
  type BranchParticipantRuntime,
  type BranchScopedParticipantTelemetry,
} from "./participants.js";
