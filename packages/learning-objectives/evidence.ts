/**
 * The §10 evidence capsule chain (W036) — the typed evidence REWARD is a
 * function over.
 *
 * Spec: spec/ARCHITECTURE.md §10 Evidence — "An evidence capsule connects:
 * observation → decision metadata → action → resulting state. No private
 * model chain-of-thought is stored." The W035 agent-world session already
 * records the first three links as data (the `AgentPassRecord`: the settled
 * observation with its grant and view digest; the decision stream with its
 * rationale-as-data; the admission gate's outcome; the issued commands'
 * typed outcomes). This module completes the chain — the RESULTING STATE
 * (the settled post-action account read: portfolio + risk) — and binds all
 * four links into one capsule, then orders capsules into the evidence
 * stream every evaluation in this package consumes.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6 — event-driven truth: the capsule
 * cites digests and typed outcomes only; it re-proves nothing about UI
 * state. Spec: A7 — the resulting state is a SETTLED read (asOf at or after
 * the pass's observation instant; never mid-flight, never future-dated
 * relative to the read). Spec: A9 — determinism: capsules carry only
 * simulation-time instants and upstream deterministic digests; validating
 * and reading them is pure.
 *
 * FAIL-CLOSED (the seam law): malformed evidence NEVER silently scores —
 * `validateEvidenceStream` returns typed, closed-set errors, and every
 * evaluation seam in this package runs it first.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { AgentPassRecord, AgentSessionTelemetry } from "agent-world-protocol";
import type {
  Money,
  Portfolio,
  RiskState,
  TimestampMs,
} from "tradrl-world-contracts";
import { isCanonicalDecimal } from "./decimal.js";

/** The possession identity of the agent that produced the evidence. */
export type EvidencePossessionId = AgentSessionTelemetry["possessionId"];

/**
 * The fourth §10 link: the settled post-action account read. At least one
 * of `portfolio` / `riskState` must be present (an empty resulting state is
 * malformed evidence — `empty-resulting-state`).
 */
export interface ResultingState {
  /** The settled simulation instant the read was taken at. */
  readonly asOf: TimestampMs;
  /** The account's portfolio (financial state) at `asOf`. */
  readonly portfolio?: Portfolio;
  /** The account's authoritative risk state at `asOf`. */
  readonly riskState?: RiskState;
}

/**
 * One §10 evidence capsule: the W035 pass record (observation → decision
 * metadata → admission → action, verbatim — the pass IS the chain's first
 * three links as data) plus the resulting state read taken after the pass
 * settled.
 */
export interface EvidenceCapsule {
  readonly pass: AgentPassRecord;
  readonly resultingState: ResultingState;
}

/** The ordered evidence of one agent-world session (oldest pass first). */
export interface EvidenceStream {
  /** The world identity (the client world the session was attached to). */
  readonly worldId: string;
  readonly possessionId: EvidencePossessionId;
  /** Ordered by strictly increasing pass number. Never empty. */
  readonly capsules: readonly EvidenceCapsule[];
}

/** One typed evidence-validation error (closed set; capsule-linked). */
export interface EvidenceError {
  readonly code: EvidenceErrorCode;
  readonly message: string;
  /** Present when the error belongs to one capsule (its stream index). */
  readonly capsuleIndex?: number;
}

export type EvidenceErrorCode =
  | "empty-stream" // no capsules: reward over nothing is never silently scored
  | "pass-out-of-order" // pass numbers not strictly increasing
  | "non-finite-as-of" // a non-finite observation/resulting instant
  | "state-precedes-action" // the resulting state was read before the observation
  | "decision-view-mismatch" // a decision citing a view other than its pass's
  | "account-mismatch" // the resulting state is not the observed account's
  | "world-mismatch" // the capsule/stream world identities disagree
  | "empty-resulting-state" // neither portfolio nor risk state present
  | "malformed-decimal" // a consumed money/quantity field is not canonical decimal text
  | "state-count-mismatch"; // the session builder's passes/states pairing failed

/** The validation outcome: all errors, or ok (never a silent partial pass). */
export type EvidenceStreamValidationOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly EvidenceError[] };

/** The consumed money/quantity fields of one portfolio (the read surface). */
function portfolioMoneyFields(portfolio: Portfolio): string[] {
  const fields = [
    portfolio.equity.amount,
    portfolio.realizedPnl.amount,
    portfolio.unrealizedPnl.amount,
    portfolio.buyingPower.amount,
  ];
  for (const position of portfolio.positions) {
    fields.push(position.quantity, position.averageEntryPrice);
    if (position.markPrice !== undefined) {
      fields.push(position.markPrice);
    }
  }
  return fields;
}

