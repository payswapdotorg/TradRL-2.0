/**
 * The mean-reversion reference substrate (W033): a rule-following,
 * STATELESS-PER-VIEW mind — every decision is a pure function of the one
 * observed view it is handed (no state flows between views; the contract's
 * other state mode, proven by construction).
 *
 * The rule (declared, deterministic, never a guess):
 * - it reads one instrument's mid (two-sided quote only) and the view's
 *   own public tape for that instrument (the `trades` the view carries):
 *   tapeHigh = max trade price, tapeLow = min trade price;
 * - the trigger zones hug the tape's edges: the low zone is
 *   mid ≤ tapeLow + threshold (bought-up-tape low → expect a bounce up),
 *   the high zone is mid ≥ tapeHigh − threshold (sold-down tape high →
 *   expect a fade down); between the zones it proposes nothing;
 * - when both zones hold (a tape narrower than 2 × threshold) the NEARER
 *   edge wins; an exact distance tie is resolved by the SEED (a pure
 *   FNV-1a hash of seed + view digest — never RNG): odd parity acts on
 *   the exact-boundary case, even parity holds;
 * - entries: flat + low zone → buy `quantity` market; flat + high zone →
 *   sell; exits: long + high zone, short + low zone → close-position —
 *   the position always comes from the VIEW (own-positions), never from
 *   memory (there is none — that is the point of the stateless mode);
 * - missing data (no two-sided quote, an empty tape, no own-positions)
 *   means no proposal — never a guess.
 *
 * Purity: no IO, no clock reads (command time is the view's asOf), the
 * only "randomness" is the declared seed through the FNV-1a hash. Same
 * view + same seed ⇒ same DecisionStream (A9, pinned by tests).
 */

import type { InstrumentId, OrderSide, Quantity } from "tradrl-world-contracts";
import { fnv1aChainHex } from "tradrl-world-sim/world";
import { formatScaled, parseScaled, type Scaled } from "tradrl-world-sim/orderbook";
import type {
  CognitiveSubstrate,
  CognitiveSubstrateDescriptor,
  SubstrateId,
} from "./contracts.js";
import { decideThroughContract, proposalId, type DecisionContext, type ProposedDecision } from "./decide.js";
import { formatSigned, midOf, ratioOf } from "./decimal.js";

/** The mean-reversion rule's tunables (fixed per substrate instance). */
export interface MeanReversionConfig {
  readonly substrateId: SubstrateId;
  readonly seed: string;
  readonly instrumentId: InstrumentId;
  /** The edge-zone width as canonical decimal price text (> 0). */
  readonly threshold: string;
  /** The order size as canonical decimal quantity text (> 0). */
  readonly quantity: string;
  readonly displayName?: string;
}

function positionQuantityOf(context: DecisionContext, instrumentId: InstrumentId): bigint | undefined {
  if (context.view.ownPositions === undefined) {
    return undefined; // the view carries no position projection: unknown, never guessed
  }
  const position = context.view.ownPositions.find(
    (candidate) => String(candidate.instrumentId) === String(instrumentId),
  );
  if (position === undefined) {
    return 0n; // a present projection with no row for this instrument: flat
  }
  const quantityText: string = position.quantity;
  const negative = quantityText.startsWith("-");
  const magnitude = parseScaled(negative ? quantityText.slice(1) : quantityText);
  return negative ? -magnitude : magnitude;
}

/** The seeded ambiguity resolver: odd parity acts on an exact boundary. */
function seededTieAct(seed: string, viewDigest: string): boolean {
  return (Number.parseInt(fnv1aChainHex([seed, viewDigest]), 16) & 1) === 1;
}

type Zone = "low" | "high" | "none";

