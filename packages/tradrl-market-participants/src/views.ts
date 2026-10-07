/**
 * The settled-view reader (W023) — the ONLY observation path of a reactive
 * participant: the declared view set, read through the QueryPort in a fixed
 * order, at a settled clock position.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A7 — the information firewall is applied
 * at the port boundary (trades by availableAt, news by observable-then, all
 * projections at the clock position); this reader adds NOTHING the ports do
 * not serve and asks only for the declared set (the observation surface IS
 * the declaration). Spec: A6 — the views are projections; the reader never
 * fabricates, never caches across passes, and never reads engine state.
 *
 * DETERMINISM (A9): the reads are sequential awaits in the FIXED declared
 * order (instruments in declaration order, then portfolio, risk, orders,
 * news), so the wire order — and therefore the engine's arrival order — is a
 * deterministic function of the view config. One pass = one fresh view.
 */

import type {
  ClockView,
  Instrument,
  InstrumentId,
  Order,
  OrderBookSnapshot,
  Portfolio,
  Quote,
  RiskState,
  TimestampMs,
  Trade,
} from "tradrl-world-contracts";
import type { NewsItem } from "tradrl-world-contracts";
import type {
  ParticipantSettledView,
  ParticipantViewConfig,
  ReactiveParticipantWorldClient,
} from "../../tradrl-world-contracts/src/participantProtocol.js";
// NOTE(tradrl-world-contracts): the W023 protocol module is imported by the
// relative source path because the package's `exports` map registration
// ("./participantProtocol") is a TL action item (the frozen write surface
// forbids editing the contracts manifest). Type-only; erased at runtime.

/**
 * The coherence bound: a pass whose clock keeps moving under the reader is a
 * TORN read (projections from beyond the pass's own observedAt — an A7
 * violation), never a settled view. The guard retries the whole read; a world
 * that never quiets fails closed rather than recording a torn view.
 */
const MAX_SETTLED_READ_ATTEMPTS = 64;

/**
 * Read one settled view: the clock first, then the declared instrument
 * projections in declaration order, then the account's financial projections
 * and own orders, then news when declared. All reads cross the SAME ports
 * the human surfaces consume (A4/A15).
 *
 * COHERENCE (A7, the settled-view contract): the operator may advance the
 * world while a pass is mid-read. The read is only accepted when the clock
 * position is unchanged across the WHOLE read sequence (a trailing clock
 * re-read); otherwise the torn attempt is discarded and retried at the new
 * position. A recorded view therefore never carries a projection from beyond
 * its own `observedAt` — the never-future law holds by construction.
 */
export async function readSettledView(
  client: ReactiveParticipantWorldClient,
  config: ParticipantViewConfig,
): Promise<ParticipantSettledView> {
  for (let attempt = 1; ; attempt += 1) {
    const view = await readViewOnce(client, config);
    const settled: ClockView = await client.clock.getClock();
    if (Number(settled.simulationTime) === Number(view.observedAt)) {
      return view;
    }
    if (attempt >= MAX_SETTLED_READ_ATTEMPTS) {
      throw new Error(
        `readSettledView: the clock never settled under the reader (${MAX_SETTLED_READ_ATTEMPTS} torn reads; the world advanced during every attempt); refusing to record a torn view (A7)`,
      );
    }
  }
}

/** One full view read at the current clock position (possibly torn). */
async function readViewOnce(
  client: ReactiveParticipantWorldClient,
  config: ParticipantViewConfig,
): Promise<ParticipantSettledView> {
  const clock: ClockView = await client.clock.getClock();
  const observedAt = clock.simulationTime as TimestampMs;

  const instruments: Instrument[] = [];
  const quotes: Quote[] = [];
  const books: OrderBookSnapshot[] = [];
  const trades: Trade[] = [];
  for (const instrumentId of config.instruments) {
    instruments.push(await client.query.getInstrument(instrumentId));
    quotes.push(await client.query.getQuote(instrumentId));
    books.push(
      await client.query.getOrderBook(
        instrumentId,
        config.bookDepth === undefined ? undefined : config.bookDepth,
      ),
    );
    trades.push(
      ...(await client.query.getTrades(instrumentId, tradesQuery(config, observedAt))),
    );
  }
  const portfolio: Portfolio = await client.query.getPortfolio(config.accountId);
  const risk: RiskState = await client.query.getRisk(config.accountId);
  const orders: readonly Order[] = await client.query.getOrders({
    accountId: config.accountId,
  });
  const news: readonly NewsItem[] | undefined = config.includeNews
    ? await client.query.getNews()
    : undefined;

  const view: ParticipantSettledView = {
    observedAt,
    clock,
    instruments,
    quotes,
    books,
    trades,
    portfolio,
    risk,
    orders,
    ...(news === undefined ? {} : { news }),
  };
  return Object.freeze(view);
}

/** The trades query for one instrument read (the declared window, if any). */
function tradesQuery(
  config: ParticipantViewConfig,
  observedAt: TimestampMs,
): { readonly from?: TimestampMs } {
  if (config.tradeWindowMs === undefined) {
    return {};
  }
  return { from: (observedAt - config.tradeWindowMs) as TimestampMs };
}

/** The declared instrument ids of a view config (identity helper). */
export function viewInstruments(config: ParticipantViewConfig): readonly InstrumentId[] {
  return config.instruments;
}
