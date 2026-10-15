/**
 * Shared deterministic fixtures for the W024 `tradrl-adapters-abides`
 * tests — one canonical reactive world (one venue, one equity instrument,
 * three accounts, three latency-declared participants, a two-sided opening
 * book) plus the registered agent declarations and typed command builders.
 *
 * Every fixture is HAND-AUTHORED to the declared contract shapes
 * (tradrl-world-contracts) and the adapter's own declared policies
 * (README.md); nothing is recorded from any external system (clean-room).
 */

import type {
  Account,
  AccountId,
  CancelOrderCommand,
  CommandId,
  CurrencyCode,
  FeeSchedule,
  Instrument,
  InstrumentId,
  Money,
  Participant,
  ParticipantId,
  Price,
  Quantity,
  ReplaceOrderCommand,
  SubmitOrderCommand,
  TimeInForce,
  TimestampMs,
  VenueId,
  WorldId,
  WorldScope,
} from "tradrl-world-contracts";
import type { AbidesVenueConfig, AbidesWorldDefinition } from "../definition.js";
import type { AgentLatencySpec } from "../latency.js";
import type { AbidesAgentDeclaration } from "../kernel.js";
import { parseParticipantDecimal, type Scaled } from "tradrl-market-participants/decimal";

// --- canonical identities ------------------------------------------------------

export const WORLD_ID = "world-w024-abides" as WorldId;
export const CLOCK_ORIGIN: TimestampMs = 1_000_000 as TimestampMs;
export const VENUE_ID = "VX" as VenueId;
export const INSTRUMENT_ID = "EQ-1" as InstrumentId;
export const MM_ACCOUNT = "acct-mm" as AccountId;
export const NOISE_ACCOUNT = "acct-noise" as AccountId;
export const SEED_ACCOUNT = "acct-seeder" as AccountId;
export const MM_PARTICIPANT = "p-mm" as ParticipantId;
export const NOISE_PARTICIPANT = "p-noise" as ParticipantId;
export const SEED_PARTICIPANT = "p-seeder" as ParticipantId;

/** Parse canonical decimal text to the 12-decimal kernel scale (test-side). */
export function scaled(text: string): Scaled {
  return parseParticipantDecimal(text);
}

const USD = "USD" as CurrencyCode;

function usd(text: string): Money {
  return { amount: text as Money["amount"], currency: USD };
}

/** One USD account with opening cash `text` (leverage 1, simulated-only). */
export function abidesAccount(accountId: AccountId, cash: string): Account {
  return {
    accountId,
    worldId: WORLD_ID,
    balances: { [USD]: usd(cash) },
    buyingPower: usd(cash),
    marginUsed: usd("0"),
    marginAvailable: usd(cash),
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

/** One participant over `accountId` (the W023 seam binds one agent to it). */
export function abidesParticipant(
  participantId: ParticipantId,
  accountId: AccountId,
  kind: Participant["kind"],
): Participant {
  return { participantId, worldId: WORLD_ID, kind, accountId };
}

/** The canonical venue: 10ms ack / 25ms fill propagation, 0 bps + $2.50 fixed. */
export function abidesVenue(overrides: Partial<AbidesVenueConfig> = {}): AbidesVenueConfig {
  return {
    venueId: VENUE_ID,
    name: "Venue X",
    latency: { acknowledgementMs: 10, fillPropagationMs: 25 },
    feeSchedule: { makerRateBps: 0, takerRateBps: 0, fixedFee: "2.50" as FeeSchedule["fixedFee"] },
    allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
    ...overrides,
  };
}

/** The canonical instrument: penny tick, unit lot, open and tradable. */
export function abidesInstrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    instrumentId: INSTRUMENT_ID,
    worldId: WORLD_ID,
    venueId: VENUE_ID,
    symbol: "ABD",
    assetClass: "equity",
    quoteCurrency: USD,
    tickSize: "0.01" as Price,
    lotSize: "1" as Quantity,
    pricePrecision: 2,
    quantityPrecision: 0,
    tradingState: "open",
    tradable: true,
    ...overrides,
  };
}

