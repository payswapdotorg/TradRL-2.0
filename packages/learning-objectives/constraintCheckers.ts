/**
 * The constraint checkers (W036) — the per-kind pure evaluators over one
 * evidence stream.
 *
 * Every checker is deterministic and evidence-linked: it walks the stream's
 * capsules in order, reads exactly what its constraint's kind names, and
 * emits TYPED records (`HardConstraintViolation` / `SoftConstraintPenalty`)
 * — never strings. The canonical record order (capsule index, canonical
 * constraint kind, constraint id, code) is the total order the composed
 * evaluation sorts by.
 *
 * A13 discipline: the checkers never ENFORCE — the world runtime's own
 * gates rejected/allowed everything in the evidence already; the checkers
 * only MEASURE the evidence against the declared boundaries (including the
 * runtime's own recorded breaches, carried verbatim).
 *
 * FAIL-CLOSED: a checker that cannot read what its constraint requires (no
 * portfolio, mixed currencies, non-canonical decimals, non-positive equity)
 * throws its typed {@link CheckerReadError} — the composed evaluation
 * converts it to a `check-error`, never a silent zero.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { CommandId, TimestampMs } from "tradrl-world-contracts";
import type { DecisionId } from "tradrl-world-contracts/cognitiveSubstrate";
import type { EvidenceStream } from "./evidence.js";
import { portfolioSeriesOf } from "./money.js";
import type { PortfolioReading } from "./money.js";
import { compareDecimal, decimalToNumber, renderNumber } from "./decimal.js";
import { CONSTRAINT_KINDS } from "./constraints.js";
import type {
  AuthorizationGateConstraintSpec,
  ConstraintCheckError,
  DrawdownEnvelopeConstraintSpec,
  ExposureBudgetConstraintSpec,
  HardConstraintKind,
  HardConstraintViolation,
  RiskLimitConstraintSpec,
  SoftConstraintKind,
  SoftConstraintPenalty,
  SoftConstraintSpec,
  TurnoverBudgetConstraintSpec,
  VenuePolicyConstraintSpec,
} from "./constraints.js";

// ---------------------------------------------------------------------------
// The canonical record order + the record builders
// ---------------------------------------------------------------------------

interface OrderedRecord {
  readonly capsuleIndex: number;
  readonly kind: string;
  readonly constraintId: string;
  readonly code: string;
}

/** The canonical total order: capsule → kind → constraint id → code. */
export function canonicalRecordOrder(left: OrderedRecord, right: OrderedRecord): number {
  if (left.capsuleIndex !== right.capsuleIndex) {
    return left.capsuleIndex - right.capsuleIndex;
  }
  const kindDelta =
    CONSTRAINT_KINDS.indexOf(left.kind as never) - CONSTRAINT_KINDS.indexOf(right.kind as never);
  if (kindDelta !== 0) {
    return kindDelta;
  }
  const idDelta = left.constraintId.localeCompare(right.constraintId);
  if (idDelta !== 0) {
    return idDelta;
  }
  return left.code.localeCompare(right.code);
}

/** |quantity| as canonical decimal text (positions are signed). */
function absoluteQuantity(quantity: string): string {
  return quantity.startsWith("-") ? quantity.slice(1) : quantity;
}

/** A checker's own typed read failure (fail-closed, never a silent zero). */
export class CheckerReadError extends Error {
  constructor(
    readonly constraintId: string,
    readonly code: ConstraintCheckError["code"],
    message: string,
  ) {
    super(message);
  }
}

function hardViolation(
  constraintId: string,
  kind: HardConstraintKind,
  code: HardConstraintViolation["code"],
  limit: string,
  observed: string,
  capsuleIndex: number,
  occurredAt: TimestampMs,
  linkage?: { readonly decisionId: DecisionId; readonly commandId: CommandId },
): HardConstraintViolation {
  return {
    severity: "hard",
    constraintId,
    kind,
    code,
    limit,
    observed,
    capsuleIndex,
    occurredAt,
    ...(linkage === undefined ? {} : linkage),
  };
}

function softPenalty(
  constraintId: string,
  kind: SoftConstraintKind,
  code: SoftConstraintPenalty["code"],
  budget: string,
  magnitude: number,
  penalty: number,
  capsuleIndex: number,
  occurredAt: TimestampMs,
): SoftConstraintPenalty {
  return { severity: "soft", constraintId, kind, code, budget, magnitude, penalty, capsuleIndex, occurredAt };
}

function shapedPenalty(constraint: SoftConstraintSpec, magnitude: number): number {
  return constraint.penalty.shape === "linear"
    ? constraint.penalty.coefficient * magnitude
    : constraint.penalty.coefficient * magnitude * magnitude;
}

