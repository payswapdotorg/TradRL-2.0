/**
 * The Body validators (W032): descriptor structure, view ⊆ embodiment, and
 * the attach-time world binding. Every violation is collected loudly as a
 * typed error — complete outcomes, never a silent partial pass.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 — the envelope comparison is part of
 * ATTACH validation: a Body whose declared envelope exceeds its world's
 * declared limits never attaches (typed refusal, never a clip).
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — the binding checks prove the
 * Body occupies a REAL seat in the bound world: the participant exists,
 * the account exists, the instruments/venues exist, and the venue policies
 * admit every declared order kind.
 * Spec: spec/DOMAIN-MODEL.md "Identity laws" — ids are opaque (never
 * parsed); membership is checked by exact string identity.
 *
 * Check order is deterministic (the validateWorldDefinition precedent):
 * identity → embodiment closed sets → embodiment consistency → envelope
 * shape → world binding (world match, seat, account, instruments, venue
 * policies, tradability) → envelope vs world limits.
 */

import type { Instrument, Participant, Venue } from "tradrl-world-contracts";
import type { WorldDefinition } from "tradrl-world-sim/world";
import { resolveRiskLimits } from "tradrl-world-sim/risk";
import type {
  BodyDescriptor,
  BodyValidationOutcome,
  BodyValidationError,
  BodyView,
} from "./contracts.js";
import {
  BODY_COMMAND_KINDS,
  BODY_OBSERVATION_KINDS,
  BODY_ORDER_KINDS,
  BODY_TIME_IN_FORCE,
} from "./contracts.js";
import {
  compareRiskEnvelopeToWorldLimits,
  validateRiskEnvelopeShape,
} from "./envelope.js";

function isNonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function outcome(errors: readonly BodyValidationError[]): BodyValidationOutcome {
  return errors.length === 0 ? { ok: true } : { ok: false, errors: [...errors] };
}

function error(code: BodyValidationError["code"], message: string, field?: string): BodyValidationError {
  return { code, message, ...(field === undefined ? {} : { field }) };
}

function checkNoDuplicates(
  values: readonly string[],
  list: string,
  errors: BodyValidationError[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      errors.push(
        error(
          "duplicate-embodiment-entry",
          `${list} declares '${value}' more than once`,
          list,
        ),
      );
    }
    seen.add(value);
  }
}

function checkClosedSet(
  values: readonly string[],
  closed: readonly string[],
  list: string,
  code: "unknown-command-kind" | "unknown-order-kind" | "unknown-time-in-force",
  errors: BodyValidationError[],
): void {
  for (const value of values) {
    if (!closed.includes(value)) {
      errors.push(
        error(code, `${list} declares '${value}' which is not in the closed ${list} set for World Alpha`, list),
      );
    }
  }
}

/**
 * Structural validation of a Body descriptor: identity, embodiment closed
 * sets, embodiment consistency, envelope shape. World-independent — this
 * is the descriptor's own honesty.
 */
