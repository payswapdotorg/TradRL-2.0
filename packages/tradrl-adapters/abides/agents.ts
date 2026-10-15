/**
 * The ABIDES-style agent kinds (W024) — the adapter's reactive population:
 * agents that wake on market events and their own scheduled wakes, decide
 * PURELY over the W023 settled view, and act ONLY through the participant
 * protocol's intent vocabulary.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A4/A15 — every agent here is a
 * `ReactiveParticipantAgent` (tradrl-world-contracts/participantProtocol):
 * the SAME protocol surface the W023 reference agents (momentum,
 * mean-reversion) code against; the kernel drives them through the REAL
 * `createParticipantRuntime` (tradrl-market-participants/runtime) — there is
 * no second execution path. Spec: A7 — decisions read only the view (the
 * latency-firewalled projection the agent's client serves); spec: A9 —
 * `decide` is pure (seeded keyed draws, no cursor, no wall time).
 *
 * THE REGISTRY LAW (fail closed): `createAbidesAgent` accepts exactly the
 * kinds registered here; anything else is a typed `unknown-agent-kind`
 * violation (never a silent default kind).
 *
 * DECLARED POLICIES (every threshold is configuration; nothing invented):
 * - `market-maker`: two-sided post-only quotes around a reference price —
 *   the last observable trade, else the declared anchor. It re-quotes a side
 *   when the reference moved ≥ requoteTicks away from that side's working
 *   quote (or the side is missing); it withdraws a side entirely when the
 *   position cap forbids extending it. A stale quote that would cross is
 *   simply REJECTED by the venue's post-only gate — the agent never chases.
 * - `noise-trader`: on each wake, a seeded Bernoulli draw decides whether to
 *   trade at all; a seeded side draw and a seeded size draw (1..maxLots)
 *   produce one market IOC order, position-capped.
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md). The
 * semantic vocabulary (market makers posting liquidity, noise traders
 * supplying random flow) is the documented public idea of an agent-based
 * market — expressed here from scratch, exactly as the license register's
 * "reference only" posture requires.
 */

import type {
  AccountId,
  InstrumentId,
  OrderId,
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
} from "tradrl-world-contracts/participantProtocol";
import {
  formatParticipantDecimal,
  lotsOf,
  parseParticipantDecimal,
  ratioText,
  tickOffset,
  type Scaled,
} from "tradrl-market-participants/decimal";
import { drawChance, drawInt, keyedRandom } from "tradrl-market-participants/rng";
import { signedPositionScaled } from "tradrl-market-participants/agents";
import { abidesError } from "./errors.js";

/** Parse canonical decimal text, or undefined when it is not canonical. */
function tryParse(text: string): Scaled | undefined {
  try {
    return parseParticipantDecimal(text);
  } catch {
    return undefined;
  }
}

/** The registered agent kinds (the closed registry — fail closed). */
export const ABIDES_AGENT_KINDS = ["market-maker", "noise-trader"] as const;

/** The registered agent kind union. */
export type AbidesAgentKind = (typeof ABIDES_AGENT_KINDS)[number];

/** The declared policy of the market-maker agent. */
export interface AbidesMarketMakerConfig {
  readonly agentId: string;
  readonly participantId: ParticipantId;
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  /** Fair-value anchor until the first observable trade exists. */
  readonly anchorPrice: Price;
  /** Half the quoted spread, in ticks (≥ 1). */
  readonly halfSpreadTicks: number;
  /** Quote size, in lots (≥ 1). */
  readonly quoteLots: number;
  /** Absolute position cap, in lots (≥ 1). */
  readonly maxPositionLots: number;
  /** Re-quote a side when the reference moves this many ticks from its working quote (≥ 1). */
  readonly requoteTicks: number;
  /** Optional one-line description override. */
  readonly description?: string;
}

/** The declared policy of the noise-trader agent. */
export interface AbidesNoiseTraderConfig {
  readonly agentId: string;
  readonly participantId: ParticipantId;
  readonly accountId: AccountId;
  readonly instrumentId: InstrumentId;
  /** Seed for the keyed draws (deterministic per view). */
  readonly seed: string;
  /** Probability of trading on any given wake (0..1). */
  readonly tradeProbability: number;
  /** Probability the trade buys (0..1); the remainder sells. */
  readonly buyProbability: number;
  /** Maximum market-order size, in lots (≥ 1). */
  readonly maxLots: number;
  /** Absolute position cap, in lots (≥ 1). */
  readonly maxPositionLots: number;
  /** Optional one-line description override. */
  readonly description?: string;
}

