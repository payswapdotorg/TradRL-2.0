/**
 * The momentum reference agent (W023) — a reactive participant that rides
 * the tape: it measures the signed price move over a declared lookback
 * window of OBSERVABLE trades and, when the move exceeds a declared
 * threshold, takes the move's direction with a market IOC order sized by
 * declared lots plus a SEEDED jitter draw.
 *
 * DECLARED POLICY (every threshold is configuration; nothing is invented):
 * - signal: `lastPrice − firstPrice` over the most recent `lookbackTrades`
 *   observable trades of the watched instrument (the A7 view — the tape the
 *   port serves, latency-firewalled, never the engine's raw journal);
 * - fire when `|signal| ≥ thresholdTicks × tickSize` (exact scaled compare);
 * - direction: the sign of the signal (buy when positive);
 * - size: `baseLots + draw` where draw ∈ [0, jitterLots] from the seeded RNG
 *   keyed (seed, agentId, observedAt) — pure per view, no cursor;
 * - position cap: never submit when the account's absolute position in the
 *   instrument would exceed `maxPositionLots` (view-derived, exact);
 * - cooldown: never submit while any OWN order on the instrument was
 *   submitted within `cooldownMs` before the observation (view-derived from
 *   the venue's own order records — no runtime memory).
 *
 * The decision is a PURE function of the settled view: the same view (and
 * config) always yields the same decision (A9). Fills, rejections and fees
 * are the REAL venue's — the agent only ever issues intents through the
 * runtime, which uses the same CommandPort a human trader uses.
 */

import type {
  AccountId,
  InstrumentId,
  OrderSide,
  ParticipantId,
  Quantity,
} from "tradrl-world-contracts";
import type {
  ParticipantDecision,
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
  type Scaled,
} from "../decimal.js";
import { drawInt, keyedRandom } from "../rng.js";

/** The declared policy of the momentum reference agent (all thresholds). */
export interface MomentumAgentConfig {
  readonly agentId: string;
  readonly participantId: ParticipantId;
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  /** Seed for the size-jitter draws (deterministic, keyed per view). */
  readonly seed: string;
  /** Trades in the signal window (≥ 2). */
  readonly lookbackTrades: number;
  /** |signal| must reach this many ticks to fire (≥ 1). */
  readonly thresholdTicks: number;
  /** Order size base, in lots (≥ 1). */
  readonly baseLots: number;
  /** Extra seeded jitter, in lots ∈ [0, jitterLots] (≥ 0). */
  readonly jitterLots: number;
  /** Absolute position cap, in lots (≥ 1). */
  readonly maxPositionLots: number;
  /** No new order while an own order on the instrument is this fresh (≥ 0). */
  readonly cooldownMs: number;
  /** Optional one-line description override (defaults to the policy line). */
  readonly description?: string;
}

function hold(rationale: string): ParticipantDecision {
  return { intents: [], rationale };
}

/** The signed position quantity of one account+instrument, in scale units. */
export function signedPositionScaled(
  view: ParticipantSettledView,
  instrumentId: InstrumentId,
): Scaled {
  const position = view.portfolio.positions.find(
    (candidate) => String(candidate.instrumentId) === String(instrumentId),
  );
  if (position === undefined) {
    return 0n;
  }
  const text = String(position.quantity);
  // Signed decimal text (long positive, short negative) — the canonical
  // unsigned kernel parses the magnitude; the sign is applied exactly.
  return text.startsWith("-") ? -parseParticipantDecimal(text.slice(1)) : parseParticipantDecimal(text);
}

