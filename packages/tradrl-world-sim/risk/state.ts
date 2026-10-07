/**
 * The risk runtime state (W015 `risk` module): breach history, peak equity
 * and the breach-episode flags — advanced ONLY by reducing journaled
 * events, so live runs and replays produce bit-identical risk state (A6/A9).
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A13 (risk gates are runtime controls),
 * A9 (determinism), spec/REQUIREMENTS.md R023/R024.
 *
 * DETERMINISM LAW (the single-path constraint on breach recording): state
 * is a pure function of (definition, journal). Breaches are therefore
 * recorded ONLY when a JOURNALED event moves an account past a declared
 * limit — fills and trade prints move equity/marks/exposure. Pre-trade
 * gate REJECTIONS never mutate state (rejected commands journal nothing);
 * they are typed CommandResult values that the command stream hash already
 * covers deterministically. One breach record per crossing episode: the
 * per-(account, gate) breached flag rises on the crossing event and clears
 * when the measure recovers inside the limit — deterministic, replay-safe.
 *
 * EVALUATED MEASURES (all exact, all in the account base currency):
 * - drawdown       = peakEquity − equity, when positive
 *   (peak equity is tracked monotonically from the initial cash).
 * - grossExposure  = Σ |open quantity| × mark
 *   (mark moves with trade prints — an exposure limit can be breached by
 *   the MARK, with no new order).
 * - leverage       = grossExposure / equity (infinite when equity ≤ 0 and
 *   exposure > 0 — the honest breach).
 * - position-limit = |open quantity| per instrument (fills only; the
 *   pre-trade gate makes crossings unreachable through the lifecycle —
 *   this is defense in depth against corrupt journals).
 */

import type { RiskBreach, RiskGateId } from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { isOrderFilledPayload } from "../matching/index.js";
import { parseScaled, type Scaled } from "../orderbook/index.js";
import { absScaled, formatSignedMoney } from "../portfolio/index.js";
import type { PositionRecord } from "../portfolio/index.js";
import type { AccountFinancials, AccountLedger } from "../account/index.js";
import { computeAccountFinancials } from "../account/index.js";
import { ratioToScaled, type RiskLimitsByAccount } from "./limits.js";

const SCALE = 10n ** 12n;

/**
 * A breach with the account it belongs to (the W003 `RiskBreach` contract
 * has no account field — the engine-internal record keeps it; projections
 * strip it per account).
 */
export interface AccountRiskBreach extends RiskBreach {
  readonly accountId: string;
}

/** The risk slice of the financial state. */
export interface RiskRuntimeState {
  /** Resolved per-account limits (baked at init — deterministic). */
  readonly limits: RiskLimitsByAccount;
  /** Monotonic peak equity per account (scaled, base currency). */
  readonly peakEquity: Readonly<Record<string, Scaled>>;
  /** Breach history (every account, append order, with the account kept). */
  readonly breaches: readonly AccountRiskBreach[];
  /** Per-(account, gate) episode flags: true while the breach persists. */
  readonly breached: Readonly<Record<string, Partial<Record<RiskGateId, boolean>>>>;
}

/**
 * Build the initial risk state: limits resolved from the declaration, peak
 * equity seeded at each account's initial equity (its base-currency cash —
 * no positions exist yet).
 */
export function initialRiskRuntimeState(input: {
  readonly declaredLimits: RiskLimitsByAccount | undefined;
  readonly accountIds: readonly string[];
  readonly initialEquity: Readonly<Record<string, Scaled>>;
}): RiskRuntimeState {
  return {
    limits: input.declaredLimits ?? {},
    peakEquity: { ...input.initialEquity },
    breaches: [],
    breached: {},
  };
}

function currentDrawdown(peak: Scaled, equity: Scaled): Scaled {
  return peak > equity ? peak - equity : 0n;
}

function leverageScaled(gross: Scaled, equity: Scaled): Scaled | undefined {
  // equity × 10^12 as the denominator keeps the ratio on the fixed point;
  // undefined = infinite (equity ≤ 0 with open exposure)
  if (equity <= 0n) {
    return gross > 0n ? undefined : 0n;
  }
  return (gross * SCALE) / equity + ((gross * SCALE) % equity * 2n >= equity ? 1n : 0n);
}

interface Measure {
  readonly account: AccountLedger;
  readonly financials: AccountFinancials;
  readonly drawdown: Scaled;
  readonly leverage: Scaled | undefined;
}

function evaluateAccount(
  account: AccountLedger,
  positions: readonly PositionRecord[],
  peak: Scaled,
): Measure {
  const financials = computeAccountFinancials(account, positions);
  return {
    account,
    financials,
    drawdown: currentDrawdown(peak, financials.equity),
    leverage: leverageScaled(financials.grossExposure, financials.equity),
  };
}