/** The money series a money-aware checker reads (fail-closed on failure). */
function requireReadings(constraintId: string, stream: EvidenceStream): readonly PortfolioReading[] {
  const series = portfolioSeriesOf(stream);
  if (!series.ok) {
    throw new CheckerReadError(constraintId, series.error.code, series.error.message);
  }
  return series.readings;
}

// ---------------------------------------------------------------------------
// The hard checkers
// ---------------------------------------------------------------------------

/** risk-limit: the A13 `RiskLimits` boundary, measured against evidence. */
export function checkRiskLimit(
  constraint: RiskLimitConstraintSpec,
  stream: EvidenceStream,
  violations: HardConstraintViolation[],
): void {
  const { constraintId, limits } = constraint;
  const needsSeries =
    limits.maxPositionQuantity !== undefined ||
    limits.maxGrossExposure !== undefined ||
    limits.maxDrawdown !== undefined ||
    limits.minBuyingPowerAfterOrder !== undefined;
  const readings = needsSeries ? requireReadings(constraintId, stream) : [];
  stream.capsules.forEach((capsule, index) => {
    // The runtime's own authoritative breach records, carried verbatim.
    for (const breach of capsule.resultingState.riskState?.breaches ?? []) {
      violations.push(
        hardViolation(
          constraintId,
          "risk-limit",
          "runtime-breach",
          "no runtime risk-gate breaches recorded",
          `${String(breach.gate)}: ${breach.detail}`,
          index,
          breach.occurredAt,
        ),
      );
    }
    // Proposed order quantities beyond the declared cap (exact compare).
    if (limits.maxOrderQuantity !== undefined) {
      for (const decision of capsule.pass.stream.decisions) {
        if (decision.command.kind !== "submit-order") {
          continue;
        }
        if (compareDecimal(decision.command.submission.quantity, limits.maxOrderQuantity) > 0) {
          violations.push(
            hardViolation(
              constraintId,
              "risk-limit",
              "order-quantity",
              `maxOrderQuantity ${limits.maxOrderQuantity}`,
              decision.command.submission.quantity,
              index,
              decision.command.issuedAt,
              { decisionId: decision.decisionId, commandId: decision.command.commandId },
            ),
          );
        }
      }
    }
    // Observed positions beyond the declared cap (exact compare).
    if (limits.maxPositionQuantity !== undefined) {
      for (const position of capsule.resultingState.portfolio?.positions ?? []) {
        const quantity = absoluteQuantity(position.quantity);
        if (compareDecimal(quantity as never, limits.maxPositionQuantity) > 0) {
          violations.push(
            hardViolation(
              constraintId,
              "risk-limit",
              "position-quantity",
              `maxPositionQuantity ${limits.maxPositionQuantity}`,
              quantity,
              index,
              capsule.pass.observedAt,
            ),
          );
        }
      }
    }
  });
  // The state-level aggregates over the settled readings.
  for (const reading of readings) {
    if (
      limits.maxGrossExposure !== undefined &&
      reading.grossExposure > decimalToNumber(limits.maxGrossExposure.amount)
    ) {
      violations.push(
        hardViolation(
          constraintId,
          "risk-limit",
          "gross-exposure",
          `maxGrossExposure ${limits.maxGrossExposure.amount} ${String(limits.maxGrossExposure.currency)}`,
          `${renderNumber(reading.grossExposure)} ${String(reading.currency)}`,
          reading.capsuleIndex,
          reading.asOf,
        ),
      );
    }
    if (
      limits.maxDrawdown !== undefined &&
      reading.drawdown > decimalToNumber(limits.maxDrawdown.amount)
    ) {
      violations.push(
        hardViolation(
          constraintId,
          "risk-limit",
          "drawdown",
          `maxDrawdown ${limits.maxDrawdown.amount} ${String(limits.maxDrawdown.currency)}`,
          `${renderNumber(reading.drawdown)} ${String(reading.currency)}`,
          reading.capsuleIndex,
          reading.asOf,
        ),
      );
    }
    if (
      limits.minBuyingPowerAfterOrder !== undefined &&
      reading.buyingPower < decimalToNumber(limits.minBuyingPowerAfterOrder.amount)
    ) {
      violations.push(
        hardViolation(
          constraintId,
          "risk-limit",
          "buying-power",
          `minBuyingPowerAfterOrder ${limits.minBuyingPowerAfterOrder.amount} ${String(limits.minBuyingPowerAfterOrder.currency)}`,
          `${renderNumber(reading.buyingPower)} ${String(reading.currency)}`,
          reading.capsuleIndex,
          reading.asOf,
        ),
      );
    }
  }
}

