/**
 * The money-reading discipline (W036) — the single place decimal truth
 * becomes evaluation inputs: the settled portfolio series every money-aware
 * reward component and constraint checker reads.
 *
 * The discipline (fail-closed, deterministic):
 * - ONE currency across the whole series (mixed-currency streams fail
 *   closed — multi-currency evaluation accounting belongs to W038, never a
 *   silent conversion here);
 * - canonical decimal text only, parsed exactly (`decimal.ts`);
 * - finite readings only (astronomical magnitudes are typed errors, never
 *   Infinity scores);
 * - strictly positive equity (every normalized metric divides by equity);
 * - the running peak/drawdown fold is derived deterministically.
 *
 * License: Apache-2.0 (the repository LICENSE).
 */

import type { CurrencyCode, TimestampMs } from "tradrl-world-contracts";
import type { EvidenceStream } from "./evidence.js";
import { DecimalContractError, decimalToNumber, renderNumber } from "./decimal.js";

/** One settled portfolio reading, with the deterministic derived folds. */
export interface PortfolioReading {
  readonly capsuleIndex: number;
  readonly asOf: TimestampMs;
  readonly currency: CurrencyCode;
  readonly equity: number;
  readonly realized: number;
  readonly unrealized: number;
  readonly buyingPower: number;
  /** Σ |position quantity| × (mark ?? average entry), quote currency. */
  readonly grossExposure: number;
  /** Running peak equity over the series, inclusive of this reading. */
  readonly peakEquity: number;
  /** `peakEquity − equity` (≥ 0 by construction). */
  readonly drawdown: number;
}

export type PortfolioSeriesErrorCode =
  | "missing-portfolio-read" // no capsule carried a portfolio at all
  | "mixed-currency" // the series' money is not one currency
  | "malformed-decimal" // a consumed field is not canonical decimal text
  | "non-finite-reading" // a consumed reading converted to ±Infinity
  | "non-positive-equity"; // equity ≤ 0 (the normalized metrics divide by it)

export interface PortfolioSeriesError {
  readonly code: PortfolioSeriesErrorCode;
  readonly message: string;
  readonly capsuleIndex?: number;
}

export type PortfolioSeriesOutcome =
  | { readonly ok: true; readonly readings: readonly PortfolioReading[] }
  | { readonly ok: false; readonly error: PortfolioSeriesError };

/** One field-level read failure (converted to the typed series error). */
class SeriesFieldError extends Error {
  constructor(
    readonly capsuleIndex: number,
    readonly field: string,
    readonly value: string,
    readonly code: PortfolioSeriesErrorCode,
  ) {
    super(`capsule ${String(capsuleIndex)}: the ${field} field ('${value}') failed the money-reading discipline`);
  }
  asPortfolioSeriesError(): PortfolioSeriesError {
    return { code: this.code, message: this.message, capsuleIndex: this.capsuleIndex };
  }
}

/** Read the money (deterministic, exact-parse, single currency, >0 equity). */
export function portfolioSeriesOf(stream: EvidenceStream): PortfolioSeriesOutcome {
  const readings: PortfolioReading[] = [];
  let seriesCurrency: CurrencyCode | undefined;
  let peak: number | undefined;
  for (const [index, capsule] of stream.capsules.entries()) {
    const portfolio = capsule.resultingState.portfolio;
    if (portfolio === undefined) {
      continue;
    }
    const moneyCurrencies = [
      portfolio.equity.currency,
      portfolio.realizedPnl.currency,
      portfolio.unrealizedPnl.currency,
      portfolio.buyingPower.currency,
      ...portfolio.positions.flatMap((position) => [
        position.realizedPnl.currency,
        position.unrealizedPnl.currency,
      ]),
    ];
    for (const currency of moneyCurrencies) {
      if (seriesCurrency === undefined) {
        seriesCurrency = currency;
      } else if (currency !== seriesCurrency) {
        return {
          ok: false,
          error: {
            code: "mixed-currency",
            message: `capsule ${String(index)}: the evidence money mixes currencies (${String(seriesCurrency)} and ${String(currency)}) — single-currency evaluation only (fail-closed; multi-currency accounting is W038's evaluation surface)`,
            capsuleIndex: index,
          },
        };
      }
    }
    const read = (field: string, value: string): number => {
      try {
        return decimalToNumber(value as never);
      } catch (error) {
        if (error instanceof DecimalContractError) {
          throw new SeriesFieldError(index, field, value, "malformed-decimal");
        }
        throw error;
      }
    };
    try {
      const equity = read("equity", portfolio.equity.amount);
      const realized = read("realizedPnl", portfolio.realizedPnl.amount);
      const unrealized = read("unrealizedPnl", portfolio.unrealizedPnl.amount);
      const buyingPower = read("buyingPower", portfolio.buyingPower.amount);
      let grossExposure = 0;
      for (const position of portfolio.positions) {
        const quantity = read("position.quantity", position.quantity);
        const mark =
          position.markPrice === undefined
            ? read("position.averageEntryPrice", position.averageEntryPrice)
            : read("position.markPrice", position.markPrice);
        grossExposure += Math.abs(quantity) * mark;
      }
      const values = [equity, realized, unrealized, buyingPower, grossExposure];
      if (values.some((value) => !Number.isFinite(value))) {
        throw new SeriesFieldError(index, "money", "non-finite", "non-finite-reading");
      }
      if (equity <= 0) {
        return {
          ok: false,
          error: {
            code: "non-positive-equity",
            message: `capsule ${String(index)}: the settled equity is ${renderNumber(equity)} — every normalized metric divides by equity, so non-positive equity fails closed`,
            capsuleIndex: index,
          },
        };
      }
      peak = peak === undefined ? equity : Math.max(peak, equity);
      readings.push({
        capsuleIndex: index,
        asOf: capsule.resultingState.asOf,
        currency: portfolio.equity.currency,
        equity,
        realized,
        unrealized,
        buyingPower,
        grossExposure,
        peakEquity: peak,
        drawdown: peak - equity,
      });
    } catch (error) {
      if (error instanceof SeriesFieldError) {
        return { ok: false, error: error.asPortfolioSeriesError() };
      }
      throw error;
    }
  }
  if (readings.length === 0) {
    return {
      ok: false,
      error: {
        code: "missing-portfolio-read",
        message:
          "[learning-objectives] no capsule in the evidence stream carries a resulting portfolio — the money-reading components never score over an unread account (fail-closed)",
      },
    };
  }
  return { ok: true, readings };
}