export function validateBodyDescriptor(
  descriptor: BodyDescriptor,
): BodyValidationOutcome {
  const errors: BodyValidationError[] = [];
  const { embodiment } = descriptor;

  if (!isNonBlank(descriptor.bodyId)) {
    errors.push(error("blank-identity", "bodyId must be a non-blank string", "bodyId"));
  }
  if (!isNonBlank(descriptor.participantId)) {
    errors.push(error("blank-identity", "participantId must be a non-blank string", "participantId"));
  }
  if (!isNonBlank(descriptor.accountId)) {
    errors.push(error("blank-identity", "accountId must be a non-blank string", "accountId"));
  }
  const scope = descriptor.scope;
  if (
    !isNonBlank(scope.tenantId) ||
    !isNonBlank(scope.projectId) ||
    !isNonBlank(scope.worldId)
  ) {
    errors.push(error("blank-identity", "scope ids must be non-blank strings", "scope"));
  }

  checkNoDuplicates(embodiment.instruments, "embodiment.instruments", errors);
  checkNoDuplicates(embodiment.venues, "embodiment.venues", errors);
  checkNoDuplicates(embodiment.orderKinds, "embodiment.orderKinds", errors);
  checkNoDuplicates(embodiment.timeInForce, "embodiment.timeInForce", errors);
  checkNoDuplicates(embodiment.commandKinds, "embodiment.commandKinds", errors);
  checkClosedSet(embodiment.commandKinds, BODY_COMMAND_KINDS, "embodiment.commandKinds", "unknown-command-kind", errors);
  checkClosedSet(embodiment.orderKinds, BODY_ORDER_KINDS, "embodiment.orderKinds", "unknown-order-kind", errors);
  checkClosedSet(embodiment.timeInForce, BODY_TIME_IN_FORCE, "embodiment.timeInForce", "unknown-time-in-force", errors);

  // Embodiment consistency: submission authority and submission reach are
  // one declaration. A Body that may submit orders must declare at least
  // one instrument desk, one order kind and one time-in-force (an order
  // REQUIRES constraints.timeInForce); conversely, declared order kinds or
  // TIFs without the submit-order command are dead declarations.
  const maySubmit = embodiment.commandKinds.includes("submit-order");
  if (maySubmit && embodiment.instruments.length === 0) {
    errors.push(
      error(
        "embodiment-consistency",
        "a Body with the submit-order command must declare at least one instrument",
        "embodiment.instruments",
      ),
    );
  }
  if (embodiment.instruments.length > 0 && embodiment.venues.length === 0) {
    errors.push(
      error(
        "embodiment-consistency",
        "a Body that touches instruments must declare the venues it reaches",
        "embodiment.venues",
      ),
    );
  }
  if (maySubmit && embodiment.orderKinds.length === 0) {
    errors.push(
      error(
        "embodiment-consistency",
        "a Body with the submit-order command must declare at least one order kind",
        "embodiment.orderKinds",
      ),
    );
  }
  if (maySubmit && embodiment.timeInForce.length === 0) {
    errors.push(
      error(
        "embodiment-consistency",
        "a Body with the submit-order command must declare at least one time-in-force",
        "embodiment.timeInForce",
      ),
    );
  }
  if (!maySubmit && embodiment.orderKinds.length > 0) {
    errors.push(
      error(
        "embodiment-consistency",
        "declared order kinds are dead without the submit-order command",
        "embodiment.orderKinds",
      ),
    );
  }
  if (!maySubmit && embodiment.timeInForce.length > 0) {
    errors.push(
      error(
        "embodiment-consistency",
        "declared time-in-force policies are dead without the submit-order command",
        "embodiment.timeInForce",
      ),
    );
  }

  errors.push(...validateRiskEnvelopeShape(descriptor.riskEnvelope, "riskEnvelope"));
  return outcome(errors);
}

/**
 * View ⊆ descriptor: the view may be declared tighter than the embodiment,
 * never wider. Checks identity match (bodyId/worldId/accountId), the
 * closed observation-kind set, and instruments within the embodiment.
 */
export function validateBodyView(
  view: BodyView,
  descriptor: BodyDescriptor,
): BodyValidationOutcome {
  const errors: BodyValidationError[] = [];
  if (view.bodyId !== descriptor.bodyId) {
    errors.push(error("scope-mismatch", "view.bodyId must match the descriptor's bodyId", "view.bodyId"));
  }
  if (view.worldId !== descriptor.scope.worldId) {
    errors.push(error("scope-mismatch", "view.worldId must match the descriptor's world", "view.worldId"));
  }
  if (view.accountId !== descriptor.accountId) {
    errors.push(
      error("scope-mismatch", "view.accountId must match the descriptor's account", "view.accountId"),
    );
  }
  const declaredKinds: readonly string[] = view.observations;
  const allowed: readonly string[] = BODY_OBSERVATION_KINDS;
  for (const kind of declaredKinds) {
    if (!allowed.includes(kind)) {
      errors.push(
        error(
          "unknown-observation-kind",
          `view.observations declares '${kind}' which is not a BodyObservationKind`,
          "view.observations",
        ),
      );
    }
  }
  for (const instrument of view.instruments) {
    if (!descriptor.embodiment.instruments.includes(instrument)) {
      errors.push(
        error(
          "view-beyond-embodiment",
          `view grants instrument '${instrument}' which is outside the Body's embodiment`,
          "view.instruments",
        ),
      );
    }
  }
  return outcome(errors);
}

/**
 * The attach-time validation: the full binding of a Body to a world —
 * descriptor structure, the world's participant seat, the account, the
 * instruments/venues, the venue policies, account tradability, and the
 * envelope vs the world's declared limits. Every violation is collected;
 * the attach decision is exactly this outcome.
 */
