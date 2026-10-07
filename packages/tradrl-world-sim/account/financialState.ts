/**
 * The composite financial state (W015 seam): the authoritative account /
 * portfolio / risk slices in one event-sourced record, reduced by ONE
 * function the world core and journal replay share (the single-path law,
 * A6/A9 — live runs and replays produce bit-identical financial state).
 *
 * Spec: spec/SIMULATION.md "Runtime topology" (`World Engine ├─ accounts /
 * portfolio / risk`), spec/DOMAIN-MODEL.md "Ownership" (World Engine →
 * authoritative live state), spec/REQUIREMENTS.md R023 (causal portfolio/
 * risk updates — every financial change is caused by a journaled event).
 *
 * REDUCTION ORDER (the seam law): the portfolio slice advances first (it
 * needs the fill's order side from the matching registry), the account
 * ledger second (fees), and the risk slice last — it evaluates the
 * POST-event portfolio and account state, so breaches are facts of the
 * journal alone. No new event types: the financial slices consume the W014
 * matching taxonomy (`matching.order.filled`, `market.trade.printed`).
 */

import { computeAccountFinancials, initialAccountLedgerState, ledgerOf, reduceAccountLedgerEvent, type AccountFinancials, type AccountLedgerState } from "./index.js";
import { EngineInvariantError } from "../world/errors.js";
import { initialPortfolioState, reducePortfolioEvent, type PortfolioState } from "../portfolio/index.js";
import { initialRiskRuntimeState, reduceRiskEvent, type RiskRuntimeState } from "../risk/index.js";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import type { WorldDefinition } from "../world/definition.js";

/** The authoritative financial state: account ledger + positions + risk. */
export interface FinancialState {
  readonly portfolio: PortfolioState;
  readonly accounts: AccountLedgerState;
  readonly risk: RiskRuntimeState;
}

/**
 * Build the initial financial state from the world definition: declared
 * balances, no positions, peak equity seeded at each account's initial
 * base-currency cash, limits resolved (deterministic — the definition is
 * fixed for the whole run).
 */
export function initialFinancialState(definition: WorldDefinition): FinancialState {
  const accounts = initialAccountLedgerState(definition);
  const initialEquity: Record<string, bigint> = {};
  for (const [accountId, ledger] of Object.entries(accounts.accounts)) {
    initialEquity[accountId] = computeAccountFinancials(ledger, []).equity;
  }
  const risk = initialRiskRuntimeState({
    declaredLimits: definition.riskLimits ?? {},
    accountIds: Object.keys(accounts.accounts),
    initialEquity,
  });
  return {
    portfolio: initialPortfolioState(),
    accounts,
    risk,
  };
}

/**
 * Reduce one journaled event into the financial state. `matching` is the
 * post-event matching slice (the world core reduces it first — the
 * portfolio reducer resolves fill order sides from its registry). Events
 * outside the financial taxonomy pass through unchanged.
 */
export function reduceFinancialEvent(
  state: FinancialState,
  envelope: WorldEventEnvelope,
  matching: {
    readonly orders: ReadonlyArray<{ readonly orderId: string; readonly side: "buy" | "sell" }>;
  },
): FinancialState {
  if (envelope.eventType !== "matching.order.filled" && envelope.eventType !== "market.trade.printed") {
    return state;
  }
  const orderSideOf = (orderId: string): "buy" | "sell" => {
    const order = matching.orders.find((candidate) => String(candidate.orderId) === orderId);
    if (order === undefined) {
      // a fill whose order no journal accepted — corrupt journal, fail closed
      throw new EngineInvariantError(
        `financial reducer: fill cites unknown order ${orderId}`,
      );
    }
    return order.side;
  };
  const portfolio = reducePortfolioEvent(state.portfolio, envelope, orderSideOf);
  const accounts = reduceAccountLedgerEvent(state.accounts, envelope);
  const risk = reduceRiskEvent(state.risk, envelope, {
    accounts: accounts.accounts,
    positions: portfolio.positions,
  });
  if (portfolio === state.portfolio && accounts === state.accounts && risk === state.risk) {
    return state;
  }
  return { portfolio, accounts, risk };
}

/** The ledger of one account (the world core resolves books/accounts here). */
export function financialLedgerOf(state: FinancialState, accountId: string) {
  const ledger = ledgerOf(state.accounts, accountId as never);
  if (ledger === undefined) {
    throw new EngineInvariantError(`financial state has no account ${accountId}`);
  }
  return ledger;
}

/** The computed financials of one account (positions of that account only). */
export function financialsOf(state: FinancialState, accountId: string): AccountFinancials {
  const ledger = financialLedgerOf(state, accountId);
  const positions = state.portfolio.positions.filter(
    (record) => String(record.accountId) === accountId,
  );
  return computeAccountFinancials(ledger, positions);
}
