/**
 * Risk constraint-card transforms — W011 (pure, framework-free).
 *
 * Spec: spec/WORK-ITEMS.md W011 ("the risk view — constraint cards WITH
 * numbers: the actual limits and their consumption, not just predicate
 * labels; breaches surfaced"); spec/ARCHITECTURE-LOCK.md A13 (risk gates are
 * runtime controls — this is their read side); spec/WORLD-PROTOCOL.md "UI
 * projection law".
 *
 * EVERY NUMBER IS A REAL PROJECTION: limits come from the engine's own
 * `query.getRisk` (`RiskState.limits` — unset limits are not enforced, the
 * W003 law, shown honestly as such), breach history from
 * `RiskState.breaches`, and CONSUMPTION is computed from the real
 * `query.getPositions` / `query.getPortfolio` figures with the exact kernel
 * of `./decimalText.ts` — gross exposure = Σ |qty| × mark (the engine's own
 * `notionalForPosition` law), leverage = gross / equity (the engine's
 * `leverageScaled` law), position quantity per instrument, current buying
 * power. Where a figure is NOT projectable through the W003 ports (the
 * drawdown measure needs the engine-internal peak equity; the order-size
 * gate is per-submission), the card says so — it never invents a number.
 */

import type { Portfolio, Position, RiskBreach, RiskGateId, RiskState } from "tradrl-world-contracts";

import {
  absMoneyUnits,
  addMoneyUnits,
  compareMoneyUnits,
  formatMoneyUnits,
  multiplyMoneyHalfUp,
  parseMoneyText,
  ratioUnitsText,
} from "./decimalText.js";
import { grossExposureUnitsOf } from "./portfolioData.js";

/** Display row for one recorded breach (engine RiskBreach + time text). */
export interface RiskBreachDisplayRow {
  readonly gate: RiskGateId;
  readonly detail: string;
  readonly occurredAtMs: number;
  readonly occurredAtText: string;
}

/** One constraint card: a named gate with its REAL numbers. */
export interface RiskConstraintCardModel {
  readonly gate: RiskGateId;
  /** Human label (text, never an icon alone). */
  readonly gateLabel: string;
  /** The declared limit as canonical text; undefined = not enforced. */
  readonly limitText: string | undefined;
  /** How the limit is stated (e.g. "max gross exposure"). */
  readonly limitNote: string;
  /** The REAL consumption figure; undefined when not projectable/standing. */
  readonly consumptionText: string | undefined;
  /** How the consumption was derived — or why it cannot be. */
  readonly consumptionNote: string;
  /** Live comparison when derivable: true = over the limit right now. */
  readonly overLimit: boolean | undefined;
  /** The engine-recorded breaches of THIS gate (history, oldest first). */
  readonly breaches: readonly RiskBreachDisplayRow[];
}

/** The risk summary the surface header renders. */
export interface RiskSummaryModel {
  readonly accountId: string;
  readonly asOfMs: number;
  /** How many of the six named gates carry a declared limit. */
  readonly enforcedCount: number;
  /** Total recorded breaches (all gates, this account). */
  readonly breachCount: number;
  readonly cards: readonly RiskConstraintCardModel[];
  /** True when NO limit is declared (the honest alpha-world case). */
  readonly noLimitsDeclared: boolean;
}

const GATE_LABELS: Readonly<Record<RiskGateId, string>> = {
  "buying-power": "Buying power floor",
  "order-size": "Order size",
  "position-limit": "Position limit",
  leverage: "Leverage",
  "gross-exposure": "Gross exposure",
  drawdown: "Drawdown",
};

/** Simulation-time display text (W004: the world's time domain). */
export function formatRiskTimestamp(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.replace("T", " ").replace(".000Z", "Z");
}

function breachRowOf(breach: RiskBreach): RiskBreachDisplayRow {
  return {
    gate: breach.gate,
    detail: breach.detail,
    occurredAtMs: breach.occurredAt,
    occurredAtText: formatRiskTimestamp(breach.occurredAt),
  };
}

/** The engine's ratio normalization (limits.ts `ratioToScaled`, mirrored). */
function ratioLimitUnits(ratio: number): bigint | undefined {
  if (!Number.isFinite(ratio) || ratio < 0) {
    return undefined;
  }
  return BigInt(Math.round(ratio * 10 ** 12));
}

/**
 * Derive the six constraint cards from the REAL projections: `risk` is the
 * engine's `query.getRisk` value, `portfolio` its `query.getPortfolio`
 * value, `positions` the account's own open positions. All consumption
 * figures are computed exactly from those values (see module header).
 */