/** venue-policy: proposed order kinds outside the declared allow-list. */
export function checkVenuePolicy(
  constraint: VenuePolicyConstraintSpec,
  stream: EvidenceStream,
  violations: HardConstraintViolation[],
): void {
  const allowed = constraint.allowedOrderKinds.join("|");
  stream.capsules.forEach((capsule, index) => {
    for (const decision of capsule.pass.stream.decisions) {
      if (decision.command.kind !== "submit-order") {
        continue;
      }
      if (!constraint.allowedOrderKinds.includes(decision.command.submission.kind)) {
        violations.push(
          hardViolation(
            constraint.constraintId,
            "venue-policy",
            "order-kind-not-allowed",
            `allowedOrderKinds ${allowed}`,
            decision.command.submission.kind,
            index,
            decision.command.issuedAt,
            { decisionId: decision.decisionId, commandId: decision.command.commandId },
          ),
        );
      }
    }
  });
}

/** authorization-gate: observed authorize-stage denials (A13, as evidence). */
export function checkAuthorizationGate(
  constraint: AuthorizationGateConstraintSpec,
  stream: EvidenceStream,
  violations: HardConstraintViolation[],
): void {
  const boundary = `canTrade ${String(constraint.requiredPermissions.canTrade)}; canShort ${String(constraint.requiredPermissions.canShort)}; liveExecutionAllowed ${String(constraint.requiredPermissions.liveExecutionAllowed)}`;
  stream.capsules.forEach((capsule, index) => {
    for (const outcome of capsule.pass.outcomes) {
      if (outcome.result.status !== "rejected" || outcome.result.rejection.stage !== "authorize") {
        continue;
      }
      violations.push(
        hardViolation(
          constraint.constraintId,
          "authorization-gate",
          "authorization-denied",
          boundary,
          `${outcome.result.rejection.code}: ${outcome.result.rejection.message}`,
          index,
          capsule.pass.observedAt,
          { decisionId: outcome.decisionId, commandId: outcome.commandId },
        ),
      );
    }
  });
}

// ---------------------------------------------------------------------------
// The soft checkers (shaped penalties)
// ---------------------------------------------------------------------------

/** exposure-budget: gross exposure / equity over the declared fraction. */
export function checkExposureBudget(
  constraint: ExposureBudgetConstraintSpec,
  stream: EvidenceStream,
  penalties: SoftConstraintPenalty[],
): void {
  for (const reading of requireReadings(constraint.constraintId, stream)) {
    const magnitude = reading.grossExposure / reading.equity - constraint.maxGrossExposureFraction;
    if (magnitude > 0) {
      penalties.push(
        softPenalty(
          constraint.constraintId,
          "exposure-budget",
          "exposure-over-budget",
          `maxGrossExposureFraction ${renderNumber(constraint.maxGrossExposureFraction)}`,
          magnitude,
          shapedPenalty(constraint, magnitude),
          reading.capsuleIndex,
          reading.asOf,
        ),
      );
    }
  }
}

/** turnover-budget: issued commands per view over the declared budget. */
export function checkTurnoverBudget(
  constraint: TurnoverBudgetConstraintSpec,
  stream: EvidenceStream,
  penalties: SoftConstraintPenalty[],
): void {
  stream.capsules.forEach((capsule, index) => {
    const magnitude = capsule.pass.outcomes.length - constraint.maxCommandsPerView;
    if (magnitude > 0) {
      penalties.push(
        softPenalty(
          constraint.constraintId,
          "turnover-budget",
          "commands-over-budget",
          `maxCommandsPerView ${renderNumber(constraint.maxCommandsPerView)}`,
          magnitude,
          shapedPenalty(constraint, magnitude),
          index,
          capsule.pass.observedAt,
        ),
      );
    }
  });
}

/** drawdown-envelope: drawdown / peak equity over the declared fraction. */
export function checkDrawdownEnvelope(
  constraint: DrawdownEnvelopeConstraintSpec,
  stream: EvidenceStream,
  penalties: SoftConstraintPenalty[],
): void {
  for (const reading of requireReadings(constraint.constraintId, stream)) {
    const magnitude = reading.drawdown / reading.peakEquity - constraint.maxDrawdownFraction;
    if (magnitude > 0) {
      penalties.push(
        softPenalty(
          constraint.constraintId,
          "drawdown-envelope",
          "drawdown-over-envelope",
          `maxDrawdownFraction ${renderNumber(constraint.maxDrawdownFraction)}`,
          magnitude,
          shapedPenalty(constraint, magnitude),
          reading.capsuleIndex,
          reading.asOf,
        ),
      );
    }
  }
}
