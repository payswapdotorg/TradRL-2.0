/**
 * The ABIDES world definition (W024) — the declared, immutable configuration
 * a reactive market is constructed from, its LOUD construction-time
 * validation, and its canonical digest.
 *
 * Spec: spec/WORLD-PROTOCOL.md "Determinism" — the manifest carries the world
 * definition version and input hashes; the digest here is that input hash's
 * source. Spec: spec/ARCHITECTURE-LOCK.md A9 — the definition is a fixed,
 * declarative value: fixed definition + engine version + seed + command
 * stream ⇒ identical results (proven by the twin runs in
 * test/determinism.twin.test.ts).
 *
 * FAIL-CLOSED AT THE BOUNDARY: every structural problem throws a typed
 * ./errors.ts violation at CONSTRUCTION — blank ids, duplicate ids, an
 * instrument naming a venue absent from the registry ("unregistered-venue"),
 * a participant without a latency declaration, a seed order that violates
 * tick/lot laws. A malformed world never runs; there are no silent defaults.
 *
 * The venue-side latency reuses the canonical `VenueLatency` contract
 * (R022); the actor-side latency uses ./latency.ts (`AgentLatencySpec`).
 * Every actor in a reactive market declares latency — that is the law here.
 *
 * CLEAN-ROOM: original TypeScript; no upstream ABIDES code (README.md).
 */

import type {
  Account,
  FeeSchedule,
  Instrument,
  InstrumentId,
  OrderKind,
  OrderSide,
  Participant,
  ParticipantId,
  Price,
  Quantity,
  RiskLimits,
  TimestampMs,
  VenueId,
  VenueLatency,
  WorldId,
  WorldScope,
} from "tradrl-world-contracts";
import { AbidesAdapterError } from "./errors.js";
import { assertLatencySpec, type AgentLatencySpec } from "./latency.js";
import { parseScaled, type Scaled } from "./book.js";

/** One registered exchange venue (the canonical `VenueLatency` is reused verbatim). */
export interface AbidesVenueConfig {
  readonly venueId: VenueId;
  readonly name: string;
  readonly latency: VenueLatency;
  readonly feeSchedule: FeeSchedule;
  /** Order kinds this venue accepts (anything else: `order-kind-not-supported`). */
  readonly allowedOrderKinds: readonly OrderKind[];
}

/** One opening-book order — placed through the SAME command path as everything else. */
export interface AbidesSeedOrder {
  readonly participantId: ParticipantId;
  readonly instrumentId: InstrumentId;
  readonly side: OrderSide;
  readonly price: Price;
  readonly quantity: Quantity;
}

/** The declared world. */
export interface AbidesWorldDefinition {
  readonly worldId: WorldId;
  readonly scope: WorldScope;
  readonly seed: string;
  readonly worldDefinitionVersion: string;
  readonly inputDataSource: string;
  readonly clockOrigin: TimestampMs;
  /** The default clock step (`ClockPort.step()` with no argument), in simulated ms. */
  readonly defaultStepMs: number;
  readonly venues: readonly AbidesVenueConfig[];
  readonly instruments: readonly Instrument[];
  readonly accounts: readonly Account[];
  readonly participants: readonly Participant[];
  /** EVERY participant declares its transport latency (the reactive-market law). */
  readonly participantLatency: Readonly<Record<string, AgentLatencySpec>>;
  /** Optional per-account risk limits (unset accounts serve empty limits — declared, never silent). */
  readonly accountRiskLimits?: Readonly<Record<string, RiskLimits>>;
  readonly seedOrders: readonly AbidesSeedOrder[];
}

const ORDER_KINDS: readonly OrderKind[] = ["market", "limit", "stop", "stop-limit"];
const SIDES: readonly OrderSide[] = ["buy", "sell"];

function isBlank(text: string): boolean {
  return typeof text !== "string" || text.trim().length === 0;
}

