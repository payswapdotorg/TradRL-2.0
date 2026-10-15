/**
 * The coalesced drain read binder (W030 `performance` module).
 *
 * Executes one drain: ONE port read per drain entry, in the drain's canonical
 * order (sequential awaits — the W023 fixed-order determinism discipline).
 * The read value IS the latest projection at the observation point (A6: never
 * a blend — the coalescer holds no values, the port reads are fresh).
 *
 * Spec: spec/WORLD-PROTOCOL.md "Ports" (QueryPort is the single read
 * surface); spec/ARCHITECTURE-LOCK.md A7 (the firewall applies at the port
 * boundary — the binder reads through the same ports every other consumer
 * uses, so observability laws hold by construction).
 */

import type {
  EventQuery,
  InstrumentId,
  NewsQuery,
  NewsItem,
  Order,
  OrderBookSnapshot,
  OrderQuery,
  Portfolio,
  Position,
  QueryPort,
  Quote,
  RiskState,
  TimestampMs,
  TimelineSlice,
  Trade,
  AccountId,
} from "tradrl-world-contracts";
import type { CoalescedDrain, CoalescedSurfaceEntry } from "./coalescer.js";

/** Read parameters for the query-shaped surfaces (optional, deterministic). */
export interface CoalescedReadParams {
  /** `getOrderBook` depth (undefined: the full book). */
  readonly orderbookDepth?: number;
  /** `getTrades` query per instrument key. */
  readonly tradesQuery?: { readonly from?: TimestampMs; readonly to?: TimestampMs; readonly limit?: number };
  /** `getOrders` query per account key. */
  readonly ordersQuery?: OrderQuery;
  /** `getNews` query. */
  readonly newsQuery?: NewsQuery;
  /** `getTimeline` query. */
  readonly timelineQuery?: EventQuery;
}

/** One coalesced projection value: the port read result for one drain entry. */
export type CoalescedProjection =
  | { readonly surface: "quote"; readonly key: string | undefined; readonly value: Quote }
  | { readonly surface: "orderbook"; readonly key: string | undefined; readonly value: OrderBookSnapshot }
  | { readonly surface: "trades"; readonly key: string | undefined; readonly value: readonly Trade[] }
  | { readonly surface: "orders"; readonly key: string | undefined; readonly value: readonly Order[] }
  | { readonly surface: "positions"; readonly key: string | undefined; readonly value: readonly Position[] }
  | { readonly surface: "portfolio"; readonly key: string | undefined; readonly value: Portfolio }
  | { readonly surface: "risk"; readonly key: string | undefined; readonly value: RiskState }
  | { readonly surface: "news"; readonly key: string | undefined; readonly value: readonly NewsItem[] }
  | { readonly surface: "timeline"; readonly key: string | undefined; readonly value: TimelineSlice };

/** A drain read failed (fail-closed: the entry identifies the surface). */
export class CoalescedReadError extends Error {
  constructor(
    readonly entry: CoalescedSurfaceEntry,
    readonly cause: unknown,
  ) {
    super(
      `coalesced read failed for surface '${entry.surface}' key '${String(entry.key)}': ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "CoalescedReadError";
  }
}

function instrumentKeyOf(entry: CoalescedSurfaceEntry): InstrumentId {
  if (entry.key === undefined) {
    throw new CoalescedReadError(entry, new Error("instrument-keyed surface drained without a key"));
  }
  return entry.key as InstrumentId;
}

function accountKeyOf(entry: CoalescedSurfaceEntry): AccountId {
  if (entry.key === undefined) {
    throw new CoalescedReadError(entry, new Error("account-keyed surface drained without a key"));
  }
  return entry.key as AccountId;
}

/**
 * Read one drain through the QueryPort: one read per entry, canonical order,
 * fresh values (the A6 projection law — the latest projection, never a
 * blend). Rejects with {@link CoalescedReadError} on the first failed read.
 */
export async function readCoalescedDrain(
  drain: CoalescedDrain,
  ports: { readonly query: QueryPort },
  params: CoalescedReadParams = {},
): Promise<readonly CoalescedProjection[]> {
  const values: CoalescedProjection[] = [];
  for (const entry of drain.entries) {
    try {
      switch (entry.surface) {
        case "quote":
          values.push({
            surface: "quote",
            key: entry.key,
            value: await ports.query.getQuote(instrumentKeyOf(entry)),
          });
          break;
        case "orderbook":
          values.push({
            surface: "orderbook",
            key: entry.key,
            value: await ports.query.getOrderBook(
              instrumentKeyOf(entry),
              params.orderbookDepth,
            ),
          });
          break;
        case "trades":
          values.push({
            surface: "trades",
            key: entry.key,
            value: await ports.query.getTrades(instrumentKeyOf(entry), params.tradesQuery),
          });
          break;
        case "orders":
          values.push({
            surface: "orders",
            key: entry.key,
            value: await ports.query.getOrders({
              ...params.ordersQuery,
              ...(entry.key === undefined ? {} : { accountId: accountKeyOf(entry) }),
            }),
          });
          break;
        case "positions":
          values.push({
            surface: "positions",
            key: entry.key,
            value: await ports.query.getPositions(
              entry.key === undefined ? undefined : accountKeyOf(entry),
            ),
          });
          break;
        case "portfolio":
          values.push({
            surface: "portfolio",
            key: entry.key,
            value: await ports.query.getPortfolio(
              entry.key === undefined ? undefined : accountKeyOf(entry),
            ),
          });
          break;
        case "risk":
          values.push({
            surface: "risk",
            key: entry.key,
            value: await ports.query.getRisk(
              entry.key === undefined ? undefined : accountKeyOf(entry),
            ),
          });
          break;
        case "news":
          values.push({
            surface: "news",
            key: entry.key,
            value: await ports.query.getNews(params.newsQuery),
          });
          break;
        case "timeline":
          values.push({
            surface: "timeline",
            key: entry.key,
            value: await ports.query.getTimeline(params.timelineQuery),
          });
          break;
      }
    } catch (cause) {
      if (cause instanceof CoalescedReadError) {
        throw cause;
      }
      throw new CoalescedReadError(entry, cause);
    }
  }
  return values;
}

/** The port-read value type of each coalesced surface. */
export interface CoalescedSurfaceValue {
  readonly quote: Quote;
  readonly orderbook: OrderBookSnapshot;
  readonly trades: readonly Trade[];
  readonly orders: readonly Order[];
  readonly positions: readonly Position[];
  readonly portfolio: Portfolio;
  readonly risk: RiskState;
  readonly news: readonly NewsItem[];
  readonly timeline: TimelineSlice;
}

/** Find one surface's latest value in a coalesced batch (test/diagnostic helper). */
export function coalescedValueOf<S extends keyof CoalescedSurfaceValue>(
  batch: readonly CoalescedProjection[],
  surface: S,
  key: string | undefined,
): CoalescedSurfaceValue[S] | undefined {
  const found = batch.find(
    (entry) => entry.surface === surface && entry.key === key,
  );
  return found === undefined ? undefined : (found.value as CoalescedSurfaceValue[S]);
}
