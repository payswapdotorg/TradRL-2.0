/**
 * The mean-reversion reference agent (W023) — a reactive participant that
 * fades deviations from a declared reference: it computes the size-weighted
 * average price (VWAP) over a declared window of OBSERVABLE trades, and when
 * the mid deviates from that reference beyond a declared band it rests a
 * post-only limit quote on the deviation-favored side, offset from the
 * current best by a declared tick count. Inside the flat band it withdraws.
 *
 * DECLARED POLICY (every threshold is configuration; nothing is invented):
 * - reference: VWAP of the most recent `referenceTrades` observable trades
 *   (kept as an exact rational Σ(price×qty) / Σqty — compared by
 *   cross-multiplication, never divided);
 * - deviation: `mid − VWAP` where mid is `(bid+ask)/2` (all comparisons in
 *   the doubled space `bid+ask` vs `2×VWAP` — exact, no halving);
 * - entry: deviation ≤ −entryDeviationTicks×tick (price BELOW reference) →
 *   rest ONE post-only GTC buy limit at `bid − quoteOffsetTicks×tick`;
 *   symmetric sell at `ask + quoteOffsetTicks×tick` when above +entry;
 * - flat zone: |deviation| < exitDeviationTicks×tick → cancel every own
 *   working quote on the instrument (the signal is gone);
 * - wrong side: a sign flip first cancels own working quotes on the
 *   OPPOSITE side of the current signal (mispriced quotes never linger);
 * - caps: at most `maxWorkingQuotes` own working quotes per side; never a
 *   quote that would push the account's absolute position beyond
 *   `maxPositionLots` (position-REDUCING quotes are always allowed).
 *
 * No RNG is needed (no jitter) — the agent is a pure function of the view.
 * Fills, rejections and fees are the REAL venue's: the agent only ever
 * issues intents through the runtime's CommandPort (A4/A15).
 */

import type {
  AccountId,
  InstrumentId,
  OrderSide,
  ParticipantId,
  Price,
  Quantity,
} from "tradrl-world-contracts";
import type {
  ParticipantDecision,
  ParticipantOrderIntent,
  ParticipantSettledView,
  ReactiveParticipantAgent,
} from "../../../tradrl-world-contracts/src/participantProtocol.js";
// NOTE(tradrl-world-contracts): relative source import — the exports-map
// registration is a TL action item (see runtime.ts). Type-only.
import {
  formatParticipantDecimal,
  lotsOf,
  parseParticipantDecimal,
  ratioText,
  tickOffset,
} from "../decimal.js";
import { signedPositionScaled } from "./momentum.js";

/** The declared policy of the mean-reversion reference agent. */
export interface MeanReversionAgentConfig {
  readonly agentId: string;
  readonly participantId: ParticipantId;
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  /** Trades in the VWAP reference window (≥ 1). */
  readonly referenceTrades: number;
  /** Deviation (ticks) beyond which the agent quotes (≥ 1). */
  readonly entryDeviationTicks: number;
  /** Deviation (ticks) inside which the agent withdraws (≥ 0, ≤ entry). */
  readonly exitDeviationTicks: number;
  /** Quote offset from the current best, in ticks (≥ 1). */
  readonly quoteOffsetTicks: number;
  /** Quote size, in lots (≥ 1). */
  readonly quoteLots: number;
  /** Absolute position cap, in lots (≥ 1). */
  readonly maxPositionLots: number;
  /** Own working quotes allowed per side (≥ 1). */
  readonly maxWorkingQuotes: number;
  /** Optional one-line description override (defaults to the policy line). */
  readonly description?: string;
}

/** One own working (resting) limit quote of this account+instrument. */
interface WorkingQuote {
  readonly orderId: string;
  readonly side: OrderSide;
}

function hold(rationale: string): ParticipantDecision {
  return { intents: [], rationale };
}

function cancelAll(
  quotes: readonly WorkingQuote[],
  reason: string,
  intents: ParticipantOrderIntent[],
): number {
  for (const quote of quotes) {
    intents.push({
      kind: "cancel-order",
      orderId: quote.orderId as never,
      reason,
    });
  }
  return quotes.length;
}

