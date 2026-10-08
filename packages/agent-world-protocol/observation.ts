/**
 * The observation grant protocol (W035): how a possessed agent's substrate
 * receives `ObservedBodyView`s — the W032 view-grant machinery ∩ the W034
 * effective-agent projection, driven by the W023 settled-view discipline.
 *
 * THE GRANT FIRST (the W032 machinery is the authority): one observation
 * begins at a settled clock position, computes the W032 observation grant
 * (`projectBodyObservations` over the effective view, the protocol config
 * and the world's DECLARED information artifacts), and only then reads the
 * port projections THE GRANT admits — content beyond the grant never
 * enters the observed view, not even to be filtered out later.
 *
 * THE SETTLED-VIEW DISCIPLINE (the W023 law, verbatim): the read is only
 * accepted when the clock position is unchanged across the WHOLE read
 * sequence (a trailing clock re-read); a torn attempt is discarded and
 * retried at the new position; a world that never quiets fails closed
 * rather than recording a torn view. A recorded observation therefore
 * never carries a projection from beyond its own `asOf`.
 *
 * THE A7 FIREWALL, twice: (1) the port serves available-then projections
 * only (the engine's own boundary); (2) the grant judges the world's
 * declared artifacts against `asOf` — artifacts whose `availableAt` is
 * after the observation instant are WITHHELD AND NAMED in the grant and
 * never enter the view. The two sources are cross-checked (the port must
 * serve exactly the grant's visible set — a port serving withheld content,
 * or withholding granted content, is a definition/engine inconsistency and
 * fails closed with `grant-inconsistency`).
 *
 * DETERMINISM (A9): the read order is fixed (the grant's instruments in
 * declaration order, each quote→book→trades; then own orders, positions,
 * portfolio, risk; then news), no clocks besides the settled position, no
 * randomness — same world state ⇒ same observed view, bit-for-bit.
 */

import type {
  InformationArtifact,
  Order,
  OrderBookSnapshot,
  Portfolio,
  Position,
  Quote,
  RiskState,
  TimestampMs,
  Trade,
} from "tradrl-world-contracts";
import { BODY_OBSERVATION_KINDS } from "tradrl-world-contracts/agentBody";
import type { ObservedBodyView, ViewDigest } from "tradrl-world-contracts/cognitiveSubstrate";
import { projectBodyObservations } from "agent-body/view";
import { viewDigestOf } from "cognitive-substrate/observedView";
import type {
  AgentObservation,
  AgentWorldClient,
  ObservationConfigError,
  ObservationFailure,
  ObservationProtocolConfig,
  ResolvedObservationProtocol,
} from "./contracts.js";

/**
 * The coherence bound (the W023 law): a pass whose clock keeps moving under
 * the reader is a TORN read, never a settled view. The guard retries the
 * whole read; a world that never quiets fails closed.
 */
const MAX_SETTLED_READ_ATTEMPTS = 64;

function observationFailure(
  code: ObservationFailure["code"],
  message: string,
): ObservationFailure {
  return { code, message };
}

/**
 * Read one settled observation for the session's effective agent: the
 * settled instant, the W032 grant, the granted-content observed view, and
 * the W033 content digest (the citation every decision from this view
 * carries). All reads cross the SAME ports the human surfaces consume.
 */
export async function observeAgentView(
  client: AgentWorldClient,
  protocol: ResolvedObservationProtocol,
): Promise<AgentObservation> {
  for (let attempt = 1; ; attempt += 1) {
    const observation = await readOnce(client, protocol);
    if (observation !== undefined) {
      return observation;
    }
    if (attempt >= MAX_SETTLED_READ_ATTEMPTS) {
      throw observationFailure(
        "torn-read-exhausted",
        `observeAgentView: the clock never settled under the reader (${MAX_SETTLED_READ_ATTEMPTS} torn reads; the world advanced during every attempt); refusing to record a torn view (A7)`,
      );
    }
  }
}