/** Validate the whole definition loudly (throws typed violations). */
export function validateAbidesWorldDefinition(definition: AbidesWorldDefinition): void {
  const problems: string[] = [];
  if (isBlank(String(definition.worldId))) problems.push("worldId is blank");
  if (isBlank(definition.seed)) problems.push("seed is blank");
  if (isBlank(definition.worldDefinitionVersion)) problems.push("worldDefinitionVersion is blank");
  if (isBlank(definition.inputDataSource)) problems.push("inputDataSource is blank");
  if (!Number.isInteger(definition.clockOrigin) || definition.clockOrigin < 0) {
    problems.push(`clockOrigin must be a non-negative integer (got ${String(definition.clockOrigin)})`);
  }
  if (!Number.isInteger(definition.defaultStepMs) || definition.defaultStepMs <= 0) {
    problems.push(`defaultStepMs must be a positive integer (got ${String(definition.defaultStepMs)})`);
  }
  if (definition.venues.length === 0) problems.push("at least one venue is required");

  const venueIds = new Set<string>();
  for (const venue of definition.venues) {
    if (isBlank(String(venue.venueId))) problems.push("a venue has a blank venueId");
    if (venueIds.has(String(venue.venueId))) problems.push(`duplicate venueId ${String(venue.venueId)}`);
    venueIds.add(String(venue.venueId));
    if (isBlank(venue.name)) problems.push(`venue ${String(venue.venueId)} has a blank name`);
    if (
      !Number.isInteger(venue.latency.acknowledgementMs) ||
      venue.latency.acknowledgementMs < 0
    ) {
      problems.push(`venue ${String(venue.venueId)} acknowledgementMs must be a non-negative integer`);
    }
    if (!Number.isInteger(venue.latency.fillPropagationMs) || venue.latency.fillPropagationMs < 0) {
      problems.push(`venue ${String(venue.venueId)} fillPropagationMs must be a non-negative integer`);
    }
    if (venue.feeSchedule.makerRateBps < 0 || venue.feeSchedule.takerRateBps < 0) {
      problems.push(`venue ${String(venue.venueId)} fee rates must be non-negative`);
    }
    if (venue.allowedOrderKinds.length === 0) {
      problems.push(`venue ${String(venue.venueId)} accepts no order kinds`);
    }
    for (const kind of venue.allowedOrderKinds) {
      if (!ORDER_KINDS.includes(kind)) {
        problems.push(`venue ${String(venue.venueId)} allows unknown order kind ${String(kind)}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new AbidesAdapterError("malformed-world-definition", problems.join("; "));
  }

  // Instruments: unique, listed on REGISTERED venues (the unregistered-venue gate).
  const instrumentIds = new Set<string>();
  const parsedInstruments = new Map<string, { tick: Scaled; lot: Scaled; venueId: string }>();
  for (const instrument of definition.instruments) {
    const id = String(instrument.instrumentId);
    if (isBlank(id)) problems.push("an instrument has a blank instrumentId");
    if (instrumentIds.has(id)) problems.push(`duplicate instrumentId ${id}`);
    instrumentIds.add(id);
    if (String(instrument.worldId) !== String(definition.worldId)) {
      problems.push(`instrument ${id} carries a foreign worldId`);
    }
    if (!venueIds.has(String(instrument.venueId))) {
      // THE fail-closed unregistered-venue path (work-order law).
      throw new AbidesAdapterError(
        "unregistered-venue",
        `instrument ${id} is listed on venue ${String(instrument.venueId)} which is not registered in this world (registered: ${[...venueIds].join(", ") || "none"})`,
      );
    }
    const tick = parseScaled(String(instrument.tickSize));
    const lot = parseScaled(String(instrument.lotSize));
    if (tick === undefined || tick <= 0n) problems.push(`instrument ${id} tickSize must be a positive canonical decimal`);
    if (lot === undefined || lot <= 0n) problems.push(`instrument ${id} lotSize must be a positive canonical decimal`);
    if (!Number.isInteger(instrument.pricePrecision) || instrument.pricePrecision < 0 || instrument.pricePrecision > 12) {
      problems.push(`instrument ${id} pricePrecision must be an integer in 0..12`);
    }
    if (!Number.isInteger(instrument.quantityPrecision) || instrument.quantityPrecision < 0 || instrument.quantityPrecision > 12) {
      problems.push(`instrument ${id} quantityPrecision must be an integer in 0..12`);
    }
    if (tick !== undefined && lot !== undefined) {
      parsedInstruments.set(id, { tick, lot, venueId: String(instrument.venueId) });
    }
  }
  if (definition.instruments.length === 0) problems.push("at least one instrument is required");
  if (problems.length > 0) {
    throw new AbidesAdapterError("malformed-world-definition", problems.join("; "));
  }

  // Accounts: unique, simulated-only (A14), canonical opening cash.
  const accountIds = new Set<string>();
  for (const account of definition.accounts) {
    const id = String(account.accountId);
    if (isBlank(id)) problems.push("an account has a blank accountId");
    if (accountIds.has(id)) problems.push(`duplicate accountId ${id}`);
    accountIds.add(id);
    if (String(account.worldId) !== String(definition.worldId)) {
      problems.push(`account ${id} carries a foreign worldId`);
    }
    if (account.permissions.liveExecutionAllowed !== false) {
      throw new AbidesAdapterError(
        "live-execution-not-permitted",
        `account ${id} declares live execution permission — this simulation adapter is simulated-only by construction (A14)`,
      );
    }
    const cash = parseScaled(String(account.buyingPower.amount));
    if (cash === undefined || cash < 0n) {
      problems.push(`account ${id} buyingPower must be a non-negative canonical decimal (the adapter's declared opening cash)`);
    }
  }
  if (problems.length > 0) {
    throw new AbidesAdapterError("malformed-world-definition", problems.join("; "));
  }

  // Participants: unique, on registered accounts, WITH latency declarations.
  const participantIds = new Set<string>();
  for (const participant of definition.participants) {
    const id = String(participant.participantId);
    if (isBlank(id)) problems.push("a participant has a blank participantId");
    if (participantIds.has(id)) problems.push(`duplicate participantId ${id}`);
    participantIds.add(id);
    if (String(participant.worldId) !== String(definition.worldId)) {
      problems.push(`participant ${id} carries a foreign worldId`);
    }
    if (!accountIds.has(String(participant.accountId))) {
      problems.push(`participant ${id} trades unknown account ${String(participant.accountId)}`);
    }
    const latency = definition.participantLatency[id];
    if (latency === undefined) {
      problems.push(`participant ${id} has NO latency declaration (every actor in a reactive market declares latency)`);
    } else {
      assertLatencySpec(latency, `participantLatency[${id}]`);
    }
  }
  for (const id of Object.keys(definition.participantLatency)) {
    if (!participantIds.has(id)) {
      problems.push(`participantLatency declares unknown participant ${id}`);
    }
  }
  if (problems.length > 0) {
    throw new AbidesAdapterError("malformed-world-definition", problems.join("; "));
  }

  // Optional per-account risk limits: known accounts only (loud, never silent).
  for (const [id, limits] of Object.entries(definition.accountRiskLimits ?? {})) {
    if (!accountIds.has(id)) {
      problems.push(`accountRiskLimits declares unknown account ${id}`);
    }
    if (limits === null || typeof limits !== "object") {
      problems.push(`accountRiskLimits[${id}] must be a RiskLimits object`);
    }
  }
  if (problems.length > 0) {
    throw new AbidesAdapterError("malformed-world-definition", problems.join("; "));
  }

  // Seed orders: registered participant + instrument, tick/lot lawful.
  for (const [index, order] of definition.seedOrders.entries()) {
    const label = `seedOrders[${String(index)}]`;
    if (!participantIds.has(String(order.participantId))) {
      problems.push(`${label} references unknown participant ${String(order.participantId)}`);
    }
    const instrument = parsedInstruments.get(String(order.instrumentId));
    if (instrument === undefined) {
      problems.push(`${label} references unknown instrument ${String(order.instrumentId)}`);
      continue;
    }
    if (!SIDES.includes(order.side)) problems.push(`${label} has an invalid side`);
    const price = parseScaled(String(order.price));
    if (price === undefined || price <= 0n) {
      problems.push(`${label} price must be a positive canonical decimal`);
    } else if (price % instrument.tick !== 0n) {
      problems.push(`${label} price ${String(order.price)} is not a tick multiple`);
    }
    const quantity = parseScaled(String(order.quantity));
    if (quantity === undefined || quantity <= 0n) {
      problems.push(`${label} quantity must be a positive canonical decimal`);
    } else if (quantity % instrument.lot !== 0n) {
      problems.push(`${label} quantity ${String(order.quantity)} is not a lot multiple`);
    }
  }
  if (problems.length > 0) {
    throw new AbidesAdapterError("malformed-world-definition", problems.join("; "));
  }
}

/** Stable serialization: object keys sorted, arrays in order, numbers as-is (deterministic). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

/** FNV-1a 32-bit over the stable text (the deterministic input hash). */
export function hash32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** The world definition digest (the determinism manifest's input hash). */
export function abidesWorldDigest(definition: AbidesWorldDefinition): string {
  return hash32(stableStringify(definition));
}