/** Create the momentum reference agent from its declared configuration. */
export function createMomentumAgent(config: MomentumAgentConfig): ReactiveParticipantAgent {
  assertConfig(config);
  return {
    agentId: config.agentId,
    participantId: config.participantId,
    accountId: config.accountId,
    description:
      config.description ??
      `momentum: ${String(config.lookbackTrades)}-trade lookback, ` +
        `≥${String(config.thresholdTicks)}t entry, ${String(config.baseLots)}+jitter lots, ` +
        `cap ${String(config.maxPositionLots)} lots`,
    decide(view: ParticipantSettledView): ParticipantDecision {
      const instrument = view.instruments.find(
        (candidate) => String(candidate.instrumentId) === String(config.instrumentId),
      );
      if (instrument === undefined) {
        return hold("instrument not in the declared view set");
      }
      const observedAt = Number(view.observedAt);

      // Cooldown: the venue's own records of OUR orders (view-derived).
      const ownRecent = view.orders.filter(
        (order) =>
          String(order.instrumentId) === String(config.instrumentId) &&
          Number(order.submittedAt) > observedAt - config.cooldownMs,
      );
      if (ownRecent.length > 0) {
        return hold(
          `cooldown: ${String(ownRecent.length)} own order(s) fresher than ${String(config.cooldownMs)}ms`,
        );
      }

      // Signal: the observable tape of the instrument, window-tail.
      const tape = view.trades.filter(
        (trade) => String(trade.instrumentId) === String(config.instrumentId),
      );
      if (tape.length < config.lookbackTrades) {
        return hold(
          `warming up: ${String(tape.length)}/${String(config.lookbackTrades)} trades observed`,
        );
      }
      const window = tape.slice(-config.lookbackTrades);
      const first = parseParticipantDecimal(String(window[0]!.price));
      const last = parseParticipantDecimal(String(window[window.length - 1]!.price));
      const tick = parseParticipantDecimal(String(instrument.tickSize));
      const signal = last - first;
      const threshold = BigInt(config.thresholdTicks) * tick;
      const magnitude = signal < 0n ? -signal : signal;
      if (magnitude < threshold) {
        return hold(
          `signal ${ratioText(magnitude, tick)}t below threshold ${String(config.thresholdTicks)}t`,
        );
      }

      // Direction and size (the seeded draw is pure per view).
      const side: OrderSide = signal > 0n ? "buy" : "sell";
      const draw = keyedRandom(config.seed, "momentum-size", config.agentId, observedAt);
      const lots =
        config.baseLots + (config.jitterLots > 0 ? drawInt(draw, config.jitterLots + 1) : 0);

      // Position cap: exact scaled arithmetic on the account's own position.
      // An order INCREASES |position| only when it extends the current side
      // (buy while long/flat, sell while short/flat); a reducing order is
      // always allowed (the same law the mean-reversion agent applies).
      const lotSize = parseParticipantDecimal(String(instrument.lotSize));
      const position = signedPositionScaled(view, config.instrumentId);
      const cap = BigInt(config.maxPositionLots) * lotSize;
      const increases = side === "buy" ? position >= 0n : position <= 0n;
      const positionMagnitude = position < 0n ? -position : position;
      if (increases && positionMagnitude + lotsOf(lotSize, lots) > cap) {
        return hold(
          `capped: |position| ${ratioText(positionMagnitude, lotSize)} + ${String(lots)} lots > ${String(config.maxPositionLots)}`,
        );
      }

      const quantity = formatParticipantDecimal(
        lotsOf(lotSize, lots),
        instrument.quantityPrecision,
      ) as Quantity;
      return {
        intents: [
          {
            kind: "submit-order",
            instrumentId: config.instrumentId,
            submission: {
              kind: "market",
              side,
              quantity: quantity as never,
              constraints: { timeInForce: "IOC" },
            },
          },
        ],
        rationale:
          `signal ${signal > 0n ? "+" : "-"}${ratioText(magnitude, tick)}t ≥ ${String(config.thresholdTicks)}t: ` +
          `${side} ${String(lots)} lots market IOC`,
      };
    },
  };
}

/** Validate the declared configuration loudly (misconfiguration is a bug). */
function assertConfig(config: MomentumAgentConfig): void {
  const problems: string[] = [];
  if (config.lookbackTrades < 2) problems.push("lookbackTrades must be ≥ 2");
  if (!Number.isInteger(config.thresholdTicks) || config.thresholdTicks < 1)
    problems.push("thresholdTicks must be an integer ≥ 1");
  if (!Number.isInteger(config.baseLots) || config.baseLots < 1)
    problems.push("baseLots must be an integer ≥ 1");
  if (!Number.isInteger(config.jitterLots) || config.jitterLots < 0)
    problems.push("jitterLots must be an integer ≥ 0");
  if (!Number.isInteger(config.maxPositionLots) || config.maxPositionLots < 1)
    problems.push("maxPositionLots must be an integer ≥ 1");
  if (!Number.isInteger(config.cooldownMs) || config.cooldownMs < 0)
    problems.push("cooldownMs must be an integer ≥ 0");
  if (config.jitterLots > 0 && config.baseLots + config.jitterLots > config.maxPositionLots)
    problems.push("baseLots + jitterLots must be ≤ maxPositionLots (a crossing order must never breach the cap)");
  if (problems.length > 0) {
    throw new Error(`[participants] momentum agent config: ${problems.join("; ")}`);
  }
}
