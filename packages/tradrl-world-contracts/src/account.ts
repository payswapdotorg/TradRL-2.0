/**
 * Account contracts.
 *
 * Spec: spec/ARCHITECTURE.md §5 — Account: balances, buying power, margin,
 * leverage, permissions.
 * Spec: spec/ARCHITECTURE-LOCK.md A14 / spec/ACCEPTANCE-WORLD-ALPHA.md K —
 * World Alpha contains no live execution authority: `liveExecutionAllowed`
 * is the literal type `false` (fail-closed; enabling it is a contract change,
 * never a data change).
 */

import type { AccountId, WorldId } from "./ids.js";
import type { CurrencyCode, Money, Ratio } from "./primitives.js";

/**
 * Account permissions. `liveExecutionAllowed` is typed as the literal
 * `false` so no simulated world can accidentally grant live execution
 * (fail-closed simulation/live boundary).
 */
export interface AccountPermissions {
  readonly canTrade: boolean;
  readonly canShort: boolean;
  readonly liveExecutionAllowed: false;
}

/**
 * A trading account inside one world.
 * Balances are per-currency money; buying power and margin are explicit.
 */
export interface Account {
  readonly accountId: AccountId;
  readonly worldId: WorldId;
  readonly balances: Readonly<Record<CurrencyCode, Money>>;
  readonly buyingPower: Money;
  readonly marginUsed: Money;
  readonly marginAvailable: Money;
  readonly leverage: Ratio;
  readonly permissions: AccountPermissions;
}
