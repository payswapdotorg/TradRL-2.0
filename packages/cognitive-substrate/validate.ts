/**
 * The loud validators (W033): the substrate descriptor's structure, and the
 * decision stream against the BODY it would act through.
 *
 * Spec: spec/WORK-ITEMS.md W033 — "validation (loud typed errors: a
 * substrate producing commands outside the body's embodiment is invalid;
 * rate-envelope breaches are typed)". A stream that fails here is INVALID
 * — never silently clipped, never partially accepted.
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — the stream's commands must be
 * issued by the body's own seat, in the body's world, against the body's
 * account: a substrate cannot propose as anyone else.
 * Spec: spec/ARCHITECTURE-LOCK.md A9 — `issuedAt` must be the stream's
 * observation asOf (the substrate reads no clock; a mismatch is a typed
 * error). Spec: spec/ARCHITECTURE.md §10 — every decision carries its
 * rationale as data and a declared confidence ∈ [0,1] (never invented,
 * never defaulted — absent/malformed is invalid).
 */

import type { BodyCommandKind, BodyDescriptor } from "tradrl-world-contracts/agentBody";
import { BODY_COMMAND_KINDS } from "tradrl-world-contracts/agentBody";
import type {
  CognitiveSubstrateDescriptor,
  DecisionStream,
  DecisionStreamValidationError,
  DecisionStreamValidationOutcome,
  SubstrateError,
} from "./contracts.js";
import { stableDigest } from "tradrl-world-sim/world";