function hold(rationale: string): ParticipantDecision {
  return { intents: [], rationale };
}

function workingQuotesOf(view: ParticipantSettledView, instrumentId: InstrumentId): readonly { orderId: OrderId; side: OrderSide; limitPrice: Scaled }[] {
  return view.orders
    .filter((order) => String(order.instrumentId) === String(instrumentId))
    .filter((order) => order.status === "accepted" || order.status === "partially-filled")
    .filter((order) => order.kind === "limit" && order.limitPrice !== undefined)
    .map((order) => ({ orderId: order.orderId as never, side: order.side, limitPrice: parseParticipantDecimal(String(order.limitPrice)) }));
}

/** Create the market-maker agent from its declared configuration. */
export function createMarketMakerAgent(config: AbidesMarketMakerConfig): ReactiveParticipantAgent {
  const problems: string[] = [];
  if (!Number.isInteger(config.halfSpreadTicks) || config.halfSpreadTicks < 1) problems.push("halfSpreadTicks must be an integer ≥ 1");
  if (!Number.isInteger(config.quoteLots) || config.quoteLots < 1) problems.push("quoteLots must be an integer ≥ 1");
  if (!Number.isInteger(config.maxPositionLots) || config.maxPositionLots < 1) problems.push("maxPositionLots must be an integer ≥ 1");
  if (!Number.isInteger(config.requoteTicks) || config.requoteTicks < 1) problems.push("requoteTicks must be an integer ≥ 1");
  if (tryParse(String(config.anchorPrice)) === undefined) {
    problems.push("anchorPrice must be canonical decimal text");
  }
  if (problems.length > 0) {
    abidesError("malformed-agent-config", `market-maker config for ${config.agentId}: ${problems.join("; ")}`);
  }
  return {
    agentId: config.agentId,
    participantId: config.participantId,
    accountId: config.accountId,
    description: config.description ??
      `abides market-maker: ±${String(config.halfSpreadTicks)}t two-sided post-only quotes, ${String(config.quoteLots)} lots, cap ${String(config.maxPositionLots)}`,
    decide(view: ParticipantSettledView): ParticipantDecision {
      const instrument = view.instruments.find((candidate) => String(candidate.instrumentId) === String(config.instrumentId));
      if (instrument === undefined) {
        return hold("instrument not in the declared view set");
      }
      const tick = parseParticipantDecimal(String(instrument.tickSize));
      const lotSize = parseParticipantDecimal(String(instrument.lotSize));
      const tape = view.trades.filter((trade) => String(trade.instrumentId) === String(config.instrumentId));
      const reference = tape.length > 0
        ? parseParticipantDecimal(String(tape[tape.length - 1]!.price))
        : parseParticipantDecimal(String(config.anchorPrice));

      const position = signedPositionScaled(view, config.instrumentId);
      const positionLots = ratioText(position < 0n ? -position : position, lotSize);
      const cap = BigInt(config.maxPositionLots) * lotSize;
      const working = workingQuotesOf(view, config.instrumentId);
      const intents: ParticipantOrderIntent[] = [];
      const sides: readonly { side: OrderSide; offset: number; extendsPosition: boolean }[] = [
        { side: "buy", offset: -config.halfSpreadTicks, extendsPosition: position >= 0n },
        { side: "sell", offset: config.halfSpreadTicks, extendsPosition: position <= 0n },
      ];
      const rationales: string[] = [];
      for (const { side, offset, extendsPosition } of sides) {
        const desired = tickOffset(reference, offset, tick);
        const existing = working.find((quote) => quote.side === side);
        const quantity = lotsOf(lotSize, config.quoteLots);
        const wouldExceed = extendsPosition && (position < 0n ? -position : position) + quantity > cap;
        if (wouldExceed) {
          // The cap withdraws the extending side (a working quote keeps filling).
          if (existing !== undefined) {
            intents.push({ kind: "cancel-order", orderId: existing.orderId, reason: "position-cap" });
            rationales.push(`cancel ${side} quote (|position| ${positionLots} at the ${String(config.maxPositionLots)}-lot cap)`);
          } else {
            rationales.push(`no ${side} quote (|position| ${positionLots} at the ${String(config.maxPositionLots)}-lot cap)`);
          }
          continue;
        }
        if (existing !== undefined) {
          const drift = desired < existing.limitPrice ? existing.limitPrice - desired : desired - existing.limitPrice;
          if (drift < BigInt(config.requoteTicks) * tick) {
            continue; // the working quote is fresh enough — hold it
          }
          intents.push({ kind: "cancel-order", orderId: existing.orderId, reason: "requote" });
          rationales.push(`cancel ${side} quote (drifted ${ratioText(drift, tick)}t)`);
        }
        intents.push({
          kind: "submit-order",
          instrumentId: config.instrumentId,
          submission: {
            kind: "limit",
            side,
            quantity: formatParticipantDecimal(quantity, instrument.quantityPrecision) as Quantity,
            limitPrice: formatParticipantDecimal(desired, instrument.pricePrecision) as Price,
            constraints: { timeInForce: "GTC", postOnly: true },
          },
        });
        rationales.push(`${side} ${String(config.quoteLots)} lots at ${formatParticipantDecimal(desired, instrument.pricePrecision)} (post-only GTC)`);
      }
      return { intents, rationale: rationales.length > 0 ? rationales.join("; ") : "quotes fresh — hold" };
    },
  };
}

