/**
 * The account ledger (W024) — exact fill economics and the financial
 * projections the venue serves (positions, portfolio, risk).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Command lifecycle" — fills mutate
 * authoritative state through the venue (./exchange.ts); this module owns
 * the ACCOUNT half of that state. Spec: spec/DOMAIN-MODEL.md "Financial
 * precision" — canonical decimal text at the boundary, exact fixed-point
 * arithmetic inside (the W023 12-decimal kernel, reused from
 * tradrl-market-participants/decimal; no binary floats — A9).
 *
 * DECLARED POLICIES (every one deterministic, every one disclosed in
 * README.md — nothing invented silently):
 * - average entry price is recomputed on position INCREASE as the
 *   exact-scaled weighted average, half-up rounded at the 12-decimal kernel
 *   scale when the division is inexact;
 * - realized P&L accrues on position REDUCTION as
 *   `(exit − entry) × reducedQuantity` signed by the position side;
 * - a fill that crosses through zero realizes on the reducing part and opens
 *   the remainder at the fill price;
 * - fees are `notional × rateBps / 10⁴` (half-up at the kernel scale) per
 *   fill, plus the schedule's fixed per-order fee on the order's FIRST fill
 *   only;
 * - buying power is cash (leverage 1) — the declared baseline;
 * - risk state serves the declared limits with an empty breach history
 *   (pre-trade gates reject before breaches can occur; post-trade breach
 *   surveillance belongs to the canonical W015 risk engine — scope honesty).
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import { formatParticipantDecimal, mulScaled } from "tradrl-market-participants/decimal";
import type {
  AccountId,
  CurrencyCode,
  DecimalString,
  FeeSchedule,
  Instrument,
  InstrumentId,
  OrderId,
  OrderSide,
  Portfolio,
  Position,
  RiskLimits,
  RiskState,
  TimestampMs,
  WorldId,
} from "tradrl-world-contracts";
import { AbidesAdapterError } from "./errors.js";
import { formatPrice, formatSignedQuantity, parseScaled, type Scaled } from "./book.js";

/** Half-up division of scaled values (result on the 12-decimal scale). */
export function halfUpScaled(numerator: bigint, denominator: bigint): Scaled {
  if (denominator <= 0n) {
    throw new Error("[abides:ledger] half-up division needs a positive denominator");
  }
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** One side's fill economics to apply (the venue computes the fill records). */
export interface LedgerFill {
  readonly orderId: OrderId;
  readonly instrumentId: InstrumentId;
  readonly accountId: AccountId;
  readonly side: OrderSide;
  readonly price: Scaled;
  readonly quantity: Scaled;
  readonly liquidity: "maker" | "taker";
}

/** The mutable position state of one account+instrument. */
export interface LedgerPosition {
  quantity: Scaled; // signed: long positive, short negative
  averageEntry: Scaled;
  realizedPnl: Scaled;
  openedAt: TimestampMs;
  updatedAt: TimestampMs;
}

/** The outcome of applying one fill (the fee actually charged, for the fill record). */
export interface FillEconomics {
  readonly fee: Scaled;
}

/** One account's ledger. */
export interface AccountLedger {
  applyFill(input: {
    readonly fill: LedgerFill;
    readonly instrument: Instrument;
    readonly at: TimestampMs;
    /** The venue's fee schedule resolved for THIS fill's instrument (per-fill venue policy). */
    readonly feeSchedule: FeeSchedule;
    readonly applyFixedFee: boolean;
  }): FillEconomics;
  positionOf(instrumentId: InstrumentId): LedgerPosition | undefined;
  cashScaled(): Scaled;
  portfolio(input: {
    readonly accountId: AccountId;
    readonly worldId: WorldId;
    readonly instruments: ReadonlyMap<InstrumentId, Instrument>;
    readonly marks: ReadonlyMap<InstrumentId, Scaled>;
    readonly asOf: TimestampMs;
  }): Portfolio;
}

/** Money text at the declared 2-decimal currency precision (sign included). */
function moneyText(value: Scaled): DecimalString {
  const magnitude = value < 0n ? -value : value;
  const text = formatParticipantDecimal(magnitude, 2);
  return (value < 0n ? `-${text}` : text) as DecimalString;
}

/** Create one account ledger from its opening cash balance. */
export function createAccountLedger(input: {
  readonly accountId: AccountId;
  readonly openingCash: Scaled;
  readonly currency: CurrencyCode;
}): AccountLedger {
  const positions = new Map<InstrumentId, LedgerPosition>();
  let cash = input.openingCash;

  return {
    applyFill({ fill, at, feeSchedule, applyFixedFee }) {
      const signed = fill.side === "buy" ? fill.quantity : -fill.quantity;
      const existing = positions.get(fill.instrumentId);
      const position: LedgerPosition = existing ?? {
        quantity: 0n,
        averageEntry: 0n,
        realizedPnl: 0n,
        openedAt: at,
        updatedAt: at,
      };
      const sameDirection = position.quantity === 0n || (position.quantity > 0n) === (signed > 0n);
      if (sameDirection) {
        // Increase (or open): exact weighted average, half-up at kernel scale.
        const oldMagnitude = position.quantity < 0n ? -position.quantity : position.quantity;
        const numerator =
          position.averageEntry * oldMagnitude + fill.price * fill.quantity;
        position.averageEntry = halfUpScaled(numerator, oldMagnitude + fill.quantity);
        position.quantity += signed;
      } else {
        // Reduction (possibly crossing through zero).
        const positionMagnitude = position.quantity < 0n ? -position.quantity : position.quantity;
        const reduced = positionMagnitude < fill.quantity ? positionMagnitude : fill.quantity;
        const gainPerUnit =
          position.quantity > 0n ? fill.price - position.averageEntry : position.averageEntry - fill.price;
        position.realizedPnl += mulScaled(gainPerUnit, reduced);
        position.quantity += signed;
        if (position.quantity !== 0n && (position.quantity > 0n) !== (existing === undefined ? signed > 0n : existing.quantity > 0n)) {
          // Crossed through zero: the excess opens fresh at the fill price.
          position.averageEntry = fill.price;
        }
      }
      if (existing === undefined) {
        positions.set(fill.instrumentId, position);
      }

      // Fees: notional × rate (maker/taker), half-up at the kernel scale;
      // the schedule's fixed per-order fee applies on the order's first fill only.
      const notional = mulScaled(fill.price, fill.quantity);
      let fee = estimateFillFee(notional, fill.liquidity, feeSchedule);
      if (applyFixedFee && feeSchedule.fixedFee !== undefined) {
        fee += fixedFeeOf(feeSchedule);
      }

      // Cash flow: buys pay notional + fee; sells receive notional − fee.
      if (fill.side === "buy") {
        cash -= notional + fee;
      } else {
        cash += notional - fee;
      }
      return { fee };
    },
    positionOf(instrumentId) {
      const position = positions.get(instrumentId);
      return position === undefined ? undefined : { ...position };
    },
    cashScaled() {
      return cash;
    },
    portfolio({ accountId, worldId, instruments, marks, asOf }) {
      const rows: Position[] = [];
      let realizedTotal = 0n;
      let unrealizedTotal = 0n;
      for (const [instrumentId, position] of positions.entries()) {
        if (position.quantity === 0n) continue;
        const instrument = instruments.get(instrumentId);
        if (instrument === undefined) {
          throw new AbidesAdapterError(
            "unknown-instrument",
            `a position exists for instrument ${String(instrumentId)} which the venue does not list (state corruption — fail closed)`,
          );
        }
        const mark = marks.get(instrumentId);
        const unrealized =
          mark === undefined ? 0n : mulScaled(mark - position.averageEntry, position.quantity);
        unrealizedTotal += unrealized;
        realizedTotal += position.realizedPnl;
        rows.push({
          accountId,
          worldId,
          instrumentId,
          quantity: formatSignedQuantity(position.quantity, instrument),
          averageEntryPrice: formatPrice(position.averageEntry, instrument),
          ...(mark === undefined ? {} : { markPrice: formatPrice(mark, instrument) }),
          realizedPnl: { amount: moneyText(position.realizedPnl), currency: input.currency },
          unrealizedPnl: { amount: moneyText(unrealized), currency: input.currency },
          openedAt: position.openedAt,
          updatedAt: position.updatedAt,
        });
      }
      const equity = cash + unrealizedTotal;
      return {
        accountId,
        worldId,
        positions: rows,
        cash: { amount: moneyText(cash), currency: input.currency },
        buyingPower: { amount: moneyText(cash), currency: input.currency },
        realizedPnl: { amount: moneyText(realizedTotal), currency: input.currency },
        unrealizedPnl: { amount: moneyText(unrealizedTotal), currency: input.currency },
        equity: { amount: moneyText(equity), currency: input.currency },
        asOf,
      };
    },
  };
}

/** The variable fee of one fill's notional at its liquidity rate (exact same arithmetic as applyFill). */
export function estimateFillFee(
  notional: Scaled,
  liquidity: "maker" | "taker",
  schedule: FeeSchedule,
): Scaled {
  const rateBps = liquidity === "taker" ? schedule.takerRateBps : schedule.makerRateBps;
  return halfUpScaled(notional * BigInt(rateBps), 10_000n);
}

/** The schedule's fixed per-order fee (0 when absent or malformed — validated at construction). */
export function fixedFeeOf(schedule: FeeSchedule): Scaled {
  if (schedule.fixedFee === undefined) return 0n;
  return parseScaled(schedule.fixedFee) ?? 0n;
}

/** Serve the account's risk projection (declared limits; honest empty breach history). */
export function riskStateOf(input: {
  readonly accountId: AccountId;
  readonly worldId: WorldId;
  readonly limits: RiskLimits;
  readonly asOf: TimestampMs;
}): RiskState {
  return {
    accountId: input.accountId,
    worldId: input.worldId,
    limits: input.limits,
    breaches: [],
    asOf: input.asOf,
  };
}