const FIXED_LATENCY: Readonly<Record<string, AgentLatencySpec>> = {
  [String(MM_PARTICIPANT)]: { toVenueMs: 40, fromVenueMs: 60 },
  [String(NOISE_PARTICIPANT)]: { toVenueMs: 25, fromVenueMs: 35 },
  [String(SEED_PARTICIPANT)]: { toVenueMs: 0, fromVenueMs: 0 },
};

/**
 * The canonical world. `overrides` shallow-merge (arrays replace whole) so
 * negative fixtures stay explicit; every build is a FRESH object (twin runs
 * must never share mutable state).
 */
export function abidesWorld(overrides: Partial<AbidesWorldDefinition> = {}): AbidesWorldDefinition {
  return {
    worldId: WORLD_ID,
    scope: {
      tenantId: "tenant-w024" as WorldScope["tenantId"],
      projectId: "project-w024" as WorldScope["projectId"],
      worldId: WORLD_ID,
    },
    seed: "w024-seed-a",
    worldDefinitionVersion: "w024@1",
    inputDataSource: "synthetic-declared",
    clockOrigin: CLOCK_ORIGIN,
    defaultStepMs: 100,
    venues: [abidesVenue()],
    instruments: [abidesInstrument()],
    accounts: [
      abidesAccount(MM_ACCOUNT, "1000000.00"),
      abidesAccount(NOISE_ACCOUNT, "1000000.00"),
      abidesAccount(SEED_ACCOUNT, "1000000.00"),
    ],
    participants: [
      abidesParticipant(MM_PARTICIPANT, MM_ACCOUNT, "passive-market-maker"),
      abidesParticipant(NOISE_PARTICIPANT, NOISE_ACCOUNT, "noise-trader"),
      abidesParticipant(SEED_PARTICIPANT, SEED_ACCOUNT, "liquidity-taker"),
    ],
    participantLatency: { ...FIXED_LATENCY },
    seedOrders: [
      { participantId: SEED_PARTICIPANT, instrumentId: INSTRUMENT_ID, side: "sell", price: "101.00" as Price, quantity: "100" as Quantity },
      { participantId: SEED_PARTICIPANT, instrumentId: INSTRUMENT_ID, side: "buy", price: "99.00" as Price, quantity: "100" as Quantity },
    ],
    ...overrides,
  };
}

/** The divergence world: RANGE latencies, so the world seed moves arrivals. */
export function rangeLatencyWorld(seed: string): AbidesWorldDefinition {
  const range = (minMs: number, maxMs: number) => ({ minMs, maxMs });
  return abidesWorld({
    seed,
    participantLatency: {
      [String(MM_PARTICIPANT)]: { toVenueMs: range(20, 80), fromVenueMs: range(30, 90) },
      [String(NOISE_PARTICIPANT)]: { toVenueMs: range(10, 50), fromVenueMs: range(15, 65) },
      [String(SEED_PARTICIPANT)]: { toVenueMs: range(0, 5), fromVenueMs: range(0, 5) },
    },
  });
}

// --- agent declarations --------------------------------------------------------

/** The canonical market-maker declaration (two-sided post-only quotes). */
export function marketMakerDeclaration(
  overrides: Partial<AbidesAgentDeclaration> = {},
): AbidesAgentDeclaration {
  return {
    agentId: "mm-1",
    participantId: MM_PARTICIPANT,
    kind: "market-maker",
    config: {
      agentId: "mm-1",
      participantId: MM_PARTICIPANT,
      accountId: MM_ACCOUNT,
      instrumentId: INSTRUMENT_ID,
      anchorPrice: "100.00" as Price,
      halfSpreadTicks: 5,
      quoteLots: 10,
      maxPositionLots: 100,
      requoteTicks: 3,
    },
    viewInstruments: [INSTRUMENT_ID],
    bookDepth: 5,
    wakeSchedule: { everyMs: 300 },
    ...overrides,
  };
}