/** One full observation read at the current clock position (undefined = torn). */
async function readOnce(
  client: AgentWorldClient,
  protocol: ResolvedObservationProtocol,
): Promise<AgentObservation | undefined> {
  const { agent } = protocol;
  const view = agent.view;
  const clock = await client.clock.getClock();
  const asOf = clock.simulationTime as TimestampMs;

  // THE GRANT FIRST (pure, over declarations): the W032 machinery judges
  // the request against the effective view and the world's DECLARED
  // artifacts — naming every denial and every withheld artifact.
  const grant = projectBodyObservations(
    view,
    {
      asOf,
      kinds: protocol.kinds,
      instruments: protocol.instruments,
      ...(protocol.kinds.includes("information-artifacts")
        ? { artifacts: protocol.declaredArtifacts.map((artifact) => artifact.artifactId) }
        : {}),
    },
    protocol.declaredArtifacts,
  );

  // The granted read surface (the grant is the authority — nothing beyond
  // it is read, so nothing beyond it can enter the observed view).
  const grantedKinds = grant.kinds as readonly string[];
  const wantsQuote = grantedKinds.includes("market-quote");
  const wantsBook = grantedKinds.includes("market-book");
  const wantsTrades = grantedKinds.includes("market-trades");
  const wantsOwnOrders = grantedKinds.includes("own-orders");
  const wantsPositions = grantedKinds.includes("own-positions");
  const wantsPortfolio = grantedKinds.includes("own-portfolio");
  const wantsRisk = grantedKinds.includes("own-risk");
  const wantsArtifacts = grantedKinds.includes("information-artifacts");

  // The market reads: the grant's instruments, in declaration order, each
  // quote → book → trades (the fixed wire order; A9).
  const quotes: Quote[] = [];
  const books: OrderBookSnapshot[] = [];
  const trades: Trade[] = [];
  for (const instrumentId of grant.instruments) {
    if (wantsQuote) {
      quotes.push(await client.query.getQuote(instrumentId));
    }
    if (wantsBook) {
      books.push(
        await client.query.getOrderBook(
          instrumentId,
          protocol.bookDepth === undefined ? undefined : protocol.bookDepth,
        ),
      );
    }
    if (wantsTrades) {
      trades.push(
        ...(await client.query.getTrades(instrumentId, tradesQuery(protocol, asOf))),
      );
    }
  }

  // The own-state reads: the view's own account (the fixed wire order).
  const ownOrders: readonly Order[] = wantsOwnOrders
    ? await client.query.getOrders({ accountId: agent.accountId })
    : [];
  const ownPositions: readonly Position[] = wantsPositions
    ? await client.query.getPositions(agent.accountId)
    : [];
  const portfolio: Portfolio | undefined = wantsPortfolio
    ? await client.query.getPortfolio(agent.accountId)
    : undefined;
  const riskState: RiskState | undefined = wantsRisk
    ? await client.query.getRisk(agent.accountId)
    : undefined;

  // The information world: the port's available-then artifacts, cross-
  // checked against the grant's visible set (the declared universe).
  let artifacts: readonly InformationArtifact<unknown>[] | undefined;
  if (wantsArtifacts) {
    const served = await client.query.getNews();
    const visibleIds = new Set(grant.visibleArtifacts.map((id) => String(id)));
    const servedIds = new Set(served.map((artifact) => String(artifact.artifactId)));
    const servedButNotGranted = [...servedIds].filter((id) => !visibleIds.has(id));
    const grantedButNotServed = [...visibleIds].filter((id) => !servedIds.has(id));
    if (servedButNotGranted.length > 0 || grantedButNotServed.length > 0) {
      // The port and the grant disagree on the A7 boundary: either the
      // engine serves an artifact the declared universe withholds, or a
      // declared-available artifact never arrived. Both are definition/
      // engine inconsistencies — fail closed, never a silently-partial view.
      throw observationFailure(
        "grant-inconsistency",
        `observeAgentView: the port's available-then artifacts and the observation grant's visible set disagree at asOf ${String(asOf)}` +
          (servedButNotGranted.length > 0 ? ` (served but not granted: ${servedButNotGranted.join(", ")})` : "") +
          (grantedButNotServed.length > 0 ? ` (granted but not served: ${grantedButNotServed.join(", ")})` : ""),
      );
    }
    artifacts = served;
  }

  // THE COHERENCE GUARD: the trailing clock re-read. The whole attempt is
  // discarded when the world moved under the reader (a torn read would
  // carry projections from beyond this observation's own asOf — A7).
  const settled = await client.clock.getClock();
  if (Number(settled.simulationTime) !== Number(asOf)) {
    return undefined;
  }

  // The observed view: granted content only (the W033 input). A granted
  // family is PRESENT even when its read came back empty (an empty tape is
  // honest data; an absent field means "not granted, not read").
  const observed: ObservedBodyView = {
    bodyId: view.bodyId,
    worldId: view.worldId,
    instruments: view.instruments,
    observations: view.observations,
    accountId: view.accountId,
    participantId: agent.participantId,
    asOf,
    ...(wantsQuote ? { quotes } : {}),
    ...(wantsBook ? { books } : {}),
    ...(wantsTrades ? { trades } : {}),
    ...(wantsOwnOrders ? { ownOrders } : {}),
    ...(wantsPositions ? { ownPositions } : {}),
    ...(portfolio === undefined ? {} : { portfolio }),
    ...(riskState === undefined ? {} : { riskState }),
    ...(artifacts === undefined ? {} : { artifacts }),
  };
  const viewDigest: ViewDigest = viewDigestOf(observed);
  return { asOf, grant, view: observed, viewDigest };
}