/** Validate a substrate descriptor's structure (all errors, or ok). */
export function validateSubstrateDescriptor(
  descriptor: CognitiveSubstrateDescriptor,
): { readonly ok: true } | { readonly ok: false; readonly errors: readonly SubstrateError[] } {
  const errors: SubstrateError[] = [];
  if (typeof descriptor.substrateId !== "string" || String(descriptor.substrateId).trim().length === 0) {
    errors.push({ code: "blank-identity", field: "substrateId", message: "substrateId must be a non-blank identity" });
  }
  if (typeof descriptor.seed !== "string" || descriptor.seed.length === 0) {
    errors.push({ code: "empty-seed", field: "seed", message: "seed must be a non-empty string (the determinism root, A9)" });
  }
  if (descriptor.stateMode !== "stateless-per-view" && descriptor.stateMode !== "declared-state") {
    errors.push({ code: "unknown-state-mode", field: "stateMode", message: `stateMode must be 'stateless-per-view' or 'declared-state' (got '${String(descriptor.stateMode)}')` });
  }
  const rate = descriptor.decisionRate;
  if (
    rate === undefined ||
    !Number.isInteger(rate.maxDecisionsPerView) ||
    rate.maxDecisionsPerView < 1
  ) {
    errors.push({ code: "invalid-rate-envelope", field: "decisionRate.maxDecisionsPerView", message: "maxDecisionsPerView must be an integer ≥ 1" });
  }
  if (rate !== undefined && rate.minViewIntervalMs !== undefined && (!Number.isFinite(rate.minViewIntervalMs) || rate.minViewIntervalMs < 0)) {
    errors.push({ code: "invalid-rate-envelope", field: "decisionRate.minViewIntervalMs", message: "minViewIntervalMs must be finite and ≥ 0 when present" });
  }
  const seen = new Set<string>();
  if (!Array.isArray(descriptor.commandKinds) || descriptor.commandKinds.length === 0) {
    errors.push({ code: "unknown-command-kind", field: "commandKinds", message: "commandKinds must be a non-empty list of the kinds this substrate may propose" });
  } else {
    for (const kind of descriptor.commandKinds) {
      if (!BODY_COMMAND_KINDS.includes(kind as BodyCommandKind)) {
        errors.push({ code: "unknown-command-kind", field: "commandKinds", message: `unknown command kind '${String(kind)}' (the closed set: ${BODY_COMMAND_KINDS.join(", ")})` });
      }
      if (seen.has(String(kind))) {
        errors.push({ code: "duplicate-command-kind", field: "commandKinds", message: `duplicate command kind '${String(kind)}'` });
      }
      seen.add(String(kind));
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function streamError(
  code: DecisionStreamValidationError["code"],
  message: string,
  field?: string,
  rate?: { readonly count: number; readonly max: number },
): DecisionStreamValidationError {
  return {
    code,
    message,
    ...(field === undefined ? {} : { field }),
    ...(rate === undefined ? {} : { rate }),
  };
}

/**
 * Validate one decision stream against the substrate descriptor it claims
 * to come from and the BODY it would act through. Every violation is
 * collected loudly; the outcome is ok only for a fully lawful stream.
 */
export function validateDecisionStream(
  stream: DecisionStream,
  body: BodyDescriptor,
  descriptor: CognitiveSubstrateDescriptor,
): DecisionStreamValidationOutcome {
  const errors: DecisionStreamValidationError[] = [];
  if (String(stream.substrateId) !== String(descriptor.substrateId)) {
    errors.push(streamError("substrate-mismatch", `stream claims substrate ${String(stream.substrateId)}, not ${String(descriptor.substrateId)}`, "substrateId"));
  }
  if (stream.seed !== descriptor.seed) {
    errors.push(streamError("seed-mismatch", `stream carries seed '${stream.seed}', not the descriptor's '${descriptor.seed}'`, "seed"));
  }
  if (stream.decisions.length > descriptor.decisionRate.maxDecisionsPerView) {
    errors.push(
      streamError(
        "rate-envelope-breach",
        `the stream emits ${String(stream.decisions.length)} decisions for one view — the declared cap is ${String(descriptor.decisionRate.maxDecisionsPerView)} (never silently truncated)`,
        "decisions",
        { count: stream.decisions.length, max: descriptor.decisionRate.maxDecisionsPerView },
      ),
    );
  }

  const embodiment = body.embodiment;
  const seenIds = new Set<string>();
  for (const [index, decision] of stream.decisions.entries()) {
    const at = `decisions[${String(index)}]`;
    const { command } = decision;
    if (String(decision.decisionId).length === 0) {
      errors.push(streamError("malformed-decision-id", `${at}.decisionId must be a non-empty identity`, `${at}.decisionId`));
    }
    if (seenIds.has(String(decision.decisionId))) {
      errors.push(streamError("duplicate-decision-id", `${at}.decisionId '${String(decision.decisionId)}' repeats`, `${at}.decisionId`));
    }
    seenIds.add(String(decision.decisionId));
    if (decision.viewDigest !== stream.viewDigest) {
      errors.push(streamError("view-digest-mismatch", `${at} cites view ${decision.viewDigest}, not its stream's ${stream.viewDigest} (the W028 chain discipline)`, `${at}.viewDigest`));
    }
    if (command.issuedAt !== stream.asOf) {
      errors.push(streamError("issued-at-mismatch", `${at}.command.issuedAt (${String(command.issuedAt)}) must be the view's asOf (${String(stream.asOf)}) — the substrate reads no clock`, `${at}.command.issuedAt`));
    }
    if (String(command.issuedBy) !== String(body.participantId)) {
      errors.push(streamError("issued-by-mismatch", `${at}.command is issued by ${String(command.issuedBy)}, not the body's seat ${String(body.participantId)}`, `${at}.command.issuedBy`));
    }
    if (String(command.worldId) !== String(body.scope.worldId)) {
      errors.push(streamError("world-mismatch", `${at}.command targets world ${String(command.worldId)}, not the body's ${String(body.scope.worldId)}`, `${at}.command.worldId`));
    }
    if (!descriptor.commandKinds.includes(command.kind)) {
      errors.push(streamError("command-kind-not-declared", `${at} proposes a '${command.kind}' command the substrate does not declare (declared: ${descriptor.commandKinds.join(", ")})`, `${at}.command.kind`));
    }
    if (!embodiment.commandKinds.includes(command.kind)) {
      errors.push(streamError("command-kind-not-in-embodiment", `${at} proposes a '${command.kind}' command outside the body's embodiment (embodied: ${embodiment.commandKinds.join(", ")})`, `${at}.command.kind`));
    }
    if (command.kind === "submit-order" || command.kind === "close-position") {
      if (String(command.accountId) !== String(body.accountId)) {
        errors.push(streamError("account-mismatch", `${at}.command targets account ${String(command.accountId)}, not the body's ${String(body.accountId)}`, `${at}.command.accountId`));
      }
    }
    if (command.kind === "submit-order" || command.kind === "close-position" || (command.kind === "add-annotation" && command.instrumentId !== undefined)) {
      const instrumentId = command.instrumentId as string;
      if (!embodiment.instruments.includes(instrumentId as never)) {
        errors.push(streamError("instrument-not-in-embodiment", `${at}.command touches instrument ${instrumentId}, outside the body's embodiment`, `${at}.command.instrumentId`));
      }
    }
    if (command.kind === "submit-order") {
      if (!embodiment.orderKinds.includes(command.submission.kind)) {
        errors.push(streamError("order-kind-not-in-embodiment", `${at} proposes a '${command.submission.kind}' order outside the body's embodied order kinds`, `${at}.command.submission.kind`));
      }
      if (!embodiment.timeInForce.includes(command.submission.constraints.timeInForce)) {
        errors.push(streamError("time-in-force-not-in-embodiment", `${at} proposes time-in-force '${command.submission.constraints.timeInForce}' outside the body's embodied set`, `${at}.command.submission.constraints.timeInForce`));
      }
    }
    const rationale = decision.rationale;
    if (
      rationale === undefined ||
      typeof rationale.rule !== "string" ||
      rationale.rule.length === 0 ||
      !Array.isArray(rationale.signals) ||
      rationale.signals.length === 0 ||
      typeof rationale.explanation !== "string" ||
      rationale.explanation.length === 0 ||
      !rationale.signals.every(
        (signal) =>
          typeof signal?.name === "string" &&
          signal.name.length > 0 &&
          (typeof signal.value === "string" ||
            typeof signal.value === "number" ||
            typeof signal.value === "boolean"),
      )
    ) {
      errors.push(streamError("malformed-rationale", `${at} must carry its rationale as data: a non-empty rule, at least one signal (named scalar values), a non-empty explanation (§10: decision metadata, never private chain-of-thought)`, `${at}.rationale`));
    }
    if (typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
      errors.push(streamError("invalid-confidence", `${at}.confidence must be a finite number in [0,1], declared by the substrate (got '${String(decision.confidence)}')`, `${at}.confidence`));
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * The content digest of one decision stream (the stream's own content
 * address — same W016 hashing family as the view digest and the W028
 * chain; downstream trajectories/experiments cite this).
 */
export function decisionStreamDigestOf(stream: DecisionStream): string {
  return stableDigest(stream);
}
