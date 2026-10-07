/**
 * The synthetic participants of the generator (W017) — the deterministic
 * market population of spec/SIMULATION.md "Participants": passive market
 * makers, liquidity takers, noise traders and momentum participants.
 *
 * THE PARTICIPANT LAW (SIMULATION.md): "Participant code cannot bypass
 * venue/account/risk contracts." These planners do not touch the book, the
 * journal or the matching engine — they emit ORDER COMMANDS, and the
 * generator engine (generator/engine.ts) submits them through the real
 * CommandPort exactly like human traders: same lifecycle, same venue
 * policy, same fees, same latency (availableAt) discipline. Every fill a
 * generated order receives is a real match against real resting liquidity.
 *
 * The participants are DECLARED in the world definition (their Participant
 * kinds select their role); a world that declares no market makers simply
 * has no generated passive liquidity (honest, declarative).
 *
 * Determinism: every decision is a pure draw from the seeded per-turn RNG
 * (seed, domain, participant, instrument, time) — see rng.ts. The plan for
 * a turn is a pure function of (definition, matching state, active regime
 * entry, simulation time). PLANNING ORDER (part of the contract): the
 * market makers reconcile their quotes FIRST (so fresh liquidity rests
 * before the aggressive flow), then the shock gap, then liquidity takers,
 * noise traders and momentum participants.
 */

import type {
  CancelOrderCommand,
  OrderId,
  OrderSide,
  Participant,
  Price,
  Quantity,
  RegimeScheduleEntry,
  SubmitOrderCommand,
  TimestampMs,
} from "tradrl-world-contracts";
import { formatScaled, parseScaled } from "../orderbook/index.js";
import type { BookState } from "../orderbook/index.js";
import type { Scaled } from "../orderbook/index.js";
import type { MatchingState } from "../matching/state.js";
import type { WorldDefinition } from "../world/definition.js";
import { generatedCommandId } from "./events.js";
import { derivedRandom, drawChance, drawInt } from "./rng.js";
import { isShockGapTurn, referenceModeOf, type RegimeProfile } from "./regime.js";
import { referencePriceOf } from "./quotes.js";

/** A fully-built generated command (the wrapper submits these verbatim). */
export type GeneratedCommand = SubmitOrderCommand | CancelOrderCommand;

/** One instrument of the world definition, structurally narrowed. */
type InstrumentOfDefinition = WorldDefinition["instruments"][number];

/** The deterministic per-turn command-id source (sequence order = plan order). */
export interface CommandIdSource {
  next(): string;
}

/** Create the command-id source for one generator turn. */
export function createCommandIdSource(worldId: string, at: TimestampMs): CommandIdSource {
  let sequence = 0;
  return {
    next(): string {
      sequence += 1;
      return generatedCommandId(worldId, at, sequence);
    },
  };
}

function lots(instrument: InstrumentOfDefinition, count: number): Quantity {
  return formatScaled(parseScaled(instrument.lotSize) * BigInt(count), 12) as Quantity;
}

function sideOf(direction: 1 | -1): OrderSide {
  return direction === 1 ? "buy" : "sell";
}

function opposite(side: OrderSide): OrderSide {
  return side === "buy" ? "sell" : "buy";
}

/** Does the book have resting liquidity an aggressive `side` order can hit? */
function hasTakeableLiquidity(book: BookState, side: OrderSide): boolean {
  return side === "buy" ? book.asks.length > 0 : book.bids.length > 0;
}

function participantsOfRole(definition: WorldDefinition, role: Participant["kind"]): readonly Participant[] {
  return definition.participants.filter((participant) => participant.kind === role);
}

function submit(
  ids: CommandIdSource,
  definition: WorldDefinition,
  at: TimestampMs,
  participant: Participant,
  instrumentId: InstrumentOfDefinition["instrumentId"],
  submission: SubmitOrderCommand["submission"],
): GeneratedCommand {
  return {
    kind: "submit-order",
    commandId: ids.next() as never,
    worldId: definition.scope.worldId,
    issuedBy: participant.participantId,
    issuedAt: at as never,
    accountId: participant.accountId,
    instrumentId,
    submission,
  };
}

function cancel(
  ids: CommandIdSource,
  definition: WorldDefinition,
  at: TimestampMs,
  participant: Participant,
  orderId: OrderId,
): GeneratedCommand {
  return {
    kind: "cancel-order",
    commandId: ids.next() as never,
    worldId: definition.scope.worldId,
    issuedBy: participant.participantId,
    issuedAt: at as never,
    orderId,
  };
}

/** One desired market-maker level (price on the internal scale). */
interface DesiredLevel {
  readonly side: OrderSide;
  readonly priceScaled: Scaled;
  readonly price: Price;
}