/** The trades query for one instrument read (the declared window, if any). */
function tradesQuery(
  protocol: ResolvedObservationProtocol,
  asOf: TimestampMs,
): { readonly from?: TimestampMs } {
  if (protocol.tradeWindowMs === undefined) {
    return {};
  }
  return { from: (asOf - protocol.tradeWindowMs) as TimestampMs };
}

/**
 * Resolve the observation protocol at attach (pure): validate the declared
 * config against the effective view — the config may only NARROW the view;
 * a config beyond it is a typed refusal, never a per-pass denial — and
 * fill the defaults (all the view's kinds and instruments when unset). The
 * world's DECLARED information artifacts ride along: the W032 grant judges
 * that universe, so future-dated artifacts are named as withheld even
 * though the port would never serve them.
 */
export function resolveObservationProtocol(
  config: ObservationProtocolConfig | undefined,
  agent: ResolvedObservationProtocol["agent"],
  declaredArtifacts: readonly InformationArtifact<unknown>[],
): { readonly ok: true; readonly protocol: ResolvedObservationProtocol } | {
  readonly ok: false;
  readonly errors: readonly ObservationConfigError[];
} {
  const errors: ObservationConfigError[] = [];
  const view = agent.view;

  const kinds = config?.kinds ?? [...view.observations];
  const seenKinds = new Set<string>();
  for (const kind of kinds) {
    const name = String(kind);
    if (!(BODY_OBSERVATION_KINDS as readonly string[]).includes(name)) {
      errors.push({
        code: "unknown-observation-kind",
        message: `observation config declares '${name}' which is not a BodyObservationKind`,
      });
      continue;
    }
    if (seenKinds.has(name)) {
      errors.push({
        code: "duplicate-config-entry",
        message: `observation config declares the kind '${name}' more than once`,
      });
    }
    seenKinds.add(name);
    if (!view.observations.includes(kind)) {
      errors.push({
        code: "kind-beyond-view",
        message: `observation config declares '${name}' which the effective view does not admit (view: ${view.observations.join(", ")})`,
      });
    }
  }

  const instruments = config?.instruments ?? [...view.instruments];
  const seenInstruments = new Set<string>();
  for (const instrumentId of instruments) {
    const name = String(instrumentId);
    if (seenInstruments.has(name)) {
      errors.push({
        code: "duplicate-config-entry",
        message: `observation config declares the instrument ${name} more than once`,
      });
    }
    seenInstruments.add(name);
    if (!view.instruments.includes(instrumentId)) {
      errors.push({
        code: "instrument-beyond-view",
        message: `observation config declares instrument ${name} which is outside the effective view (view instruments: ${view.instruments.map((one) => String(one)).join(", ")})`,
      });
    }
  }

  const bookDepth = config?.bookDepth;
  if (bookDepth !== undefined && (!Number.isInteger(bookDepth) || bookDepth < 1)) {
    errors.push({
      code: "invalid-book-depth",
      message: `bookDepth must be an integer ≥ 1 when present (got '${String(bookDepth)}')`,
    });
  }
  const tradeWindowMs = config?.tradeWindowMs;
  if (tradeWindowMs !== undefined && (!Number.isFinite(tradeWindowMs) || tradeWindowMs < 0)) {
    errors.push({
      code: "invalid-trade-window",
      message: `tradeWindowMs must be finite and ≥ 0 when present (got '${String(tradeWindowMs)}')`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    protocol: {
      agent,
      kinds,
      instruments,
      ...(bookDepth === undefined ? {} : { bookDepth }),
      ...(tradeWindowMs === undefined ? {} : { tradeWindowMs }),
      declaredArtifacts,
    },
  };
}
