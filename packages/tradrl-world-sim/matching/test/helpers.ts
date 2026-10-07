/**
 * Shared test fixtures for the W014 matching module tests.
 *
 * Everything is deterministic: fixed ids, fixed times, a two-participant
 * world (maker + taker with their own accounts) so crossing orders and
 * fills can be exercised, and a fee/latency venue to make fees and
 * observability delays observable in assertions.
 */

import type {
  Account,
  CancelOrderCommand,
  Instrument,
  Participant,
  Price,
  Quantity,
  ReplaceOrderCommand,
  SubmitOrderCommand,
  TimestampMs,
  Venue,
} from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { PendingEventDraft } from "../../journal/eventJournal.js";
import { eventIdFor } from "../../journal/eventJournal.js";
import type { WorldDefinition } from "../../world/index.js";
import type { ReduceOnlyPositionCheck } from "../index.js";
import type { MatchingCommandOutcome } from "../index.js";
import type { MatchingState } from "../index.js";
import { applyMatchingCommand, initialMatchingState, reduceMatchingEvent } from "../index.js";

export const WORLD = "world-w014-tests" as WorldDefinition["scope"]["worldId"];
export const TENANT = "tenant-alpha" as WorldDefinition["scope"]["tenantId"];
export const PROJECT = "project-one" as WorldDefinition["scope"]["projectId"];
export const MAKER = "participant-maker" as Participant["participantId"];
export const TAKER = "participant-taker" as Participant["participantId"];
export const MAKER_ACCOUNT = "account-maker" as Account["accountId"];
export const TAKER_ACCOUNT = "account-taker" as Account["accountId"];
export const INSTRUMENT = "instrument-es-fut" as Instrument["instrumentId"];
export const VENUE_ID = "venue-sim" as Venue["venueId"];
export const START = 1_700_000_000_000;

export function testInstrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    instrumentId: INSTRUMENT,
    worldId: WORLD,
    venueId: VENUE_ID,
    symbol: "ES-TEST",
    assetClass: "future",
    quoteCurrency: "USD" as never,
    tickSize: "0.25" as never,
    lotSize: "1" as never,
    pricePrecision: 2,
    quantityPrecision: 0,
    tradingState: "open",
    tradable: true,
    ...overrides,
  };
}

/** A venue with real fees (2 bps maker / 5 bps taker + 0.10 fixed) and no latency. */
export function testVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    venueId: VENUE_ID,
    worldId: WORLD,
    name: "sim-venue",
    matchingModel: "price-time-priority",
    allowedOrderKinds: ["market", "limit", "stop", "stop-limit"],
    feeSchedule: { makerRateBps: 2, takerRateBps: 5, fixedFee: "0.10" as never },
    latency: { acknowledgementMs: 0, fillPropagationMs: 0 },
    calendar: { sessions: [{ opensAt: 0 as never, closesAt: Number.MAX_SAFE_INTEGER as never }] },
    haltPolicy: { haltOnShock: false },
    ...overrides,
  };
}

function accountOf(accountId: Account["accountId"]): Account {
  return {
    accountId,
    worldId: WORLD,
    balances: { USD: { amount: "1000000.00", currency: "USD" } } as never,
    buyingPower: { amount: "1000000.00" as never, currency: "USD" as never },
    marginUsed: { amount: "0.00" as never, currency: "USD" as never },
    marginAvailable: { amount: "1000000.00" as never, currency: "USD" as never },
    leverage: 1,
    permissions: { canTrade: true, canShort: true, liveExecutionAllowed: false },
  };
}

export function matchingDefinition(overrides: Partial<WorldDefinition> = {}): WorldDefinition {
  return {
    scope: { tenantId: TENANT, projectId: PROJECT, worldId: WORLD },
    mode: "reactive-replay",
    seed: "w014-test-seed",
    worldDefinitionVersion: "w014-test-def@1",
    inputDataSource: "synthetic://w014-tests",
    clock: {
      start: START as never,
      defaultStepMs: 1000,
      initialWallTime: (START + 5_000) as never,
    },
    instruments: [testInstrument()],
    venues: [testVenue()],
    accounts: [accountOf(MAKER_ACCOUNT), accountOf(TAKER_ACCOUNT)],
    participants: [
      { participantId: MAKER, worldId: WORLD, kind: "human", accountId: MAKER_ACCOUNT },
      { participantId: TAKER, worldId: WORLD, kind: "human", accountId: TAKER_ACCOUNT },
    ],
    ...overrides,
  };
}

