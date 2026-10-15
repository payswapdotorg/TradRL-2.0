/**
 * The reward component evaluators (W036) — the closed set of PURE functions
 * over evidence, one per {@link RewardComponentKind}.
 *
 * Every component is a deterministic table: given the validated evidence
 * stream it reads exactly what its kind names, computes ONE raw value in
 * the kind's own raw unit, and records its provenance (which capsules, what
 * readings) as data. The raw value is normalized by the declared scale into
 * the [-1, +1] score at the reward seam (`reward.ts`) — never here.
 *
 * The money-reading discipline the money-aware components share
 * (`portfolioSeriesOf`, `money.ts`) is the single place decimal truth
 * becomes evaluation inputs: one currency, canonical text, positive finite
 * equity, and the deterministic peak/drawdown fold.
 *
 * EXPLICIT NEUTRAL (disclosed, not a silent default): the execution-quality
 * component over a stream that issued NO commands scores raw 0 — an idle
 * stream is neither rewarded nor punished on execution. It is recorded in
 * the provenance readings, never silently defaulted.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { EvidenceStream } from "./evidence.js";
import { renderNumber } from "./decimal.js";
import { portfolioSeriesOf } from "./money.js";
import type { PortfolioReading, PortfolioSeriesErrorCode } from "./money.js";
import type {
  RewardComponentKind,
  RewardComponentProvenance,
  RewardComponentResult,
  RewardComponentSpec,
} from "./reward.js";

// ---------------------------------------------------------------------------
// The component evaluators (closed set; one pure function per kind)
// ---------------------------------------------------------------------------

export type RewardComponentErrorCode =
  | PortfolioSeriesErrorCode
  | "non-finite-raw"
  | "unknown-component-kind";

export interface RewardComponentError {
  readonly kind: RewardComponentKind;
  readonly code: RewardComponentErrorCode;
  readonly message: string;
}

export type RewardComponentOutcome =
  | { readonly ok: true; readonly result: RewardComponentResult }
  | { readonly ok: false; readonly error: RewardComponentError };

function componentError(
  kind: RewardComponentKind,
  code: RewardComponentErrorCode,
  message: string,
): RewardComponentOutcome {
  return { ok: false, error: { kind, code, message } };
}

/** Clamp to the [-1, +1] score band (the normalization seam). */
function clampScore(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/** Evaluate one declared component over the stream (pure, fail-closed). */
export function evaluateRewardComponent(
  spec: RewardComponentSpec,
  stream: EvidenceStream,
): RewardComponentOutcome {
  switch (spec.kind) {
    case "realized-pnl":
      return evaluateRealizedPnl(spec, stream);
    case "risk-adjusted-return":
      return evaluateRiskAdjustedReturn(spec, stream);
    case "drawdown-control":
      return evaluateDrawdownControl(spec, stream);
    case "exposure-discipline":
      return evaluateExposureDiscipline(spec, stream);
    case "execution-quality":
      return evaluateExecutionQuality(spec, stream);
    case "protocol-compliance":
      return evaluateProtocolCompliance(spec, stream);
    default:
      return componentError(
        spec.kind,
        "unknown-component-kind",
        `unknown reward component kind '${String(spec.kind)}' (the closed set: realized-pnl, risk-adjusted-return, drawdown-control, exposure-discipline, execution-quality, protocol-compliance)`,
      );
  }
}

function finish(
  spec: RewardComponentSpec,
  rawValue: number,
  provenance: RewardComponentProvenance,
): RewardComponentOutcome {
  if (!Number.isFinite(rawValue)) {
    return componentError(
      spec.kind,
      "non-finite-raw",
      `the '${spec.kind}' raw value is non-finite — never a silent score (fail-closed)`,
    );
  }
  const score = clampScore(rawValue / spec.scale);
  return {
    ok: true,
    result: {
      kind: spec.kind,
      rawValue,
      score,
      weight: spec.weight,
      contribution: spec.weight * score,
      provenance,
    },
  };
}

/**
 * The money series (shared propagation of the discipline's failures). The
 * failure arm is the component's OWN typed error — never the whole outcome —
 * so `ok` alone discriminates the union exactly.
 */
function requireSeries(
  spec: RewardComponentSpec,
  stream: EvidenceStream,
): { ok: true; readings: readonly PortfolioReading[] } | { ok: false; error: RewardComponentError } {
  const series = portfolioSeriesOf(stream);
  if (series.ok) {
    return { ok: true, readings: series.readings };
  }
  return { ok: false, error: { kind: spec.kind, code: series.error.code, message: series.error.message } };
}

/** realized-pnl: the account's cumulative realized P&L at the latest read. */
function evaluateRealizedPnl(
  spec: RewardComponentSpec,
  stream: EvidenceStream,
): RewardComponentOutcome {
  const series = requireSeries(spec, stream);
  if (!series.ok) {
    return series;
  }
  const latest = series.readings[series.readings.length - 1];
  if (latest === undefined) {
    return componentError(spec.kind, "missing-portfolio-read", "no portfolio reading exists");
  }
  return finish(spec, latest.realized, {
    capsuleIndices: [latest.capsuleIndex],
    readings: [
      `final realizedPnl = ${String(latest.currency)} ${renderNumber(latest.realized)} @ capsule ${String(latest.capsuleIndex)} (asOf ${String(latest.asOf)})`,
    ],
  });
}

/** risk-adjusted-return: (equity_last − equity_first) / (1 + max drawdown). */
function evaluateRiskAdjustedReturn(
  spec: RewardComponentSpec,
  stream: EvidenceStream,
): RewardComponentOutcome {
  const series = requireSeries(spec, stream);
  if (!series.ok) {
    return series;
  }
  const first = series.readings[0];
  const last = series.readings[series.readings.length - 1];
  if (first === undefined || last === undefined) {
    return componentError(spec.kind, "missing-portfolio-read", "no portfolio reading exists");
  }
  let maxDrawdown = 0;
  for (const reading of series.readings) {
    maxDrawdown = Math.max(maxDrawdown, reading.drawdown);
  }
  const rawValue = (last.equity - first.equity) / (1 + maxDrawdown);
  return finish(spec, rawValue, {
    capsuleIndices: [first.capsuleIndex, last.capsuleIndex],
    readings: [
      `equity ${String(first.currency)} ${renderNumber(first.equity)} → ${renderNumber(last.equity)} (capsules ${String(first.capsuleIndex)}→${String(last.capsuleIndex)})`,
      `max drawdown ${String(first.currency)} ${renderNumber(maxDrawdown)}; denominator (1 + maxDrawdown) = ${renderNumber(1 + maxDrawdown)}`,
    ],
  });
}

/** drawdown-control: raw = −max drawdown (penalty-shaped; zero is best). */
function evaluateDrawdownControl(
  spec: RewardComponentSpec,
  stream: EvidenceStream,
): RewardComponentOutcome {
  const series = requireSeries(spec, stream);
  if (!series.ok) {
    return series;
  }
  let worst: PortfolioReading | undefined;
  for (const reading of series.readings) {
    if (worst === undefined || reading.drawdown > worst.drawdown) {
      worst = reading;
    }
  }
  if (worst === undefined) {
    return componentError(spec.kind, "missing-portfolio-read", "no portfolio reading exists");
  }
  return finish(spec, -worst.drawdown, {
    capsuleIndices: [worst.capsuleIndex],
    readings: [
      `max drawdown = ${String(worst.currency)} ${renderNumber(worst.drawdown)} @ capsule ${String(worst.capsuleIndex)} (peak ${renderNumber(worst.peakEquity)}, equity ${renderNumber(worst.equity)})`,
    ],
  });
}

/** exposure-discipline: raw = −time-averaged gross exposure / equity. */
function evaluateExposureDiscipline(
  spec: RewardComponentSpec,
  stream: EvidenceStream,
): RewardComponentOutcome {
  const series = requireSeries(spec, stream);
  if (!series.ok) {
    return series;
  }
  const fractions = series.readings.map((reading) => reading.grossExposure / reading.equity);
  const mean = fractions.reduce((sum, value) => sum + value, 0) / fractions.length;
  return finish(spec, -mean, {
    capsuleIndices: series.readings.map((reading) => reading.capsuleIndex),
    readings: [
      `time-averaged gross exposure fraction = ${renderNumber(mean)} over ${String(fractions.length)} settled read(s) (Σ |quantity| × mark / equity)`,
    ],
  });
}

/** execution-quality: acks vs typed rejections (idle streams: raw 0). */
function evaluateExecutionQuality(
  spec: RewardComponentSpec,
  stream: EvidenceStream,
): RewardComponentOutcome {
  let issued = 0;
  let acked = 0;
  const contributing: number[] = [];
  stream.capsules.forEach((capsule, index) => {
    if (capsule.pass.outcomes.length > 0) {
      contributing.push(index);
    }
    for (const outcome of capsule.pass.outcomes) {
      issued += 1;
      if (outcome.result.status === "acked") {
        acked += 1;
      }
    }
  });
  if (issued === 0) {
    return finish(spec, 0, {
      capsuleIndices: contributing,
      readings: [
        "no commands issued across the stream — the EXPLICIT idle neutral (raw 0; documented semantics, never a silent default)",
      ],
    });
  }
  return finish(spec, (2 * acked) / issued - 1, {
    capsuleIndices: contributing,
    readings: [`acked ${String(acked)} of ${String(issued)} issued commands`],
  });
}

/** protocol-compliance: admission-gate refusals across passes. */
function evaluateProtocolCompliance(
  spec: RewardComponentSpec,
  stream: EvidenceStream,
): RewardComponentOutcome {
  const passes = stream.capsules.length;
  let refusals = 0;
  const refusedAt: number[] = [];
  stream.capsules.forEach((capsule, index) => {
    if (!capsule.pass.admission.ok) {
      refusals += 1;
      refusedAt.push(index);
    }
  });
  return finish(spec, 1 - (2 * refusals) / passes, {
    capsuleIndices: refusedAt.length > 0 ? refusedAt : stream.capsules.map((_, i) => i),
    readings: [`admission gate refused ${String(refusals)} of ${String(passes)} pass(es)`],
  });
}