/** Plan everything one generator turn does on ONE instrument. */
export function planGeneratorTurn(input: {
  readonly definition: WorldDefinition;
  readonly matching: MatchingState;
  readonly instrument: InstrumentOfDefinition;
  readonly book: BookState;
  readonly entry: RegimeScheduleEntry;
  readonly profile: RegimeProfile;
  readonly entries: readonly RegimeScheduleEntry[];
  readonly at: TimestampMs;
  readonly seed: string;
}): readonly GeneratedCommand[] {
  const { definition, instrument, book, entry, profile, at, seed } = input;
  const ids = createCommandIdSource(String(definition.scope.worldId), at);
  const commands: GeneratedCommand[] = [];

  // 1. Passive market makers reconcile their quotes around the reference.
  const reference = referencePriceOf(
    book,
    instrument,
    profile.anchorPrice,
    referenceModeOf(entry),
  );
  if (reference !== undefined && reference > 0n) {
    const tick = parseScaled(instrument.tickSize);
    const desired: DesiredLevel[] = [];
    for (let level = 0; level < profile.mmLevels; level += 1) {
      const offset = BigInt(profile.mmSpreadTicks + level) * tick;
      desired.push({
        side: "buy",
        priceScaled: reference - offset,
        price: formatScaled(reference - offset, 12) as Price,
      });
      desired.push({
        side: "sell",
        priceScaled: reference + offset,
        price: formatScaled(reference + offset, 12) as Price,
      });
    }
    for (const maker of participantsOfRole(definition, "passive-market-maker")) {
      const resting = input.matching.orders.filter(
        (order) =>
          order.submittedBy === maker.participantId &&
          order.instrumentId === instrument.instrumentId &&
          (order.status === "accepted" || order.status === "partially-filled"),
      );
      const covered = new Set<string>();
      for (const order of resting) {
        const stillDesired =
          order.kind === "limit" &&
          desired.some(
            (level) => level.side === order.side && level.priceScaled === parseScaled(order.limitPrice!),
          );
        if (stillDesired) {
          covered.add(`${order.side}:${String(order.limitPrice)}`);
        } else {
          commands.push(cancel(ids, definition, at, maker, order.orderId));
        }
      }
      const quantity = lots(instrument, profile.mmDepthLots);
      for (const level of desired) {
        if (covered.has(`${level.side}:${String(level.price)}`)) {
          continue;
        }
        commands.push(
          submit(ids, definition, at, maker, instrument.instrumentId, {
            kind: "limit",
            side: level.side,
            quantity,
            limitPrice: level.price,
            constraints: { timeInForce: "GTC", postOnly: true },
          }),
        );
      }
    }
  }

  // 2. The aggressive flow: shock gap, liquidity takers, noise, momentum.
  const takers = participantsOfRole(definition, "liquidity-taker");
  const directionSide = sideOf(profile.direction);
  if (
    entry.regime === "shock" &&
    profile.gapLots > 0 &&
    isShockGapTurn(input.entries, entry, at) &&
    takers.length > 0 &&
    hasTakeableLiquidity(book, directionSide)
  ) {
    commands.push(
      submit(ids, definition, at, takers[0]!, instrument.instrumentId, {
        kind: "market",
        side: directionSide,
        quantity: lots(instrument, profile.gapLots),
        constraints: { timeInForce: "IOC" },
      }),
    );
  }
  for (const taker of takers) {
    const rng = derivedRandom(
      seed,
      "taker",
      String(taker.participantId),
      String(instrument.instrumentId),
      at,
    );
    if (!drawChance(rng, profile.takerRate)) {
      continue;
    }
    const side = drawChance(rng, profile.takerBias) ? directionSide : opposite(directionSide);
    if (!hasTakeableLiquidity(book, side)) {
      continue;
    }
    commands.push(
      submit(ids, definition, at, taker, instrument.instrumentId, {
        kind: "market",
        side,
        quantity: lots(instrument, 1 + drawInt(rng, profile.takerMaxLots)),
        constraints: { timeInForce: "IOC" },
      }),
    );
  }
  for (const noise of participantsOfRole(definition, "noise-trader")) {
    const rng = derivedRandom(
      seed,
      "noise",
      String(noise.participantId),
      String(instrument.instrumentId),
      at,
    );
    if (!drawChance(rng, profile.noiseRate)) {
      continue;
    }
    const side: OrderSide = drawChance(rng, 0.5) ? "buy" : "sell";
    if (!hasTakeableLiquidity(book, side)) {
      continue;
    }
    commands.push(
      submit(ids, definition, at, noise, instrument.instrumentId, {
        kind: "market",
        side,
        quantity: lots(instrument, 1),
        constraints: { timeInForce: "IOC" },
      }),
    );
  }
  if (profile.momentumRate > 0) {
    for (const momentum of participantsOfRole(definition, "momentum")) {
      const rng = derivedRandom(
        seed,
        "momentum",
        String(momentum.participantId),
        String(instrument.instrumentId),
        at,
      );
      if (!drawChance(rng, profile.momentumRate)) {
        continue;
      }
      if (!hasTakeableLiquidity(book, directionSide)) {
        continue;
      }
      commands.push(
        submit(ids, definition, at, momentum, instrument.instrumentId, {
          kind: "market",
          side: directionSide,
          quantity: lots(instrument, 1 + drawInt(rng, 3)),
          constraints: { timeInForce: "IOC" },
        }),
      );
    }
  }

  return commands;
}
