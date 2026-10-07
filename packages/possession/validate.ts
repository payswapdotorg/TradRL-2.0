/**
 * The possession validators (W034): the PossessionDescriptor's own honesty
 * — the grant, the declared scope, and the two consumed descriptors
 * (W032 Body, W033 Substrate) delegated to their OWN validators with the
 * errors carried verbatim (never re-derived, never dropped).
 *
 * Spec: spec/REQUIREMENTS.md R051 — possession has compatibility evidence;
 * the evidence starts with a loudly valid declaration.
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — ids are opaque (never
 * parsed); membership is checked by exact string identity.
 *
 * Check order is deterministic (the `validateBodyAttachment` precedent):
 * possession identity → grant (who, channel, when, basis) → the consumed
 * descriptors (W032, then W033 — verbatim delegation) → the scope (no
 * duplicates, closed observation kinds, scope ⊆ embodiment, rate-grant
 * shape).
 */

import { BODY_OBSERVATION_KINDS } from "tradrl-world-contracts/agentBody";
import { validateBodyDescriptor } from "agent-body/validate";
import { validateSubstrateDescriptor } from "cognitive-substrate/validate";
import type {
  PossessionDescriptor,
  PossessionError,
  PossessionValidationOutcome,
} from "./contracts.js";
import { POSSESSION_CHANNELS } from "./contracts.js";

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function error(
  code: PossessionError["code"],
  message: string,
  field?: string,
): PossessionError {
  return { code, message, ...(field === undefined ? {} : { field }) };
}

function outcome(errors: readonly PossessionError[]): PossessionValidationOutcome {
  return errors.length === 0 ? { ok: true } : { ok: false, errors: [...errors] };
}

function checkNoDuplicates(
  values: readonly string[],
  list: string,
  errors: PossessionError[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(
        error(
          "duplicate-scope-entry",
          `${list} declares '${value}' more than once`,
          list,
        ),
      );
    }
    seen.add(value);
  }
}

/**
 * Structural validation of a possession descriptor: possession identity,
 * the grant, the consumed descriptors (W032/W033 validators, errors
 * verbatim), and the declared scope (⊆ the body's embodiment, closed
 * observation kinds, a well-formed rate grant).
 */
export function validatePossessionDescriptor(
  descriptor: PossessionDescriptor,
): PossessionValidationOutcome {
  const errors: PossessionError[] = [];
  const { body, substrate, grant, scope } = descriptor;

  // Possession identity.
  if (!isNonBlank(descriptor.possessionId)) {
    errors.push(
      error("blank-identity", "possessionId must be a non-blank string", "possessionId"),
    );
  }

  // The grant: who, through what channel, when, on what basis.
  if (!isNonBlank(grant.grantedBy)) {
    errors.push(
      error("blank-identity", "grant.grantedBy must be a non-blank principal identity", "grant.grantedBy"),
    );
  }
  if (!POSSESSION_CHANNELS.includes(grant.channel)) {
    errors.push(
      error(
        "unknown-channel",
        `grant.channel must be one of ${POSSESSION_CHANNELS.join(", ")} (got '${String(grant.channel)}')`,
        "grant.channel",
      ),
    );
  }
  if (!Number.isFinite(grant.grantedAt)) {
    errors.push(
      error(
        "non-finite-time",
        `grant.grantedAt must be a finite declared time (got '${String(grant.grantedAt)}')`,
        "grant.grantedAt",
      ),
    );
  }
  if (!isNonBlank(grant.basis)) {
    errors.push(
      error(
        "blank-basis",
        "grant.basis must be a non-empty declared basis (rationale as data, the §10 discipline)",
        "grant.basis",
      ),
    );
  }

  // The consumed descriptors: THEIR validators are the authority — the
  // errors are carried verbatim, one possession error each (never
  // re-derived, never dropped).
  const bodyOutcome = validateBodyDescriptor(body);
  if (!bodyOutcome.ok) {
    errors.push({
      code: "invalid-body",
      field: "body",
      message: `the embedded Body descriptor is invalid (${String(bodyOutcome.errors.length)} W032 error(s), carried verbatim)`,
      body: bodyOutcome.errors,
    });
  }
  const substrateOutcome = validateSubstrateDescriptor(substrate);
  if (!substrateOutcome.ok) {
    errors.push({
      code: "invalid-substrate",
      field: "substrate",
      message: `the embedded Cognitive Substrate descriptor is invalid (${String(substrateOutcome.errors.length)} W033 error(s), carried verbatim)`,
      substrate: substrateOutcome.errors,
    });
  }

  // The declared scope: explicit allow-lists, ⊆ the body's embodiment.
  checkNoDuplicates(scope.instruments, "scope.instruments", errors);
  checkNoDuplicates(scope.observations, "scope.observations", errors);
  checkNoDuplicates(scope.commandKinds, "scope.commandKinds", errors);
  const allowedObservations: readonly string[] = BODY_OBSERVATION_KINDS;
  for (const kind of scope.observations) {
    if (!allowedObservations.includes(kind)) {
      errors.push(
        error(
          "unknown-observation-kind",
          `scope.observations declares '${String(kind)}' which is not a BodyObservationKind`,
          "scope.observations",
        ),
      );
    }
  }
  for (const instrumentId of scope.instruments) {
    if (!body.embodiment.instruments.includes(instrumentId)) {
      errors.push(
        error(
          "scope-beyond-embodiment",
          `scope grants instrument '${String(instrumentId)}' which is outside the Body's embodiment`,
          "scope.instruments",
        ),
      );
    }
  }
  for (const kind of scope.commandKinds) {
    if (!body.embodiment.commandKinds.includes(kind)) {
      errors.push(
        error(
          "scope-beyond-embodiment",
          `scope grants command kind '${String(kind)}' which the Body's embodiment does not declare`,
          "scope.commandKinds",
        ),
      );
    }
  }

  // The optional possession-level rate grant (the DecisionRateEnvelope
  // shape, the W033 law).
  const rate = scope.decisionRate;
  if (rate !== undefined) {
    if (!Number.isInteger(rate.maxDecisionsPerView) || rate.maxDecisionsPerView < 1) {
      errors.push(
        error(
          "invalid-rate-grant",
          "scope.decisionRate.maxDecisionsPerView must be an integer ≥ 1",
          "scope.decisionRate.maxDecisionsPerView",
        ),
      );
    }
    if (
      rate.minViewIntervalMs !== undefined &&
      (!Number.isFinite(rate.minViewIntervalMs) || rate.minViewIntervalMs < 0)
    ) {
      errors.push(
        error(
          "invalid-rate-grant",
          "scope.decisionRate.minViewIntervalMs must be finite and ≥ 0 when present",
          "scope.decisionRate.minViewIntervalMs",
        ),
      );
    }
  }

  return outcome(errors);
}