/** Validate one stream: identity, ordering, the four-link consistency laws. */
export function validateEvidenceStream(stream: EvidenceStream): EvidenceStreamValidationOutcome {
  const errors: EvidenceError[] = [];
  if (stream.capsules.length === 0) {
    errors.push({
      code: "empty-stream",
      message:
        "[learning-objectives] the evidence stream carries no capsules — an empty trajectory is never silently scored (fail-closed)",
    });
    return { ok: false, errors };
  }
  let previousPass: number | undefined;
  stream.capsules.forEach((capsule, index) => {
    const label = `capsule ${String(index)} (pass ${String(capsule.pass.pass)})`;
    if (previousPass !== undefined && capsule.pass.pass <= previousPass) {
      errors.push({
        code: "pass-out-of-order",
        message: `${label}: pass numbers must strictly increase (${String(capsule.pass.pass)} after ${String(previousPass)})`,
        capsuleIndex: index,
      });
    }
    previousPass = capsule.pass.pass;

    if (!Number.isFinite(Number(capsule.pass.observedAt))) {
      errors.push({
        code: "non-finite-as-of",
        message: `${label}: the observation instant is not finite`,
        capsuleIndex: index,
      });
    }
    if (!Number.isFinite(Number(capsule.resultingState.asOf))) {
      errors.push({
        code: "non-finite-as-of",
        message: `${label}: the resulting-state instant is not finite`,
        capsuleIndex: index,
      });
    } else if (Number(capsule.resultingState.asOf) < Number(capsule.pass.observedAt)) {
      errors.push({
        code: "state-precedes-action",
        message: `${label}: the resulting state (${String(capsule.resultingState.asOf)}) precedes the observation (${String(capsule.pass.observedAt)}) — the fourth §10 link cannot run backwards`,
        capsuleIndex: index,
      });
    }

    // The citation law: every decision cites the view its pass observed.
    capsule.pass.stream.decisions.forEach((decision, decisionIndex) => {
      if (decision.viewDigest !== capsule.pass.observation.viewDigest) {
        errors.push({
          code: "decision-view-mismatch",
          message: `${label}: decision ${String(decisionIndex)} (${String(decision.decisionId)}) cites view ${String(decision.viewDigest)} but the pass observed ${String(capsule.pass.observation.viewDigest)}`,
          capsuleIndex: index,
        });
      }
    });

    // Identity laws: the resulting state is the observed account, in the
    // stream's world.
    const view = capsule.pass.observation.view;
    const { portfolio, riskState } = capsule.resultingState;
    if (portfolio === undefined && riskState === undefined) {
      errors.push({
        code: "empty-resulting-state",
        message: `${label}: the resulting state carries neither a portfolio nor a risk state`,
        capsuleIndex: index,
      });
    }
    if (portfolio !== undefined) {
      if (portfolio.accountId !== view.accountId) {
        errors.push({
          code: "account-mismatch",
          message: `${label}: the resulting portfolio is account ${String(portfolio.accountId)} but the view is account ${String(view.accountId)}`,
          capsuleIndex: index,
        });
      }
      if (String(portfolio.worldId) !== String(view.worldId)) {
        errors.push({
          code: "world-mismatch",
          message: `${label}: the resulting portfolio is world ${String(portfolio.worldId)} but the view is world ${String(view.worldId)}`,
          capsuleIndex: index,
        });
      }
      for (const field of portfolioMoneyFields(portfolio)) {
        if (!isCanonicalDecimal(field)) {
          errors.push({
            code: "malformed-decimal",
            message: `${label}: a consumed portfolio field is not canonical decimal text ('${field}')`,
            capsuleIndex: index,
          });
          break;
        }
      }
    }
    if (riskState !== undefined) {
      if (riskState.accountId !== view.accountId) {
        errors.push({
          code: "account-mismatch",
          message: `${label}: the resulting risk state is account ${String(riskState.accountId)} but the view is account ${String(view.accountId)}`,
          capsuleIndex: index,
        });
      }
      if (String(riskState.worldId) !== String(view.worldId)) {
        errors.push({
          code: "world-mismatch",
          message: `${label}: the resulting risk state is world ${String(riskState.worldId)} but the view is world ${String(view.worldId)}`,
          capsuleIndex: index,
        });
      }
    }
    if (String(view.worldId) !== stream.worldId) {
      errors.push({
        code: "world-mismatch",
        message: `${label}: the observed world ${String(view.worldId)} is not the stream's world ${stream.worldId}`,
        capsuleIndex: index,
      });
    }
  });
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/** Build one capsule from a completed W035 pass and its settled state read. */
export function evidenceCapsuleOf(
  pass: AgentPassRecord,
  resultingState: ResultingState,
): EvidenceCapsule {
  return { pass, resultingState };
}

/** Assemble a stream (validation is a separate, explicit step). */
export function evidenceStreamOf(
  worldId: string,
  possessionId: EvidencePossessionId,
  capsules: readonly EvidenceCapsule[],
): EvidenceStream {
  return { worldId, possessionId, capsules };
}

/** The session-builder outcome (the pairing law, fail-closed). */
export type EvidenceStreamOfSessionOutcome =
  | { readonly ok: true; readonly stream: EvidenceStream }
  | { readonly ok: false; readonly errors: readonly EvidenceError[] };

/**
 * Build the evidence stream of one COMPLETED session: one resulting-state
 * read per pass, in pass order (the W037 trajectory capture discipline,
 * contract-side). A count mismatch is a typed error — capsules are never
 * silently paired with the wrong state.
 */
export function evidenceStreamOfSession(
  telemetry: AgentSessionTelemetry,
  resultingStates: readonly ResultingState[],
): EvidenceStreamOfSessionOutcome {
  if (telemetry.passes.length !== resultingStates.length) {
    return {
      ok: false,
      errors: [
        {
          code: "state-count-mismatch",
          message: `[learning-objectives] the session completed ${String(telemetry.passes.length)} pass(es) but ${String(resultingStates.length)} resulting-state read(s) were supplied — the pairing is one state per pass, fail-closed`,
        },
      ],
    };
  }
  const capsules = telemetry.passes.map((pass, index) =>
    evidenceCapsuleOf(pass, resultingStates[index] as ResultingState),
  );
  return {
    ok: true,
    stream: evidenceStreamOf(telemetry.worldId, telemetry.possessionId, capsules),
  };
}

/** Render one money value deterministically (record rendering only). */
export function renderMoney(money: Money): string {
  return `${String(money.currency)} ${money.amount}`;
}