export function validateBodyAttachment(
  descriptor: BodyDescriptor,
  world: WorldDefinition,
): BodyValidationOutcome {
  const errors: BodyValidationError[] = [];

  // Descriptor structure first (the world checks below assume closed sets
  // hold); structural failures are reported by themselves when binding
  // cannot proceed meaningfully.
  const structural = validateBodyDescriptor(descriptor);
  if (!structural.ok) {
    return structural;
  }

  if (descriptor.scope.worldId !== world.scope.worldId) {
    errors.push(
      error(
        "world-mismatch",
        `descriptor is bound to world ${String(descriptor.scope.worldId)} but validated against world ${String(world.scope.worldId)}`,
        "scope.worldId",
      ),
    );
    return outcome(errors);
  }

  // The seat: the Body occupies a REAL participant of this world, on the
  // account it declared, with the kind it declared.
  const seat: Participant | undefined = world.participants.find(
    (candidate) => candidate.participantId === descriptor.participantId,
  );
  if (seat === undefined) {
    errors.push(
      error(
        "unknown-participant",
        `participant ${String(descriptor.participantId)} is not declared in the world`,
        "participantId",
      ),
    );
  } else {
    if (seat.accountId !== descriptor.accountId) {
      errors.push(
        error(
          "participant-account-mismatch",
          `participant ${String(descriptor.participantId)} trades account ${String(seat.accountId)} in the world, but the descriptor declares ${String(descriptor.accountId)}`,
          "accountId",
        ),
      );
    }
    if (seat.kind !== descriptor.participantKind) {
      errors.push(
        error(
          "participant-kind-mismatch",
          `participant ${String(descriptor.participantId)} is a '${seat.kind}' seat in the world, but the descriptor declares '${descriptor.participantKind}'`,
          "participantKind",
        ),
      );
    }
  }

  const account = world.accounts.find(
    (candidate) => candidate.accountId === descriptor.accountId,
  );
  if (account === undefined) {
    errors.push(
      error(
        "unknown-account",
        `account ${String(descriptor.accountId)} is not declared in the world`,
        "accountId",
      ),
    );
  } else if (
    descriptor.embodiment.commandKinds.includes("submit-order") &&
    account.permissions.canTrade !== true
  ) {
    errors.push(
      error(
        "account-not-tradable",
        `account ${String(descriptor.accountId)} does not permit trading (permissions.canTrade), so a Body with the submit-order command cannot attach to it`,
        "accountId",
      ),
    );
  }

  // The desks: every embodied instrument exists, and each one sits on a
  // venue the Body declared.
  const instrumentsById = new Map<string, Instrument>(
    world.instruments.map((instrument) => [String(instrument.instrumentId), instrument]),
  );
  for (const instrumentId of descriptor.embodiment.instruments) {
    const instrument = instrumentsById.get(String(instrumentId));
    if (instrument === undefined) {
      errors.push(
        error(
          "unknown-instrument",
          `instrument ${String(instrumentId)} is not declared in the world`,
          "embodiment.instruments",
        ),
      );
      continue;
    }
    if (!descriptor.embodiment.venues.includes(instrument.venueId)) {
      errors.push(
        error(
          "instrument-venue-mismatch",
          `instrument ${String(instrumentId)} trades on venue ${String(instrument.venueId)} which is outside the Body's declared venues`,
          "embodiment.venues",
        ),
      );
    }
  }

  // The venues: when the world declares venues, every embodied venue must
  // exist and its policy must admit every declared order kind for the
  // instruments the Body touches on it. Worlds without venue declarations
  // run the documented default policy (all kinds — W014 seam).
  const venuesById = new Map<string, Venue | undefined>(
    world.venues === undefined
      ? []
      : world.venues.map((venue) => [String(venue.venueId), venue]),
  );
  if (world.venues !== undefined) {
    for (const venueId of descriptor.embodiment.venues) {
      if (!venuesById.get(String(venueId))) {
        errors.push(
          error(
            "unknown-venue",
            `venue ${String(venueId)} is not declared in the world`,
            "embodiment.venues",
          ),
        );
      }
    }
  }
  for (const instrumentId of descriptor.embodiment.instruments) {
    const instrument = instrumentsById.get(String(instrumentId));
    if (instrument === undefined) {
      continue;
    }
    const venue = venuesById.get(String(instrument.venueId));
    if (venue === undefined) {
      continue;
    }
    for (const orderKind of descriptor.embodiment.orderKinds) {
      if (!venue.allowedOrderKinds.includes(orderKind)) {
        errors.push(
          error(
            "order-kind-not-allowed",
            `venue ${String(venue.venueId)} does not accept '${orderKind}' orders (allowed: ${venue.allowedOrderKinds.join(", ")})`,
            "embodiment.orderKinds",
          ),
        );
      }
    }
  }

  // The envelope vs the world's declared limits (A13: invalid at attach,
  // never silently clipped). Unset world limits are not enforced.
  const worldLimits = resolveRiskLimits(world.riskLimits, String(descriptor.accountId));
  errors.push(
    ...compareRiskEnvelopeToWorldLimits(
      descriptor.riskEnvelope,
      worldLimits,
      String(descriptor.accountId),
    ),
  );

  return outcome(errors);
}