/** Create the noise-trader agent from its declared configuration. */
export function createNoiseTraderAgent(config: AbidesNoiseTraderConfig): ReactiveParticipantAgent {
  const problems: string[] = [];
  if (!(config.tradeProbability >= 0 && config.tradeProbability <= 1)) problems.push("tradeProbability must be within [0, 1]");
  if (!(config.buyProbability >= 0 && config.buyProbability <= 1)) problems.push("buyProbability must be within [0, 1]");
  if (!Number.isInteger(config.maxLots) || config.maxLots < 1) problems.push("maxLots must be an integer ≥ 1");
  if (!Number.isInteger(config.maxPositionLots) || config.maxPositionLots < 1) problems.push("maxPositionLots must be an integer ≥ 1");
  if (problems.length > 0) {
    abidesError("malformed-world-definition", `noise-trader config for ${config.agentId}: ${problems.join("; ")}`);
  }
  return {
    agentId: config.agentId,
    participantId: config.participantId,
    accountId: config.accountId,
    description: config.description ??
      `abides noise-trader: p=${String(config.tradeProbability)} market IOC, 1..${String(config.maxLots)} lots, cap ${String(config.maxPositionLots)}`,
    decide(view: ParticipantSettledView): ParticipantDecision {
      const instrument = view.instruments.find((candidate) => String(candidate.instrumentId) === String(config.instrumentId));
      if (instrument === undefined) {
        return hold("instrument not in the declared view set");
      }
      const observedAt = Number(view.observedAt);
      const draw = keyedRandom(config.seed, "abides-noise", config.agentId, observedAt);
      if (!drawChance(draw, config.tradeProbability)) {
        return hold("no trade this wake (seeded draw)");
      }
      const side: OrderSide = drawChance(draw, config.buyProbability) ? "buy" : "sell";
      const lots = 1 + drawInt(draw, config.maxLots);
      const lotSize = parseParticipantDecimal(String(instrument.lotSize));
      const position = signedPositionScaled(view, config.instrumentId);
      const cap = BigInt(config.maxPositionLots) * lotSize;
      const increases = side === "buy" ? position >= 0n : position <= 0n;
      const magnitude = position < 0n ? -position : position;
      if (increases && magnitude + lotsOf(lotSize, lots) > cap) {
        return hold(`capped: |position| ${ratioText(magnitude, lotSize)} + ${String(lots)} lots > ${String(config.maxPositionLots)}`);
      }
      const quantity = formatParticipantDecimal(lotsOf(lotSize, lots), instrument.quantityPrecision) as Quantity;
      return {
        intents: [
          {
            kind: "submit-order",
            instrumentId: config.instrumentId,
            submission: { kind: "market", side, quantity, constraints: { timeInForce: "IOC" } },
          },
        ],
        rationale: `noise: ${side} ${String(lots)} lots market IOC`,
      };
    },
  };
}

/** Create an agent by REGISTERED kind (unknown kinds fail closed, loudly). */
export function createAbidesAgent(kind: string, config: unknown): ReactiveParticipantAgent {
  switch (kind) {
    case "market-maker":
      return createMarketMakerAgent(config as AbidesMarketMakerConfig);
    case "noise-trader":
      return createNoiseTraderAgent(config as AbidesNoiseTraderConfig);
    default:
      abidesError(
        "unknown-agent-kind",
        `agent kind '${String(kind)}' is not registered (registered: ${ABIDES_AGENT_KINDS.join(", ")})`,
      );
  }
}
