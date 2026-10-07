/**
 * Branch genesis state — what a branch world is born with (W016 `branch`
 * module).
 *
 * Spec: spec/ARCHITECTURE.md §8 "Counterfactual — snapshot-derived child
 * world with explicit altered scenario rules" and §9 "Branching".
 * Spec: spec/ACCEPTANCE-WORLD-ALPHA.md G — mutating a child world must not
 * alter its parent snapshot/history (the child gets its OWN state object
 * graph here; nothing is shared mutably).
 *
 * The genesis state is the source snapshot's authoritative state with three
 * deliberate transformations:
 * 1. RESCOPE — every inherited matching entity (orders/fills/trades) is
 *    stamped with the branch world id: the branch's authoritative state is
 *    explicitly scoped to the branch (DOMAIN-MODEL "Tenant/project/world
 *    scope is explicit"). Opaque ids and causal references (marketRef
 *    sequences, order ids) are inherited verbatim — that is the honest
 *    provenance of the inherited market state.
 * 2. RESET — the snapshot/branch registries start empty: "snapshots taken
 *    in this world" and "branches created from this world" are per-world
 *    registries; the branch's ancestry lives in its lineage chain and
 *    WorldMeta.parentWorldId.
 * 3. OVERRIDE — `configuration.scenarioOverride` replaces the inherited
 *    scenario in force (counterfactual branches, ARCHITECTURE.md §8).
 */

import type { BranchConfiguration, WorldId } from "tradrl-world-contracts";
import type { FinancialState } from "../account/index.js";
import type { MatchingState } from "../matching/index.js";
import type { WorldState } from "../world/state.js";
import { hydrateWorldState } from "../snapshot/stateCodec.js";
import type { WorldSnapshot } from "../snapshot/capture.js";

/** Rescope every world-stamped matching entity to the branch world id. */
function rescopeMatching(matching: MatchingState, worldId: WorldId): MatchingState {
  return {
    ...matching,
    orders: matching.orders.map((order) => ({ ...order, worldId })),
    fills: matching.fills.map((fill) => ({ ...fill, worldId })),
    trades: matching.trades.map((trade) => ({ ...trade, worldId })),
    // books and armedStops carry no world stamps (instrument/order keyed).
  };
}

/**
 * Rescope the inherited financial slice (W015): position records are
 * world-stamped (like every inherited entity), while the ledgers and the
 * risk runtime are account-keyed and inherit verbatim — the branch starts
 * from the parent's exact account truth (balances, realized P&L, breach
 * history, peak equity).
 */
function rescopeFinancial(financial: FinancialState, worldId: WorldId): FinancialState {
  return {
    ...financial,
    portfolio: {
      positions: financial.portfolio.positions.map((record) => ({ ...record, worldId })),
    },
  };
}

/**
 * The state a branch world starts from: the snapshot's authoritative state,
 * rescoped, registries reset, scenario overridden when configured. The
 * branch's journal is EMPTY — its events start at sequence 1 — so the
 * inherited acked-command ids stay in the duplicate-command law (a re-issued
 * parent command id is rejected: its effects are already in the inherited
 * state).
 */
export function branchGenesisState(input: {
  readonly snapshot: WorldSnapshot;
  readonly branchWorldId: WorldId;
  readonly configuration?: BranchConfiguration;
}): WorldState {
  const inherited = hydrateWorldState(input.snapshot.state);
  const override = input.configuration?.scenarioOverride;
  return Object.freeze({
    annotations: inherited.annotations,
    ...(inherited.currentScenario === undefined && override === undefined
      ? {}
      : { currentScenario: override ?? inherited.currentScenario }),
    ackedCommandIds: inherited.ackedCommandIds,
    matching: rescopeMatching(inherited.matching, input.branchWorldId),
    financial: rescopeFinancial(inherited.financial, input.branchWorldId),
    // W017: the generator slice (regime in force) has no world stamps —
    // the branch inherits the regime truth of the parent's snapshot cursor.
    market: inherited.market,
    snapshots: [],
    branches: [],
  } as WorldState);
}
