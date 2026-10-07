/**
 * The account ledger state (W015 `account` module): the authoritative
 * balances per account, advanced ONLY by reducing journaled events.
 *
 * Spec: spec/ARCHITECTURE-LOCK.md A6/A9 (single-path reduction — the same
 * reducer advances live and replay state), spec/ARCHITECTURE.md §5
 * (Account: balances, buying power, margin, leverage, permissions),
 * spec/DOMAIN-MODEL.md "Financial precision".
 *
 * LEDGER MODEL (documented, World Alpha — a derivatives margin account):
 * - Balances start from the world definition's declared accounts. The
 *   quote-currency fee of every journaled fill is charged against the
 *   matching currency balance (fees are the only cash movements: position
 *   notional is margined, not paid; realized P&L is tracked per position —
 *   the W003 Portfolio consistency law is equity = cash + realized +
 *   unrealized).
 * - A missing currency balance starts at zero and may go negative (fees in
 *   a currency the account never held are still charged — honest books,
 *   visible in projections, never silently dropped).
 * - Permissions (canTrade, canShort, liveExecutionAllowed: false) are the
 *   declared fail-closed set (A14) — carried verbatim, never widened.
 * - Cumulative fees paid per currency are tracked for audit/evidence.
 */

import type { AccountId, CurrencyCode, Money } from "tradrl-world-contracts";
import type { WorldEventEnvelope } from "tradrl-world-contracts";
import { isOrderFilledPayload } from "../matching/index.js";
import { parseScaled, type Scaled } from "../orderbook/index.js";
import { formatSignedMoney } from "../portfolio/index.js";
import type { WorldDefinition } from "../world/definition.js";

/** One account's authoritative ledger (exact scaled balances). */
export interface AccountLedger {
  readonly accountId: AccountId;
  /** Currency → exact balance (insertion order: declaration, then fees). */
  readonly balances: Readonly<Record<string, Scaled>>;
  /** Currency → cumulative fees charged (audit trail). */
  readonly feesPaid: Readonly<Record<string, Scaled>>;
  /** Declared leverage (integer ≥ 1 — validated at definition time). */
  readonly leverage: number;
  /** The account's base currency (the declared buyingPower currency). */
  readonly baseCurrency: CurrencyCode;
  /** The declared fail-closed permission set (A14). */
  readonly permissions: {
    readonly canTrade: boolean;
    readonly canShort: boolean;
    readonly liveExecutionAllowed: false;
  };
}

/** The account ledger slice of the financial state. */
export interface AccountLedgerState {
  /** Keyed by account id (opaque ids are Record keys, never parsed). */
  readonly accounts: Readonly<Record<string, AccountLedger>>;
}

/** Build the initial ledger state from the declared accounts. */
export function initialAccountLedgerState(definition: WorldDefinition): AccountLedgerState {
  const accounts: Record<string, AccountLedger> = {};
  for (const account of definition.accounts) {
    const balances: Record<string, Scaled> = {};
    for (const [currency, money] of Object.entries(account.balances)) {
      balances[currency] = parseScaled(money.amount);
    }
    accounts[String(account.accountId)] = {
      accountId: account.accountId,
      balances,
      feesPaid: {},
      leverage: account.leverage,
      baseCurrency: account.buyingPower.currency,
      permissions: account.permissions,
    };
  }
  return { accounts };
}

/** The ledger of one account (undefined when the world never declared it). */
export function ledgerOf(state: AccountLedgerState, accountId: AccountId): AccountLedger | undefined {
  return state.accounts[String(accountId)];
}

function withChargedFee(
  ledger: AccountLedger,
  currency: string,
  feeScaled: Scaled,
): AccountLedger {
  const balances = { ...ledger.balances };
  const feesPaid = { ...ledger.feesPaid };
  balances[currency] = (balances[currency] ?? 0n) - feeScaled;
  feesPaid[currency] = (feesPaid[currency] ?? 0n) + feeScaled;
  return { ...ledger, balances, feesPaid };
}

/**
 * Reduce one journaled event into the ledger state. Only fills move cash
 * (their venue-scheduled fee, R022 — the fee amount was computed by the
 * matcher from the venue schedule and journaled on the fill).
 */
export function reduceAccountLedgerEvent(
  state: AccountLedgerState,
  envelope: WorldEventEnvelope,
): AccountLedgerState {
  if (envelope.eventType !== "matching.order.filled" || !isOrderFilledPayload(envelope.payload)) {
    return state;
  }
  const payload = envelope.payload;
  const key = String(payload.accountId);
  const ledger = state.accounts[key];
  if (ledger === undefined) {
    // a fill for an account the world never declared: a corrupt journal —
    // the matching seam only accepts declared accounts (unknown-account at
    // validate), so this cannot happen through the command lifecycle.
    throw new Error(`account ledger reducer: fill references unknown account ${key}`);
  }
  const fee = parseScaled(payload.fee.amount);
  if (fee === 0n) {
    return state;
  }
  return {
    accounts: {
      ...state.accounts,
      [key]: withChargedFee(ledger, String(payload.fee.currency), fee),
    },
  };
}

/** Project one ledger's balances into the W003 Money shape (canonical text). */
export function projectBalances(ledger: AccountLedger): readonly Money[] {
  return Object.entries(ledger.balances).map(([currency, scaled]) => ({
    amount: formatLedgerMoney(scaled),
    currency: currency as CurrencyCode,
  }));
}

/** Format a ledger balance as canonical signed decimal text (fees charged). */
export function formatLedgerMoney(scaled: Scaled): Money["amount"] {
  return formatSignedMoney(scaled) as Money["amount"];
}