function meanReversionCore(
  context: DecisionContext,
  config: MeanReversionConfig,
): { readonly ok: true; readonly proposed: readonly ProposedDecision[] } {
  const quote = context.view.quotes?.find(
    (candidate) => String(candidate.instrumentId) === String(config.instrumentId),
  );
  const tape = (context.view.trades ?? []).filter(
    (trade) => String(trade.instrumentId) === String(config.instrumentId),
  );
  const position = positionQuantityOf(context, config.instrumentId);
  if (quote === undefined || quote.bid === undefined || quote.ask === undefined || tape.length === 0 || position === undefined) {
    return { ok: true, proposed: [] };
  }

  const mid = midOf(parseScaled(quote.bid), parseScaled(quote.ask));
  const midText = formatScaled(mid, 12);
  const threshold = parseScaled(config.threshold);
  let tapeHigh: Scaled | undefined;
  let tapeLow: Scaled | undefined;
  for (const trade of tape) {
    const price = parseScaled(trade.price);
    tapeHigh = tapeHigh === undefined || price > tapeHigh ? price : tapeHigh;
    tapeLow = tapeLow === undefined || price < tapeLow ? price : tapeLow;
  }
  if (tapeHigh === undefined || tapeLow === undefined) {
    return { ok: true, proposed: [] };
  }
  const highText = formatScaled(tapeHigh, 12);
  const lowText = formatScaled(tapeLow, 12);

  // The nearer edge wins; exact boundary/tie cases resolve through the seed.
  const lowEdge = (tapeLow ?? 0n) + threshold;
  const highEdge = (tapeHigh ?? 0n) - threshold;
  const inLow = mid <= lowEdge;
  const inHigh = mid >= highEdge;
  let zone: Zone = "none";
  let depth = 0n;
  if (inLow && !inHigh) {
    zone = "low";
    depth = lowEdge - mid;
  } else if (inHigh && !inLow) {
    zone = "high";
    depth = mid - highEdge;
  } else if (inLow && inHigh) {
    const distanceLow = lowEdge - mid;
    const distanceHigh = mid - highEdge;
    if (distanceLow < distanceHigh) {
      zone = "low";
      depth = distanceLow;
    } else if (distanceHigh < distanceLow) {
      zone = "high";
      depth = distanceHigh;
    } else {
      zone = seededTieAct(context.descriptor.seed, context.viewDigest) ? "low" : "high";
      depth = distanceLow;
    }
  }
  if (zone !== "none" && depth === 0n && !seededTieAct(context.descriptor.seed, context.viewDigest)) {
    zone = "none"; // exactly on the boundary and the seed says hold
  }
  if (zone === "none") {
    return { ok: true, proposed: [] };
  }

  const exitLong = position > 0n && zone === "high";
  const exitShort = position < 0n && zone === "low";
  const enterLong = position === 0n && zone === "low";
  const enterShort = position === 0n && zone === "high";
  if (!exitLong && !exitShort && !enterLong && !enterShort) {
    return { ok: true, proposed: [] };
  }

  const commandId = proposalId(context.descriptor, context.viewDigest, 0) as never;
  const base = {
    commandId,
    worldId: context.view.worldId,
    issuedBy: context.view.participantId,
    issuedAt: context.view.asOf,
  } as const;
  const confidence = 0.5 + 0.5 * ratioOf(depth > threshold ? threshold : depth, threshold);
  const signals = [
    { name: "instrument", value: String(config.instrumentId) },
    { name: "mid", value: midText, unit: "price" },
    { name: "tapeHigh", value: highText, unit: "price" },
    { name: "tapeLow", value: lowText, unit: "price" },
    { name: "threshold", value: config.threshold, unit: "price" },
    { name: "zone", value: zone },
    { name: "positionQuantity", value: position === 0n ? "0" : formatSigned(position), unit: "quantity" },
    { name: "confidenceBasis", value: "0.5 + 0.5 × min(depth, threshold) / threshold" },
  ];
  const explanation =
    `mean-reversion-tape-edge: mid ${midText} against the tape [${lowText}, ${highText}] ` +
    `with edge width ${config.threshold} → ${zone} zone` +
    (exitLong || exitShort ? "; strength against the held position → close-position" : ` → ${enterLong ? "buy" : "sell"} ${config.quantity} market`);

  const proposed: ProposedDecision[] = exitLong || exitShort
    ? [
        {
          command: { ...base, kind: "close-position", accountId: context.view.accountId, instrumentId: config.instrumentId },
          rationale: { rule: "mean-reversion-tape-edge", signals, explanation },
          confidence,
        },
      ]
    : [
        {
          command: {
            ...base,
            kind: "submit-order",
            accountId: context.view.accountId,
            instrumentId: config.instrumentId,
            submission: {
              kind: "market",
              side: (enterLong ? "buy" : "sell") as OrderSide,
              quantity: config.quantity as Quantity,
              constraints: { timeInForce: "GTC" },
            },
          },
          rationale: { rule: "mean-reversion-tape-edge", signals, explanation },
          confidence,
        },
      ];
  return { ok: true, proposed };
}

/** Constructor-time config guards (loud, before any view is ever seen). */
function assertMeanReversionConfig(config: MeanReversionConfig): void {
  if (parseScaled(config.threshold) <= 0n) {
    throw new Error(`mean-reversion threshold must be canonical decimal text > 0 (got '${config.threshold}')`);
  }
  if (parseScaled(config.quantity) <= 0n) {
    throw new Error(`mean-reversion quantity must be canonical decimal text > 0 (got '${config.quantity}')`);
  }
}

/**
 * Create the mean-reversion reference substrate: a stateless-per-view,
 * seeded, rule-following mind over one instrument's tape edges. It has no
 * initial state by contract (stateless-per-view); the seed resolves exact
 * boundary ambiguity only.
 */
export function createMeanReversionSubstrate(config: MeanReversionConfig): CognitiveSubstrate {
  assertMeanReversionConfig(config);
  const descriptor: CognitiveSubstrateDescriptor = {
    substrateId: config.substrateId,
    ...(config.displayName === undefined ? {} : { displayName: config.displayName }),
    stateMode: "stateless-per-view",
    seed: config.seed,
    decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 1000 },
    commandKinds: ["submit-order", "close-position"],
  };
  return {
    descriptor,
    decide: (input) =>
      decideThroughContract(
        { descriptor },
        input,
        (context) => meanReversionCore(context, config),
      ),
  };
}