/** Create the mean-reversion reference agent from its declared configuration. */
export function createMeanReversionAgent(
  config: MeanReversionAgentConfig,
): ReactiveParticipantAgent {
  assertConfig(config);
  return {
    agentId: config.agentId,
    participantId: config.participantId,
    accountId: config.accountId,
    description:
      config.description ??
      `mean-reversion: ${String(config.referenceTrades)}-trade VWAP, ` +
        `±${String(config.entryDeviationTicks)}t entry / ${String(config.exitDeviationTicks)}t exit, ` +
        `post-only ${String(config.quoteOffsetTicks)}t offset`,
    decide(view: ParticipantSettledView): ParticipantDecision {
      const instrument = view.instruments.find(
        (candidate) => String(candidate.instrumentId) === String(config.instrumentId),
      );
      if (instrument === undefined) {
        return hold("instrument not in the declared view set");
      }
      const quote = view.quotes.find(
        (candidate) => String(candidate.instrumentId) === String(config.instrumentId),
      );
      if (quote === undefined || quote.bid === undefined || quote.ask === undefined) {
        return hold("no two-sided quote to reference");
      }
      const tape = view.trades.filter(
        (trade) => String(trade.instrumentId) === String(config.instrumentId),
      );
      if (tape.length === 0) {
        return hold("no observable trades for the reference window");
      }
      const window = tape.slice(-config.referenceTrades);

      // Exact VWAP as a rational on the scale-24 product scale: Σ(price×qty)
      // is kept as the RAW product sum (scale-24), so every deviation
      // comparison below lives in ONE scale space — (bid+ask)×Σqty is the
      // same scale-24 space (scale-12 × scale-12). Compared, never divided.
      let vwapNumerator = 0n;
      let vwapDenominator = 0n;
      for (const trade of window) {
        vwapNumerator +=
          parseParticipantDecimal(String(trade.price)) *
          parseParticipantDecimal(String(trade.quantity));
        vwapDenominator += parseParticipantDecimal(String(trade.quantity));
      }
      // Doubled mid (bid+ask) keeps every comparison division-free:
      // mid − VWAP ⟺ (bid+ask)×Σqty − 2×Σ(price×qty), one scale-24 space.
      const doubledMid =
        parseParticipantDecimal(String(quote.bid)) +
        parseParticipantDecimal(String(quote.ask));
      const doubledDeviation = doubledMid * vwapDenominator - 2n * vwapNumerator;
      const tick = parseParticipantDecimal(String(instrument.tickSize));
      const entry = BigInt(config.entryDeviationTicks) * tick;
      const exit = BigInt(config.exitDeviationTicks) * tick;

      // Own working quotes on the instrument (the venue's own records).
      const working = view.orders.filter(
        (order) =>
          String(order.instrumentId) === String(config.instrumentId) &&
          (order.status === "accepted" || order.status === "partially-filled"),
      );
      const workingQuotes: WorkingQuote[] = working.map((order) => ({
        orderId: String(order.orderId),
        side: order.side,
      }));
      const workingBuys = workingQuotes.filter((quote) => quote.side === "buy");
      const workingSells = workingQuotes.filter((quote) => quote.side === "sell");

      // Flat zone: |deviation| < exit → withdraw everything.
      const magnitude =
        doubledDeviation < 0n ? -doubledDeviation : doubledDeviation;
      const exitBound = 2n * exit * vwapDenominator;
      if (magnitude < exitBound) {
        if (workingQuotes.length === 0) {
          return hold(
            `flat zone: |dev| ${ratioText(magnitude, 2n * tick * vwapDenominator)}t < ${String(config.exitDeviationTicks)}t`,
          );
        }
        const intents: ParticipantOrderIntent[] = [];
        cancelAll(workingQuotes, "mean-reversion: flat zone", intents);
        return {
          intents,
          rationale: `flat zone (|dev| < ${String(config.exitDeviationTicks)}t): withdrew ${String(intents.length)} quote(s)`,
        };
      }

      const entryBound = 2n * entry * vwapDenominator;
      const devTicksText = ratioText(magnitude, 2n * tick * vwapDenominator);
      if (doubledDeviation <= -entryBound) {
        // Price BELOW reference → favor buys; withdraw wrong-side sells.
        const intents: ParticipantOrderIntent[] = [];
        const withdrawn = cancelAll(workingSells, "mean-reversion: signal flipped", intents);
        const rationalePrefix =
          `dev −${devTicksText}t ≤ −${String(config.entryDeviationTicks)}t` +
          (withdrawn > 0 ? ` (withdrew ${String(withdrawn)} sell quote(s))` : "");
        if (workingBuys.length >= config.maxWorkingQuotes) {
          return {
            intents,
            rationale: `${rationalePrefix}; ${String(workingBuys.length)} buy quote(s) already at the cap`,
          };
        }
        const lotSize = parseParticipantDecimal(String(instrument.lotSize));
        const position = signedPositionScaled(view, config.instrumentId);
        const quoteQuantityScaled = lotsOf(lotSize, config.quoteLots);
        const cap = BigInt(config.maxPositionLots) * lotSize;
        // A BUY quote increases |position| only when already long (or flat);
        // reducing an existing short is always allowed.
        const wouldIncrease = position >= 0n;
        const positionMagnitude = position < 0n ? -position : position;
        if (wouldIncrease && positionMagnitude + quoteQuantityScaled > cap) {
          return {
            intents,
            rationale: `${rationalePrefix}; capped at |position| ${String(config.maxPositionLots)} lots`,
          };
        }
        const bid = parseParticipantDecimal(String(quote.bid));
        const price = tickOffset(bid, -config.quoteOffsetTicks, tick);
        const limitPrice = formatParticipantDecimal(price, instrument.pricePrecision) as Price;
        intents.push({
          kind: "submit-order",
          instrumentId: config.instrumentId,
          submission: {
            kind: "limit",
            side: "buy",
            quantity: formatParticipantDecimal(
              quoteQuantityScaled,
              instrument.quantityPrecision,
            ) as Quantity,
            limitPrice,
            constraints: { timeInForce: "GTC", postOnly: true },
          },
        });
        return {
          intents,
          rationale: `${rationalePrefix}: rest buy ${String(config.quoteLots)} lots post-only at ${String(limitPrice)}`,
        };
      }
      if (doubledDeviation >= entryBound) {
        // Price ABOVE reference → favor sells; withdraw wrong-side buys.
        const intents: ParticipantOrderIntent[] = [];
        const withdrawn = cancelAll(workingBuys, "mean-reversion: signal flipped", intents);
        const rationalePrefix =
          `dev +${devTicksText}t ≥ +${String(config.entryDeviationTicks)}t` +
          (withdrawn > 0 ? ` (withdrew ${String(withdrawn)} buy quote(s))` : "");
        if (workingSells.length >= config.maxWorkingQuotes) {
          return {
            intents,
            rationale: `${rationalePrefix}; ${String(workingSells.length)} sell quote(s) already at the cap`,
          };
        }
        const lotSize = parseParticipantDecimal(String(instrument.lotSize));
        const position = signedPositionScaled(view, config.instrumentId);
        const quoteQuantityScaled = lotsOf(lotSize, config.quoteLots);
        const cap = BigInt(config.maxPositionLots) * lotSize;
        const wouldIncrease = position <= 0n;
        const positionMagnitude = position < 0n ? -position : position;
        if (wouldIncrease && positionMagnitude + quoteQuantityScaled > cap) {
          return {
            intents,
            rationale: `${rationalePrefix}; capped at |position| ${String(config.maxPositionLots)} lots`,
          };
        }
        const ask = parseParticipantDecimal(String(quote.ask));
        const price = tickOffset(ask, config.quoteOffsetTicks, tick);
        const limitPrice = formatParticipantDecimal(price, instrument.pricePrecision) as Price;
        intents.push({
          kind: "submit-order",
          instrumentId: config.instrumentId,
          submission: {
            kind: "limit",
            side: "sell",
            quantity: formatParticipantDecimal(
              quoteQuantityScaled,
              instrument.quantityPrecision,
            ) as Quantity,
            limitPrice,
            constraints: { timeInForce: "GTC", postOnly: true },
          },
        });
        return {
          intents,
          rationale: `${rationalePrefix}: rest sell ${String(config.quoteLots)} lots post-only at ${String(limitPrice)}`,
        };
      }
      return hold(
        `inside band: |dev| ${devTicksText}t in [${String(config.exitDeviationTicks)}t, ${String(config.entryDeviationTicks)}t)`,
      );
    },
  };
}