export function submitOrder(
  overrides: Partial<SubmitOrderCommand> & {
    submission?: Partial<SubmitOrderCommand["submission"]>;
  } = {},
): SubmitOrderCommand {
  return {
    kind: "submit-order",
    commandId: "cmd-order-1" as never,
    worldId: WORLD,
    issuedBy: TAKER,
    issuedAt: START as never,
    accountId: TAKER_ACCOUNT,
    instrumentId: INSTRUMENT,
    submission: {
      kind: "limit",
      side: "buy",
      quantity: "10" as Quantity,
      limitPrice: "4800.25" as Price,
      constraints: { timeInForce: "GTC" },
      ...overrides.submission,
    },
    ...overrides,
  };
}

export function cancelOrder(overrides: Partial<CancelOrderCommand> = {}): CancelOrderCommand {
  return {
    kind: "cancel-order",
    commandId: "cmd-cancel-1" as never,
    worldId: WORLD,
    issuedBy: TAKER,
    issuedAt: START as never,
    orderId: "ord:world-w014-tests:1" as never,
    ...overrides,
  };
}

export function replaceOrder(overrides: Partial<ReplaceOrderCommand> = {}): ReplaceOrderCommand {
  return {
    kind: "replace-order",
    commandId: "cmd-replace-1" as never,
    worldId: WORLD,
    issuedBy: TAKER,
    issuedAt: START as never,
    orderId: "ord:world-w014-tests:1" as never,
    ...overrides,
  };
}

/** Seal drafts exactly the way the journal will (sequence, deterministic eventId). */
export function sealDrafts(
  drafts: readonly PendingEventDraft[],
  startSequence: number,
): WorldEventEnvelope[] {
  return drafts.map((draft, index) => {
    const sequence = (startSequence + index) as never;
    return {
      worldId: WORLD,
      sequence,
      eventId: eventIdFor(WORLD, sequence),
      eventType: draft.eventType,
      occurredAt: draft.occurredAt,
      ...(draft.availableAt === undefined ? {} : { availableAt: draft.availableAt }),
      causationId: draft.causationId,
      correlationId: draft.correlationId,
      producer: draft.producer,
      schemaVersion: draft.schemaVersion,
      payload: draft.payload,
    } satisfies WorldEventEnvelope;
  });
}

export interface DriveOptions {
  readonly simulationTime?: TimestampMs;
  readonly reduceOnlyCheck?: ReduceOnlyPositionCheck;
}

export interface DriveResult {
  readonly state: MatchingState;
  readonly outcomes: readonly MatchingCommandOutcome[];
  readonly envelopes: readonly WorldEventEnvelope[];
}

/**
 * Drive a command stream through the seam the way the world engine will:
 * apply → seal drafts → reduce through the SAME reducer the engine uses.
 * The result is the externally-reduced state (what replay would compute).
 */
export function drive(
  commands: readonly (SubmitOrderCommand | CancelOrderCommand | ReplaceOrderCommand)[],
  options: DriveOptions & { readonly definition?: WorldDefinition } = {},
): DriveResult {
  const definition = options.definition ?? matchingDefinition();
  let state = initialMatchingState(definition);
  let nextSequence = 1;
  const outcomes: MatchingCommandOutcome[] = [];
  const envelopes: WorldEventEnvelope[] = [];
  for (const command of commands) {
    const outcome = applyMatchingCommand(command, {
      definition,
      matching: state,
      simulationTime: (options.simulationTime ?? START) as never,
      nextSequence: nextSequence as never,
      ...(options.reduceOnlyCheck === undefined
        ? {}
        : { reduceOnlyCheck: options.reduceOnlyCheck }),
    });
    outcomes.push(outcome);
    if (outcome.kind === "applied") {
      for (const envelope of sealDrafts(outcome.drafts, nextSequence)) {
        envelopes.push(envelope);
        state = reduceMatchingEvent(state, envelope);
      }
      nextSequence += outcome.drafts.length;
    }
  }
  return { state, outcomes, envelopes };
}

/** Event types of a drive's envelopes (handy for order assertions). */
export function eventTypes(envelopes: readonly WorldEventEnvelope[]): string[] {
  return envelopes.map((envelope) => envelope.eventType);
}