export function deriveRiskConstraintCards(input: {
  readonly risk: RiskState;
  readonly portfolio: Portfolio;
  readonly positions: readonly Position[];
}): readonly RiskConstraintCardModel[] {
  const { risk, portfolio, positions } = input;
  const limits = risk.limits;
  const breachesByGate = new Map<RiskGateId, RiskBreachDisplayRow[]>();
  for (const breach of risk.breaches) {
    const rows = breachesByGate.get(breach.gate) ?? [];
    rows.push(breachRowOf(breach));
    breachesByGate.set(breach.gate, rows);
  }
  const breachesOf = (gate: RiskGateId): readonly RiskBreachDisplayRow[] =>
    breachesByGate.get(gate) ?? [];

  const equity = parseMoneyText(portfolio.equity.amount, "portfolio.equity");
  const gross = grossExposureUnitsOf(positions);
  let maxOpenQuantity = 0n;
  for (const position of positions) {
    const quantity = absMoneyUnits(parseMoneyText(position.quantity, "position.quantity"));
    if (compareMoneyUnits(quantity, maxOpenQuantity) > 0) {
      maxOpenQuantity = quantity;
    }
  }
  const leverageText = ratioUnitsText(gross, equity);

  const moneyLimit = (
    value: { readonly amount: string } | undefined,
  ): string | undefined => (value === undefined ? undefined : value.amount);

  const cards: readonly RiskConstraintCardModel[] = [
    {
      gate: "buying-power",
      gateLabel: GATE_LABELS["buying-power"],
      limitText: moneyLimit(limits.minBuyingPowerAfterOrder),
      limitNote: "minBuyingPowerAfterOrder — floor that must survive an order",
      consumptionText: portfolio.buyingPower.amount,
      consumptionNote: "current buying power (query.getPortfolio)",
      overLimit:
        limits.minBuyingPowerAfterOrder === undefined
          ? undefined
          : compareMoneyUnits(
              parseMoneyText(portfolio.buyingPower.amount, "portfolio.buyingPower"),
              parseMoneyText(limits.minBuyingPowerAfterOrder.amount, "limits.minBuyingPower"),
            ) < 0,
      breaches: breachesOf("buying-power"),
    },
    {
      gate: "order-size",
      gateLabel: GATE_LABELS["order-size"],
      limitText: limits.maxOrderQuantity,
      limitNote: "maxOrderQuantity — per order at submission",
      consumptionText: undefined,
      consumptionNote:
        "a per-submission gate: the pre-trade risk gate checks each order's quantity — there is no standing consumption figure to project",
      overLimit: undefined,
      breaches: breachesOf("order-size"),
    },
    {
      gate: "position-limit",
      gateLabel: GATE_LABELS["position-limit"],
      limitText: limits.maxPositionQuantity,
      limitNote: "maxPositionQuantity — absolute open quantity per instrument",
      consumptionText: formatMoneyUnits(maxOpenQuantity),
      consumptionNote: "largest open |quantity| across instruments (query.getPositions)",
      overLimit:
        limits.maxPositionQuantity === undefined
          ? undefined
          : compareMoneyUnits(
              maxOpenQuantity,
              parseMoneyText(limits.maxPositionQuantity, "limits.maxPositionQuantity"),
            ) > 0,
      breaches: breachesOf("position-limit"),
    },
    {
      gate: "leverage",
      gateLabel: GATE_LABELS["leverage"],
      limitText:
        limits.maxLeverage === undefined ? undefined : String(limits.maxLeverage),
      limitNote: "maxLeverage — gross exposure / equity",
      consumptionText:
        leverageText === undefined ? "infinite" : `${leverageText}×`,
      consumptionNote:
        leverageText === undefined
          ? "equity is exhausted while exposure remains (gross / equity, exact)"
          : "gross exposure / equity (exact ratio of the real projections)",
      overLimit:
        limits.maxLeverage === undefined
          ? undefined
          : leverageText === undefined
            ? gross > 0n
            : compareMoneyUnits(
                parseMoneyText(leverageText, "leverage consumption"),
                ratioLimitUnits(limits.maxLeverage) ?? 0n,
              ) > 0,
      breaches: breachesOf("leverage"),
    },
    {
      gate: "gross-exposure",
      gateLabel: GATE_LABELS["gross-exposure"],
      limitText: moneyLimit(limits.maxGrossExposure),
      limitNote: "maxGrossExposure — Σ |open quantity| × mark",
      consumptionText: formatMoneyUnits(gross),
      consumptionNote: "Σ |open quantity| × (mark ?? entry), exact (query.getPositions)",
      overLimit:
        limits.maxGrossExposure === undefined
          ? undefined
          : compareMoneyUnits(
              gross,
              parseMoneyText(limits.maxGrossExposure.amount, "limits.maxGrossExposure"),
            ) > 0,
      breaches: breachesOf("gross-exposure"),
    },
    {
      gate: "drawdown",
      gateLabel: GATE_LABELS["drawdown"],
      limitText: moneyLimit(limits.maxDrawdown),
      limitNote: "maxDrawdown — peak equity − equity",
      consumptionText: undefined,
      consumptionNote:
        "the drawdown measure needs the engine-internal peak equity, which the W003 ports do not project — the breach history below carries the engine's own numbers",
      overLimit: undefined,
      breaches: breachesOf("drawdown"),
    },
  ];
  return cards;
}

/** Derive the full risk view (cards + the honest summary counts). */
export function deriveRiskSummary(input: {
  readonly risk: RiskState;
  readonly portfolio: Portfolio;
  readonly positions: readonly Position[];
}): RiskSummaryModel {
  const cards = deriveRiskConstraintCards(input);
  const enforcedCount = cards.filter((card) => card.limitText !== undefined).length;
  const breachCount = input.risk.breaches.length;
  return {
    accountId: input.risk.accountId,
    asOfMs: input.risk.asOf,
    enforcedCount,
    breachCount,
    cards,
    noLimitsDeclared: enforcedCount === 0,
  };
}

/**
 * Total unrealized P&L across open positions (exact fold — the positions
 * surface's summary strip; agrees with portfolio.unrealizedPnl by the W003
 * law, computed independently as a cross-check display).
 */
export function totalUnrealizedUnitsOf(positions: readonly Position[]): bigint {
  let total = 0n;
  for (const position of positions) {
    total = addMoneyUnits(
      total,
      parseMoneyText(position.unrealizedPnl.amount, "position.unrealizedPnl"),
    );
  }
  return total;
}

/** Notional of one position (|qty| × mark, exact — row summary). */
export function positionNotionalText(position: Position): string {
  const quantity = absMoneyUnits(parseMoneyText(position.quantity, "position.quantity"));
  const reference =
    position.markPrice === undefined ? position.averageEntryPrice : position.markPrice;
  const mark = parseMoneyText(reference, "position.markPrice");
  return formatMoneyUnits(multiplyMoneyHalfUp(quantity, mark));
}