/** Validate the declared configuration loudly (misconfiguration is a bug). */
function assertConfig(config: MeanReversionAgentConfig): void {
  const problems: string[] = [];
  if (!Number.isInteger(config.referenceTrades) || config.referenceTrades < 1)
    problems.push("referenceTrades must be an integer ≥ 1");
  if (!Number.isInteger(config.entryDeviationTicks) || config.entryDeviationTicks < 1)
    problems.push("entryDeviationTicks must be an integer ≥ 1");
  if (
    !Number.isInteger(config.exitDeviationTicks) ||
    config.exitDeviationTicks < 0 ||
    config.exitDeviationTicks > config.entryDeviationTicks
  )
    problems.push("exitDeviationTicks must be an integer in [0, entryDeviationTicks]");
  if (!Number.isInteger(config.quoteOffsetTicks) || config.quoteOffsetTicks < 1)
    problems.push("quoteOffsetTicks must be an integer ≥ 1");
  if (!Number.isInteger(config.quoteLots) || config.quoteLots < 1)
    problems.push("quoteLots must be an integer ≥ 1");
  if (!Number.isInteger(config.maxPositionLots) || config.maxPositionLots < 1)
    problems.push("maxPositionLots must be an integer ≥ 1");
  if (!Number.isInteger(config.maxWorkingQuotes) || config.maxWorkingQuotes < 1)
    problems.push("maxWorkingQuotes must be an integer ≥ 1");
  if (problems.length > 0) {
    throw new Error(`[participants] mean-reversion agent config: ${problems.join("; ")}`);
  }
}
