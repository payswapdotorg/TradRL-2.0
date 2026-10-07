/**
 * The momentum reference substrate (W033): a rule-following, DECLARED-STATE
 * mind — the seeded state machine the contract names.
 *
 * The rule (declared, deterministic, never a guess):
 * - it tracks one instrument's mid price (two-sided quotes only) in a
 *   rolling window of the last `lookback` views;
 * - during warm-up (fewer than `lookback` mids) it proposes NOTHING —
 *   insufficient history is honest, not a signal;
 * - the signal is the mid's change over the window against `threshold`:
 *   ≥ +threshold → up, ≤ −threshold → down, inside the band → flat;
 * - an EXACT threshold tie is ambiguous: the SEED resolves it (a pure
 *   FNV-1a hash of seed + view digest — never RNG): odd parity lets the
 *   boundary count as a signal, even parity holds it flat. A different
 *   seed can flip only the exactly-ambiguous case, never a clear one;
 * - entries: flat + up → buy `quantity` market; flat + down → sell;
 *   exits: long + down, short + up → close-position. The position comes
 *   from the VIEW (own-positions), never from memory — a declared-state
 *   substrate carries its rule state, not the world's state;
 * - it acts only when the signal CHANGES (its `lastSignal` state);
 * - missing data (no quote for the instrument, a one-sided quote, no
 *   own-positions) means no proposal this view — never a guess.
 *
 * Purity: no IO, no clock reads (command time is the view's asOf), the
 * only "randomness" is the declared seed through the FNV-1a hash. Same
 * views + same seed ⇒ same DecisionStream (A9, pinned by tests).
 */

import type { InstrumentId, OrderSide, Quantity } from "tradrl-world-contracts";
import { fnv1aChainHex } from "tradrl-world-sim/world";
import { formatScaled, isCanonicalDecimal, parseScaled, type Scaled } from "tradrl-world-sim/orderbook";
import type {
  CognitiveSubstrate,
  CognitiveSubstrateDescriptor,
  SubstrateError,
  SubstrateId,
  SubstrateState,
} from "./contracts.js";
import { decideThroughContract, proposalId, type DecisionContext, type ProposedDecision } from "./decide.js";
import { formatSigned, midOf, ratioOf } from "./decimal.js";

/** The momentum rule's tunables (fixed per substrate instance). */
export interface MomentumConfig {
  readonly substrateId: SubstrateId;
  readonly seed: string;
  readonly instrumentId: InstrumentId;
  /** Window length in views (≥ 2). */
  readonly lookback: number;
  /** The signal threshold as canonical decimal price text (> 0). */
  readonly threshold: string;
  /** The order size as canonical decimal quantity text (> 0). */
  readonly quantity: string;
  readonly displayName?: string;
}

/** The momentum state's signal values. */
export type MomentumSignal = "up" | "down" | "flat";

/** The momentum state: the rolling window and the last computed signal. */
export interface MomentumState extends SubstrateState {
  readonly substrateId: string;
  readonly window: readonly string[];
  readonly lastSignal: MomentumSignal;
}

const SIGNALS: readonly MomentumSignal[] = ["up", "down", "flat"];

function isMomentumState(
  state: SubstrateState,
  descriptor: CognitiveSubstrateDescriptor,
): state is MomentumState {
  const candidate = state as Partial<MomentumState>;
  return (
    candidate.substrateId === String(descriptor.substrateId) &&
    Array.isArray(candidate.window) &&
    candidate.window.every((mid) => isCanonicalDecimal(mid)) &&
    SIGNALS.includes(candidate.lastSignal as MomentumSignal)
  );
}

function malformedState(): { readonly ok: false; readonly errors: readonly SubstrateError[] } {
  return {
    ok: false,
    errors: [
      {
        code: "malformed-state",
        message: "the momentum substrate's state must be its own: { substrateId, window (canonical decimals), lastSignal ∈ up|down|flat }",
      },
    ],
  };
}