/**
 * Reduce one journaled event into the risk state. `accounts` and
 * `positions` are the POST-event account and portfolio slices (the
 * financial composite reduces them first — the ordering is the seam law).
 */
export function reduceRiskEvent(
  state: RiskRuntimeState,
  envelope: WorldEventEnvelope,
  input: {
    readonly accounts: Readonly<Record<string, AccountLedger>>;
    readonly positions: readonly PositionRecord[];
  },
): RiskRuntimeState {
  const isFill = envelope.eventType === "matching.order.filled" && isOrderFilledPayload(envelope.payload);
  const isPrint = envelope.eventType === "market.trade.printed";
  if (!isFill && !isPrint) {
    return state;
  }

  let peakEquity = state.peakEquity;
  let breached = state.breached;
  const breaches: AccountRiskBreach[] = [];
  const touched = isFill ? [String(envelope.payload.accountId)] : Object.keys(input.accounts);

  for (const accountId of touched) {
    const account = input.accounts[accountId];
    if (account === undefined) {
      continue;
    }
    const limits = state.limits[accountId] ?? {};
    const positionsOf = input.positions.filter((record) => String(record.accountId) === accountId);
    const peak = peakEquity[accountId] ?? 0n;
    const measure = evaluateAccount(account, positionsOf, peak);

    if (measure.financials.equity > peak) {
      peakEquity = { ...peakEquity, [accountId]: measure.financials.equity };
    }

    const checks: { gate: RiskGateId; breachedNow: boolean; detail: () => string }[] = [
      {
        gate: "drawdown",
        breachedNow:
          limits.maxDrawdown !== undefined &&
          measure.drawdown > parseScaled(limits.maxDrawdown.amount),
        detail: () =>
          `drawdown ${formatSignedMoney(measure.drawdown)} exceeds limit ${String(limits.maxDrawdown?.amount)}`,
      },
      {
        gate: "gross-exposure",
        breachedNow:
          limits.maxGrossExposure !== undefined &&
          measure.financials.grossExposure > parseScaled(limits.maxGrossExposure.amount),
        detail: () =>
          `gross exposure ${formatSignedMoney(measure.financials.grossExposure)} exceeds limit ${String(limits.maxGrossExposure?.amount)}`,
      },
      {
        gate: "leverage",
        breachedNow:
          limits.maxLeverage !== undefined &&
          (measure.leverage === undefined
            ? measure.financials.grossExposure > 0n
            : measure.leverage > ratioToScaled(limits.maxLeverage)),
        detail: () =>
          measure.leverage === undefined
            ? `equity ${formatSignedMoney(measure.financials.equity)} is exhausted while exposure ${formatSignedMoney(measure.financials.grossExposure)} remains (leverage limit ${String(limits.maxLeverage)})`
            : `leverage ${formatSignedMoney(measure.leverage)} exceeds limit ${String(limits.maxLeverage)}`,
      },
    ];

    if (isFill) {
      // position-limit crossings are fill-caused (defense in depth)
      const payload = envelope.payload as { instrumentId: string };
      const record = positionsOf.find(
        (candidate) => String(candidate.instrumentId) === payload.instrumentId,
      );
      checks.push({
        gate: "position-limit",
        breachedNow:
          limits.maxPositionQuantity !== undefined &&
          record !== undefined &&
          absScaled(record.quantity) > parseScaled(limits.maxPositionQuantity),
        detail: () =>
          `position quantity ${record === undefined ? "0" : formatSignedMoney(absScaled(record.quantity))} exceeds limit ${String(limits.maxPositionQuantity)}`,
      });
    }

    for (const check of checks) {
      const was = breached[accountId]?.[check.gate] === true;
      if (check.breachedNow && !was) {
        breaches.push({
          accountId,
          gate: check.gate,
          detail: check.detail(),
          occurredAt: envelope.occurredAt,
        });
        breached = { ...breached, [accountId]: { ...breached[accountId], [check.gate]: true } };
      } else if (!check.breachedNow && was) {
        const cleared = { ...breached[accountId] };
        delete cleared[check.gate];
        breached = { ...breached, [accountId]: cleared };
      }
    }
  }

  if (breaches.length === 0 && peakEquity === state.peakEquity && breached === state.breached) {
    return state;
  }
  return {
    ...state,
    peakEquity,
    breached,
    ...(breaches.length === 0 ? {} : { breaches: [...state.breaches, ...breaches] }),
  };
}

/** The breaches of one account, projected to the W003 `RiskBreach` shape. */
export function breachesOf(state: RiskRuntimeState, accountId: string): readonly RiskBreach[] {
  return state.breaches
    .filter((breach) => breach.accountId === accountId)
    .map(({ accountId: _accountId, ...breach }) => breach);
}
