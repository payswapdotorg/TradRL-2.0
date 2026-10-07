/**
 * The shared decide machinery (W033): what every substrate's `decide` runs
 * around its pure core, so the contract laws hold by construction:
 *
 * - the observed view is validated fail-closed FIRST (a view beyond the
 *   grant is a typed error — the mind never sees it);
 * - the state-mode laws are enforced (stateless handed state is loud;
 *   declared-state without state is loud);
 * - the view digest is computed ONCE from the exact validated view the
 *   core consumed, and every decision cites it (the W028 chain
 *   discipline — the citation can never drift from the observation);
 * - decision ids are deterministic (`substrateId:viewDigest:index`) — the
 *   substrate invents no identity;
 * - command time is the view's `asOf` — the substrate reads no clock.
 */

import type {
  CognitiveSubstrateDescriptor,
  Decision,
  DecisionId,
  DecisionStream,
  ObservedBodyView,
  SubstrateDecisionOutcome,
  SubstrateError,
  ViewDigest,
} from "./contracts.js";
import { validateObservedView, viewDigestOf } from "./observedView.js";

function error(code: SubstrateError["code"], message: string): SubstrateError {
  return { code, message };
}

/**
 * A decision as emitted by a substrate core: the command, the rationale
 * and the confidence. The identity fields (`decisionId`, `viewDigest`)
 * are stamped by {@link finalizeDecisionStream} — never by the core.
 */
export interface ProposedDecision {
  readonly command: Decision["command"];
  readonly rationale: Decision["rationale"];
  readonly confidence: Decision["confidence"];
}

/** Everything a pure core needs: the descriptor, the validated view, its digest. */
export interface DecisionContext {
  readonly descriptor: CognitiveSubstrateDescriptor;
  readonly view: ObservedBodyView;
  readonly viewDigest: ViewDigest;
}

/** Compute the decision context (digest included) for a validated view. */
export function decisionContext(
  descriptor: CognitiveSubstrateDescriptor,
  view: ObservedBodyView,
): DecisionContext {
  return { descriptor, view, viewDigest: viewDigestOf(view) };
}

/**
 * Stamp the identity fields onto a core's proposals and assemble the
 * DecisionStream: deterministic ids, the exact view digest, the view's
 * asOf, the descriptor's identity and seed. The stream is returned exactly
 * as emitted — rate caps are NEVER applied here (a breach is the
 * validator's typed error, not a silent truncation).
 */
export function finalizeDecisionStream(
  context: DecisionContext,
  proposed: readonly ProposedDecision[],
): DecisionStream {
  const decisions: Decision[] = proposed.map((proposal, index) => ({
    decisionId: proposalId(context.descriptor, context.viewDigest, index),
    viewDigest: context.viewDigest,
    command: proposal.command,
    rationale: proposal.rationale,
    confidence: proposal.confidence,
  }));
  return {
    substrateId: context.descriptor.substrateId,
    seed: context.descriptor.seed,
    viewDigest: context.viewDigest,
    asOf: context.view.asOf,
    decisions,
  };
}

/** The deterministic decision-id law: `substrateId:viewDigest:index`. */
export function proposalId(
  descriptor: CognitiveSubstrateDescriptor,
  viewDigest: ViewDigest,
  index: number,
): DecisionId {
  return `${String(descriptor.substrateId)}:${viewDigest}:${String(index)}` as DecisionId;
}

/**
 * The fail-closed decide wrapper every substrate runs: validate the view,
 * then the state-mode laws, then hand the validated view to the pure core.
 * Cores never re-validate; they consume exactly what this gate admits.
 */
export function decideThroughContract(
  substrate: { readonly descriptor: CognitiveSubstrateDescriptor },
  input: { readonly view: ObservedBodyView; readonly state?: Readonly<Record<string, unknown>> },
  core: (context: DecisionContext, state: Readonly<Record<string, unknown>> | undefined) =>
    | { readonly ok: true; readonly proposed: readonly ProposedDecision[]; readonly state?: Readonly<Record<string, unknown>> }
    | { readonly ok: false; readonly errors: readonly SubstrateError[] },
): SubstrateDecisionOutcome {
  const viewErrors = validateObservedView(input.view);
  if (!viewErrors.ok) {
    return viewErrors;
  }
  const stateless = substrate.descriptor.stateMode === "stateless-per-view";
  if (stateless && input.state !== undefined) {
    return { ok: false, errors: [error("unexpected-state", "a stateless-per-view substrate takes no state — the caller must not track one")] };
  }
  if (!stateless && input.state === undefined) {
    return { ok: false, errors: [error("state-required", "a declared-state substrate requires its state (the prior next state, or the seed-derived initial state)")] };
  }
  const outcome = core(decisionContext(substrate.descriptor, input.view), input.state);
  if (!outcome.ok) {
    return { ok: false, errors: outcome.errors };
  }
  if (!stateless && outcome.state === undefined) {
    return {
      ok: false,
      errors: [error("malformed-state", "a declared-state substrate core must return its next state")],
    };
  }
  const context = decisionContext(substrate.descriptor, input.view);
  const stream = finalizeDecisionStream(context, outcome.proposed);
  return stateless
    ? { ok: true, stream }
    : { ok: true, stream, ...(outcome.state === undefined ? {} : { state: outcome.state }) };
}