/** The deterministic mid of a view's two-sided quote for one instrument. */
function midOfView(context: DecisionContext, instrumentId: InstrumentId): { readonly midText: string; readonly mid: Scaled } | undefined {
  const quote = context.view.quotes?.find(
    (candidate) => String(candidate.instrumentId) === String(instrumentId),
  );
  if (quote === undefined || quote.bid === undefined || quote.ask === undefined) {
    return undefined;
  }
  const mid = midOf(parseScaled(quote.bid), parseScaled(quote.ask));
  return { midText: formatScaled(mid, 12), mid };
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

/** The seeded ambiguity resolver: odd parity acts on an exact tie. */
function seededTieAct(seed: string, viewDigest: string): boolean {
  return (Number.parseInt(fnv1aChainHex([seed, viewDigest]), 16) & 1) === 1;
}

function momentumCore(
  context: DecisionContext,
  state: SubstrateState | undefined,
  config: MomentumConfig,
): { readonly ok: true; readonly proposed: readonly ProposedDecision[]; readonly state: SubstrateState } | { readonly ok: false; readonly errors: readonly SubstrateError[] } {
  if (state === undefined || !isMomentumState(state, context.descriptor)) {
    return malformedState();
  }
  const observed = midOfView(context, config.instrumentId);
  const window = [...state.window, ...(observed === undefined ? [] : [observed.midText])].slice(-config.lookback);
  if (observed === undefined || window.length < config.lookback) {
    // warm-up (or no usable quote): the window advances, nothing is proposed
    return {
      ok: true,
      proposed: [],
      state: { substrateId: String(context.descriptor.substrateId), window, lastSignal: state.lastSignal },
    };
  }

  const startText = window[0] ?? "0";
  const delta = observed.mid - parseScaled(startText);
  const threshold = parseScaled(config.threshold);
  const magnitude = delta < 0n ? -delta : delta;
  let signal: MomentumSignal;
  if (magnitude > threshold) {
    signal = delta > 0n ? "up" : "down";
  } else if (magnitude === threshold) {
    // exactly at the threshold: the seeded tie-break (disclosed ambiguity rule)
    signal = seededTieAct(context.descriptor.seed, context.viewDigest)
      ? delta > 0n ? "up" : "down"
      : "flat";
  } else {
    signal = "flat";
  }
  const next: MomentumState = { substrateId: String(context.descriptor.substrateId), window, lastSignal: signal };

  const position = positionQuantityOf(context, config.instrumentId);
  if (position === undefined || signal === state.lastSignal) {
    return { ok: true, proposed: [], state: next };
  }

  const commandId = proposalId(context.descriptor, context.viewDigest, 0) as never;
  const base = {
    commandId,
    worldId: context.view.worldId,
    issuedBy: context.view.participantId,
    issuedAt: context.view.asOf,
  } as const;
  const depth = magnitude - threshold;
  const confidence = 0.5 + 0.5 * ratioOf(depth > 3n * threshold ? 3n * threshold : depth, 3n * threshold);
  const signals = [
    { name: "instrument", value: String(config.instrumentId) },
    { name: "mid", value: observed.midText, unit: "price" },
    { name: "lookbackStart", value: startText, unit: "price" },
    { name: "delta", value: formatSigned(delta), unit: "price" },
    { name: "threshold", value: config.threshold, unit: "price" },
    { name: "lookback", value: config.lookback, unit: "views" },
    { name: "positionQuantity", value: position === 0n ? "0" : formatSigned(position), unit: "quantity" },
    { name: "signal", value: signal },
    { name: "confidenceBasis", value: "0.5 + 0.5 × min(|delta|−threshold, 3×threshold) / (3×threshold)" },
  ];

  const exitLong = position > 0n && signal === "down";
  const exitShort = position < 0n && signal === "up";
  const enterLong = position === 0n && signal === "up";
  const enterShort = position === 0n && signal === "down";
  if (!exitLong && !exitShort && !enterLong && !enterShort) {
    return { ok: true, proposed: [], state: next };
  }

  const explanation =
    `momentum-lookback-cross: mid ${observed.midText} vs ${startText} ${String(config.lookback)} views ago ` +
    `= delta ${formatSigned(delta)} against threshold ${config.threshold} → ${signal}` +
    (exitLong || exitShort ? "; opposing signal against the held position → close-position" : ` → ${enterLong ? "buy" : "sell"} ${config.quantity} market`);

  const proposed: ProposedDecision[] = exitLong || exitShort
    ? [
        {
          command: { ...base, kind: "close-position", accountId: context.view.accountId, instrumentId: config.instrumentId },
          rationale: { rule: "momentum-lookback-cross", signals, explanation },
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
          rationale: { rule: "momentum-lookback-cross", signals, explanation },
          confidence,
        },
      ];
  return { ok: true, proposed, state: next };
}

/** Constructor-time config guards (loud, before any view is ever seen). */
function assertMomentumConfig(config: MomentumConfig): void {
  if (!Number.isInteger(config.lookback) || config.lookback < 2) {
    throw new Error(`momentum lookback must be an integer ≥ 2 (got '${String(config.lookback)}')`);
  }
  const threshold = parseScaled(config.threshold);
  if (threshold <= 0n) {
    throw new Error(`momentum threshold must be canonical decimal text > 0 (got '${config.threshold}')`);
  }
  if (parseScaled(config.quantity) <= 0n) {
    throw new Error(`momentum quantity must be canonical decimal text > 0 (got '${config.quantity}')`);
  }
}

/**
 * Create the momentum reference substrate: a declared-state, seeded,
 * rule-following mind over one instrument's mids. The initial state is
 * the EMPTY window (the seed never invents prices — it resolves exact
 * threshold ambiguity only).
 */
export function createMomentumSubstrate(config: MomentumConfig): CognitiveSubstrate {
  assertMomentumConfig(config);
  const descriptor: CognitiveSubstrateDescriptor = {
    substrateId: config.substrateId,
    ...(config.displayName === undefined ? {} : { displayName: config.displayName }),
    stateMode: "declared-state",
    seed: config.seed,
    decisionRate: { maxDecisionsPerView: 1, minViewIntervalMs: 1000 },
    commandKinds: ["submit-order", "close-position"],
  };
  const substrate: CognitiveSubstrate = {
    descriptor,
    initialState: { substrateId: String(config.substrateId), window: [], lastSignal: "flat" },
    decide: (input) =>
      decideThroughContract(
        { descriptor },
        input,
        (context, state) => momentumCore(context, state, config),
      ),
  };
  return substrate;
}