/** The canonical noise-trader declaration (market IOC, p=1). */
export function noiseTraderDeclaration(
  overrides: Partial<AbidesAgentDeclaration> = {},
): AbidesAgentDeclaration {
  return {
    agentId: "noise-1",
    participantId: NOISE_PARTICIPANT,
    kind: "noise-trader",
    config: {
      agentId: "noise-1",
      participantId: NOISE_PARTICIPANT,
      accountId: NOISE_ACCOUNT,
      instrumentId: INSTRUMENT_ID,
      seed: "noise-seed-1",
      tradeProbability: 1,
      buyProbability: 0.5,
      maxLots: 3,
      maxPositionLots: 50,
    },
    viewInstruments: [INSTRUMENT_ID],
    wakeSchedule: { everyMs: 250 },
    ...overrides,
  };
}

// --- typed command builders (the venue's own command path) ---------------------

/** One submit-order command through the canonical world. */
export function submitCommand(input: {
  readonly commandId: string;
  readonly issuedBy: ParticipantId;
  readonly accountId: AccountId;
  readonly side: "buy" | "sell";
  readonly quantity: string;
  readonly instrumentId?: InstrumentId;
  readonly limitPrice?: string;
  readonly stopPrice?: string;
  readonly timeInForce?: TimeInForce;
  readonly postOnly?: boolean;
  readonly issuedAt?: number;
}): SubmitOrderCommand {
  return {
    kind: "submit-order",
    commandId: input.commandId as CommandId,
    worldId: WORLD_ID,
    issuedBy: input.issuedBy,
    issuedAt: (input.issuedAt ?? CLOCK_ORIGIN) as TimestampMs,
    accountId: input.accountId,
    instrumentId: input.instrumentId ?? INSTRUMENT_ID,
    submission: {
      kind: input.limitPrice === undefined && input.stopPrice === undefined ? "market" : input.stopPrice === undefined ? "limit" : input.limitPrice === undefined ? "stop" : "stop-limit",
      side: input.side,
      quantity: input.quantity as Quantity,
      ...(input.limitPrice === undefined ? {} : { limitPrice: input.limitPrice as Price }),
      ...(input.stopPrice === undefined ? {} : { stopPrice: input.stopPrice as Price }),
      constraints: {
        timeInForce: input.timeInForce ?? "GTC",
        ...(input.postOnly === undefined ? {} : { postOnly: input.postOnly }),
      },
    },
  };
}

/** One cancel-order command through the canonical world. */
export function cancelCommand(input: {
  readonly commandId: string;
  readonly issuedBy: ParticipantId;
  readonly orderId: string;
  readonly issuedAt?: number;
}): CancelOrderCommand {
  return {
    kind: "cancel-order",
    commandId: input.commandId as CommandId,
    worldId: WORLD_ID,
    issuedBy: input.issuedBy,
    issuedAt: (input.issuedAt ?? CLOCK_ORIGIN) as TimestampMs,
    orderId: input.orderId as CancelOrderCommand["orderId"],
  };
}

/** One replace-order command through the canonical world. */
export function replaceCommand(input: {
  readonly commandId: string;
  readonly issuedBy: ParticipantId;
  readonly orderId: string;
  readonly limitPrice?: string;
  readonly quantity?: string;
  readonly issuedAt?: number;
}): ReplaceOrderCommand {
  return {
    kind: "replace-order",
    commandId: input.commandId as CommandId,
    worldId: WORLD_ID,
    issuedBy: input.issuedBy,
    issuedAt: (input.issuedAt ?? CLOCK_ORIGIN) as TimestampMs,
    orderId: input.orderId as ReplaceOrderCommand["orderId"],
    ...(input.limitPrice === undefined ? {} : { limitPrice: input.limitPrice as Price }),
    ...(input.quantity === undefined ? {} : { quantity: input.quantity as Quantity }),
  };
}

/** Let every queued microtask chain run to its blocking point (macrotask hops). */
export async function settleMicrotasks(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

/** Drive one kernel through a fixed step stream (the twin stream). */
export async function driveSteps(
  kernel: { step(deltaMs?: number): Promise<TimestampMs> },
  steps: readonly number[],
): Promise<void> {
  for (const delta of steps) {
    await kernel.step(delta);
  }
}
